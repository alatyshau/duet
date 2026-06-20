"""Duet Backend HTTP Server.

HTTP server with REST API and MCP endpoint.
Entry point for the Python backend.

New architecture:
- Backend reads pointer file (~/.org.ve68.duet) to find DuetData and DuetConfig
- No more --data-path argument needed
- For testing: set env DUET_POINTER_FILE to override pointer path

Usage:
    python server.py
"""

import argparse
import asyncio
import logging
import signal
import sys
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from config import (
    ConfigError,
    get_db_path,
    get_duet_data_path,
    get_instructions_path,
    get_log_path,
    get_port,
    get_root_context_folders,
    get_timezone,
    get_version,
)
from fileio import atomic_write_json
from instructions import merge_duet_instructions
from db import DatabaseManager
from watcher import ManifestWatcher
from mcp_handler import (
    get_duet_data_path_str,
    get_entities_service,
    get_timestamp,
    get_workspace_service,
    init_services,
    mcp,
)
from services.entities import EntitiesService
from services.workspace import WorkspaceService


# Logger
logger = logging.getLogger("duet")

# Server start time for uptime calculation
_start_time: float = 0

# Shutdown event
_shutdown_event: asyncio.Event | None = None

# Manifest watcher (initialized in lifespan)
_watcher: ManifestWatcher | None = None

# Timeout for uvicorn graceful shutdown (seconds).
# Host waits STOP_GRACE_PERIOD_MS (2s) = this timeout + 1s margin.
# See: packages/host/src/core/backend.ts → STOP_GRACE_PERIOD_MS
SHUTDOWN_TIMEOUT_S = 1.0


def setup_logging() -> None:
    """Setup logging to file with rotation.

    Logs to DuetData/backend.log with:
    - Max size: 5 MB
    - Backup count: 1 (keeps backend.log.1)
    - Format: timestamp [level] message
    """
    log_path = get_log_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # File handler with rotation
    file_handler = RotatingFileHandler(
        log_path,
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=1,
        encoding="utf-8",
    )
    file_handler.setLevel(logging.INFO)

    # Format: 2025-01-31 14:30:52 [INFO] message
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_handler.setFormatter(formatter)

    root_logger.addHandler(file_handler)

    # Also configure uvicorn loggers to use our handler
    # Set propagate=False to avoid duplicate logs through root logger
    for name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
        uv_logger = logging.getLogger(name)
        uv_logger.handlers = []
        uv_logger.addHandler(file_handler)
        uv_logger.propagate = False


# === REST API Handlers ===


async def health_handler(request: Request) -> JSONResponse:
    """GET /health - Health check with version and uptime."""
    uptime = int(time.time() - _start_time) if _start_time else 0
    return JSONResponse(
        {
            "status": "ok",
            "version": get_version(),
            "uptime_seconds": uptime,
        }
    )


async def stop_handler(request: Request) -> JSONResponse:
    """POST /stop - Graceful shutdown."""
    if _shutdown_event:
        _shutdown_event.set()
    return JSONResponse({"status": "stopping"})


async def timestamp_handler(request: Request) -> JSONResponse:
    """GET /timestamp - Current timestamp."""
    return JSONResponse({"timestamp": get_timestamp()})


async def duet_data_path_handler(request: Request) -> JSONResponse:
    """GET /duet-data-path - Path to DuetData."""
    return JSONResponse({"path": get_duet_data_path_str()})


