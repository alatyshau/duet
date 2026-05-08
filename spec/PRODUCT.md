# Duet Product Spec

> Read this FIRST when entering the monorepo. Component specs reference this file.

## Agent Rules

- **NEVER make git commits.** All commits are done by the user manually.
- **NEVER make destructive git operations** (checkout, reset, force push, etc.)

## Components

```
┌─────────────────┐     writes      ┌──────────────────┐
│  Host (Electron) │ ──────────────→ │ ~/.org.ve68.duet │
│  Tray app, UI    │                 │   (pointer file) │
└────────┬────────┘                 └────────┬─────────┘
  spawns │                            reads  │  reads
         │                    ┌──────────────┴──────────────┐
         ▼                    ▼                              ▼
┌──────────────────┐          ┌──────────────────┐
│ Backend (Python)  │◀──HTTP──│ Extension (VSCode)│
│ HTTP API + MCP    │         │ UI (tree views)   │
└──────────────────┘          └──────────────────┘
```

| Component | Package | Language | Role |
|-----------|---------|----------|------|
| **Host** | `packages/host` | TypeScript/Electron | Tray app. Writes pointer file. Deploys backend. Configures AI clients |
| **Extension** | `packages/extension` | TypeScript/VS Code | UI (tree views, commands). Thin client — all data from Backend HTTP API. Reads pointer for port |
| **Backend** | `packages/backend` | Python/FastAPI | HTTP API + MCP. Owns DB. Reads pointer + DuetConfig |

## AI Instructions (Duet-Instructions)

AI-инструкции вынесены из Duet в отдельный git-репозиторий **Duet-Instructions**, которым владеет пользователь. Duet не деплоит и не бандлит инструкции — только предоставляет платформенный bootstrapper и инструменты для работы с ними.

**Структура Duet-Instructions:**
- `index.json` — объявляет per-agent core-файлы (`agents.executor`, `agents.vizir`), путь к персонам и skill-каталогам
- `agents/executor.md`, `agents/vizir.md` — пользовательские инструкции для каждого агента (L7, spec-driven, project management — у Executor; orchestration loop — у Vizir)
- `personas/` — персоны (Socrates, Hephaestus, Ariadna, etc.)
- `skills/` — скиллы по категориям (coding, modes, stances, tandem, tools, workflows)

**Подключение:** `instructionsPath` в `{machine}.json` указывает абсолютный путь к Duet-Instructions.

**Merge pipeline (multi-agent):** Backend компонует `bootstrapper.md` (платформенный, в packages/backend) с core-файлом каждого агента из `agents/` + общую таблицу скиллов через `POST /merge-duet-instructions`. Один merged-файл на агента: `DuetData/duet-executor.md`, `DuetData/duet-vizir.md` (atomic write). Host читает per-agent файлы с диска и развозит по AI-клиентам.

**AI-клиенты (конфигурируемые Host):**

| Client | Config | Content |
|--------|--------|---------|
| Claude Code | `~/.claude/output-styles/duet-executor.md` + `~/.claude/agents/duet-executor.md` + `~/.claude/agents/duet-vizir.md` | Output style (executor) + 2 custom subagents |
| Codex | `~/.codex/duet_instructions.md` | Host-managed instructions file |
| Antigravity | `~/.gemini/GEMINI.md` | Host-managed instructions file |

**Platform asymmetry:** Claude Code supports custom subagents. Codex and Antigravity use one instructions file.

## Pointer File

Path: `~/.org.ve68.duet` — flat JSON file (NOT a directory).

