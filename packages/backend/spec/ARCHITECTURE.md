# Backend Architecture

> Shared model (pointer, DuetData, DuetConfig, version flow, spawn): see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md)

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
| Pointer-based config | Reads pointer → settings.json + {machine}.json |

## Module Responsibilities

| Module | Does | Does NOT |
|--------|------|----------|
| `server.py` | HTTP routes, lifecycle, DI init, logging setup | Business logic |
| `mcp_handler.py` | MCP tool registration, service getters | DB access |
| `services/*.py` | Business logic, atomic file writes | Direct HTTP, MCP |
| `scanner.py` | Hierarchy scan, self-healing, scan_components | HTTP, config writes |
| `db.py` | SQLite CRUD | Business rules |
| `pointer.py` | Read pointer file | Write pointer |
| `aliases.py` | Resolve `@alias` → absolute path | Config management |
| `config.py` | Read pointer + settings + machine config, path getters | Write config files |

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
| Pointer reading | `pointer.py` |
| Alias resolution | `aliases.py` |
| PID lifecycle | `server.py:write_pid_file/check_pid_file` |
| Logging setup | `server.py:setup_logging()` |

## API Contracts

### REST Endpoints

| Method | Path | Contract |
|--------|------|----------|
| GET | `/health` | Returns `{ status, version, uptime_seconds }` |
| POST | `/stop` | Returns `{ status: "stopping" }`, triggers shutdown |
| GET | `/timestamp` | Returns `{ timestamp: "YYMMDD_HHMMSS<tz>" }` |
| GET | `/duet-data-path` | Returns `{ path: "/absolute/path" }` |
| GET | `/workspace-info` | Query: `workspace_path`. Returns chain, components |
| GET | `/streams` | Returns `{ streams: [...] }` — all business/stream/product. Each entity includes `absolute_path` (resolved from `drive_path` via business_folders) |
| GET | `/projects/{stream_id}` | Returns `{ projects: [...] }` — projects of a stream. Each entity includes `absolute_path` |
| POST | `/scan` | Returns `{ status, entities_count, duration_ms }` |

#### `/scan` Behavior

**Debounce:** If last scan completed < 5 seconds ago, returns `{ status: "skipped", reason: "recent_scan" }`.

**Blocking:** Scan runs synchronously. During scan, backend does NOT respond to other requests. Typical duration: 1-5 seconds.

**Why this is OK:** Single-user local app. One person, one machine, predictable behavior.

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

**Format note:** REST wraps in `{ key: value }` (extensibility), MCP returns data directly (AI convenience).

**Contracts:**
- `/stop` is REST-only (AI must not stop backend)
- Errors: `McpError` with JSON-RPC codes (`INVALID_PARAMS` -32602, `INTERNAL_ERROR` -32603)
- Empty result returns `[]`, not exception

## Logging

```
DuetData/backend.log  ← RotatingFileHandler
├── Max size: 5 MB
├── Backups: 1 (backend.log.1)
└── Format: YYYY-MM-DD HH:MM:SS [LEVEL] message
```

## Lifecycle

### Startup

```
1. Read pointer file
2. setup_logging() → RotatingFileHandler
3. Validate config (VERSION, port, settings)
4. check_pid_file() → exit if already running
5. db.init()
6. Create services (DI)
7. init_services()
8. write_pid_file()
9. Start uvicorn
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
workspace_service = WorkspaceService(db)
entities_service = EntitiesService(db)
init_services(workspace_service, entities_service, _start_time)

# Usage (anywhere)
get_workspace_service().get_workspace_info(...)
```

**Contract:** Services initialized once in lifespan. Never create new instances elsewhere.

## Python Environment

**One venv for monorepo:** at repo root (`.venv/`), shared by all Python packages.

```bash
.venv/bin/python    # interpreter
.venv/bin/pytest    # test runner
```

**Contract:** Always use `.venv/bin/python`, never system Python.

## Testing

```bash
cd packages/backend && ../../.venv/bin/pytest
```

### Test Infrastructure

```
tests/
├── conftest.py          # Centralized fixtures
├── fixtures/
│   ├── entities.py      # EntityFactory
│   └── filesystem.py    # DuetDataBuilder, ManifestBuilder, HierarchyBuilder
└── test_*.py
```

| Fixture | Purpose |
|---------|---------|
| `duet_data` | Creates DuetData structure |
| `db` | DatabaseManager with test.db |
| `client` | Async HTTP test client (ASGI) |
| `EntityFactory` | Create Entity objects with defaults |
| `DuetDataBuilder` | Build custom DuetData structure |

**Contracts:**
- All tests use `tmp_path`. Never write to real DuetData.
- Use `EntityFactory` instead of raw Entity() construction.

## Running

```bash
python server.py                                          # reads ~/.org.ve68.duet
DUET_POINTER_FILE=/tmp/test-pointer python server.py      # test override
```
