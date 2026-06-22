# Backend

Python HTTP backend serving REST API and MCP endpoint for Duet.

> Domain model (contexts, manifests, invariants), pointer file, DuetData/DuetConfig layout, cross-component contracts: see [/spec/PRODUCT.md](/spec/PRODUCT.md). This file documents only what Backend itself owns and exposes.

## Purpose

Backend is the system's strict reader and DB owner. It does not write manifests, does not migrate schemas, does not own backend lifecycle (Host does). It reads config + manifests → builds `entities.db` → exposes a typed surface over REST and MCP for AI agents and the Extension.

Three things Backend is the only authority for:
1. **The entity database.** SQLite at `DuetData/data/entities.db`, native sqlite3.
2. **Orientation algorithm.** Resolves workspace paths → entity → products/components tree.
3. **Merged AI instructions.** Composes bootstrapper + per-agent core → one file per agent.

## Architecture

### Module Map

```
server.py (entry point, lifecycle)
    │
    ├── mcp_handler.py       MCP tools, service getters
    ├── services/
    │   ├── workspace.py     WorkspaceService — orientation response
    │   ├── entities.py      EntitiesService — /contexts, /scan
    │   ├── products.py      products/components discovery (product/component discovery)
    │   ├── deploy_instructions.py  deploy a context's skills/instructions into its Drive folder
    │   ├── at_paths.py      `@<name>/<rest>` resolver (repos / context folders)
    │   └── manifest.py      strict v4 manifest reader
    ├── scanner.py           hierarchy scan, strict v4 reader
    ├── watcher.py           manifest file watcher, auto-rescan
    ├── description.py       extract_description, spec file lookup
    ├── instructions.py      merge pipeline (multi-agent)
    ├── db.py                SQLite operations
    ├── config.py            read-only configuration
    ├── pointer.py           pointer file reader
    ├── aliases.py           @alias resolver
    ├── fileio.py            atomic_write()
    └── normalization.py     NFC paths
```

### Module Responsibilities