```json
{
  "machine": "mac_work",
  "duetDataPath": "/Users/user/DuetData",
  "duetConfigPath": "/Users/user/GoogleDrive/DuetConfig"
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `machine` | string | Machine ID → maps to `DuetConfig/{machine}.json` |
| `duetDataPath` | string | Absolute path to local cache |
| `duetConfigPath` | string | Absolute path to cloud-synced config |

**Contracts:**
- Host is the ONLY writer. Extension and Backend only read
- All 3 fields required. Missing field = not configured
- Test override: `DUET_POINTER_FILE` (Backend), `DUET_CONFIG_FILE` (Host)

## DuetData Directory

Local cache. Fully recoverable — can be deleted and rebuilt.

```
DuetData/
├── data/
│   └── entities.db                 # Backend's SQLite (native sqlite3)
├── repos/
│   └── {Product}.git/              # cloned repositories
├── workspaces/
│   └── {Product}.code-workspace    # multi-root: repo + Drive folder
├── backend/
│   ├── VERSION                     # installed backend version
│   ├── server.py                   # backend code (deployed by Host)
│   └── requirements.txt
├── .venv/                          # Python virtual environment
├── .pid                            # backend PID lockfile
├── backend.log                     # backend log (RotatingFileHandler)
└── root-contexts.code-workspace   # multi-root for all root contexts
```

## DuetConfig Directory

Cloud-synced (e.g. Google Drive). Shared across machines.

```
DuetConfig/
├── settings.json                   # shared across machines
└── {machine}.json                  # per-machine config
```

### settings.json

```json
{
  "version": 2,
  "timestampTZ": { "id": "M", "value": "Europe/Moscow" },
  "root_context_folders": ["@БАЗА", "@МетаЛаб"]
}
```

| Field | Who reads | Purpose |
|-------|-----------|---------|
| `root_context_folders` | Backend | List of top-level context folders (may use @aliases). Renamed from `business_folders` in v1; Host owns startup migration |
| `timestampTZ` | Backend | Timezone for timestamps |
| `version` | Host | Schema version. Host owns auto-upgrade |

### {machine}.json

```json
{
  "port": 19680,
  "instructionsPath": "/Users/.../Duet-Instructions.git",
  "@БАЗА": "/Users/.../!БАЗА",
  "@МетаЛаб": "/Users/.../!МетаЛаб"
}
```

| Field | Who reads | Purpose |
|-------|-----------|---------|
| `port` | Extension, Backend | HTTP port for backend |
| `instructionsPath` | Backend | Absolute path to Duet-Instructions repo |
| `@alias` keys | Backend | Machine-specific path resolution |

## @Alias Resolution

`root_context_folders` in settings.json use `@aliases` resolved via `{machine}.json`:

```
"@БАЗА/subfolder" → split → alias "@БАЗА" + rest "subfolder"
  → lookup in {machine}.json → "/Users/.../!БАЗА"
  → join → "/Users/.../!БАЗА/subfolder"
```

| Input | Output |
|-------|--------|
| `@БАЗА` | `/abs/path/to/БАЗА` |
| `@БАЗА/sub` | `/abs/path/to/БАЗА/sub` |
| `/absolute/path` | `/absolute/path` (unchanged) |

**Contract:** Unresolved alias → error (fail fast, not silent fallback).

## Entity Hierarchy

```
meta-context (one per workspace, e.g. !БАЗА — meta: true)
├── root context (top-level user context, parent_id IS NULL)
│   ├── context (intermediate, can nest)
│   │   └── context with git_url (terminal — product lives in repo)
│   └── context with git_url
└── ...
```

A context is a folder on Drive carrying `context.json` v2. Roles are
inferred from manifest fields, not from a separate enum:

| Role | How it's identified |
|------|---------------------|
| meta-context | `meta: true` in `context.json`. Exactly one per database whenever `root_context_folders` is non-empty |
| root context | `parent_id IS NULL`, listed in `root_context_folders` |
| terminal (with git) | `git_url` set; scanner stops recursing |
| intermediate | none of the above |

**Meta required.** When `root_context_folders` is non-empty, exactly one context in
`entities.db` has `meta=1`, and it is **the first element** of `root_context_folders`.
The state «list non-empty, no meta» is impossible — neither through Host UI (drag-to-
position-0 is the only re-meta mechanism) nor through direct edits to `settings.json`
or `context.json` (Host's startup migration restores the invariant on the next sweep).

The meta-context is the **управляющий уровень над контекстами** — a container for the
user's top-level data that spans every other context: the personal task DB, the ontology,
the AI instructions repo. Other root contexts hold domain data (businesses, streams);
the meta-context holds the operating layer over them.

Three entity types live in `entities.db`:

| Type | Manifest | Tree? | Notes |
|------|----------|-------|-------|
| `context` | `context.json` v2 | yes | Bounded context on Drive |
| `product_repo` | — | no | Auto-registered for each `context` with `git_url`. Path resolution helper |
| `reference_repo` | — | no | Read-only clone declared via `reference_repos` |

### Manifest Format

```json
{ "version": 2, "name": "Duet", "icon": "📦", "git_url": "git@github.com:owner/repo.git" }
{ "version": 2, "name": "БАЗА", "icon": "🗂", "meta": true }
{ "version": 2, "name": "ТехноЛаб", "icon": "📁", "reference_repos": {"cookbook": "https://..."} }
```

| Field | Type | Required? | Meaning |
|-------|------|-----------|---------|
| `version` | int | required | Schema version. `2` for current backend; `version != 2` is ignored with warning |
| `name` | string | required | Globally unique entity name |
| `icon` | string | optional | Defaults: `📁` for context, `📦` when `git_url` present |
| `meta` | bool | optional | `true` marks the meta-context. Renamed from v1's `root` (Host migrates) |
| `git_url` | string | optional | If set, scanner stops recursing; product lives in this repo |
| `reference_repos` | map | optional | `{name: url}` for read-only clones |
| `description` | string | optional | Used for `chain[].description` in orientation; takes priority over README first sentence |

**Contract:** Keys are `snake_case`. `name` globally unique (see Name Uniqueness). Backend reads only; Host owns all upgrades.

### Reference Repos

`reference_repos` field in any `context.json` declares read-only reference clones. Key = explicit clone name, value = git URL. Cloned to `DuetData/repos/{name}.git`. Entity name includes `.git` suffix (enters global uniqueness space).

### Name Uniqueness (CRITICAL)

Entity names globally unique. Conflict resolution by priority:

| Type | Priority | Unique? |
|------|----------|---------|
| context | 2 (claims name on collision over `(reference_repo)` only) | globally |
| product_repo | 3 | globally |
| reference_repo | 5 (lowest — gets `Name (1)`) | globally |

When two contexts collide on name (rare in practice), the second-comer gets the `(N)` suffix.

### Self-Healing

Backend does not self-heal. **Host** owns all manifest upgrades on startup
(legacy `business.json` / `stream.json` / `product.json` → `context.json` v2,
including `root → meta` rename) and creates a default `context.json` v2 for
empty root context folders. Backend reads the upgraded result; folders with
`version != 2` are silently skipped with an `unrecognized_manifest_version`
warning in scan errors.

## Database Schema

Backend's SQLite schema (`entities.db`, native sqlite3):

```sql
CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,        -- 'context' | 'product_repo' | 'reference_repo'
    name TEXT,        -- globally unique
    icon TEXT,
    drive_path TEXT UNIQUE,
    parent_id INTEGER REFERENCES entities(id),
    git_url TEXT,
    meta INTEGER DEFAULT 0  -- 1 = meta-context (e.g. !БАЗА)
);
CREATE UNIQUE INDEX idx_name ON entities(name);
```

## Cross-Component Contracts

### Version Flow

```
Host (app.getVersion())
    │ deploy.ts → writes DuetData/backend/VERSION
    ▼
