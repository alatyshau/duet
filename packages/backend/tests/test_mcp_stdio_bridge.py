"""Tests for the stdio bridge that Claude Desktop launches to reach the Duet MCP endpoint.

A small threaded HTTP server stands in for the backend's `/mcp`: it hands out session
ids on `initialize`, answers 400 to a message without a session id and 404 to an unknown
one (as the real backend does), 202 to notifications, can "restart" (forget every
session) and can fail the next `initialize` calls. The tests pin what the client must see: answers on
the right ids, nothing for notifications, no trace of the bridge's own re-initialize,
and an error instead of silence when the backend is down.
"""

import json
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from mcp_stdio_bridge import Bridge, main

BRIDGE_SCRIPT = Path(__file__).parent.parent / "mcp_stdio_bridge.py"
PROTOCOL = "2025-06-18"

INITIALIZE = {
    "jsonrpc": "2.0",
    "id": 0,
    "method": "initialize",
    "params": {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "t"}},
}
INITIALIZED = {"jsonrpc": "2.0", "method": "notifications/initialized"}


def request(request_id, method="echo", params=None):
    return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}


class FakeBackend:
    """Mimics the parts of the backend's streamable-HTTP `/mcp` the bridge relies on."""

    def __init__(self, port=0):
        self.sessions: set[str] = set()
        self.seen: list[dict] = []
        self.deleted: list[str] = []
        self.fail_initialize = 0
        backend = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, status, body=b"", content_type="application/json", headers=None):
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.end_headers()
                self.wfile.write(body)

            def do_DELETE(self):
                session = self.headers.get("Mcp-Session-Id")
                backend.sessions.discard(session)
                backend.deleted.append(session)
                self._send(200)

            def do_POST(self):
                message = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                backend.seen.append(
                    {
                        "message": message,
                        "session": self.headers.get("Mcp-Session-Id"),
                        "protocol": self.headers.get("MCP-Protocol-Version"),
                    }
                )
                if message.get("method") == "initialize":
                    if backend.fail_initialize:
                        backend.fail_initialize -= 1
                        self._send(500, b"not ready", content_type="text/plain")
                        return
                    session = uuid.uuid4().hex
                    backend.sessions.add(session)
                    result = {"protocolVersion": PROTOCOL, "serverInfo": {"name": "duet"}}
                    body = {"jsonrpc": "2.0", "id": message["id"], "result": result}
                    self._send(200, json.dumps(body).encode(), headers={"Mcp-Session-Id": session})
                    return
                if not self.headers.get("Mcp-Session-Id"):
                    body = {
                        "jsonrpc": "2.0",
                        "id": "server-error",
                        "error": {"code": -32600, "message": "Bad Request: Missing session ID"},
                    }
                    self._send(400, json.dumps(body).encode())
                    return
                if self.headers.get("Mcp-Session-Id") not in backend.sessions:
                    body = {
                        "jsonrpc": "2.0",
                        "id": "server-error",
                        "error": {"code": -32600, "message": "Session not found"},
                    }
                    self._send(404, json.dumps(body).encode())
                    return
                if "id" not in message:
                    self._send(202)
                    return
                method = message["method"]
                if method == "boom":
                    self._send(500, b"kaboom", content_type="text/plain")
                    return
                body = json.dumps(
                    {"jsonrpc": "2.0", "id": message["id"], "result": {"echo": message["params"]}},
                    ensure_ascii=False,
                ).encode("utf-8")
                if method == "sse":
                    self._send(200, b"event: message\ndata: " + body + b"\n\n", "text/event-stream")
                    return
                self._send(200, body)

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/mcp/"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def restart(self):
        """Forget every session, as a restarted backend does."""
        self.sessions.clear()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def backend():
    server = FakeBackend()
    yield server
    server.stop()


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def make_bridge(url, **kwargs):
    emitted: list[dict] = []
    kwargs.setdefault("connect_timeout", 0.3)
    kwargs.setdefault("retry_interval", 0.05)
    return Bridge(url, emitted.append, **kwargs), emitted


def connect(bridge):
    bridge.handle(INITIALIZE)
    bridge.handle(INITIALIZED)


class TestForwarding:
    """Messages pass through with the session the backend handed out."""

    def test_initialize_answer_reaches_client_and_session_is_kept(self, backend):
        bridge, emitted = make_bridge(backend.url)
        bridge.handle(INITIALIZE)

        assert emitted[0]["id"] == 0
        assert emitted[0]["result"]["serverInfo"] == {"name": "duet"}
        assert bridge.session_id in backend.sessions

    def test_request_carries_session_and_protocol_headers(self, backend):
        bridge, emitted = make_bridge(backend.url)
        connect(bridge)
        bridge.handle(request(1, params={"x": 1}))

        assert emitted[-1] == {"jsonrpc": "2.0", "id": 1, "result": {"echo": {"x": 1}}}
        assert backend.seen[-1]["session"] == bridge.session_id
        assert backend.seen[-1]["protocol"] == PROTOCOL

    def test_notification_produces_no_output(self, backend):
        bridge, emitted = make_bridge(backend.url)
        bridge.handle(INITIALIZE)
        emitted.clear()
        bridge.handle(INITIALIZED)

        assert emitted == []
        assert backend.seen[-1]["message"] == INITIALIZED

    def test_sse_answer_is_unwrapped(self, backend):
        bridge, emitted = make_bridge(backend.url)
        connect(bridge)
        bridge.handle(request(7, method="sse", params={"k": "v"}))

        assert emitted[-1] == {"jsonrpc": "2.0", "id": 7, "result": {"echo": {"k": "v"}}}