async def orientation_handler(request: Request) -> JSONResponse:
    """POST /orientation - Full workspace orientation.

    Request body: {"workspace_paths": ["/path1", "/path2"]}
    Response includes a `memory` field: the resolved context-memory pointer
    `{ref, path}` (from `context.json` → `memory`), or `null` when none declared.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"error": "Invalid JSON body", "code": "BAD_REQUEST"},
            status_code=400,
        )

    workspace_paths = body.get("workspace_paths", [])
    if not isinstance(workspace_paths, list):
        return JSONResponse(
            {"error": "'workspace_paths' must be a list", "code": "BAD_REQUEST"},
            status_code=400,
        )

    try:
        result = get_workspace_service().get_orientation(workspace_paths=workspace_paths)
    except ConfigError as e:
        return JSONResponse(
            {"error": str(e), "code": "CONFIG_ERROR"},
            status_code=422,
        )
    return JSONResponse(result)


async def contexts_handler(request: Request) -> JSONResponse:
    """GET /contexts - Get all context entities."""
    result = get_entities_service().get_contexts()
    response = {"contexts": result}

    # JSON cache: write for file watcher consumers (Host, Extension)
    try:
        cache_path = get_duet_data_path() / "data" / "contexts.json"
        atomic_write_json(cache_path, response)
    except Exception as e:
        logger.warning(f"Failed to write contexts cache: {e}")

    return JSONResponse(response)


def run_scan_with_cache() -> dict:
    """Run scan and write JSON cache files.

    Shared by scan_handler (HTTP) and ManifestWatcher (auto-rescan).
    Returns scan result dict with duration_ms.
    """
    start = time.time()
    result = get_entities_service().run_scan()
    result["duration_ms"] = int((time.time() - start) * 1000)

    # JSON cache: write scan result + fresh contexts for file watcher consumers
    if result.get("status") == "completed":
        try:
            data_dir = get_duet_data_path() / "data"
            atomic_write_json(data_dir / "scan.json", result)
            contexts = get_entities_service().get_contexts()
            atomic_write_json(data_dir / "contexts.json", {"contexts": contexts})
        except Exception as e:
            logger.warning(f"Failed to write scan cache: {e}")

        # Restart watcher if root context folders changed
        if _watcher:
            try:
                _watcher.maybe_restart(get_root_context_folders())
            except Exception as e:
                logger.warning(f"Failed to update watcher: {e}")

    return result


async def scan_handler(request: Request) -> JSONResponse:
    """POST /scan - Rescan hierarchy."""
    return JSONResponse(run_scan_with_cache())


async def deploy_instructions_handler(request: Request) -> JSONResponse:
    """POST /deploy-instructions - Deploy a context's instruction components.

    Request body: {"workspace_paths": ["/path1", "/path2"]}. Resolves the
    owning context and materializes its `skills` / `instructions` declarations
    into its Drive folder. Idempotent.

    Response: {status, deployed: {...}, warnings: [...]}.
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            {"error": "Invalid JSON body", "code": "BAD_REQUEST"},
            status_code=400,
        )

    workspace_paths = body.get("workspace_paths", [])
    if not isinstance(workspace_paths, list):
        return JSONResponse(
            {"error": "'workspace_paths' must be a list", "code": "BAD_REQUEST"},
            status_code=400,
        )

    try:
        result = get_workspace_service().deploy_instructions(workspace_paths)
    except ConfigError as e:
        return JSONResponse(
            {"error": str(e), "code": "CONFIG_ERROR"},
            status_code=422,
        )
    return JSONResponse(result)


async def merge_instructions_handler(request: Request) -> JSONResponse:
    """POST /merge-duet-instructions - Merge bootstrapper + per-agent core + skills table.

    Iterates agents declared in index.json (e.g. executor, vizir) and writes one
    merged file per agent to DuetData/duet-{agent}.md.
    Errors aggregated into DuetData/data/duet-instructions-errors.json.

    Response: { status, paths: { agent: absolute_path }, errors: [...] }.
    """
    # Bundled/deployed: electron-builder copies bootstrapper.md next to server.py
    # (packages/instructions/ -> backend/). Dev: read it from the sibling package.
    bootstrapper_path = Path(__file__).parent / "bootstrapper.md"
    if not bootstrapper_path.exists():
        bootstrapper_path = Path(__file__).parent.parent / "instructions" / "bootstrapper.md"
    try:
        instructions_path = get_instructions_path()
        duet_data = get_duet_data_path()
        errors_path = duet_data / "data" / "duet-instructions-errors.json"

        result = merge_duet_instructions(
            bootstrapper_path, instructions_path, duet_data, errors_path
        )
        return JSONResponse(result)
    except ConfigError as e:
        return JSONResponse(
            {"error": str(e), "code": "CONFIG_ERROR"},
            status_code=422,
        )


# === Application Setup ===


@asynccontextmanager
async def lifespan(app: Starlette):
    """Application lifespan handler."""
    global _start_time

    _start_time = time.time()
    # Note: _shutdown_event is created in run_server() before app starts

    # Initialize database
    db = DatabaseManager()
    db.init()

    # Initialize services with DI
    workspace_service = WorkspaceService(db)
    entities_service = EntitiesService(db)

    # Initialize services (shared between REST and MCP handlers)
    init_services(workspace_service, entities_service, _start_time)

    logger.info(f"Duet backend started (version {get_version()})")

    # Setup signal handlers for graceful shutdown
    # add_signal_handler is Unix-only; on Windows host uses POST /stop
    if sys.platform != 'win32':
        loop = asyncio.get_event_loop()

        def handle_signal():
            if _shutdown_event:
                _shutdown_event.set()

        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, handle_signal)

    # Initial scan + manifest watcher
    global _watcher
    _watcher = ManifestWatcher(on_scan=run_scan_with_cache)
    try:
        folders = get_root_context_folders()
        if folders:
            logger.info("Running initial scan")
            run_scan_with_cache()
            _watcher.start(folders)
    except Exception as e:
        logger.warning(f"Initial scan/watcher failed: {e}")

    # Initialize MCP session manager (required for streamable HTTP transport)
    async with mcp.session_manager.run():
        try:
            yield
        finally:
            # Cleanup
            _watcher.stop()
            _watcher = None
            db.close()
            logger.info("Duet backend stopped")