| Module | Does | Does NOT |
|--------|------|----------|
| `server.py` | HTTP routes, lifecycle, DI init, logging setup | Business logic |
| `mcp_handler.py` | MCP tool registration, service getters | DB access |
| `services/*.py` | Business logic, atomic file writes | Direct HTTP, MCP |
| `scanner.py` | Hierarchy scan (strict v4), `git_repos` → N product_repo while Drive context recursion continues | HTTP, config writes, manifest upgrades, products/components discovery |
| `services/products.py` | Build orientation `products[]` + components (product/component discovery) | DB writes, HTTP |
| `services/manifest.py` | Strict v4 manifest parsing (incl. optional `skills`/`instructions`/`memory` @-path declarations) | Migrations (Host owns) |
| `services/deploy_instructions.py` | Materialize a context's `skills` (`.claude/skills/<name>/`) + `instructions` (`CLAUDE/AGENTS/GEMINI.md`) into its Drive folder; idempotent | HTTP, @-path resolution policy, DB |
| `services/at_paths.py` | Resolve `@<repo-dir>` (under `DuetData/repos`) or `@<context-name>` (→ that context's Drive folder); reject `..` escape | File copy, HTTP, DB |
| `watcher.py` | Watch manifest files, debounce, trigger rescan | DB, HTTP, config |
| `instructions.py` | Merge bootstrapper + per-agent core → one file per agent | DB, HTTP |
| `description.py` | Extract description from markdown, spec file lookup | DB, HTTP |
| `db.py` | SQLite CRUD | Business rules |
| `pointer.py` | Read pointer file | Write pointer |
| `aliases.py` | Resolve `@alias` → absolute path | Config management |
| `config.py` | Read pointer + settings + machine config, path getters | Write config files |

### Boundaries (CRITICAL)

| Rule | Why |
|------|-----|
| `services/` never imports `server.py` | Layer isolation |
| `scanner.py` never imports `mcp_handler` | Domain isolation |
| `config.py` never writes files | Read-only contract |
| `db.py` never validates business rules | Just CRUD |

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| Python (not TS) | Native sqlite3, DuckDB, LanceDB support |
| HTTP (not stdio) | One process owns DB, no race conditions |
| Services layer with DI | Testability, separation of concerns |
| Pointer-based config | Reads pointer → settings.json + {machine}.json |
| Strict v4 reader | Backend never silently coerces malformed manifests — Host owns migrations |

## Surface

### REST Endpoints

| Method | Path | Contract |
|--------|------|----------|
| GET | `/health` | `{ status, version, uptime_seconds }` |
| POST | `/stop` | `{ status: "stopping" }`, triggers shutdown |
| GET | `/timestamp` | `{ timestamp: "YYMMDD_HHMMSS<tz>" }` |
| GET | `/duet-data-path` | `{ path: "/absolute/path" }` |
| POST | `/orientation` | Body: `{"workspace_paths": [...]}`. Returns duet_paths, workspace, context, products[], memory (v4 shape — see Orientation below) |
| GET | `/contexts` | `{ contexts: [...] }` — `type='context'` entities. Each entity carries `absolute_path`, `git_url`, `git_repos` (map or `null`), `meta`, `reference_repos`, `description`. **Order: roots in `root_context_folders` config order; non-root siblings alphabetical by `name`** — see /spec/PRODUCT.md → Invariants |
| POST | `/scan` | `{ status, entities_count, duration_ms, errors[] }` |
| POST | `/deploy-instructions` | Body: `{"workspace_paths": [...]}`. Resolves the owning context, deploys its `skills`/`instructions` declarations into its Drive folder (idempotent). Returns `{ status: "ok", deployed, warnings }` or `{ status: "unknown", reason }` — see Deploy Instructions below |
| POST | `/merge-duet-instructions` | Merges bootstrapper + per-agent core → one file per agent, plus the thin session prompt `duet.md`. Returns `{ status, paths: { agent_name: path }, output_style, errors[] }` |

### MCP Tools

| Tool | Returns |
|------|---------|
| `timestamp` | string directly |
| `duet_data_path` | string directly |
| `orientation` | dict directly |
| `contexts` | list directly |
| `scan` | dict directly |
| `health` | `{ status, version, uptime_seconds }` |

**Format note:** REST wraps in `{ key: value }` (extensibility); MCP returns data directly (AI convenience).

**Contracts:**
- `/stop` is REST-only — AI must not stop backend.
- Errors: `McpError` with JSON-RPC codes (`INVALID_PARAMS` -32602, `INTERNAL_ERROR` -32603).
- Empty result returns `[]`, not exception.

### Orientation

`POST /orientation` with body `{"workspace_paths": [...]}` is the primary orientation endpoint for AI agents. MCP analog: `orientation(workspace_paths: list[str])`.

**Multi-path entity resolution:**

1. Classify each path: `git` (under `DuetData/repos/`) or `context` (contains `context.json`) or ignored.
2. Resolve entities from classified paths.
3. If the meta-context (`meta=true`) is among the resolved entities, it wins; otherwise the first resolved context is used.

Multi-repo contexts (`git_repos` with N aliases) unify all `repos/<alias>.git` paths to one owner: each path resolves through its `product_repo` entity to the same parent context. Opening any of a context's declared repo paths (or its Drive folder) returns the same context regardless of which path the agent opened.

**Response shape (v4):**

| Block | Fields | When |
|-------|--------|------|
| `duet_paths` | `duetDataPath`, `machineConfig` | Always |
| `workspace` | `kind`, `context_name`, `context_folder`, `git_folders[, addons]` | Always |
| `context` | `breadcrumb`, `chain[{type, name, icon, description?}]` | When entity resolved |
| `products` | `[{name, path, spec?, description?, components: [...]}]` | When entity resolved |
| `memory` | `{ref, path}` (resolved from `context.json` → `memory` @-path) or `null` when none declared / unresolvable | When entity resolved |

**`workspace` fields:**

| Field | Type | Value |
|-------|------|-------|
| `kind` | string | `"context"` for resolved entity, `"unknown"` for unresolved paths |
| `context_name` | string \| null | Current context name (last `context.chain[]` entry) |
| `context_folder` | string \| null | Absolute path to the context's Drive folder |
| `git_folders` | map | `{alias: expected_absolute_path}` for every alias in `git_repos`. Path is always `{repos}/{alias}.git` whether the clone exists or not — consumers check `Path(...).exists()`. Order matches manifest insertion |
| `reference_repos` | map, optional | `{name.git: absolute_path}` for existing reference clones |

**Meta-context addons** (only when `entity.meta=true`):

| Field | Value |
|-------|-------|
| `root_context_folders` | Map `{name: absolute_path}` of every top-level context |
| `duet_data_folder` | Absolute path to DuetData |

Unknown workspace adds `reason` discriminator (`no_workspace_path` \| `path_not_in_hierarchy` \| `entity_not_in_db`) and the four canonical fields with empty / null values.

**`products[*]` fields:**

| Field | Type | Value |
|-------|------|-------|
| `name` | string | Duet-ontology slug. Rule A: `{alias}.git`. Rules B/D: context name. Rule C: subfolder name. No `.git` on drive-products |
| `path` | string | @-ref. Git: `@<alias>.git`; Drive (B/D): `@<context_name>`; Drive (C): `@<context_name>/<sub>` |
| `spec` | string, optional | Relative path to spec file. Absent when description came from README |
| `description` | string, optional | First sentence from the spec or README |
| `components` | array | `[{name, path, spec?, description?}]` |

**`products[*].components[*]` fields:**

| Field | Type | Value |
|-------|------|-------|
| `name` | string | Subfolder name |
| `path` | string | Relative to `product.path`. E.g. `packages/backend` or `MetaMathematics` |
| `spec` | string, optional | Relative to `component.path`. E.g. `spec/COMPONENT.md` |
| `description` | string, optional | First sentence from the spec or README |

**Discovery rules** (normative implementation: `services/products.py:build_products`):
- Products: A — `git_repos` aliases; B — `<context>/spec/PRODUCT.md`; C — `<sub>/spec/PRODUCT.md` without `<sub>/context.json`; D — README fallback when A/B/C all empty.
- Components: per-product, one level deep, four ordered paths: `packages/<comp>/spec/COMPONENT.md` → `packages/<comp>/README*.md` → `<comp>/spec/COMPONENT.md` → `<comp>/README*.md`.
- Skip-list at every level (`drafts`, `work`, `archive`, `bin`, `out`, `dist`, `build`, `node_modules`, `target`, `__pycache__`, `.venv`, `venv`, `src`, `spec`, `docs`, `tests`, `test`, `examples`, hidden dotfiles). `packages` is the monorepo container, never itself a component.
- `README*.md` priority: exact `README.md` wins; otherwise alphabetically first.

**Path conventions:** absolute paths only in `workspace` (`context_folder`, `git_folders[*]`). Inside `products[]` and `components[]` — @-ref or relative. `product.spec` is relative to `product.path`; `component.spec` is relative to `component.path`. Optional fields omitted when absent (no `null` placeholders); empty collections are explicit (`components: []`, `git_folders: {}`).

**`chain[].description` priority:** `context.json::description` (when non-empty) > first sentence of `README.md` at the context's Drive folder.

**`chain[].icon`** mirrors `Entity.icon` (set by Scanner from manifest, or default: `📚` meta, `📦` context with `git_repos`, `📁` context without `git_repos`).

**REST note:** `/orientation` is POST (JSON body avoids URL-length issues with long paths containing non-ASCII). Returns result directly (not wrapped).

### Deploy Instructions

`POST /deploy-instructions` with body `{"workspace_paths": [...]}` resolves the owning context (same multi-path resolution as orientation) and materializes that context's `skills` / `instructions` declarations into its Drive folder. Idempotent — safe to call on every workspace open. Logic: `services/deploy_instructions.py`; service method `WorkspaceService.deploy_instructions` (per-context lock serializes concurrent calls).

**@-path resolution** (`services/at_paths.py:resolve_at_path`): `@<head>/<rest>` resolves `<head>` to either a repo directory `<DuetData>/repos/<head>` (when it exists) or a context named `<head>` (→ that context's Drive folder). Entries that don't start with `@`, have an empty/absolute body, or escape the matched root via `..` resolve to `None` (warning + skip).

**skills** (`<context>/.claude/skills/<name>/`, byte-for-byte copy):
- Absent key → not managed at all. Present (even `[]`) → manage.
- Each declared @-path must be a directory containing `SKILL.md`; deploy-name = source dir name.
- Reserved name `.pruned` and deploy-name collisions are skipped with a warning.
- Prune: any `.claude/skills/<x>` not in the declared set is moved into `.claude/skills/.pruned/<name>` (backup) before removal; `.pruned` is never itself pruned.

**instructions** (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` at the context root):
- Composes the bodies of declared @-path sources (order preserved) into the per-client templates `packages/instructions/{CLAUDE,AGENTS,GEMINI}_template.md` at the `<!-- INSERT USER INSTRUCTIONS -->` marker.
- ALWAYS generates all three (templates carry the client-specific memory policy even with no user sources). Files written read-only (`0444`).
- A pre-existing hand-written file (lacking the `AUTO-GENERATED by Duet` banner) is backed up to `<name>.bak` once before the first overwrite.

**Response:**
- `{ status: "ok", deployed: { skills_deployed: [...], skills_pruned: [...], instructions_written: [...] }, warnings: [...] }` when an owning context resolves.
- `{ status: "unknown", reason: "no_owning_context" | "no_context_manifest" }` when no owning context / manifest resolves.
- `400` (`BAD_REQUEST`) on invalid JSON body or non-list `workspace_paths`; `422` (`CONFIG_ERROR`) on backend config error.

### Timestamp Format

`/timestamp` and the MCP `timestamp` tool return `YYMMDD_HHMMSS<tz_id>` strings.

Examples: `260131_143052M` (Moscow), `260131_103052Z` (UTC).

Source: `timestampTZ` in `DuetConfig/settings.json` → `{id}` becomes the suffix.

### `/merge-duet-instructions` — Merged Instructions (multi-agent)

`POST /merge-duet-instructions` merges platform bootstrapper + each agent's core file into one file per agent. Writes results to `DuetData/duet-{agent}.md` for every entry in `index.json.agents`. It also writes `DuetData/duet.md` — the **thin session prompt** (bootstrapper with the `<!-- INSERT USER CORE INSTRUCTIONS -->` core marker removed, i.e. no agent core). The full per-agent cores still go to `duet-{agent}.md`.

> **Source of agents.** `bootstrapper.md`, `index.json`, and the agent cores (`executor.md`, `vizir.md`) are all **platform artifacts in `packages/instructions/`**, bundled next to backend at runtime (Host must bundle them via electron-builder for prod and the dev backend-deploy). The merge no longer reads them from the user instructions workspace (`instructionsPath`) — that decoupling lets `Duet-Instructions.git` be retired.

**Pipeline** (`merge_duet_instructions()` in `instructions.py`):
1. Reads `bootstrapper.md` (in `packages/instructions/`, bundled next to backend; the core marker required) — once.
2. Reads `index.json` (same platform dir) — once. Required field: `agents: { name → relative_path }` map.
3. Scans the platform dir for version-suffix files (`_v2`, `_v3`, …) — once.
4. Writes the thin session prompt `DuetData/duet.md` (atomic) — bootstrapper, core marker substituted with empty string (`_build_bare_session_prompt`).
5. For each agent in `index.agents`:
   - Reads agent file at `packages/instructions / relative_path`.
   - Extracts user content (first H2 onwards, H1 stripped).
   - Substitutes the bootstrapper core marker (`<!-- INSERT USER CORE INSTRUCTIONS -->`).
   - Writes `DuetData/duet-{agent}.md` (atomic).
6. Writes errors to `DuetData/data/duet-instructions-errors.json` (atomic).

**Response:** `{ status: "ok" | "error", paths: { agent_name: "/absolute/path" }, output_style: "/absolute/path/to/duet.md", errors: [{path, reason_code, description}] }`.

**Status semantics:**
- `"ok"` ⇔ every agent declared in `index.agents` merged successfully (warnings allowed).
- `"error"` ⇔ a fatal pre-condition failed (bootstrapper, index, no agents) OR at least one agent merge failed. Successful agents still appear in `paths`; failed ones do not.

**Error reason codes:** `version_suffix`, `content_between_h1_h2`, `no_h2_found`, `bootstrapper_not_found`, `bootstrapper_missing_marker`, `index_not_found`, `index_invalid`, `index_missing_field`, `agent_file_not_found`.

> Note: this pipeline does not validate skill/persona frontmatter — `duet-instructions-errors.json` carries merge + version-suffix errors only. (Skill/persona scanning was removed along with the skills table; skills are now native Anthropic skills deployed via `deploy_instructions`.)

**Consumer:** Host reads `DuetData/duet-{agent}.md` from disk and writes them to AI client config files. No HTTP fetch for content — file-based delivery via JSON cache pattern.

## Behaviors

### Scanner

- Reads `root_context_folders` from `DuetConfig/settings.json` in declared order.
- Resolves `@aliases` via `{machine}.json` (see /spec/PRODUCT.md → @Alias Resolution).
- Strict v4 reader: never writes manifests; folders without `context.json` v4 silently skipped; `version != 4` produces `unrecognized_manifest_version` error.
- Stores results in `DuetData/data/entities.db` (native sqlite3).
- Deterministic order: `readdir` results sorted by name for reproducible scans.

**`/scan` behavior:**
- **Debounce:** if last scan completed < 5 seconds ago, returns `{ status: "skipped", reason: "recent_scan", entities_count: 0, errors: [] }`. All scan responses conform to `ScanResult` shape (via `make_scan_result()` factory).
- **Blocking:** scan runs synchronously. During scan, backend does NOT respond to other requests. Typical duration: 1-5 seconds. OK because single-user local app.
- **Scan errors** in response: `{path, reason_code, description}`. Codes: `name_collision`, `repo_collision`, `invalid_manifest`, `unrecognized_manifest_version`. Backend never writes manifests; Host owns missing-file creation and version upgrades.
- **`run_scan_with_cache()`** (in `server.py`): shared function that runs scan + writes JSON cache (`scan.json`, `contexts.json`). Used by both `POST /scan` and ManifestWatcher.

### Manifest Watcher

Watches root context folders for changes to `context.json` manifests. On change — auto-rescan.

**Library:** `watchfiles` (async-native, Rust notify-rs). OS-level events: FSEvents (macOS), inotify (Linux), ReadDirectoryChangesW (Windows).

| Event | Action |
|-------|--------|
| Backend startup | If `root_context_folders` non-empty → initial scan + start watcher |
| Manifest file changed | Debounce 10s → `run_scan_with_cache()` |
| `POST /scan` completes | If folders changed → restart watcher |
| Backend shutdown | Stop watcher |

**Debounce:** 10s (watchfiles `debounce` parameter). On top of `EntitiesService` 5s debounce (10s > 5s, always passes).

**Filter:** `ManifestFilter` — only passes changes to files named `context.json`. All other filesystem events ignored.

**Folder tracking:** watcher watches specific folder paths. When `root_context_folders` change (add/remove via settings), `maybe_restart()` compares current vs new list and restarts if different.

**Data flow:** manifest changed → watcher → scan → `scan.json` / `contexts.json` updated → Host file watcher on `DuetData/data/` → UI refresh. No new IPC or endpoints.

Implementation: `watcher.py`.

### JSON Cache Pattern

Backend writes operation results to `DuetData/data/` as JSON files (atomic). Host's file watcher on `DuetData/data/` picks up changes and refreshes wizard state without HTTP polling. Extension does **not** consume these files — it uses HTTP (`GET /contexts`, `POST /scan`, `POST /orientation`) directly.

| File | Source | Consumer |
|------|--------|----------|
| `DuetData/duet.md` (thin session prompt: bootstrapper, no core) | `POST /merge-duet-instructions` | Host → Claude output-style + Codex/Antigravity system prompt |
| `DuetData/duet-{agent}.md` (one per agent in `index.json.agents`) | `POST /merge-duet-instructions` | Host → AI client configs (Claude `duet-{agent}` subagents) |
| `DuetData/data/duet-instructions-errors.json` | `POST /merge-duet-instructions` | Host wizard |
| `DuetData/data/scan.json` | `POST /scan` | Host wizard |
| `DuetData/data/contexts.json` | `GET /contexts` / scan-completion sweep | Host wizard |

**Atomic write:** all files written via `.new` → rename → `.old` → delete. File watcher never sees half-written file. Implementation: `fileio.py:atomic_write()`.

### Description Extraction

Extracts description from markdown — first sentence of first paragraph after H1, or H1 text if next content is structural. Used by `context.chain[].description` (from README.md) and `components[].description` (from spec file).

**Legacy `find_spec_file()` fallback chain** (`ARCHITECTURE.md`, `INDEX.md`, `BUSINESS.md`, `STREAM.md`) is no longer consulted by orientation — those names lingered from the pre-rename taxonomy. The function is retained as a utility but is not on the orientation hot path.

### Database Schema

```sql
CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,                  -- 'context' | 'product_repo' | 'reference_repo'
    name TEXT,                  -- globally unique (see /spec/PRODUCT.md → Invariants)
    icon TEXT,
    drive_path TEXT UNIQUE,
    parent_id INTEGER REFERENCES entities(id),
    git_url TEXT,               -- populated only on product_repo / reference_repo rows
    meta INTEGER DEFAULT 0      -- 1 = meta-context (e.g. !БАЗА)
);
CREATE UNIQUE INDEX idx_name ON entities(name);
```

**v3 note:** `git_url` is no longer set on `context` rows — the URL lives in the `git_repos` map on disk and on `product_repo` children. The column stays on `product_repo` / `reference_repo` rows as the per-clone URL. No `components_repo` column is introduced.

`id` is identity, not ordering — `id ASC` happens to reflect scanner insertion order today, but the API contract for `/contexts` defines display order explicitly (see Surface → `/contexts`).

### Config Reading Order

```
pointer.py → ~/.org.ve68.duet
config.py  → DuetConfig/settings.json + {machine}.json
           → DuetData/backend/VERSION
```

**Backend-specific contracts:**
- `config.py` is read-only — never writes config files.
- `aliases.py:resolve_alias()` fails fast on unresolved alias (`AliasNotFoundError`).
- `config.get_version()` raises `ConfigError` if VERSION file not found.

### Lifecycle

**Startup:**

```
1. Read pointer file
2. setup_logging() → RotatingFileHandler
3. Validate config (VERSION, port, settings)
4. db.init()
5. Create services (DI)
6. init_services()
7. Initial scan + start manifest watcher (if root_context_folders non-empty)
8. Start uvicorn
```

**Shutdown:**

```
1. Receive SIGTERM/SIGINT or POST /stop
2. Set shutdown_event
3. Stop manifest watcher
4. db.close()
5. Exit
```

**Single-instance contract.** Backend does **not** use a PID file. Single-instance is guaranteed by Host (the only spawner) plus port binding — a second `uvicorn` on the same port fails fast with `EADDRINUSE`. `DuetData/.pid` is not written.

### Dependency Injection

```python
# server.py lifespan
db = DatabaseManager()
workspace_service = WorkspaceService(db)
entities_service = EntitiesService(db)
init_services(workspace_service, entities_service, _start_time)

# Usage (anywhere)
get_workspace_service().get_orientation(...)
```

**Contract:** services initialized once in lifespan. Never create new instances elsewhere.

### Logging

```
DuetData/backend.log  ← RotatingFileHandler
  Max size: 5 MB
  Backups: 1 (backend.log.1)
  Format: YYYY-MM-DD HH:MM:SS [LEVEL] message
```

## Engineering

### Python Environment

**One venv for monorepo:** at repo root (`.venv/`), shared by all Python packages.

```bash
.venv/bin/python    # interpreter
.venv/bin/pytest    # test runner
```

**Contract:** always use `.venv/bin/python`, never system Python.

### Testing

```bash
cd packages/backend && ../../.venv/bin/pytest
```

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
- Use `EntityFactory` instead of raw `Entity()` construction.

### Running

```bash
python server.py                                          # reads ~/.org.ve68.duet
DUET_POINTER_FILE=/tmp/test-pointer python server.py      # test override
```

Backend has no standalone build — bundled into Host's `extraResources` (see [`host/spec/COMPONENT.md` → Engineering](../../host/spec/COMPONENT.md)).

### File Map

| Concept | File |
|---------|------|
| HTTP endpoints | `server.py` |
| MCP tools | `mcp_handler.py` |
| Workspace info / orientation | `services/workspace.py` |
| Entity listing | `services/entities.py` |
| Hierarchy scan | `scanner.py:_scan_context()` |
| Manifest reader (strict v4) | `services/manifest.py:read_manifest()` |
| Deploy skills/instructions | `services/deploy_instructions.py:deploy_instructions()` |
| `@<name>/<rest>` resolution | `services/at_paths.py:resolve_at_path()` |
| Context-memory pointer | `services/workspace.py:_build_memory()` |
| Products/components discovery | `services/products.py:build_products()` |
| Description extraction | `description.py:extract_description()` |
| Spec file fallback (legacy) | `description.py:find_spec_file()` |
| Merge pipeline | `instructions.py:merge_duet_instructions()` |
| Manifest watcher | `watcher.py:ManifestWatcher` |
| Scan + cache (shared) | `server.py:run_scan_with_cache()` |
| Atomic file write | `fileio.py:atomic_write()` |
| SQLite schema | `db.py:_init_schema()` |
| Config reading | `config.py` |
| Pointer reading | `pointer.py` |
| Alias resolution | `aliases.py` |
| Logging setup | `server.py:setup_logging()` |
