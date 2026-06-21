# Duet Product Spec

Система управления знаниями и делами, построенная на дуэте Человека и ИИ.

> Read this FIRST when entering the monorepo. Component specs reference this file and never duplicate the domain.

## Agent Rules

- **NEVER make git commits.** All commits are done by the user manually.
- **NEVER make destructive git operations** (checkout, reset, force push, etc.).

## Components

```
┌─────────────────────────────────────────────────────────────────┐
│             AI Clients (external, MCP consumers)                │
│           Claude Code  ·  Codex  ·  Antigravity                 │
└──────▲────────────────────────────────────────────▲─────────────┘
       │ MCP (HTTP)                                 │ reads configs
       │                                            │ + merged
       │                                            │ instructions
       │                                            │ (written by Host)
┌──────┴──────────────┐                  ┌──────────┴──────────────┐
│ Backend (Python)    │ ◀── spawns ──────│ Host (Electron tray)    │
│ HTTP API + MCP      │     + deploys    │ Wizard + deployer       │
│ Owns entities.db    │                  │ Single writer of every  │
│ Strict reader of    │                  │ config (pointer,        │
│ configs & manifests │                  │ DuetConfig, manifests,  │
└──────▲──────────────┘                  │ AI client files)        │
       │ HTTP                            └─────────────────────────┘
       │
┌──────┴──────────────┐
│ Extension (VS Code) │
│ Tree views, commands│
│ Thin HTTP client    │
└─────────────────────┘
```

| Component | Package | Language | Role | Spec |
|-----------|---------|----------|------|------|
| **Host** | `packages/host` | TypeScript/Electron | Tray app. Writes pointer file. Deploys backend. Configures AI clients | [`spec/COMPONENT.md`](../packages/host/spec/COMPONENT.md) |
| **Extension** | `packages/extension` | TypeScript/VS Code | UI (tree views, commands). Thin client over Backend HTTP API | [`spec/COMPONENT.md`](../packages/extension/spec/COMPONENT.md) |
| **Backend** | `packages/backend` | Python | HTTP API + MCP. Owns DB. Strict reader of config and manifests | [`spec/COMPONENT.md`](../packages/backend/spec/COMPONENT.md) |