def create_app() -> Starlette:
    """Create Starlette application."""
    # Create MCP app first to initialize session_manager (used in lifespan)
    mcp_app = mcp.streamable_http_app()

    routes = [
        Route("/health", health_handler, methods=["GET"]),
        Route("/stop", stop_handler, methods=["POST"]),
        Route("/timestamp", timestamp_handler, methods=["GET"]),
        Route("/duet-data-path", duet_data_path_handler, methods=["GET"]),
        Route("/orientation", orientation_handler, methods=["POST"]),
        Route("/contexts", contexts_handler, methods=["GET"]),
        Route("/scan", scan_handler, methods=["POST"]),
        Route("/deploy-instructions", deploy_instructions_handler, methods=["POST"]),
        Route("/merge-duet-instructions", merge_instructions_handler, methods=["POST"]),
        # Mount MCP at /mcp (streamable HTTP transport)
        Mount("/mcp", app=mcp_app),
    ]

    return Starlette(
        routes=routes,
        lifespan=lifespan,
    )


async def run_server(port: int, host: str = "127.0.0.1") -> None:
    """Run the server with shutdown support."""
    global _shutdown_event

    # Create shutdown event BEFORE starting server (fixes race condition)
    _shutdown_event = asyncio.Event()

    uconfig = uvicorn.Config(
        create_app(),
        host=host,
        port=port,
        log_config=None,  # Use our logging setup instead of uvicorn's default
    )
    server = uvicorn.Server(uconfig)

    # Run server in background task
    server_task = asyncio.create_task(server.serve())

    # Wait for shutdown signal
    await _shutdown_event.wait()

    # Graceful shutdown: tell uvicorn to exit, then wait with timeout.
    #
    # When managed by Host (normal mode):
    #   Host sends SIGTERM → SIGKILL if needed. The timeout below never fires.
    #
    # When running standalone (dev/testing, no Host):
    #   No external process to send SIGTERM. Without timeout, open MCP/SSE
    #   connections would keep uvicorn alive forever after /stop.
    #   The 1s timeout + cancel() is the only safety net.
    server.should_exit = True
    try:
        await asyncio.wait_for(server_task, timeout=SHUTDOWN_TIMEOUT_S)
    except asyncio.TimeoutError:
        logger.warning("Server shutdown timed out, forcing exit")
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass


def main() -> None:
    """Main entry point.

    Backend reads pointer file (~/.org.ve68.duet) to find configuration.
    No arguments needed (except optional --help).
    """
    parser = argparse.ArgumentParser(description="Duet Backend Server")
    # No required arguments - backend reads pointer file
    parser.parse_args()

    # Setup logging to file
    # Note: This may fail if pointer is missing, but we want fast fail anyway
    try:
        setup_logging()
    except Exception as e:
        print(f"Failed to setup logging: {e}", file=sys.stderr)
        sys.exit(1)

    # Validate configuration before starting (fail fast)
    try:
        from config import get_duet_data_path, ConfigError

        duet_data = get_duet_data_path()
        get_version()
        get_port()
        get_timezone()
        get_root_context_folders()
        # instructionsPath not validated at startup — may not be configured yet
        # during initial wizard setup. Endpoints check it per-request.
    except ConfigError as e:
        logger.error(f"Config error: {e}")
        logger.error(
            "Run Duet Host to create pointer file and configuration."
        )
        sys.exit(1)

    # Read port from config (validated above)
    port = get_port()

    logger.info(f"Starting Duet backend on 127.0.0.1:{port}")
    logger.info(f"DuetData path: {duet_data}")

    # Ensure database directory exists
    get_db_path().parent.mkdir(parents=True, exist_ok=True)

    # Run server (will fail with error if port is busy)
    asyncio.run(run_server(port, "127.0.0.1"))


if __name__ == "__main__":
    main()
