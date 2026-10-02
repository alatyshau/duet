"""Stdio bridge to the Duet MCP endpoint, for clients that can only launch stdio servers.

Claude Desktop reads MCP servers from `claude_desktop_config.json` and can only start a
process and talk JSON-RPC to it over stdin/stdout. Host registers this script there, run
by the DuetData venv Python, so Claude Desktop reaches the same `/mcp` endpoint that the
other clients reach over HTTP:

    python mcp_stdio_bridge.py http://127.0.0.1:19680/mcp/

Standard library only, so the bridge does not depend on the MCP SDK version in the venv.
It relies on the backend answering every request with plain JSON (`json_response=True`
in `mcp_handler.py`); an SSE answer is still parsed, but the server→client GET stream is
not opened, because the backend never pushes messages on its own.

Two failures are absorbed rather than passed to the client:
- the backend is not up yet (Claude Desktop starts at login, often before Host has
  started the backend) or is restarting during a deploy: connection errors are retried
  until `connect_timeout` runs out;
- the backend restarted and forgot the session (`404`): the bridge replays the client's
  own `initialize` on a new session and resends the request once.

Anything else wrong becomes a JSON-RPC error on the request's id, so the client is never
left waiting. Diagnostics go to stderr, which Claude Desktop writes to
`mcp-server-duet.log`.
"""

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable

SESSION_HEADER = "Mcp-Session-Id"
PROTOCOL_HEADER = "MCP-Protocol-Version"

# Seconds to keep retrying while the backend is unreachable.
CONNECT_TIMEOUT = 30.0
RETRY_INTERVAL = 0.5
# Seconds one HTTP exchange may take; long enough for a full rescan behind a tool call.
REQUEST_TIMEOUT = 300.0

INTERNAL_ERROR = -32603

Message = dict[str, Any]


class BackendUnreachable(Exception):
    """The backend did not accept a connection within the retry window."""


class Response:
    """One HTTP answer from the backend, read in full."""

    def __init__(self, status: int, headers: Any, body: bytes) -> None:
        self.status = status
        self.headers = headers
        self.body = body

    def messages(self) -> list[Any]:
        """JSON-RPC messages carried by the body (plain JSON or SSE `data:` lines)."""
        if not self.body.strip():
            return []
        content_type = (self.headers.get("Content-Type") or "").lower()
        if content_type.startswith("text/event-stream"):
            return [
                json.loads(line[5:].strip())
                for line in self.body.decode("utf-8").splitlines()
                if line.startswith("data:") and line[5:].strip()
            ]
        return [json.loads(self.body)]


def log(text: str) -> None:
    print(f"[duet-bridge] {text}", file=sys.stderr, flush=True)


def is_request(message: Any) -> bool:
    return isinstance(message, dict) and "method" in message and "id" in message


def error_response(request_id: Any, text: str) -> Message:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": INTERNAL_ERROR, "message": text}}


