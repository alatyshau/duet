# Backend

Python HTTP backend serving REST API and MCP endpoint for Duet.

> Shared model (pointer, DuetData, DuetConfig, entities, version flow, spawn): see [/spec/PRODUCT.md](/spec/PRODUCT.md)

## Glossary

| Term | Definition |
|------|------------|
| **Entity** | Node in hierarchy: business, stream, product, project |
| **Manifest** | JSON file: business.json, stream.json, product.json |
| **Chain** | Path from root business to current entity |
| **Component** | Package in product's `packages/` with optional `spec/` |

Entity hierarchy, manifests, name uniqueness, self-healing: see PRODUCT.md

## Architecture

```
server.py (entry point, lifecycle)
    |
    +-- mcp_handler.py (MCP tools, service getters)
    |
    +-- services/
    |   +-- workspace.py (WorkspaceService)
    |   +-- entities.py (EntitiesService)
    |
    +-- scanner.py (hierarchy scan, self-healing)
    +-- description.py (extract_description, find_spec_file)
    +-- db.py (SQLite operations)
    +-- config.py (read-only configuration)
```

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Python (not TS) | Native sqlite3, DuckDB, LanceDB support |
| HTTP (not stdio) | One process owns DB, no race conditions |
| Services layer | DI for testability, separation of concerns |
| Pointer-based config | Reads pointer -> settings.json + {machine}.json |

## Module Responsibilities

| Module | Does | Does NOT |
|--------|------|----------|
| `server.py` | HTTP routes, lifecycle, DI init, logging setup | Business logic |
| `mcp_handler.py` | MCP tool registration, service getters | DB access |
| `services/*.py` | Business logic, atomic file writes | Direct HTTP, MCP |
| `scanner.py` | Hierarchy scan, self-healing, scan_components | HTTP, config writes |
| `instructions.py` | Scan instructions workspace, parse YAML frontmatter | DB, HTTP |
| `description.py` | Extract description from markdown, spec file fallback chains | DB, HTTP |
| `db.py` | SQLite CRUD | Business rules |
| `pointer.py` | Read pointer file | Write pointer |
| `aliases.py` | Resolve `@alias` -> absolute path | Config management |
| `config.py` | Read pointer + settings + machine config, path getters | Write config files |

## Boundaries (CRITICAL)

| Rule | Enforced |
|------|----------|
| services/ never imports server.py | Layer isolation |
| scanner.py never imports mcp_handler | Domain isolation |
| config.py never writes files | Read-only contract |
| db.py never validates business rules | Just CRUD |

## API Contracts

### REST Endpoints

| Method | Path | Contract |
|--------|------|----------|
| GET | `/health` | Returns `{ status, version, uptime_seconds }` |
| POST | `/stop` | Returns `{ status: "stopping" }`, triggers shutdown |
| GET | `/timestamp` | Returns `{ timestamp: "YYMMDD_HHMMSS<tz>" }` |
| GET | `/duet-data-path` | Returns `{ path: "/absolute/path" }` |
| GET | `/workspace-info` | Query: `workspace_paths` (repeated). Returns duet_paths, instructions, context, workspace_paths, key_files, components |
| GET | `/streams` | Returns `{ streams: [...] }` — business/stream/product + active projects under business/stream. Each entity includes `absolute_path`, `status` |
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

### workspace_info v3

`GET /workspace-info?workspace_paths=...&workspace_paths=...` — primary orientation endpoint for AI agents.

MCP tool: `workspace_info(workspace_paths: list[str])` — accepts all workspace paths available to the agent.

**Multi-path entity resolution:**

1. Classify each path: `gitFolders` (under DuetData/repos/) or `streamFolders` (contains manifest) or ignored
2. Resolve entities from classified paths
3. Prioritize: root business (`root: true`) > business > stream > product > project

`root: true` — field in `business.json`. Identifies the meta-business (e.g. БАЗА) in all-businesses workspace.

**Response (status=found):**

| Block | Fields | When |
|-------|--------|------|
| `duet_paths` | duetDataPath, machineConfig | Always |
| `instructions` | basePath, personas[], skills[] | When instructionsPath configured |
| `context` | breadcrumb, chain[{type, name, description?}] | When entity resolved |
| `workspace_paths` | workspace_type, main_folder, projects_folder? | When entity resolved |
| `key_files` | spec?, readme? | When files exist |
| `components` | [{name, path, spec?, description?}] | When product in chain |

