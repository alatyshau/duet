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
import os
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

import config
from config import (
    get_business_folders,
    get_db_path,
    get_log_path,
    get_pid_path,
    get_port,
    get_timezone,
    get_version,
)
from db import DatabaseManager
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
    global _shutdown_event
    if _shutdown_event:
        _shutdown_event.set()
    return JSONResponse({"status": "stopping"})


async def timestamp_handler(request: Request) -> JSONResponse:
    """GET /timestamp - Current timestamp."""
    return JSONResponse({"timestamp": get_timestamp()})


async def duet_data_path_handler(request: Request) -> JSONResponse:
    """GET /duet-data-path - Path to DuetData."""
    return JSONResponse({"path": get_duet_data_path_str()})


async def workspace_info_handler(request: Request) -> JSONResponse:
    """GET /workspace-info - Full workspace information."""
    workspace_path = request.query_params.get("workspace_path")
    result = get_workspace_service().get_workspace_info(workspace_path)
    return JSONResponse(result)


async def streams_handler(request: Request) -> JSONResponse:
    """GET /streams - Get all streams (business/stream/product) without projects."""
    result = get_entities_service().get_streams()
    return JSONResponse({"streams": result})


async def projects_handler(request: Request) -> JSONResponse:
    """GET /projects/{stream_id} - Get projects for a stream."""
    stream_id_str = request.path_params.get("stream_id", "")
    try:
        stream_id = int(stream_id_str)
    except ValueError:
        return JSONResponse(
            {"error": "Invalid stream_id: must be an integer", "code": "BAD_REQUEST"},
            status_code=400,
        )

    result = get_entities_service().get_projects(stream_id)
    return JSONResponse({"projects": result})


async def scan_handler(request: Request) -> JSONResponse:
    """POST /scan - Rescan hierarchy."""
    start = time.time()
    result = get_entities_service().run_scan()
    result["duration_ms"] = int((time.time() - start) * 1000)
    return JSONResponse(result)


# === Lifecycle Management ===


def write_pid_file() -> None:
    """Write current PID to lockfile."""
    pid_path = get_pid_path()
    pid_path.parent.mkdir(parents=True, exist_ok=True)
    pid_path.write_text(str(os.getpid()))


def remove_pid_file() -> None:
    """Remove PID lockfile."""
    pid_path = get_pid_path()
    try:
        pid_path.unlink()
    except FileNotFoundError:
        pass


def check_pid_file() -> int | None:
    """Check if PID file exists and process is running.

    Returns PID if running, None otherwise.
    """
    pid_path = get_pid_path()
    if not pid_path.exists():
        return None

    try:
        pid = int(pid_path.read_text().strip())
        # Check if process is running (signal 0 doesn't kill)
        os.kill(pid, 0)
        return pid
    except (ValueError, ProcessLookupError, PermissionError):
        # Invalid PID or process not running
        return None


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

    # Write PID file
    write_pid_file()

    logger.info(f"Duet backend started (version {get_version()})")

    # Setup signal handlers for graceful shutdown
    loop = asyncio.get_event_loop()

    def handle_signal():
        if _shutdown_event:
            _shutdown_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, handle_signal)

    # Initialize MCP session manager (required for streamable HTTP transport)
    async with mcp.session_manager.run():
        try:
            yield
        finally:
            # Cleanup
            db.close()
            remove_pid_file()
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
        Route("/workspace-info", workspace_info_handler, methods=["GET"]),
        Route("/streams", streams_handler, methods=["GET"]),
        Route("/projects/{stream_id}", projects_handler, methods=["GET"]),
        Route("/scan", scan_handler, methods=["POST"]),
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

    # Trigger graceful shutdown
    server.should_exit = True
    await server_task


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
        get_business_folders()
    except ConfigError as e:
        logger.error(f"Config error: {e}")
        logger.error(
            "Run Duet Host to create pointer file and configuration."
        )
        sys.exit(1)

    # Check if already running
    existing_pid = check_pid_file()
    if existing_pid:
        logger.error(f"Backend already running (PID {existing_pid})")
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