class Bridge:
    """Forwards client messages to the backend and emits the backend's answers."""

    def __init__(
        self,
        url: str,
        emit: Callable[[Any], None],
        connect_timeout: float = CONNECT_TIMEOUT,
        retry_interval: float = RETRY_INTERVAL,
        request_timeout: float = REQUEST_TIMEOUT,
    ) -> None:
        self.url = url
        self.emit = emit
        self.connect_timeout = connect_timeout
        self.retry_interval = retry_interval
        self.request_timeout = request_timeout
        self.session_id: str | None = None
        self.protocol_version: str | None = None
        self._initialize: Message | None = None
        self._session_lock = threading.Lock()
        self._reinit_count = 0

    # -- transport ---------------------------------------------------------------

    def _post_once(self, message: Any, session_id: str | None) -> Response:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if session_id:
            headers[SESSION_HEADER] = session_id
        if self.protocol_version:
            headers[PROTOCOL_HEADER] = self.protocol_version
        request = urllib.request.Request(
            self.url,
            data=json.dumps(message, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.request_timeout) as answer:
                return Response(answer.status, answer.headers, answer.read())
        except urllib.error.HTTPError as answer:
            return Response(answer.code, answer.headers, answer.read())

    def _post(self, message: Any, session_id: str | None) -> Response:
        """POST, retrying connection failures until `connect_timeout` runs out."""
        deadline = time.monotonic() + self.connect_timeout
        warned = False
        while True:
            try:
                return self._post_once(message, session_id)
            except (urllib.error.URLError, ConnectionError) as exc:
                reason = getattr(exc, "reason", exc)
                if time.monotonic() >= deadline:
                    raise BackendUnreachable(str(reason)) from exc
                if not warned:
                    log(f"backend at {self.url} not reachable ({reason}), retrying")
                    warned = True
                time.sleep(self.retry_interval)

    # -- session -----------------------------------------------------------------

    def _remember_session(self, response: Response) -> None:
        session_id = response.headers.get(SESSION_HEADER)
        if session_id:
            self.session_id = session_id
        for message in response.messages():
            result = message.get("result") if isinstance(message, dict) else None
            if isinstance(result, dict) and result.get("protocolVersion"):
                self.protocol_version = result["protocolVersion"]

    def _reinitialize(self, stale_session: str | None) -> bool:
        """Open a new session by replaying the client's initialize. False if impossible.

        `session_id` changes only when the backend hands out a new one: a failed replay
        leaves the stale id in place, so the next message meets a 404 and tries again
        (without any id the backend answers 400, which would never trigger a retry).
        """
        with self._session_lock:
            if self.session_id != stale_session:
                return True  # another thread already reopened it
            if self._initialize is None:
                return False
            self._reinit_count += 1
            replay = dict(self._initialize, id=f"duet-bridge-reinit-{self._reinit_count}")
            response = self._post(replay, None)
            if response.status != 200 or not response.headers.get(SESSION_HEADER):
                log(f"re-initialize failed: HTTP {response.status}")
                return False
            self._remember_session(response)
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, self.session_id)
            log("opened a new backend session (backend restarted?)")
            return True

    # -- messages ----------------------------------------------------------------

    def handle(self, message: Any) -> None:
        """Forward one client message; emit whatever the backend answers to it."""
        request_id = message.get("id") if is_request(message) else None
        try:
            if isinstance(message, dict) and message.get("method") == "initialize":
                self._initialize = message
                with self._session_lock:
                    response = self._post(message, None)
                    if response.status == 200:
                        self._remember_session(response)
            else:
                session_id = self.session_id
                if session_id is None and self._initialize is not None:
                    # The client's own initialize never got a session (backend was down).
                    self._reinitialize(None)
                    session_id = self.session_id
                response = self._post(message, session_id)
                if response.status == 404 and self._reinitialize(session_id):
                    response = self._post(message, self.session_id)
            self._deliver(message, response)
        except BackendUnreachable as exc:
            log(f"backend at {self.url} unreachable: {exc}")
            if is_request(message):
                self.emit(
                    error_response(
                        request_id,
                        f"Duet backend is not reachable at {self.url} ({exc}). "
                        "Is Duet running?",
                    )
                )
        except Exception as exc:  # never leave the client waiting on a request
            log(f"failed to forward {message!r:.200}: {exc!r}")
            if is_request(message):
                self.emit(error_response(request_id, f"Duet stdio bridge error: {exc}"))

    def _deliver(self, message: Any, response: Response) -> None:
        if 200 <= response.status < 300:
            for answer in response.messages():
                self.emit(answer)
            return
        text = response.body.decode("utf-8", errors="replace").strip()
        log(f"backend answered HTTP {response.status}: {text[:500]}")
        if is_request(message):
            # The backend's own error body carries id "server-error", not the request's.
            self.emit(
                error_response(message["id"], f"Duet backend HTTP {response.status}: {text[:500]}")
            )

    def close(self) -> None:
        """End the backend session, best effort."""
        if not self.session_id:
            return
        request = urllib.request.Request(
            self.url, headers={SESSION_HEADER: self.session_id}, method="DELETE"
        )
        try:
            urllib.request.urlopen(request, timeout=2).close()
        except Exception:
            pass


def serve(url: str, stdin: Any, stdout: Any) -> None:
    """Read newline-delimited JSON-RPC from `stdin` until EOF, answering on `stdout`."""
    out_lock = threading.Lock()

    def emit(message: Any) -> None:
        line = json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n"
        with out_lock:
            stdout.write(line.encode("utf-8"))
            stdout.flush()

    bridge = Bridge(url, emit)
    workers: list[threading.Thread] = []
    log(f"forwarding stdio to {url}")
    for raw in stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError as exc:
            log(f"ignoring a line that is not JSON: {exc}")
            continue
        if is_request(message) and message.get("method") != "initialize":
            # Requests run concurrently, so a long tool call does not hold up the rest.
            worker = threading.Thread(target=bridge.handle, args=(message,), daemon=True)
            worker.start()
            workers = [w for w in workers if w.is_alive()] + [worker]
        else:
            # initialize must finish before anything else uses the session;
            # notifications and responses keep their order.
            bridge.handle(message)
    for worker in workers:
        worker.join(timeout=5)
    bridge.close()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: mcp_stdio_bridge.py <backend MCP URL>", file=sys.stderr)
        return 2
    serve(argv[1], sys.stdin.buffer, sys.stdout.buffer)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