**instructions block:** Dynamic catalog built from YAML frontmatter.
- `basePath`: absolute path to instructions workspace (from machine.json `instructionsPath`)
- `personas[]`: `{name, description, shortcuts?, path}` — relative to basePath
- `skills[]`: `{category, name, description, shortcuts?, trigger?, noTrigger?, path}` — relative to basePath
- Scanned from `index.json` in instructions workspace (declares persona path + skill_folders)

**workspace_type values:** `product_folder_with_git_repo` | `product_folder` | `stream_folder` | `business_folder` | `project_folder` | `unknown` (fallback for unexpected entity types)

**status=unknown reasons:** `no_workspace_path` | `path_not_in_hierarchy` | `entity_not_in_db`

**projects_folder:** Created on demand (mkdir) for product/stream. Absent for business/project.

**Path conventions:** `key_files` contains absolute paths (for direct agent use). `components[].path` and `components[].spec` are relative to `main_folder` (compact, resolved by consumer).

**REST exception:** `/workspace-info` returns result directly (not wrapped in `{ workspace_info: {...} }`), because the response is already a structured object with extensible top-level keys (`status`, `duet_paths`, etc.).

## Description Extraction (`description.py`)

Extracts description from markdown — first sentence of first paragraph after H1, or H1 text if next content is structural.

Used by: `context.chain[].description` (from README.md), `components[].description` (from spec file).

## Spec File Fallback (`description.py`)

`find_spec_file(root_path, entity_type)` — searches `spec/` for first existing file:

| Entity type | Chain |
|-------------|-------|
| product | PRODUCT.md > COMPONENT.md > ARCHITECTURE.md > README.md > INDEX.md |
| component | COMPONENT.md > ARCHITECTURE.md > README.md > INDEX.md |
| stream | STREAM.md > COMPONENT.md > ARCHITECTURE.md > README.md > INDEX.md |
| business | BUSINESS.md > COMPONENT.md > ARCHITECTURE.md > README.md > INDEX.md |
| project | PROJECT.md > COMPONENT.md > ARCHITECTURE.md > README.md > INDEX.md |

Used by: `key_files.spec`, `components[].spec`.

## Business Rules

### Scanner

- Reads `business_folders` from `DuetConfig/settings.json`
- Resolves `@aliases` via `{machine}.json` (see PRODUCT.md -> @Alias Resolution)
- Stores results in `DuetData/data/entities.db` (native sqlite3)

### Config Reading Order

```
pointer.py -> ~/.org.ve68.duet
config.py  -> DuetConfig/settings.json + {machine}.json
           -> DuetData/backend/VERSION
```

**Backend-specific contracts:**
- `config.py` is read-only — never writes config files
- `aliases.py:resolve_alias()` fails fast on unresolved alias (`AliasNotFoundError`)
- `config.get_version()` raises `ConfigError` if VERSION file not found

## Logging

```
DuetData/backend.log  <- RotatingFileHandler
+-- Max size: 5 MB
+-- Backups: 1 (backend.log.1)
+-- Format: YYYY-MM-DD HH:MM:SS [LEVEL] message
```

## Lifecycle

### Startup

```
1. Read pointer file
2. setup_logging() -> RotatingFileHandler
3. Validate config (VERSION, port, settings)
4. check_pid_file() -> exit if already running
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
+-- conftest.py          # Centralized fixtures
+-- fixtures/
|   +-- entities.py      # EntityFactory
|   +-- filesystem.py    # DuetDataBuilder, ManifestBuilder, HierarchyBuilder
+-- test_*.py
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

## File Paths

| Path | Purpose |
|------|---------|
| `DuetData/data/entities.db` | Backend's SQLite database |
| `DuetData/backend/VERSION` | Installed backend version |
| `DuetData/backend.log` | Backend log file |

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
| Description extraction | `description.py:extract_description()` |
| Spec file fallback | `description.py:find_spec_file()` |
| Instructions scanning | `instructions.py:scan_instructions()` |
| Frontmatter parsing | `instructions.py:parse_frontmatter()` |
| SQLite schema | `db.py:_init_schema()` |
| Config reading | `config.py` |
| Pointer reading | `pointer.py` |
| Alias resolution | `aliases.py` |
| PID lifecycle | `server.py:write_pid_file/check_pid_file` |
| Logging setup | `server.py:setup_logging()` |

## Running

```bash
python server.py                                          # reads ~/.org.ve68.duet
DUET_POINTER_FILE=/tmp/test-pointer python server.py      # test override
```
