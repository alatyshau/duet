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
- `index.json` — объявляет пути к персонам и skill-каталогам
- `core_instructions.md` — пользовательские инструкции (L7, spec-driven, project management)
- `personas/` — персоны (Socrates, Hephaestus, Ariadna, etc.)
- `skills/` — скиллы по категориям (coding, modes, stances, tools, workflows)

**Подключение:** `instructionsPath` в `{machine}.json` указывает абсолютный путь к Duet-Instructions.

**Merge pipeline:** Backend компонует `bootstrapper.md` (платформенный, в packages/backend) с `core_instructions.md` (пользовательский) + таблицу скиллов через `POST /merge-duet-instructions`. Результат записывается в `DuetData/duet-instructions.md` (atomic write). Host читает файл с диска и записывает в конфиги AI-клиентов.

**AI-клиенты (конфигурируемые Host):**

| Client | Config | Content |
|--------|--------|---------|
| Claude Code | `~/.claude/output-styles/duet.md` | Merged bootstrapper+core_instructions |
| Codex | `~/.codex/duet_instructions.md` | Merged bootstrapper+core_instructions |
| Antigravity | `~/.gemini/GEMINI.md` | Merged bootstrapper+core_instructions |

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
└── all-businesses.code-workspace   # multi-root for all businesses
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
  "timestampTZ": { "id": "M", "value": "Europe/Moscow" },
  "business_folders": ["@БАЗА", "@МетаЛаб"]
}
```

| Field | Who reads | Purpose |
|-------|-----------|---------|
| `business_folders` | Backend | List of business roots (may use @aliases) |
| `timestampTZ` | Backend | Timezone for timestamps |

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

`business_folders` in settings.json use `@aliases` resolved via `{machine}.json`:

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
Business (root)
├── Stream (intermediate, can nest)
│   ├── Stream
│   │   └── Product (terminal)
│   └── Product
└── ...
```

| Type | Manifest | Terminal? | Has git_url? |
|------|----------|-----------|--------------|
| business | `business.json` | No | No |
| stream | `stream.json` | No | No |
| product | `product.json` | Yes — stops recursion | Optional |

### Manifest Format

```json
{ "name": "Name", "icon": "📁" }
{ "name": "Name", "icon": "📦", "git_url": "https://..." }
{ "name": "Name", "icon": "📦", "git_url": "https://...", "reference_repos": {"cookbook": "https://..."} }
```

**Contract:** Keys are `snake_case`. `name` globally unique (see Name Uniqueness). `reference_repos` is optional map (name → URL) in all manifests.

### Reference Repos

`reference_repos` field in any manifest (product.json, stream.json, business.json) declares read-only reference clones. Key = explicit clone name, value = git URL. Cloned to `DuetData/repos/{name}.git` by Extension. Entity name includes `.git` suffix (enters global uniqueness space).

### Name Uniqueness (CRITICAL)

Entity names globally unique. Conflict resolution by priority:

| Type | Priority | Unique? |
|------|----------|---------|
| business | 1 (highest — keeps name) | globally |
| stream | 2 | globally |
| product | 3 | globally |
| product_repo | 3 (same as product) | globally |
| reference_repo | 5 (lowest — gets `Name (1)`) | globally |

### Self-Healing

Scanner auto-fixes manifest issues:

| Issue | Action |
|-------|--------|
| No `business.json` at root | Create with folder name |
| `stream.json` at root | Rename → `business.json` |
| `business.json` inside chain | Rename → `stream.json` |

## Database Schema

Backend's SQLite schema (`entities.db`, native sqlite3):

```sql
CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,        -- 'business' | 'stream' | 'product' | 'project' | 'product_repo' | 'reference_repo'
    name TEXT,        -- unique (partial index excludes projects)
    icon TEXT,
    drive_path TEXT UNIQUE,
    parent_id INTEGER REFERENCES entities(id),
    git_url TEXT,
    status TEXT,      -- project status: 'active', 'postponed', 'archived', NULL
    root INTEGER DEFAULT 0  -- business only: 1 = meta-business (root entity)
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

**Multi-path resolution:** Classifies each path (gitFolder / streamFolder / ignored), resolves entities, picks highest priority: root business > business > stream > product > project.

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

| Entity level | Standard spec file |
|-------------|-------------------|
| product | `spec/PRODUCT.md` |
| component | `spec/COMPONENT.md` |
| stream | `spec/STREAM.md` |
| business | `spec/BUSINESS.md` |
| project | `spec/PROJECT.md` |

Fallback: if standard file absent, orientation searches next in chain per entity type (e.g. product: PRODUCT.md > COMPONENT.md > ARCHITECTURE.md > README.md > INDEX.md). Full chains in `packages/backend/spec/COMPONENT.md` → Spec File Fallback.

**COMPONENT.md** merges what was previously ARCHITECTURE.md + DOMAIN.md. First sentence of COMPONENT.md becomes component `description` in orientation response.

### Who Reads What

| File | Host | Extension | Backend | AI Agents |
|------|------|-----------|---------|-----------|
| `~/.org.ve68.duet` | **writes** | reads | reads | — |
| `DuetConfig/settings.json` | creates defaults | — | reads | — |
| `DuetConfig/{machine}.json` | reads+writes (port, defaults) | reads (port) | reads (port, @aliases) | — |
| `DuetData/backend/VERSION` | writes | — | reads | — |
| `DuetData/backend.log` | — | — | writes | — |
| `DuetData/.pid` | reads | — | writes | — |

## Build & Release

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
