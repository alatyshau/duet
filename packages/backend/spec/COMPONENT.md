# Backend

Python HTTP backend serving REST API and MCP endpoint for Duet.

> Shared model (pointer, DuetData, DuetConfig, entities, version flow, spawn): see [/spec/PRODUCT.md](/spec/PRODUCT.md)

## Glossary

| Term | Definition |
|------|------------|
| **Entity** | Node in DB: `context`, `product_repo`, or `reference_repo` |
| **Context** | Bounded folder on Drive carrying `context.json` v3 |
| **Manifest** | `context.json` v3 — strict reader; Host owns upgrades |
| **Chain** | Path from meta/root context down to the current context |
| **Alias** | Key in a context's `git_repos` map — the github repo name (e.g. `Duet`), no `.git`. The Duet-ontology slug for the product is `{alias}.git` — same string on disk (`DuetData/repos/{alias}.git/`), in DB (`product_repo.name`), and in orientation (`product.name`, `product.path` = `@{alias}.git`) |
| **Product** | Top-level unit in orientation, discovered by four rules (§2.2 of design-doc): A `git_repos` alias, B `<context>/spec/PRODUCT.md`, C `<sub>/spec/PRODUCT.md` without sub's own `context.json`, D README fallback |
| **Component** | Nested unit inside a product. Marker is `spec/COMPONENT.md` or `README*.md`, found one level deep (four-path priority §2.3) |

Entity hierarchy, manifests, name uniqueness, ownership of self-heal (Host): see PRODUCT.md

## Architecture

