# Backend

Python HTTP backend serving REST API and MCP endpoint for Duet.

> Shared model (pointer, DuetData, DuetConfig, entities, version flow, spawn): see [/spec/PRODUCT.md](/spec/PRODUCT.md)

## Glossary

| Term | Definition |
|------|------------|
| **Entity** | Node in hierarchy: business, stream, product |
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
    +-- watcher.py (manifest file watcher, auto-rescan)
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
| `watcher.py` | Watch manifest files, debounce, trigger rescan | DB, HTTP, config |
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
| POST | `/orientation` | Body: `{"workspace_paths": [...]}`. Returns duet_paths, instructions, workspace, context, key_files, components |
| GET | `/streams` | Returns `{ streams: [...] }` — business/stream/product. Each entity includes `absolute_path`, `status` |
| POST | `/scan` | Returns `{ status, entities_count, duration_ms, errors[] }` |
| POST | `/merge-duet-instructions` | Merges bootstrapper + core_instructions + skills table → file. Returns `{ status, path, errors[] }` |

#### `/scan` Behavior

**Debounce:** If last scan completed < 5 seconds ago, returns `{ status: "skipped", reason: "recent_scan", entities_count: 0, errors: [] }`. All scan responses conform to `ScanResult` shape (via `make_scan_result()` factory).

**Blocking:** Scan runs synchronously. During scan, backend does NOT respond to other requests. Typical duration: 1-5 seconds.

**Why this is OK:** Single-user local app. One person, one machine, predictable behavior.

**Scan errors:** `errors[]` in response contains `{path, reason_code, description, manifest_path?}`. Reason codes: `name_collision`, `repo_collision`, `missing_manifest`, `invalid_manifest`. Each error includes `manifest_path` for Host UI Fix button.

**`run_scan_with_cache()`:** Shared function (in `server.py`) that runs scan + writes JSON cache (scan.json, streams.json). Used by both `POST /scan` handler and ManifestWatcher.

#### Manifest Watcher

Watches business folders for changes to manifest files (`business.json`, `stream.json`, `product.json`). On change — auto-rescan.

**Library:** `watchfiles` (async-native, Rust notify-rs). Uses OS-level events: FSEvents (macOS), inotify (Linux), ReadDirectoryChangesW (Windows).

**Lifecycle:**

| Event | Action |
|-------|--------|
| Backend startup | If `business_folders` non-empty → initial scan + start watcher |
| Manifest file changed | Debounce 10s → `run_scan_with_cache()` |
| `POST /scan` completes | If folders changed → restart watcher |
| Backend shutdown | Stop watcher |

**Debounce:** 10s (watchfiles `debounce` parameter). Collects burst of filesystem events, fires one scan. On top of `EntitiesService` 5s debounce (10s > 5s, always passes).

**Data flow:** Manifest changed → watcher → scan → scan.json/streams.json updated → Host file watcher on `DuetData/data/` → UI refresh. No new IPC or endpoints.

**Filter:** `ManifestFilter` — only passes changes to files named `business.json`, `stream.json`, `product.json`. All other filesystem events ignored.

**Folder tracking:** Watcher watches specific folder paths. When `business_folders` change (add/remove via settings), `maybe_restart()` compares current watched list with new list and restarts if different.

Implementation: `watcher.py`

#### JSON Cache Pattern

Backend writes operation results to `DuetData/data/` as JSON files (atomic write). Consumers (Host, Extension) use file watchers instead of polling HTTP.

| File | Source | Consumers |
|------|--------|-----------|
| `DuetData/duet-instructions.md` | `POST /merge-duet-instructions` | Host → writes to AI client configs |
| `DuetData/data/duet-instructions-errors.json` | `POST /merge-duet-instructions` | Host wizard (step 6) |
| `DuetData/data/scan.json` | `POST /scan` | Host wizard (step 5), Extension (tree) |
| `DuetData/data/streams.json` | `GET /streams` | Extension (tree without HTTP) |

**Atomic write:** All files written via `.new` → rename → `.old` → delete. File watcher never sees half-written file. Implementation: `fileio.py:atomic_write()`.

### MCP Tools

| Tool | Notes |
|------|-------|
| `timestamp` | Returns string directly |
| `duet_data_path` | Returns string directly |
| `orientation` | Returns dict directly |
| `streams` | Returns list directly |
| `scan` | Returns dict directly |
| `health` | Returns `{ status, version, uptime_seconds }` |

**Format note:** REST wraps in `{ key: value }` (extensibility), MCP returns data directly (AI convenience).

**Contracts:**
- `/stop` is REST-only (AI must not stop backend)
- Errors: `McpError` with JSON-RPC codes (`INVALID_PARAMS` -32602, `INTERNAL_ERROR` -32603)
- Empty result returns `[]`, not exception

### Orientation