class TestBackendRestart:
    """A restarted backend forgets the session; the client must not notice."""

    def test_request_after_restart_is_answered_on_a_new_session(self, backend):
        bridge, emitted = make_bridge(backend.url)
        connect(bridge)
        old_session = bridge.session_id
        backend.restart()
        emitted.clear()

        bridge.handle(request(2))

        assert emitted == [{"jsonrpc": "2.0", "id": 2, "result": {"echo": {}}}]
        assert bridge.session_id != old_session
        assert bridge.session_id in backend.sessions

    def test_replayed_initialize_keeps_client_params_and_is_followed_by_initialized(
        self, backend
    ):
        bridge, _ = make_bridge(backend.url)
        connect(bridge)
        backend.restart()
        backend.seen.clear()

        bridge.handle(request(3))

        methods = [entry["message"].get("method") for entry in backend.seen]
        assert methods == ["echo", "initialize", "notifications/initialized", "echo"]
        replay = backend.seen[1]["message"]
        assert replay["params"] == INITIALIZE["params"]
        assert replay["id"] != INITIALIZE["id"]

    def test_concurrent_requests_after_restart_open_one_session(self, backend):
        bridge, emitted = make_bridge(backend.url)
        connect(bridge)
        backend.restart()
        backend.seen.clear()
        emitted.clear()

        workers = [threading.Thread(target=bridge.handle, args=(request(i),)) for i in range(5)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()

        assert sorted(answer["id"] for answer in emitted) == [0, 1, 2, 3, 4]
        assert all("result" in answer for answer in emitted)
        replays = [e for e in backend.seen if e["message"].get("method") == "initialize"]
        assert len(replays) == 1


    def test_failed_replay_is_retried_on_the_next_request(self, backend):
        bridge, emitted = make_bridge(backend.url)
        connect(bridge)
        backend.restart()
        backend.fail_initialize = 1
        emitted.clear()

        bridge.handle(request(5))
        bridge.handle(request(6))

        assert emitted[0]["id"] == 5 and "error" in emitted[0]
        assert emitted[1] == {"jsonrpc": "2.0", "id": 6, "result": {"echo": {}}}
        forwarded = [e for e in backend.seen if e["message"].get("method") == "echo"]
        assert all(entry["session"] for entry in forwarded)

    def test_initialize_that_failed_is_replayed_before_the_next_request(self, backend):
        backend.fail_initialize = 1
        bridge, emitted = make_bridge(backend.url)
        bridge.handle(INITIALIZE)
        bridge.handle(INITIALIZED)

        bridge.handle(request(8))

        assert "error" in emitted[0]
        assert emitted[-1] == {"jsonrpc": "2.0", "id": 8, "result": {"echo": {}}}


class TestFailures:
    """Every request gets an answer, even when the backend cannot give one."""

    def test_http_error_becomes_json_rpc_error_on_request_id(self, backend):
        bridge, emitted = make_bridge(backend.url)
        connect(bridge)
        bridge.handle(request(4, method="boom"))

        assert emitted[-1]["id"] == 4
        assert "500" in emitted[-1]["error"]["message"]
        assert "kaboom" in emitted[-1]["error"]["message"]

    def test_unreachable_backend_answers_request_with_error(self):
        bridge, emitted = make_bridge(f"http://127.0.0.1:{free_port()}/mcp/")
        bridge.handle(INITIALIZE)

        assert emitted[0]["id"] == 0
        assert "not reachable" in emitted[0]["error"]["message"]

    def test_unreachable_backend_drops_notification_silently(self):
        bridge, emitted = make_bridge(f"http://127.0.0.1:{free_port()}/mcp/")
        bridge.handle(INITIALIZED)

        assert emitted == []

    def test_backend_that_starts_late_is_waited_for(self):
        port = free_port()
        bridge, emitted = make_bridge(f"http://127.0.0.1:{port}/mcp/", connect_timeout=5)
        late: list[FakeBackend] = []
        timer = threading.Timer(0.5, lambda: late.append(FakeBackend(port)))
        timer.start()
        try:
            bridge.handle(INITIALIZE)
        finally:
            timer.join()
            for server in late:
                server.stop()

        assert emitted[0]["result"]["serverInfo"] == {"name": "duet"}


class TestProcess:
    """The script as Claude Desktop runs it: lines on stdin, lines on stdout."""

    def test_round_trip_over_stdio_keeps_unicode_and_closes_session(self, backend):
        lines = [INITIALIZE, INITIALIZED, request(1, params={"text": "Привет, Duet"})]
        stdin = "".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines)

        result = subprocess.run(
            [sys.executable, str(BRIDGE_SCRIPT), backend.url],
            input=stdin.encode("utf-8"),
            capture_output=True,
            timeout=30,
        )

        answers = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines()]
        assert [answer["id"] for answer in answers] == [0, 1]
        assert answers[1]["result"] == {"echo": {"text": "Привет, Duet"}}
        assert b"forwarding stdio to" in result.stderr
        assert backend.deleted and backend.sessions == set()

    def test_garbage_line_is_skipped(self, backend):
        stdin = "not json\n" + json.dumps(INITIALIZE) + "\n"

        result = subprocess.run(
            [sys.executable, str(BRIDGE_SCRIPT), backend.url],
            input=stdin.encode("utf-8"),
            capture_output=True,
            timeout=30,
        )

        answers = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines()]
        assert [answer["id"] for answer in answers] == [0]

    def test_missing_url_is_a_usage_error(self):
        assert main(["mcp_stdio_bridge.py"]) == 2


def test_waits_do_not_slow_the_happy_path(backend):
    """Retries only kick in on failure: a live backend answers without delay."""
    bridge, _ = make_bridge(backend.url, connect_timeout=30, retry_interval=5)
    started = time.monotonic()
    connect(bridge)
    bridge.handle(request(1))

    assert time.monotonic() - started < 2