**Platform instructions — `packages/instructions`.** AI-инструкции (системный каркас `bootstrapper.md`, ядра агентов `executor.md`/`vizir.md`, `index.json`) — **платформенный артефакт внутри Duet**, бандлится рядом с backend (PROD — через electron-builder; DEV — копируется при деплое). Backend мёржит их в `DuetData/duet.md` (тонкий сессионный промпт) и `duet-{agent}.md` (полные тела субагентов); Host разливает по AI-клиентам (Claude Code, Codex, Antigravity) в рамках конфигурации агентов. Внешнего пользовательского репо инструкций больше нет — нет `instructionsPath`, нет отдельного wizard-шага. (Скиллы — отдельная машинерия: нативные `SKILL.md`, деплоятся в контексты через `skills`-декларации `context.json`, см. [Deploy Instructions](#deploy-instructions).)

## Domain

### Glossary

| Term | Definition |
|------|------------|
| **Entity** | Node in `entities.db`: `context`, `product_repo`, or `reference_repo` |
| **Context** | Bounded folder on Drive carrying `context.json` v4. Roles inferred from manifest fields, not from a separate enum |
| **Manifest** | `context.json` v4 inside a context folder |
| **Chain** | Path from meta/root context down to the current context |
| **Alias** | Key in a context's `git_repos` map — the github repo name (e.g. `Duet`), no `.git` suffix |
| **Product** | Top-level unit in orientation, discovered by four rules (see [Spec File Naming](#spec-file-naming)) |
| **Component** | Nested unit inside a product. Marker is `spec/COMPONENT.md` or `README*.md`, one level deep |

### Contexts and Hierarchy

```
meta-context (one per workspace, e.g. !БАЗА — meta: true)
├── root context (top-level, parent_id IS NULL, listed in root_context_folders)
│   ├── context (intermediate, can nest)
│   │   └── context with git_repos (products live in repos; Drive children may still nest)
│   └── context with git_repos
└── ...
```

A context is a folder on Drive carrying `context.json` v4. Roles are inferred from manifest fields:

| Role | How it's identified |
|------|---------------------|
| meta-context | `meta: true` in `context.json`. Exactly one per database whenever `root_context_folders` is non-empty |
| root context | `parent_id IS NULL`, listed in `root_context_folders` |
| context with git products | `git_repos` present; scanner registers one `product_repo` per alias and still recurses through the context's Drive folder |
| intermediate | none of the above |

The meta-context is the **управляющий уровень над контекстами** — a container for the user's top-level data that spans every other context: the personal task DB, the ontology, the AI instructions repo. Other root contexts hold domain data (businesses, streams); the meta-context holds the operating layer over them.

Three entity types live in `entities.db`:

| Type | Manifest | Tree? | Notes |
|------|----------|-------|-------|
| `context` | `context.json` v4 | yes | Bounded context on Drive |
| `product_repo` | — | no | Auto-registered for each alias in a context's `git_repos`. Entity name = `{alias}.git`. Path-resolution helper |
| `reference_repo` | — | no | Read-only clone declared via `reference_repos` |

### Manifests

`context.json` v4 carries the on-disk declaration of a context. Backend is a strict reader — Host owns every migration (v1 → v2 → v3 → v4). Examples:

```json
{ "version": 4, "name": "Duet", "icon": "📦", "git_repos": {"Duet": "git@github.com:owner/duet.git"} }
{ "version": 4, "name": "DuetLab", "icon": "🎭",
  "git_repos": {"Duet": "git@github.com:owner/duet.git"},
  "skills": ["@anthropic-skills.git/skills/pdf"],
  "instructions": ["@Duet.git/packages/instructions/executor.md"],
  "memory": "@DuetLab/README.md" }
{ "version": 4, "name": "БАЗА", "icon": "🗂", "meta": true }
{ "version": 4, "name": "ТехноЛаб", "icon": "📁", "reference_repos": {"cookbook": "https://..."} }
```

| Field | Type | Required? | Meaning |
|-------|------|-----------|---------|
| `version` | int | required | Schema version. `4` for current backend; `version != 4` ignored with `unrecognized_manifest_version` warning |
| `name` | string | required | Globally unique entity name |
| `icon` | string | optional | Defaults: `📁` for context, `📦` when `git_repos` present |
| `meta` | bool | optional | `true` marks the meta-context (see Invariants). Host migrates v1's `root` field |
| `git_repos` | map | optional | `{alias: url}` declaring product clones. When present, scanner registers N `product_repo` children while continuing to recurse through the Drive folder for nested contexts. Insertion order preserved and surfaces in `products[]` order |
| `reference_repos` | map | optional | `{name: url}` for read-only clones |
| `description` | string | optional | Surfaces in orientation's `chain[].description`; takes priority over README first sentence |
| `skills` | list | optional | `@`-paths to skill dirs deployed into `<context>/.claude/skills/` (see [Deploy Instructions](#deploy-instructions)) |
| `instructions` | list | optional | `@`-paths whose bodies compose the per-client `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` |
| `memory` | string | optional | A single `@`-path to the context-memory file; surfaced in orientation's `memory` block |

**Validation rules** (strict v4 reader; implementation `packages/backend/services/manifest.py:read_manifest`):
- Keys are `snake_case`. `name` globally unique (see Invariants).
- `git_repos` must be a non-empty object when present; alias and URL must be non-empty strings.
- `reference_repos` shares the alias namespace with `git_repos` — within-manifest overlap is rejected as `invalid_manifest`.
- `skills` / `instructions` must be lists of non-empty strings when present (shape only; `@`-path resolution happens at deploy / orientation time).
- `memory` must be a non-empty string when present.
- No regex / Windows-reserved-name / URL-leading-`-` guards: manifests are user-written, this is intentional.

**Workspace assembly is context-first.** Opening a context with `git_repos` builds a multi-root `.code-workspace` with the **Drive folder first**, cloned repos after (in `git_repos` order). The order is fixed — the former `workspace_config.primary_folder` knob was removed in v4 (its migration drops the field). The first folder is the default cwd for terminals and the anchor for file pickers, so the context's Drive folder (and its root `CLAUDE.md`) anchors the session.

**`reference_repos`** declares read-only clones. Key = clone name, value = git URL. Cloned to `DuetData/repos/{name}.git`. Entity name includes `.git` suffix (enters global uniqueness space, shared with `git_repos` aliases).

### Invariants

These rules must hold across the system. Violating any of them means the data is corrupted.

**`root_context_folders` is an ordered list — order is load-bearing in two ways.**

1. **Position 0 = meta-context (structural invariant).** Exactly one context in `entities.db` has `meta=1`, and it is the first element of `root_context_folders`. The state «list non-empty, no meta» is impossible — neither through Host UI (drag-to-position-0 is the only re-meta mechanism, the crown icon on `DuetPathsPage` is a read-only indicator) nor through direct edits to `settings.json` or `context.json` (Host's startup migration restores the invariant on the next sweep via atomic two-phase commit, see [`host/spec/COMPONENT.md` § Root Contexts](../packages/host/spec/COMPONENT.md)).
2. **List order = display order across all UI.** Backend's `/contexts` response delivers root contexts in this order; Extension's ДЕЛА sidebar preserves it without re-sorting. Non-root siblings are sorted alphabetically by `name`. The user controls display order via drag-to-position in Host's wizard, which writes back to `settings.json` and atomically rewrites both the order and the `meta` flags. Direct edits to `settings.json` are normalised on next Host start.

**Single-writer for config files.** Host is the only writer of `settings.json` and `{machine}.json`. Backend and Extension only read. Adding/removing/reordering root context folders, creating `@alias` mappings — all flows go through Host UI. Extension has no write path; before any root context edit it directs the user to Host.

**Name uniqueness.** Entity names are globally unique. Conflict resolution by priority (lower number = higher priority):

| Type | Priority | Behavior on collision |
|------|----------|----------------------|
| context | 2 | Claims name; existing `reference_repo` gets suffixed |
| product_repo | 3 | Suffixed if collides with a `context` |
| reference_repo | 5 | Suffixed (`Name (1)`) — lowest priority |

When two contexts collide on name (rare), the second-comer gets the `(N)` suffix.

**Manifest ownership.** Backend never writes manifests. Host owns all upgrades (v1 → v2 → v3 → v4) and self-heal of empty root context folders. Backend folders with `version != 4` are silently skipped with an `unrecognized_manifest_version` warning. See [Schema Migration Policy](#schema-migration-policy).

## On-disk Layout

### Pointer File

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

All 3 fields required. Missing field = not configured. Test overrides: `DUET_POINTER_FILE` (Backend), `DUET_CONFIG_FILE` (Host).

### DuetData

Local cache. Fully recoverable — can be deleted and rebuilt.

```
DuetData/
├── data/
│   ├── entities.db                # Backend's SQLite (native sqlite3)
│   ├── scan.json                  # Last scan result (atomic write)
│   ├── contexts.json              # Entity tree cache (atomic write)
│   └── duet-instructions-errors.json
├── repos/
│   └── {alias}.git/               # cloned repositories
├── workspaces/
│   └── {Context}.code-workspace   # multi-root: repos + Drive folder
├── backend/
│   ├── VERSION                    # installed backend version (written by Host)
│   ├── server.py                  # backend code (deployed by Host)
│   └── requirements.txt
├── duet.md                        # thin session prompt: bootstrapper + skills, no core (Backend writes)
├── duet-{agent}.md                # full per-agent instructions for the duet-{agent} subagents (Backend writes)
├── .venv/                         # Python virtual environment
├── backend.log                    # backend log (RotatingFileHandler)
└── root-contexts.code-workspace   # multi-root for all root contexts
```

### DuetConfig

Cloud-synced (e.g. Google Drive). Shared across machines via `settings.json`; machine-local values live in `{machine}.json`.

```
DuetConfig/
├── settings.json                  # shared across machines (v2)
└── {machine}.json                 # per-machine config (v2)
```

**`settings.json`** (shared):

```json
{
  "version": 2,
  "timestampTZ": { "id": "M", "value": "Europe/Moscow" },
  "root_context_folders": ["@БАЗА", "@МетаЛаб"]
}
```

| Field | Who reads | Purpose |
|-------|-----------|---------|
| `root_context_folders` | Backend | Ordered list of top-level context folders (`@aliases`). Order is load-bearing — see Invariants. Renamed from `business_folders` in v1; Host owns startup migration |
| `timestampTZ` | Backend | Timezone for timestamps; `id` becomes the suffix in `YYMMDD_HHMMSS<id>` |
| `version` | Host | Schema version for Host's startup migration |

**`{machine}.json`** (per-machine, NOT cloud-synced):

```json
{
  "version": 2,
  "port": 19680,
  "@БАЗА": "/Users/.../!БАЗА",
  "@МетаЛаб": "/Users/.../!МетаЛаб"
}
```

| Field | Who reads | Purpose |
|-------|-----------|---------|
| `port` | Extension, Backend | HTTP port for backend |
| `pythonPath`, `deployChannel`, `devBackendPath` | Host | Host-specific machine settings |
| `@alias` keys | Backend | Machine-specific path resolution (see @Alias Resolution) |

### @Alias Resolution

`root_context_folders` entries use `@aliases` resolved via `{machine}.json`:

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

**Contract:** unresolved alias → error (fail fast, not silent fallback). All path comparisons normalize through NFC (macOS NFD vs NTFS NFC).

**Deploy-time `@`-paths are a separate alias space.** The `skills` / `instructions` / `memory` declarations use `@<head>/<rest>` resolved by `packages/backend/services/at_paths.py` — `<head>` is a **repo dir** under `DuetData/repos` (e.g. `@anthropic-skills.git`) or a **context name** (e.g. `@DuetLab` → that context's Drive folder), drawn from the Backend's internal hierarchy, not from `{machine}.json`. `..`-traversal escaping the matched root is rejected; an unresolvable `@`-path is skipped with a warning (not fatal — deploy is best-effort per declaration).

### Repository Naming

| Pattern | Meaning |
|---------|---------|
| `{alias}.git` | Main clone of a product (alias from `git_repos` or `reference_repos` name) |
| `{alias}.wt-N` | Worktree N (planned) |

Aliases from `git_repos` live in a global `{alias}.git` namespace shared with `reference_repos`. Manifest validation rejects within-manifest overlap; cross-manifest collisions surface as `repo_collision` scan errors.

**Manifest alias vs. Duet-ontology slug.** The key in `git_repos` (e.g. `"Duet"`) is the **github repo name** — short, user-facing, no `.git`. Everywhere this product surfaces inside Duet — the clone folder (`DuetData/repos/Duet.git/`), `product_repo.name` in DB, `orientation.products[*].name` (`"Duet.git"`), `orientation.products[*].path` (`"@Duet.git"`) — uses the derived slug `{alias}.git`. The `.git` suffix is added by backend during derivation; it is **not** stored in the manifest.

Drive-products (rules B/C/D in the Orientation algorithm — context-as-product, subfolder-as-product, README fallback) have no git repo. Their slug is just the context/subfolder name without `.git`.

## Cross-Component Contracts

### Backend Spawn & Version Flow

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

- **Host** is the single owner of backend process lifecycle (start, stop, health).
- `spawn(venvPython, [server.py], { stdio: ['ignore', 'ignore', 'pipe'] })` — attached child (no `detached`, no `unref`), dies with Host. stderr piped during startup for diagnostics; closed once `/health` confirms ready.
- Auto-start on Host startup (when ready + deployed). Auto-start after deploy. Stop on Host quit.
- **Extension** checks `/health` once on activation (no polling). Port read from `DuetConfig/{machine}.json` (default 19680).
- Host writes its version to `DuetData/backend/VERSION` after successful deploy; Backend returns it via `/health`; Host checks for mismatch and redeploys on upgrade.

### Orientation

AI agents call `orientation(workspace_paths=[<all working dirs>])` at session start. Backend resolves workspace paths to an entity via multi-path resolution and returns structured context.

**Consumers:** AI agents (via MCP tool), Extension (via HTTP endpoint).

**Multi-path resolution:** classifies each path (gitFolder / contextFolder / ignored), resolves entities. If the meta-context is among them, it wins; otherwise the first resolved context is used. Multi-repo contexts (DuetLab-style) unify all `repos/<alias>.git` paths to one owner — each path resolves through its `product_repo` entity to the same parent context. The first-come fallback also covers the brief window when the DB hasn't caught up with a fresh Host meta-flag write.

**Response blocks (v4 shape):**

| Block | Purpose | Always present? |
|-------|---------|----------------|
| `duet_paths` | `duetDataPath`, `machineConfig` | Yes |
| `workspace` | `kind`, `context_name`, `context_folder`, `git_folders` (map), `[reference_repos]`, `[meta-only addons]` | Yes |
| `context` | breadcrumb + chain (`type`, `name`, `icon`, `description?`) | When entity resolved |
| `products` | Top-level array; each product has `name`, `path` (@-ref), `spec?`, `description?`, `components[]` | When entity resolved |
| `memory` | Context-memory pointer `{ref, path}` resolved from `context.json` → `memory`, or `null` when none declared | When entity resolved |

Detailed shape: [`packages/backend/spec/COMPONENT.md` → Orientation](../packages/backend/spec/COMPONENT.md). Algorithm implementation: `packages/backend/services/products.py:build_products` — code is the normative source.

### Deploy Instructions

A context can declare per-context AI artifacts that Duet materializes into its Drive folder. The Extension calls `POST /deploy-instructions` (on activation, on workspace-folder change, and on `duet.refresh`); the Backend resolves the owning context and deploys. Idempotent (atomic writes + prune), so safe to call on every trigger; Host is not involved.

| Component | `context.json` field | Target | Behavior |
|-----------|---------------------|--------|----------|
| Skills | `skills` (list of `@`-paths) | `<context>/.claude/skills/<name>/` | Duet-managed: deploy the declared set, prune the rest. A pruned dir is **backed up** into `.claude/skills/.pruned/<name>` first. Absent key → no-op; present (even `[]`) → manage |
| Instructions | `instructions` (list of `@`-paths) | `<context>/CLAUDE.md`, `AGENTS.md`, `GEMINI.md` | Bodies of the declared sources compose into per-client templates (`packages/backend/*_template.md`); **always generated** (templates carry the client memory policy), written read-only `0444`. A hand-written file (no Duet banner) is backed up to `<name>.bak` once before first overwrite |

The Drive folder is the workspace's first root (context-first assembly), so AI clients auto-load these `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` from the project root. `@`-paths resolve over repos ∪ context folders — see [@Alias Resolution](#alias-resolution). Implementation: `packages/backend/services/deploy_instructions.py`, `services/at_paths.py`.

### Spec File Naming

The orientation algorithm (v4) uses **single canonical spec files** — no fallback chain. A missing canonical file means the entity has no spec; orientation falls back to `README*.md` only for description (never as the spec path).

| Where | Canonical spec file |
|-------|---------------------|
| product (alias from `git_repos`, rule A) | `<repo>/spec/PRODUCT.md` |
| product (context-as-product, rule B) | `<context>/spec/PRODUCT.md` |
| product (subfolder, rule C) | `<sub>/spec/PRODUCT.md` |
| component | `<…>/<comp>/spec/COMPONENT.md` |

First sentence of `PRODUCT.md` / `COMPONENT.md` becomes the entity's `description` in orientation. If the spec file is absent, orientation tries `README*.md` (exact `README.md` wins; otherwise alphabetically first) — that yields a description but no `spec` field.

### File Ownership

| File | Host | Extension | Backend | AI Agents |
|------|------|-----------|---------|-----------|
| `~/.org.ve68.duet` | **writes** | reads | reads | — |
| `DuetConfig/settings.json` | **writes** | — | reads | — |
| `DuetConfig/{machine}.json` | **writes** | reads (port) | reads (port, @aliases) | — |
| Context `context.json` manifests | **writes** (migrations, self-heal) | — | reads (strict v4) | — |
| `DuetData/backend/VERSION` | **writes** | — | reads | — |
| `DuetData/backend.log` | — | — | **writes** | — |
| `DuetData/data/entities.db` | — | — | **writes** | — |
| `DuetData/data/{scan,contexts}.json` | reads (wizard, file watcher) | — | **writes** | — |
| `DuetData/duet.md` (thin session prompt) | reads → output-style + Codex/Antigravity | — | **writes** | — |
| `DuetData/duet-{agent}.md` | reads → `duet-{agent}` subagents | — | **writes** | — |
| Context `<context>/.claude/skills/`, `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` | — | triggers `/deploy-instructions` | **writes** (deploy) | reads |

**Single-writer invariant** for `settings.json` and `{machine}.json` (see Invariants): Host is the only writer. Extension does not have its own write path; before any root context folder edit it must direct the user to Host.

### Schema Migration Policy

Host owns auto-upgrade of all on-disk Duet schemas (settings.json, `{machine}.json`, context manifests). Backend never mutates files and never migrates. **Strictness asymmetry:** Backend is a strict v4 reader for `context.json` — it validates `version: 4` explicitly and emits `unrecognized_manifest_version` for anything else. For `settings.json` and `{machine}.json` Backend does not validate the `version` field; it reads required fields by name (`root_context_folders`, `timestampTZ`, `port`, etc.) and fails fast if their shape is wrong. Schema-version enforcement for these two files is Host's responsibility (migration sweep + critical gate). Implementation lives in Host: [`packages/host/spec/COMPONENT.md` → Schema Migrations](../packages/host/spec/COMPONENT.md).

**Migration chain summary:**

| Schema | File(s) | Target | Chain |
|--------|---------|--------|-------|
| settings | `settings.json` | v2 | v1 → v2 (rename `business_folders → root_context_folders`, add `version`) |
| machine | `{machine}.json` | v2 | v1 → v2 (add `version`) |
| context | `business.json`/`stream.json`/`product.json` → `context.json` | v4 | v1 → v2 (rename file, `root → meta`); v2 → v3 (`git_url` → `git_repos: {<name>: <url>}`); v3 → v4 (drop `workspace_config`) |

**Forward-incompatibility.** A future Duet version that bumps schemas beyond what this Host build supports (e.g. context v5) leaves the older Host with `version > MAX_SUPPORTED`:
- Settings/machine → critical → backend blocked → user must update Duet.
- Context manifest → per-context warning → backend skips that context only.

**Multi-machine sync caveat.** Drive sync between an upgraded and not-yet-upgraded machine briefly produces files at higher version on the older machine. The handling above keeps both machines safe (no corruption, no infinite loops); the older machine shows error UI until updated.

**No rollback.** First Host startup on an upgraded machine rewrites every legacy manifest in place. Pre-upgrade backup is recommended for users with significant data; Host does not back up automatically.

### Pre-commit Verification

Run before every commit:

```bash
npm run verify          # all packages
npm run verify:host     # typecheck + lint + vitest
npm run verify:extension # check-types + lint + vitest
npm run verify:backend  # pytest
```

| Package | Type Check | Lint | Tests |
|---------|-----------|------|-------|
| **Host** | `npm run typecheck` (tsc node + web) | `npm run lint` (eslint) | `npm run test:run` (vitest) |
| **Extension** | `npm run check-types` (tsc) | `npm run lint` (eslint) | `npm run test` (vitest) |
| **Backend** | — | — | `pytest` |

**Important:** `electron-vite build` uses esbuild which skips TypeScript checks (`noUnusedLocals` etc.). Always run `npm run typecheck` separately.

**Release-before-commit rule.** Build scripts modify the working tree (`package.json` version bump, `resources/BUILD_SHA`). The release commands MUST run before staging the commit so those edits are part of the same commit as the code changes. Sequence:

1. Make code changes; ensure `npm run verify` passes.
2. `cd packages/host && npm run release` (or `cd packages/extension && npm run vsix` for Extension).
3. Commit: code + bumped `version` + `BUILD_SHA` together.
4. Push.

Agent never commits — only prepares the message.

Per-package build & release pipelines: each component's `Engineering` chapter. CI workflows: `.github/workflows/build-host.yml` (build artifacts for macOS/Windows/Linux on push to main if `packages/host/` changed) and `.github/workflows/host-test.yml` (vitest on the same trigger; E2E disabled — monorepo symlink issues). No auto-publish — artifacts are downloaded manually from Actions → GitHub Release.