```
server.py (entry point, lifecycle)
    |
    +-- mcp_handler.py (MCP tools, service getters)
    |
    +-- services/
    |   +-- workspace.py (WorkspaceService — orientation response)
    |   +-- entities.py (EntitiesService — /contexts, /scan)
    |   +-- products.py (products/components discovery, §2 algorithm)
    |
    +-- scanner.py (hierarchy scan, strict v3 reader)
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
| `scanner.py` | Hierarchy scan (strict v3 reader), terminal `git_repos` → N product_repo | HTTP, config writes, manifest upgrades, products/components discovery |
| `services/products.py` | Build orientation `products[]` array + components (§2 algorithm) | DB writes, HTTP |
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
| POST | `/orientation` | Body: `{"workspace_paths": [...]}`. Returns duet_paths, workspace, context, products[] (v3 shape — see Orientation section) |
| GET | `/contexts` | Returns `{ contexts: [...] }` — `type='context'` entities. Each entity includes `absolute_path`, `git_url`, `git_repos` (map `{alias: url}` read from manifest or `null`), `meta`, `reference_repos`, `description` |
| POST | `/scan` | Returns `{ status, entities_count, duration_ms, errors[] }` |
| POST | `/merge-duet-instructions` | Merges bootstrapper + per-agent core + skills table → one file per agent. Returns `{ status, paths: { agent_name: path }, errors[] }` |

#### `/scan` Behavior

**Debounce:** If last scan completed < 5 seconds ago, returns `{ status: "skipped", reason: "recent_scan", entities_count: 0, errors: [] }`. All scan responses conform to `ScanResult` shape (via `make_scan_result()` factory).

**Blocking:** Scan runs synchronously. During scan, backend does NOT respond to other requests. Typical duration: 1-5 seconds.

**Why this is OK:** Single-user local app. One person, one machine, predictable behavior.

**Scan errors:** `errors[]` in response contains `{path, reason_code, description}`. Reason codes: `name_collision`, `repo_collision`, `invalid_manifest`, `unrecognized_manifest_version`. Backend never writes manifests; Host owns missing-file creation and version upgrades.

**`run_scan_with_cache()`:** Shared function (in `server.py`) that runs scan + writes JSON cache (scan.json, contexts.json). Used by both `POST /scan` handler and ManifestWatcher.

#### Manifest Watcher

Watches root context folders for changes to `context.json` manifests. On change — auto-rescan.

**Library:** `watchfiles` (async-native, Rust notify-rs). Uses OS-level events: FSEvents (macOS), inotify (Linux), ReadDirectoryChangesW (Windows).

**Lifecycle:**

| Event | Action |
|-------|--------|
| Backend startup | If `root_context_folders` non-empty → initial scan + start watcher |
| Manifest file changed | Debounce 10s → `run_scan_with_cache()` |
| `POST /scan` completes | If folders changed → restart watcher |
| Backend shutdown | Stop watcher |

**Debounce:** 10s (watchfiles `debounce` parameter). Collects burst of filesystem events, fires one scan. On top of `EntitiesService` 5s debounce (10s > 5s, always passes).

**Data flow:** Manifest changed → watcher → scan → `scan.json` and `contexts.json` updated → Host file watcher on `DuetData/data/` → UI refresh. No new IPC or endpoints.

**Filter:** `ManifestFilter` — only passes changes to files named `context.json`. All other filesystem events ignored.

**Folder tracking:** Watcher watches specific folder paths. When `root_context_folders` change (add/remove via settings), `maybe_restart()` compares current watched list with new list and restarts if different.

Implementation: `watcher.py`

#### JSON Cache Pattern

Backend writes operation results to `DuetData/data/` as JSON files (atomic write). Consumers (Host, Extension) use file watchers instead of polling HTTP.

| File | Source | Consumers |
|------|--------|-----------|
| `DuetData/duet-{agent}.md` (one per agent in `index.json.agents`, e.g. `duet-executor.md`, `duet-vizir.md`) | `POST /merge-duet-instructions` | Host → writes to AI client configs |
| `DuetData/data/duet-instructions-errors.json` | `POST /merge-duet-instructions` | Host wizard (step 6) |
| `DuetData/data/scan.json` | `POST /scan` | Host wizard (step 5), Extension (tree) |
| `DuetData/data/contexts.json` | `GET /contexts` | Extension (tree without HTTP) |

**Atomic write:** All files written via `.new` → rename → `.old` → delete. File watcher never sees half-written file. Implementation: `fileio.py:atomic_write()`.

### MCP Tools

| Tool | Notes |
|------|-------|
| `timestamp` | Returns string directly |
| `duet_data_path` | Returns string directly |
| `orientation` | Returns dict directly |
| `contexts` | Returns list directly |
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

1. Classify each path: `git` (under DuetData/repos/) or `context` (contains `context.json`) or ignored
2. Resolve entities from classified paths
3. If the meta-context (`meta=true`) is among the resolved entities, it wins; otherwise the first resolved context is used.

Multi-repo contexts (`git_repos` with N aliases) unify all `repos/<alias>.git` paths to one owner: each path resolves through its `product_repo` entity to the same parent context. Opening `[repos/Duet.git, repos/Duet-Instructions.git, DuetLab Drive]` returns the same DuetLab context regardless of which path the agent opened.

`meta: true` — field in `context.json`. Identifies the meta-context (e.g. БАЗА) in all-contexts workspace.

**Response (v3 shape):**

| Block | Fields | When |
|-------|--------|------|
| `duet_paths` | duetDataPath, machineConfig, instructionsPath | Always (422 if instructionsPath not configured) |
| `workspace` | kind, context_name, context_folder, git_folders[, addons] | Always |
| `context` | breadcrumb, chain[{type, name, icon, description?}] | When entity resolved |
| `products` | [{name, path, spec?, description?, components: [...]}] | When entity resolved |

**`workspace` fields (§3.1):**

| Field | Type | Value |
|-------|------|-------|
| `kind` | string | `"context"` for a resolved entity, `"unknown"` for unresolved paths |
| `context_name` | string \| null | Current context name (= last `context.chain[]` entry) |
| `context_folder` | string \| null | Absolute path to the context's Drive folder |
| `git_folders` | map | `{alias: expected_absolute_path}` for every alias declared in the context's `git_repos` map. The path is always `{repos}/{alias}.git` regardless of whether the clone exists on disk — consumers check `Path(...).exists()` to detect a missing clone. Empty `{}` when the context has no `git_repos`. Order matches manifest insertion |
| `reference_repos` | map, optional | `{name.git: absolute_path}` for existing reference clones (addon when manifest declares any) |

**Meta-context addons** (only when `entity.meta=true`):

| Field | Value |
|-------|-------|
| `root_context_folders` | Map `{name: absolute_path}` of every top-level context |
| `duet_data_folder` | Absolute path to DuetData |

Unknown workspace adds `reason` discriminator (`no_workspace_path` \| `path_not_in_hierarchy` \| `entity_not_in_db`) and the four canonical fields with empty / null values.

**`products[*]` fields (§3.2):**

| Field | Type | Value |
|-------|------|-------|
| `name` | string | Duet-ontology slug. Rule A: `{alias}.git` (alias from `git_repos` + `.git` derived suffix — matches clone folder and `product_repo.name` in DB). Rules B/D: context name. Rule C: subfolder name. No `.git` on drive-products since they have no clone. |
| `path` | string | @-ref. Git: `@<alias>.git`; Drive (B/D): `@<context_name>`; Drive (C): `@<context_name>/<sub>` |
| `spec` | string, optional | Relative path to spec file (e.g. `spec/PRODUCT.md`). Absent when description came from README |
| `description` | string, optional | First sentence from the spec or README |
| `components` | array | `[{name, path, spec?, description?}]`, see §3.3 |

**`products[*].components[*]` fields (§3.3):**

| Field | Type | Value |
|-------|------|-------|
| `name` | string | Subfolder name |
| `path` | string | Relative to `product.path`. E.g. `packages/backend` or `MetaMathematics` |
| `spec` | string, optional | Relative to `component.path`. E.g. `spec/COMPONENT.md` |
| `description` | string, optional | First sentence from the spec or README |

**Discovery rules** (normative source: design-doc §2):

- Products: A — `git_repos` aliases; B — `<context>/spec/PRODUCT.md`; C — `<sub>/spec/PRODUCT.md` without `<sub>/context.json`; D — README fallback when A/B/C all empty.
- Components: per-product, one level deep, four ordered paths: `packages/<comp>/spec/COMPONENT.md` → `packages/<comp>/README*.md` → `<comp>/spec/COMPONENT.md` → `<comp>/README*.md`.
- Skip-list (`drafts`, `work`, `archive`, `ARCHIVE`, `bin`, `out`, `dist`, `build`, `node_modules`, `target`, `__pycache__`, `.venv`, `venv`, `src`, `spec`, `docs`, `tests`, `test`, `examples`, hidden dotfiles) applies at every level. `packages` is the monorepo container, never itself a component.
- README*.md priority: exact `README.md` wins; otherwise alphabetically first `README*.md`.

**Path conventions (§3.4):** Absolute paths only in `workspace` (`context_folder`, `git_folders[*]`). Inside `products[]` and `components[]` — @-ref or relative. Consumers resolve via `workspace.git_folders[alias]` (strip `@` and `.git` suffix) or `workspace.context_folder`. `product.spec` is relative to `product.path`; `component.spec` is relative to `component.path`. Optional fields are omitted when absent (no `null` placeholders); empty collections are explicit (`components: []`, `git_folders: {}`).

**chain[].description priority:** `context.json::description` field (when present and non-empty) > first sentence of `README.md` at the context's Drive folder.

**chain[].icon:** always present, mirrors `Entity.icon` (set by Scanner from the manifest, or the default — `📚` meta, `📦` terminal with `git_repos`, `📁` intermediate). Same field as `ContextEntity.icon` returned by `GET /contexts`; orientation now carries it through so КОНТЕКСТ-view in Extension can render the emoji label without an extra round-trip.

**Algorithm:** see design-doc §2 (normative). This spec carries only the contract surface; the algorithm lives in `services/products.py`.

**REST note:** `/orientation` is POST (JSON body avoids URL-length issues with long paths containing non-ASCII characters). Returns result directly (not wrapped).

### `/merge-duet-instructions` — Merged Instructions (multi-agent)

`POST /merge-duet-instructions` — merges platform bootstrapper + each agent's core file + skills table into one file per agent. Writes results to `DuetData/duet-{agent}.md` for every entry in `index.json.agents`.

**Pipeline:** `merge_duet_instructions()` in `instructions.py`:
1. Reads `bootstrapper.md` (bundled with backend, both markers required) — once.
2. Reads `index.json` — once. Required field: `agents: { name → relative_path }` map.
3. Builds skills table (name, shortcuts, path, description, trigger, noTrigger) — once. Shared across agents.
4. Scans workspace for version-suffix files (`_v2`, `_v3`, …) — once.
5. For each agent in `index.agents`:
   - Reads agent file at `instructionsPath / relative_path`.
   - Extracts user content (first H2 onwards, H1 stripped).
   - Substitutes both bootstrapper markers (`<!-- INSERT USER CORE INSTRUCTIONS -->`, `<!-- INSERT SKILLS TABLE -->`).
   - Writes `DuetData/duet-{agent}.md` (atomic).
6. Writes errors to `DuetData/data/duet-instructions-errors.json` (atomic).

**Response:** `{ status: "ok" | "error", paths: { agent_name: "/absolute/path" }, errors: [{path, reason_code, description}] }`.

**Status semantics (strict):**
- `"ok"` ⇔ every agent declared in `index.agents` was merged successfully (validation warnings are allowed).
- `"error"` ⇔ a fatal pre-condition failed (bootstrapper, index, no agents declared) OR at least one agent merge failed. Successfully merged agents still appear in `paths`; failed ones do not.

**Error reason codes:** `no_frontmatter`, `invalid_yaml`, `missing_fields`, `missing_description`, `frontmatter_too_large`, `version_suffix`, `content_between_h1_h2`, `no_h2_found`, `bootstrapper_not_found`, `bootstrapper_missing_marker`, `index_not_found`, `index_invalid`, `index_missing_field`, `agent_file_not_found`.

**Consumer:** Host reads `DuetData/duet-{agent}.md` from disk and writes them to AI client config files (Claude Code: output-style + per-agent custom subagents in `~/.claude/agents/`; Codex/Antigravity: only `duet-executor.md` content). No HTTP fetch for content — file-based delivery via JSON cache pattern.

## Description Extraction (`description.py`)

Extracts description from markdown — first sentence of first paragraph after H1, or H1 text if next content is structural.

Used by: `context.chain[].description` (from README.md), `components[].description` (from spec file).

## Spec File Lookup

The v3 orientation algorithm (§2 of design-doc) uses **single canonical files** for spec discovery:

| Where | Spec file |
|-------|-----------|
| product (git, rule A) | `<git>/spec/PRODUCT.md` (else README*.md fallback) |
| product (drive, rule B) | `<context>/spec/PRODUCT.md` |
| product (drive, rule C) | `<sub>/spec/PRODUCT.md` |
| component | `<…>/<comp>/spec/COMPONENT.md` (else README*.md fallback) |

The legacy `find_spec_file()` fallback chain (`ARCHITECTURE.md`, `INDEX.md`, `BUSINESS.md`, `STREAM.md`) is no longer consulted by orientation — those names lingered from the pre-rename taxonomy. `description.py:find_spec_file()` is currently retained as a utility but is not on the orientation hot path.

## Business Rules

### Scanner

- Reads `root_context_folders` from `DuetConfig/settings.json`
- Resolves `@aliases` via `{machine}.json` (see PRODUCT.md -> @Alias Resolution)
- Strict v3 reader: never writes manifests; folders without `context.json` v3 are silently skipped; `version != 3` produces `unrecognized_manifest_version` error
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
8. Initial scan + start manifest watcher (if `root_context_folders` non-empty)
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
| Hierarchy scan | `scanner.py:_scan_context()` |
| Manifest reader | `services/manifest.py:read_manifest()` |
| Products/components discovery | `services/products.py:build_products()` |
| Description extraction | `description.py:extract_description()` |
| Spec file fallback (legacy) | `description.py:find_spec_file()` |
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