Backend (reads VERSION → returns via /health)
    │
    ▼
Host (isDeployNeeded: app version > deployed → redeploy)
Extension (checks /health → detects when backend is up)
```

### Backend Spawn

```
Host → spawn(venvPython, [serverPath]) → Backend
Extension → checks /health → detects when backend is up
```

- Host is the single owner of backend lifecycle (start, stop, health)
- `spawn(venvPython, [server.py], { stdio: 'ignore' })` — attached child, dies with Host
- Auto-start on Host startup (when ready + deployed)
- Auto-start after deploy
- Stop on Host quit (`before-quit` handler)
- Extension checks `/health` once on activation (no polling)
- Port read from `DuetConfig/{machine}.json` (default: 19680)

### Orientation (AI Agent Orientation)

AI agents call `orientation(workspace_paths=[<all working dirs>])` at session start. Backend resolves workspace paths to entity via multi-path resolution and returns structured context.

**Consumers:** AI agents (via MCP tool), Extension (via HTTP endpoint)

**Multi-path resolution:** Classifies each path (gitFolder / contextFolder / ignored), resolves entities. If the meta-context is among them, it wins; otherwise the first resolved context is used (also covers the brief window when the DB hasn't caught up with a fresh Host meta-flag write — Host's startup/save sweep owns the invariant and surfaces real failures in red on the wizard's path page).

**Response blocks:**

| Block | Purpose | Always present? |
|-------|---------|----------------|
| `duet_paths` | duetDataPath, machineConfig | Yes |
| `instructions` | basePath, personas[], skills[] (dynamic catalog from YAML frontmatter) | Yes |
| `workspace` | type, topology, typed attributes, reference_repos | Yes |
| `context` | breadcrumb + chain (type, name, description) | When entity resolved |
| `key_files` | Absolute paths to spec and readme | When files exist |
| `components` | Product's packages with spec path and description | When product in chain |

**Contract:** Detailed format in `packages/backend/spec/COMPONENT.md` → Orientation.

### Spec File Naming Convention

| Lookup category | Standard spec file |
|-----------------|--------------------|
| context with git_url (terminal — a product) | `spec/PRODUCT.md` |
| context without git_url | `spec/CONTEXT.md` |
| component | `spec/COMPONENT.md` |

Fallback: if standard file absent, orientation searches next in chain. For context-without-git the chain still keeps `BUSINESS.md` and `STREAM.md` as legacy fallbacks for files the user has not renamed yet. Full chains in `packages/backend/spec/COMPONENT.md` → Spec File Fallback.

**COMPONENT.md** merges what was previously ARCHITECTURE.md + DOMAIN.md. First sentence of COMPONENT.md becomes component `description` in orientation response.

### Who Reads What

| File | Host | Extension | Backend | AI Agents |
|------|------|-----------|---------|-----------|
| `~/.org.ve68.duet` | **writes** | reads | reads | — |
| `DuetConfig/settings.json` | reads+writes (root_context_folders, defaults) | — | reads | — |
| `DuetConfig/{machine}.json` | reads+writes (port, instructionsPath, pythonPath, deployChannel, @aliases, defaults) | reads (port) | reads (port, @aliases) | — |
| `DuetData/backend/VERSION` | writes | — | reads | — |
| `DuetData/backend.log` | — | — | writes | — |
| `DuetData/.pid` | reads | — | writes | — |

**Single-writer invariant:** Host is the only writer of `settings.json` and `{machine}.json`. Backend strictly reads. Adding/removing/reordering root context folders, creating `@alias` mappings — all flows go through Host UI. Extension does not have its own write path; before any root context folder edit it must direct the user to Host.

## Build & Release

### Workflow

```
1. Code changes ready, verify passes
2. npm run release (Host) / npm run vsix (Extension)
   — bumps version in package.json
   — builds artifact (.dmg / .vsix)
   — Host also writes resources/BUILD_SHA
