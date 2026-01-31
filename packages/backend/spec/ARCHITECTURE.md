# Backend Architecture

## Overview

Python HTTP backend serving REST API and MCP endpoint for Duet.

```
server.py (entry point, lifecycle)
    │
    ├── mcp_handler.py (MCP tools, service getters)
    │
    ├── services/
    │   ├── workspace.py (WorkspaceService)
    │   └── entities.py (EntitiesService)
    │
    ├── scanner.py (hierarchy scan, self-healing)
    ├── db.py (SQLite operations)
    └── config.py (read-only configuration)
```

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Python (not TS) | Native sqlite3, DuckDB, LanceDB support |
| HTTP (not stdio) | One process owns DB, no race conditions |
| Services layer | DI for testability, separation of concerns |
| Read-only config | Extension is source of truth, backend never writes |

## Module Responsibilities

| Module | Does | Does NOT |
|--------|------|----------|
| `server.py` | HTTP routes, lifecycle, DI init | Business logic |
| `mcp_handler.py` | MCP tool registration, service getters | DB access |
| `services/*.py` | Business logic | Direct HTTP, MCP |
| `scanner.py` | Hierarchy scan, self-healing, scan_components | HTTP, config writes |
| `db.py` | SQLite CRUD | Business rules |
| `config.py` | Read config, path getters, get_version() | Write config |

## Version Contract

Version is stored in `config.json`, NOT in a separate file.

```
Extension (package.json)
    │
    │ writes "version" to config.json
    ▼
Backend (config.get_version())
    │
    │ returns via /health
    ▼
Extension (compares, restarts if needed)
```

**Contracts:**
- `config.get_version()` raises `RuntimeError` if version not set
- Extension MUST write version before starting backend
- `/health` response includes version for lifecycle check

## Boundaries (CRITICAL)

| Rule | Enforced |
|------|----------|
| services/ never imports server.py | Layer isolation |
| scanner.py never imports mcp_handler | Domain isolation |
| config.py never writes files | Read-only contract |
| db.py never validates business rules | Just CRUD |

## Navigation

| Concept | File |
|---------|------|
| HTTP endpoints | `server.py` |
| MCP tools | `mcp_handler.py` |
| Workspace info | `services/workspace.py` |
| Entity listing | `services/entities.py` |
| Hierarchy scan | `scanner.py` |
| Self-healing | `scanner.py` |
| Component scan | `scanner.py:scan_components()` |
| SQLite schema | `db.py:_init_schema()` |
| Config reading | `config.py` |
| PID lifecycle | `server.py:write_pid_file/check_pid_file` |

## API Contracts

### REST Endpoints

| Method | Path | Contract |
|--------|------|----------|
| GET | `/health` | Returns `{ status, version, uptime_seconds }` |
| POST | `/stop` | Returns `{ status: "stopping" }`, triggers shutdown |
| GET | `/timestamp` | Returns `{ timestamp: "YYMMDD_HHMMSS<tz>" }` |
| GET | `/duet-data-path` | Returns `{ path: "/absolute/path" }` |
| GET | `/workspace-info` | Query: `workspace_path`. Returns chain, components |
| GET | `/streams` | Returns `{ streams: [...] }` — all business/stream/product |
| GET | `/projects/{stream_id}` | Returns `{ projects: [...] }` — projects of a stream |
| POST | `/scan` | Returns `{ status, entities_count, duration_ms }` |

#### `/scan` Behavior

**Debounce:** If last scan completed < 5 seconds ago, returns `{ status: "skipped", reason: "recent_scan" }` immediately.

**Blocking:** Scan runs synchronously. During scan, backend does NOT respond to `/health` or `/stop`. Typical scan duration: 1-5 seconds depending on hierarchy size.

**Why this is OK:** Single-user local app. The user knows what buttons they pressed. Even with 10 VS Code windows from 3 different forks (Cursor, Antigravity, etc.) — it's still one person, one machine, predictable behavior.

**Future:** File watchers + WebSockets for reactive updates. Manual `/scan` will become rare.

### MCP Tools