`POST /orientation` with body `{"workspace_paths": [...]}` — primary orientation endpoint for AI agents.

MCP tool: `orientation(workspace_paths: list[str])` — accepts all workspace paths available to the agent.

**Multi-path entity resolution:**

1. Classify each path: `gitFolders` (under DuetData/repos/) or `streamFolders` (contains manifest) or ignored
2. Resolve entities from classified paths
3. Prioritize: root business (`root: true`) > business > stream > product

`root: true` — field in `business.json`. Identifies the meta-business (e.g. БАЗА) in all-businesses workspace.

**Response (entity resolved):**

| Block | Fields | When |
|-------|--------|------|
| `duet_paths` | duetDataPath, machineConfig, instructionsPath | Always (422 if instructionsPath not configured) |
| `workspace` | type, topology, typed attributes, reference_repos? | Always |
| `context` | breadcrumb, chain[{type, name, description?}] | When entity resolved |
| `key_files` | spec?, readme? | When files exist |
| `components` | [{name, path, spec?, description?}] | When product in chain |

**workspace.type values:** `product_in_git` | `product_on_drive` | `stream` | `business` | `root_business` | `unknown`

**workspace.type-specific attributes:**

| Type | Attributes |
|------|------------|
| `product_in_git` | `git_folder`, `drive_folder` |
| `product_on_drive` | `drive_folder` |
| `stream` | `drive_folder` |
| `business` | `drive_folder` |
| `root_business` | `root_business_folder`, `business_folders` (map name→path), `duet_data_folder` |
| `unknown` | `reason` (`no_workspace_path` \| `path_not_in_hierarchy` \| `entity_not_in_db`) |

**workspace.topology:** Human-readable description of workspace layout. Appended with reference repos addon when applicable.

**workspace.reference_repos:** Map `{name.git: absolute_path}` of existing reference repo clones. Read from entity's manifest on disk (fresh data, no DB).

**Path conventions:** `key_files` contains absolute paths (for direct agent use). `components[].path` and `components[].spec` are relative to product git_folder/drive_folder (compact, resolved by consumer).

**REST note:** `/orientation` is POST (JSON body avoids URL-length issues with long paths containing non-ASCII characters). Returns result directly (not wrapped).

### `/merge-duet-instructions` — Merged Instructions

`POST /merge-duet-instructions` — merges platform bootstrapper + user core_instructions + skills table into a single file. Writes result to `DuetData/duet-instructions.md`.

**Pipeline:** `merge_duet_instructions()` in `instructions.py`:
1. Reads `bootstrapper.md` (bundled with backend), finds marker `<!-- INSERT USER CORE INSTRUCTIONS -->`
2. Reads `core_instructions` from `index.json`, extracts user content (first H2 onwards, H1 stripped)
3. Replaces marker with user content
4. Builds skills table (name, shortcuts, trigger), inserts at `<!-- INSERT SKILLS TABLE -->` marker
5. Writes merged result to `DuetData/duet-instructions.md` (atomic write)
6. Writes errors to `DuetData/data/duet-instructions-errors.json` (atomic write)

**Response:** `{ status: "ok"|"error", path: "/absolute/path" | null, errors: [{path, reason_code, description}] }`

**Error reason codes:** `no_frontmatter`, `invalid_yaml`, `missing_fields`, `frontmatter_too_large`, `content_between_h1_h2`, `no_h2_found`, `bootstrapper_not_found`, `bootstrapper_missing_marker`, `index_not_found`, `index_invalid`, `index_missing_field`, `core_instructions_not_found`

**Consumer:** Host reads `DuetData/duet-instructions.md` from disk and writes to AI client config files. No HTTP fetch for content — file-based delivery via JSON cache pattern.

**Behavior:** If merge fails fatally → `status: "error"`, `path: null`. If merge succeeds with validation warnings → `status: "ok"`, `path` set, `errors` may be non-empty.

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
3. Validate config (VERSION, port, settings; instructionsPath not required at startup)
4. check_pid_file() -> exit if already running
5. db.init()
6. Create services (DI)
7. init_services()
8. Initial scan + start manifest watcher (if business_folders non-empty)
9. write_pid_file()
10. Start uvicorn
```

### Shutdown

```
1. Receive SIGTERM/SIGINT or POST /stop
2. Set shutdown_event
3. Stop manifest watcher
4. db.close()
5. remove_pid_file()
6. Exit
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
get_workspace_service().get_orientation(...)
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
| Merge pipeline | `instructions.py:merge_duet_instructions()` |
| Frontmatter parsing | `instructions.py:parse_frontmatter()` |
| Manifest watcher | `watcher.py:ManifestWatcher` |
| Scan + cache (shared) | `server.py:run_scan_with_cache()` |
| Atomic file write | `fileio.py:atomic_write()` |
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
