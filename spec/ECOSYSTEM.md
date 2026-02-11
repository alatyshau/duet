# Duet Ecosystem

> Read this FIRST when entering the monorepo. Component specs reference this file.

## Agent Rules

- **NEVER make git commits.** All commits are done by the user manually.
- **NEVER make destructive git operations** (checkout, reset, force push, etc.)

## Components

```
┌─────────────────┐     writes      ┌──────────────────┐
│  Host (Electron) │ ──────────────→ │ ~/.org.ve68.duet │
│  Tray app, UI    │                 │   (pointer file) │
└─────────────────┘                 └────────┬─────────┘
                                      reads  │  reads
                              ┌──────────────┴──────────────┐
                              ▼                              ▼
                   ┌──────────────────┐          ┌──────────────────┐
                   │ Extension (VSCode)│          │ Backend (Python)  │
                   │ UI, tree, scanner │          │ HTTP API + MCP    │
                   └──────────────────┘          └──────────────────┘
                              │          spawns           ▲
                              └──────────────────────────┘
```

| Component | Package | Language | Role |
|-----------|---------|----------|------|
| **Host** | `packages/host` | TypeScript/Electron | Tray app. Writes pointer file. Deploys backend + AI instructions. Configures AI clients |
| **Extension** | `packages/extension` | TypeScript/VS Code | UI (tree views, commands). Spawns backend. Reads pointer |
| **Backend** | `packages/backend` | Python/FastAPI | HTTP API + MCP. Owns DB. Reads pointer + DuetConfig |
| **AI Instructions** | `packages/ai-instructions` | Markdown | Pure content: modes, stances, skills, personas, workflows, schemas |
| **AI Kit** | `packages/ai-kit` | Markdown + Python | Legacy: install.py, MCP server, legacy templates. Being replaced by AI Instructions + Host |

## AI Instructions

Pure content package — source of truth for all AI agent instructions.

```
packages/ai-instructions/
├── spec/
│   ├── ARCHITECTURE.md     # package structure, naming, deploy chain
│   └── DOMAIN.md           # concepts (mode, stance, skill, persona), relationships
└── src/                    # deliverable — deployed to DuetData/ai-instructions/
    ├── core_instructions.md
    ├── core_instructions_short.md
    ├── modes/              # DIALOGUE, EXECUTE, PLANNING, etc.
    ├── stances/            # dialectic, pragmatic, critical, etc.
    ├── skills/             # python, typescript, spec-architect, etc.
    ├── personas/           # Socrates, Hephaestus, Ariadna, etc.
    ├── workflows/          # solo, pair, sddg
    └── schemas/            # topic_file, index format specs
```

**Edit rule:** Always edit `packages/ai-instructions/src/`, never `DuetData/ai-instructions/` directly. Changes are lost on next deploy.

**Deploy chain:** Host deploys `src/` to `DuetData/ai-instructions/`.

## AI Kit (Legacy)

Transitional package. Being replaced by AI Instructions (content) + Host (deploy logic).

```
packages/ai-kit/
├── templates/              # LEGACY — source of truth moved to packages/ai-instructions/
├── install.py              # LEGACY manual installer — moving to Host
├── mcp-server/             # LEGACY Python MCP (2 tools) — replaced by Extension MCP
└── spec/                   # AI Kit's own specs
```

**MCP server:** Legacy Python MCP (timestamp + get_instruction_location). Replaced by Extension's Node.js MCP (5 tools). Don't touch until backend health management is in Host UI.

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
│   ├── index.db                    # Extension's SQLite (sql.js WASM)
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
├── mcp/
│   └── mcp-server.js              # Extension Node.js MCP (deployed for VS Code Copilot)
├── all-businesses.code-workspace   # multi-root for all businesses
├── config.json                     # LEGACY — Extension scanner only
├── ai-instructions/                # AI instructions (modes, stances, skills, personas, etc.)
└── ai-kit/                         # Legacy: settings.json, MCP server
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
| `timestampTZ` | Backend, Extension MCP (via legacy `DuetData/ai-kit/settings.json`) | Timezone for timestamps |

### {machine}.json

```json
{
  "port": 19680,
  "@БАЗА": "/Users/.../!БАЗА",
  "@МетаЛаб": "/Users/.../!МетаЛаб"
}
```