| Tool | Notes |
|------|-------|
| `timestamp` | Returns string directly |
| `duet_data_path` | Returns string directly |
| `workspace_info` | Returns dict directly |
| `streams` | Returns list directly |
| `projects` | Takes `stream_id`, returns list directly |
| `scan` | Returns dict directly |
| `health` | Returns `{ status, version, uptime_seconds }` |

**Format note:** REST wraps in `{ key: value }` (extensibility), MCP returns data directly (AI convenience). Names and semantics are unified.

**Contracts:**
- `/stop` is REST-only (AI must not stop backend)
- Errors use standard MCP mechanism: `McpError` with JSON-RPC codes

### MCP Error Handling

Uses standard MCP `McpError` with JSON-RPC error codes:

```python
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData, INVALID_PARAMS

raise McpError(ErrorData(code=INVALID_PARAMS, message="stream_id must be integer"))
```

| Code | Constant | When |
|------|----------|------|
| `-32602` | `INVALID_PARAMS` | Invalid input parameters |
| `-32603` | `INTERNAL_ERROR` | Server/DB errors |

**Not errors:** Empty result (entity not found) returns `[]`, not exception.

## Lifecycle

### Startup

```
1. Parse --data-path argument
2. config.init(data_path)
3. check_pid_file() → exit if already running
4. db.init()
5. Create services (DI)
6. init_services()
7. write_pid_file()
8. Start uvicorn
```

### Shutdown

```
1. Receive SIGTERM/SIGINT or POST /stop
2. Set shutdown_event
3. db.close()
4. remove_pid_file()
5. Exit
```

**Contract:** PID file MUST be removed on any exit path.

## Dependency Injection

```python
# server.py lifespan
db = DatabaseManager()
workspace_service = WorkspaceService(db)  # DI
entities_service = EntitiesService(db)    # DI
init_services(workspace_service, entities_service, _start_time)

# Usage (anywhere)
get_workspace_service().get_workspace_info(...)
get_entities_service().get_entities(...)
```

**Contract:** Services initialized once in lifespan. Never create new instances elsewhere.

## Python Environment

**One venv for monorepo:** Virtual environment is at repo root (`.venv/`), shared by all Python packages.

```bash
# From repo root
.venv/bin/python    # Python interpreter
.venv/bin/pip       # Package manager
.venv/bin/pytest    # Test runner
```

**Contract:** All agents should use `.venv/bin/python` from repo root, never system Python.

## Testing

```bash
# Install dev dependencies (from repo root)
.venv/bin/pip install -r packages/backend/requirements-dev.txt

# Run tests (from packages/backend/)
cd packages/backend
../../.venv/bin/pytest
```

### Test Infrastructure

```
tests/
├── conftest.py          # Centralized fixtures (duet_data, db, client)
├── fixtures/
│   ├── __init__.py      # Exports all factories
│   ├── entities.py      # EntityFactory
│   └── filesystem.py    # DuetDataBuilder, ManifestBuilder, HierarchyBuilder
└── test_*.py
```

### Fixtures

| Fixture | Purpose |
|---------|---------|
| `duet_data` | Creates DuetData structure with config.json |
| `db` | DatabaseManager with test.db |
| `client` | Async HTTP test client (ASGI) |
| `EntityFactory` | Create Entity objects with defaults |
| `DuetDataBuilder` | Build custom DuetData structure |
| `ManifestBuilder` | Create manifest files |

### Test Coverage

| Test file | Coverage |
|-----------|----------|
| `test_config.py` | config.py ~95% |
| `test_db.py` | db.py ~90% |
| `test_scanner.py` | scanner.py ~85% |
| `test_lifecycle.py` | PID, /stop ~80% |
| `test_api.py` | REST endpoints ~90% |

**Contracts:**
- All tests use `tmp_path` fixture. Never write to real DuetData.
- `DuetDataBuilder` creates config.json with `version: "test"` by default.
- Use `EntityFactory` instead of raw Entity() construction.

## Running

```bash
# Development
python server.py --data-path ~/DuetData

# Production (spawned by Extension)
# Extension writes port to config.json, then:
python server.py --data-path {dataFolder}
```

**Contract:** `--data-path` is REQUIRED. No defaults, no env vars.