3. Commit: code changes + bumped version + BUILD_SHA
4. Push
```

Release **before** commit: build scripts modify working tree (version bump, BUILD_SHA). These changes go into the commit together with the code. Agent never commits — only prepares the message.

### Artifacts

| Component | Command | Artifact | Version bump |
|-----------|---------|----------|--------------|
| **Host** | `cd packages/host && npm run release` | `dist/Duet-{ver}.dmg` (or `.exe`, `.AppImage`) | Auto patch bump |
| **Extension** | `cd packages/extension && npm run vsix` | `dist/duet-{ver}.vsix` | Auto patch bump |
| **Backend** | — | No standalone artifact. Bundled into Host (extraResources) | Inherits Host version (at deploy) |

### Host Release (`packages/host/build-release.cjs`)

```
npm run release [-- --mac|--win|--linux]   # default: --mac
  1. Bump patch in package.json (0.1.1 → 0.1.2)
  2. electron-vite build (typecheck + bundle)
  3. electron-builder --{platform}
  → dist/Duet-{version}.dmg
```

Tools: electron-vite (bundle), electron-builder (installer).

**extraResources** (bundled alongside app, deployed to DuetData at runtime via `deploy.ts`):
- `packages/backend/` → `backend/` (excludes tests, `__pycache__`)

### Extension Release (`packages/extension/build-vsix.js`)

```
npm run vsix
  1. Bump patch in package.json (0.0.8 → 0.0.9)
  2. Update viewContainer title → "Duet {version}"
  3. npm run package (typecheck + lint + esbuild --production)
  4. vsce package → dist/duet-{version}.vsix
```

Extension is a thin UI client — no backend bundling. Host handles backend deployment via `deploy.ts`.

### CI/CD (GitHub Actions)

| Workflow | Trigger | What |
|----------|---------|------|
| `build-host.yml` | Push to main (if `packages/host/` changed) + manual | Build Host for macOS/Windows/Linux in parallel. Upload artifacts (90 days) |
| `host-test.yml` | Push to main (if `packages/host/` changed) + manual | Run vitest. E2E disabled (monorepo symlink issues) |

**No auto-publish.** Artifacts downloaded manually from Actions → GitHub Release.

### Version Tracking

```
Host: packages/host/package.json → "version"
Extension: packages/extension/package.json → "version"
Backend: DuetData/backend/VERSION (written by Host at deploy time)
```

Host writes its version to `DuetData/backend/VERSION` after successful deploy → Backend returns it via `/health` → Host checks for version mismatch → redeploy if upgrade. Extension reads VERSION to verify backend is installed. See "Version Flow" above.

## Pre-commit Checks

Run **before every commit**:

```bash
npm run verify          # all packages
npm run verify:host     # typecheck + lint + vitest
npm run verify:extension # check-types + lint + vitest
npm run verify:backend  # pytest
```

Per-package details:

| Package | Type Check | Lint | Tests |
|---------|-----------|------|-------|
| **Host** | `npm run typecheck` (tsc node + web) | `npm run lint` (eslint) | `npm run test:run` (vitest) |
| **Extension** | `npm run check-types` (tsc) | `npm run lint` (eslint) | `npm run test` (vitest) |
| **Backend** | — | — | `pytest` |

**Important:** `electron-vite build` uses esbuild which skips TypeScript checks (`noUnusedLocals`, etc.). Always run `npm run typecheck` separately.

## Repository Naming

| Pattern | Meaning |
|---------|---------|
| `{Name}.git` | Main clone of product |
| `{Name}.wt-N` | Worktree N (planned) |

Lookup: strip suffix → find entity by name.

## Timestamp Format

Format: `YYMMDD_HHMMSS<tz_id>`

Examples: `260131_143052M` (Moscow), `260131_103052Z` (UTC)

Source: `timestampTZ` in `DuetConfig/settings.json` → `{id}` is the suffix.