| Field | Who reads | Purpose |
|-------|-----------|---------|
| `port` | Extension, Backend | HTTP port for backend |
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
│       └── projects/
│           └── Project
└── projects/
    └── Project
```

| Type | Manifest | Terminal? | Has git_url? |
|------|----------|-----------|--------------|
| business | `business.json` | No | No |
| stream | `stream.json` | No | No |
| product | `product.json` | Yes — stops recursion | Optional |
| project | (subfolder of `projects/`) | Yes | No |

### Manifest Format

```json
{ "name": "Name", "icon": "📁" }
{ "name": "Name", "icon": "📦", "git_url": "https://..." }
```

**Contract:** Keys are `snake_case`. `name` globally unique.

### Name Uniqueness (CRITICAL)

All entity names globally unique. Conflict resolution by priority:

| Type | Priority |
|------|----------|
| business | 1 (highest — keeps name) |
| stream | 2 |
| product | 3 |
| project | 4 (lowest — gets `Name (1)`) |

### Self-Healing

Scanner auto-fixes manifest issues:

| Issue | Action |
|-------|--------|
| No `business.json` at root | Create with folder name |
| `stream.json` at root | Rename → `business.json` |
| `business.json` inside chain | Rename → `stream.json` |

## Database Schema

Shared schema — used by both Extension (`index.db`, sql.js) and Backend (`entities.db`, native sqlite3):

```sql
CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,        -- 'business' | 'stream' | 'product' | 'project'
    name TEXT,        -- globally unique
    icon TEXT,
    drive_path TEXT UNIQUE,
    parent_id INTEGER REFERENCES entities(id),
    git_url TEXT
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
Extension (reads VERSION → verifies installed; no deploy, suggests "run Host" if missing)
```

### Backend Spawn

```
Extension → spawn(venvPython, [serverPath]) → Backend
```

- No CLI arguments (backend reads pointer itself)
- `stdio: 'ignore'` (backend logs to `DuetData/backend.log`)
- `detached: true`
- Port read from `DuetConfig/{machine}.json` (default: 19680)

### Who Reads What

| File | Host | Extension | Backend | AI Agents |
|------|------|-----------|---------|-----------|
| `~/.org.ve68.duet` | **writes** | reads | reads | — |
| `DuetConfig/settings.json` | creates defaults | — | reads | — |
| `DuetConfig/{machine}.json` | reads+writes (port, defaults) | reads (port) | reads (port, @aliases) | — |
| `DuetData/backend/VERSION` | writes | reads | reads | — |
| `DuetData/config.json` | — | reads (legacy scanner) | — | — |
| `DuetData/ai-instructions/` | deploys | — | — | reads (instructions) |
| `DuetData/ai-kit/` | — | — | — | reads (settings.json) |
| `DuetData/backend.log` | — | — | writes | — |
| `DuetData/.pid` | — | — | writes | — |

## Build & Release

### Artifacts

| Component | Command | Artifact | Version bump |
|-----------|---------|----------|--------------|
| **Host** | `cd packages/host && npm run release` | `dist/Duet-{ver}.dmg` (or `.exe`, `.AppImage`) | Auto patch bump |
| **Extension** | `cd packages/extension && npm run vsix` | `dist/duet-{ver}.vsix` | Auto patch bump |
| **Backend** | — | No standalone artifact. Bundled into Host (extraResources) + Extension VSIX | Inherits Host version (at deploy) |

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
- `packages/ai-instructions/src/` → `ai-instructions/`
- `packages/backend/` → `backend/` (excludes tests, `__pycache__`)

### Extension Release (`packages/extension/build-vsix.js`)

```
npm run vsix
  1. Bump patch in package.json (0.0.8 → 0.0.9)
  2. Update viewContainer title → "Duet {version}"
  3. npm run package (typecheck + lint + esbuild --production)
  4. bundle-backend.js: copy packages/backend/ → dist/backend/ (excludes tests, __pycache__)
  5. vsce package → dist/duet-{version}.vsix
```

**Backend bundling:** `bundle-backend.js` copies Python source into VSIX (legacy). Extension no longer deploys backend — Host handles deployment via `deploy.ts`.

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
