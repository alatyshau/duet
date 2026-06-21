# Host

Electron tray app that writes the pointer file, deploys backend to DuetData, and configures AI clients.

> Domain model (contexts, manifests, invariants), pointer file, file ownership, cross-component contracts (backend spawn, schema migration policy): see [/spec/PRODUCT.md](/spec/PRODUCT.md). UI navigation and per-page contracts: see [UI.md](UI.md). This file documents what Host itself owns.

## Purpose

Host is the **single writer** of system configuration and the **owner of backend lifecycle**. Three responsibilities:

1. **Pointer + config.** Writes `~/.org.ve68.duet`. Writes and migrates `DuetConfig/settings.json` and `{machine}.json`. Writes and migrates context manifests on disk. Enforces structural invariants (meta-context at position 0).
2. **Deployment.** Deploys backend Python code from bundled `extraResources` to `DuetData/backend/`, manages venv + dependencies, writes `VERSION`, owns process spawn / stop / health monitoring.
3. **AI client integration.** Reads the thin session prompt (`DuetData/duet.md`) and the full per-agent instructions (`DuetData/duet-{agent}.md`) and writes them into Claude Code / Codex / Antigravity config locations.

Everything in this file describes how Host fulfils these three roles. UI surfaces (tray, wizard, pages) — see [UI.md](UI.md).

## Architecture

### Layers

| Layer | Responsibility | Files |
|-------|----------------|-------|
| `shared/` | Types crossing process boundary (IPC) + pure mappers | `types.ts` (single source of truth), `mappers.ts` |
| `core/` | Config, app state, deploy, backend, AI clients, instructions, root contexts, schema migrations, atomic JSON IO, wizard status, app registry | `config.ts`, `app-state.ts`, `deploy.ts`, `backend.ts`, `ai-clients.ts`, `instructions.ts`, `root-contexts.ts`, `schema-migrations.ts`, `json-io.ts`, `wizard-status.ts`, `apps.ts` |
| `platform/` | Tray, autolaunch | `tray.ts`, `autolaunch.ts` |
| `main/` | Window, IPC handlers, lifecycle | `index.ts`, `window.ts`, `ipc-handlers.ts` |
| `preload/` | Bridge main ↔ renderer | `index.ts`, `index.d.ts` |
| `renderer/` | React UI | `App.tsx`, `pages/wizard/*.tsx`, `pages/apps/BackendAppPage.tsx`, `components/` |

### Engineering Principles

| Principle | Rule |
|-----------|------|
| **Thin shell** | `main/`, `platform/`, `preload/` — only wiring. All non-trivial logic in `core/`. If logic in shell grows beyond a one-liner → extract to `core/` |
| **No framework imports in core/** | `core/` has zero Electron imports. Testable with plain Node.js |
| **Shared types** | `shared/types.ts` is the single source of truth for all types crossing process boundary (IPC). Core modules re-export from shared. No type duplication |
| **Unit tests for core/ only** | Don't mock Electron. Test pure `core/` functions directly. Shell is validated by TypeScript + E2E |
| **Pure functions over state** | Prefer pure functions with explicit args over closures capturing module state |
| **Spec-driven** | Code + spec changes in same commit. Read `spec/` before changes, update after |

### AppState

Single source of truth for application status. Derived by `checkAppState()` reading pointer → checking fields → checking `existsSync()`.

| Status | Condition |
|--------|-----------|
| `no_config` | Pointer missing, or any of 3 required fields empty |
| `path_lost` | All fields present, but `duetDataPath` or `duetConfigPath` doesn't exist on disk |
| `ready` | All fields present AND both directories exist |

```
+----------------+
|   no_config    | ← pointer missing OR fields incomplete
+-------+--------+
        | user fills all 3 fields
        v
+----------------+
|     ready      | ← both paths exist on disk
+-------+--------+
        | folder deleted/moved
        v
+----------------+
|   path_lost    | ← fields set but paths don't exist
+----------------+
```

**Config interface:**

```typescript
interface Config {
  machine?: string
  duetDataPath?: string
  duetConfigPath?: string
}
```

Operations: `readConfig()` (returns `{}` if missing/broken), `writeConfig(config)` (JSON, 2-space indent), `getConfigFile()` (returns pointer path; `DUET_CONFIG_FILE` env overrides for tests).

**AppState extended fields** — beyond core status/path fields, exposes machine-config values needed by wizard pages:

| Field | Source | Purpose |
|-------|--------|---------|
| `pythonPath` | `{machine}.json` | Python interpreter path (wizard step 2) |
| `hasDevBackendPath` | `{machine}.json` | Controls DEV/PROD toggle visibility (wizard step 3) |
| `deployChannel` | `{machine}.json` | `'dev' \| 'prod'` (default `'prod'`) — controls whether deploy uses bundled resources or dev override paths |

Implementation: `core/app-state.ts:checkAppState()`.

### Single Instance

Host uses Electron `requestSingleInstanceLock()`. Second instance shows window of the first and exits.

## Surface

### IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `app:get-state` | renderer → main | Get current AppState |
| `app-state-changed` | main → renderer | Push state updates |
| `dialog:select-folder` | renderer → main | Open system folder picker |
| `dialog:select-file` | renderer → main | Open system file picker |
| `config:save-pointer` | renderer → main | Save pointer file (partial updates supported — missing fields preserved). Creates default DuetConfig files when both `duetConfigPath` and `machine` are present. Calls `updateAppState()`, returns new AppState |
| `shell:open-path` | renderer → main | Open path in Finder/Explorer |
| `config:set-deploy-channel` | renderer → main | Set deploy channel (dev/prod) in machine config; calls `updateAppState()`, returns new AppState |
| `deploy:get-status` | renderer → main | Get deploy status |
| `deploy:start` | renderer → main | Start deploy (async). Broadcasts status + log events |
| `deploy:status-changed` | main → renderer | Push deploy status updates |
| `deploy:log` | main → renderer | Push deploy log messages |
| `python:detect` | renderer → main | Auto-detect Python 3.10+ (checks saved path first) |
| `python:validate` | renderer → main | Validate a specific Python path |
| `python:save` | renderer → main | Save `pythonPath` to `{machine}.json` |
| `backend:get-status` | renderer → main | Get backend status (stopped/starting/running/error) |
| `backend:start` | renderer → main | Start backend |
| `backend:stop` | renderer → main | Stop backend |
| `backend:status-changed` | main → renderer | Push backend status updates |
| `agents:detect` | renderer → main | Detect installed AI clients |
| `agents:configure` | renderer → main | Configure all AI clients |
| `agents:fix-issue` | renderer → main | Fix specific agent issue (by `agentId` + `reasonCode`) |
| `root-contexts:get` | renderer → main | Get resolved root contexts (raw alias + absolute path + isMeta) |
| `root-contexts:save` | renderer → main | Overwrite `root_context_folders` array in `settings.json` (used by remove/reorder); after save, enforces meta-required invariant |
| `root-contexts:add` | renderer → main | Alias-aware add: creates `@<basename>` in `{machine}.json`, appends to `root_context_folders`, runs scoped schema migration, enforces meta-required invariant |
| `root-contexts:scan` | renderer → main | Trigger `POST /scan` |
| `root-contexts:get-cached-scan` | renderer → main | Read cached `scan.json` from `DuetData/data/` |
| `root-contexts:get-cached-contexts` | renderer → main | Read cached `contexts.json` (entity tree) from `DuetData/data/` |
| `migrations:get-status` | renderer → main | Get cached `MigrationResult` from last sweep |
| `migrations:status-changed` | main → renderer | Push fresh `MigrationResult` after each sweep |

**Mutation contract:** `agents:configure`, `agents:fix-issue`, and config writers call `updateAppState()` after mutations to refresh tray icon. `deploy:start` runs async deploy, broadcasts status + log events.

**Config defaults** (`ensureConfigDefaults(duetConfigPath, machine)`): creates `settings.json` (`{ version: 2, root_context_folders: [], timestampTZ: { id: "Z", value: "UTC" } }`) and `{machine}.json` (`{ version: 2, port: 19680 }`) only if files don't exist. Never overwrites. Implementation: `core/config.ts`.

**Machine config write** (`setMachineConfigKey(key, value)`): read-modify-write single field in `{machine}.json`. Throws if pointer incomplete, machine name invalid, or file missing/invalid JSON. `setSettingsConfigKey(key, value)` mirrors this for `settings.json`. Silent-recreate-from-`{}` paths are gone — they used to lose sibling fields (`timestampTZ`, `port`). Failures now surface to the UI so the user can re-run wizard step 1 (`ensureConfigDefaults`) to recover.

### Pages

Full per-page UX, sidebar status icons, wizard step list: see [UI.md](UI.md). High-level mapping:

| Tab | Pages |
|-----|-------|
| Settings (⚙) | 5-step wizard: Duet: пути → Python → Backend → Воркспейсы → AI Агенты |
| Apps (▶) | `app:duet-backend` — process card for Duet Backend |

### Tray

Full icon table and behavior: see [UI.md](UI.md). Severity-driven: tray icon reflects `maxSeverity(deploySeverity, settingsSeverity)` when `AppStatus === 'ready'`; otherwise forced to warning. Apps-tab severity appears next to the tab button in the sidebar but is **not** aggregated into the tray icon — the tray reflects setup + deploy state only. Severity model: see Behaviors → Severity Framework.

### Window Behavioral Contracts

| Behavior | Contract |
|----------|----------|
| Window close | Hides window, does NOT quit app |
| First run (no pointer file) | Shows window for onboarding |
| Status `path_lost` | Shows window (needs attention) |
| Status `ready` | Silent in tray, no window |
| macOS Dock | Hidden by default, visible when window shown |
| Second instance | Shows window of first instance, second exits |
| Production | Cmd/Ctrl+R reload disabled |
| External links | Opened in system browser (not in-app) |

## Behaviors

### Deploy Service

Deploys backend from bundled resources to DuetData.

| Component | Source (extraResources) | Target | Method |
|-----------|------------------------|--------|--------|
| Backend | `backend/` | `DuetData/backend/` | Atomic swap (filtered): `.new` → rename → `.old` → delete |

Platform instructions (`bootstrapper.md`, agent cores, `index.json`) are product-bundled — they live inside the product at `packages/instructions/` (no external repo). In DEV mode `deployBackend()` copies `packages/instructions/{*.md,index.json}` (minus `README.md`) next to the deployed backend via the `copyPlatformInstructions()` helper; in PROD they ship via electron-builder.

**Deploy filter:** copy operations exclude dev artifact directories (`.venv`, `__pycache__`, `.pytest_cache`, `node_modules`, `.git`). Prevents copying dev environment when deploying from source (`devBackendPath`).

**Deploy channel:** when `deployChannel === 'dev'` in `{machine}.json`, deploy uses `devBackendPath` from machine config instead of bundled resources. Toggle via IPC `config:set-deploy-channel`.

**Version comparison:** uses `compareSemver(appVersion, deployed)` — strips build metadata per semver spec before comparing. Deploy only when app version is newer (not on downgrade or same version).

**PROD deploy guard:** when `deployChannel === 'prod'` and Electron is not packaged (`!app.isPackaged`), deploy checks if bundled backend exists. If not → throws human-readable error: "PROD-деплой недоступен в dev-режиме. Соберите приложение или переключитесь на DEV." Prevents cryptic "Backend source not found" errors in development.

**Flow:** PROD guard → VERSION check (semver) → skip if not newer → **stop backend** (POST `/stop` + grace sleep — no SIGTERM/SIGKILL because deploy has no process reference, see *Backend stop before deploy* below) → deploy backend (atomic swap; in DEV also copy platform instructions via `copyPlatformInstructions()`) → Python check → venv + pip → write VERSION (only on full success).

**Post-deploy configure:** after `runDeploy()` completes, the deploy IPC handler calls `configureAllAgents(...)` so `duet.md` and the per-agent files are rebuilt and redeployed — `duet.md` never goes stale after a backend upgrade.

**VERSION file:** `DuetData/backend/VERSION` contains version with build metadata:

| Channel | Format | Example |
|---------|--------|---------|
| PROD | `{semver}+prod_{sha}` | `0.1.8+prod_abc1234` |
| DEV | `{semver}+dev_{timestamp}` | `0.1.8+dev_2604041330` |
| Fallback | `{semver}` | `0.1.8` (no BUILD_SHA, dev electron) |

SHA (PROD): `git rev-parse --short HEAD` at build time → `resources/BUILD_SHA` → baked into bundle. Timestamp (DEV): `YYMMDDHHMM` at deploy time.

VERSION is NOT written if any step fails (Python not found, pip failed, etc.).

**Deploy warning** (`isDeployWarning`): channel-aware staleness check for tray icon.
- PROD: warns on dev version deployed, SHA mismatch, or semver upgrade needed.
- DEV: warns on prod version deployed, semver change, or source `.py` files newer than deploy timestamp.
- Backward compatible: plain semver (no metadata) falls back to semver-only check.

**Backend stop before deploy:** `stopBackend(port, null, opts)` — deploy passes `null` for `proc` (the process reference doesn't survive across the IPC boundary), so the deploy stop path is POST `/stop` (2s timeout) + blind `sleep(STOP_GRACE_PERIOD_MS)`, no SIGTERM/SIGKILL. The grace sleep is enough for backend's own `SHUTDOWN_TIMEOUT_S` plus a 1s margin; if backend was already dead, the fetch fails silently and we proceed to file operations. Errors don't abort deploy.

**Pure functions** (extracted from Electron shell):
- `resolveDeployStatus(appState, appVersion, activeStatus)` → `DeployStatus` — used by IPC handler `deploy:get-status`
- `isDeployWarning(appState, appVersion, buildSha?, devBackendPath?)` → boolean — used by `main/index.ts` for tray icon
- `parseVersionMeta(version)` → `VersionMeta` — parse `semver+channel_identifier`
- `readBuildSha(resourcesPath)` → `string | null` — read bundled BUILD_SHA
- `formatDeployTimestamp(date?)` / `parseDeployTimestamp(ts)` — YYMMDDHHMM format
- `isSourceNewer(dirPath, since)` → boolean — check if `.py` files changed after deploy (DEV mode)

Implementation: `core/deploy.ts`.

### Backend Lifecycle

Host is the single owner of backend process lifecycle (start, stop, health monitoring).

**Start:** `startBackend(duetDataPath, port)` — spawn venv Python with `server.py`, attached child (no `detached`, no `unref`) so the backend dies with Host. `stdio: ['ignore', 'ignore', 'pipe']` — stderr is piped for diagnostics during startup so a crash surfaces in `BackendStatus.error`; the pipe is closed after `/health` confirms the backend is up (backend logs to file from there). Poll `/health` until ready. Kill process if health check fails after all retries.

**Stop:** `stopBackend(port, proc?, opts?)` — POST `/stop` (2s timeout) → wait grace period (`waitForExit` when `proc` provided, blind `sleep` when it isn't). If `proc` is null (e.g. deploy path, where the process reference is not available across IPC boundary) the function returns here — no SIGTERM/SIGKILL fallback. When `proc` is provided (normal shutdown, `before-quit`) it continues: SIGTERM → grace → SIGKILL. No PID file. Never throws (backend may not be running).

**Health:** `checkHealth(port)` — GET `/health` with 2s timeout. Returns `{version, uptime}` or null.

**Status:** `getBackendStatus(duetDataPath, port)` → `BackendStatus` (stopped | starting | running | stopping | error).

**File watcher:** `main/index.ts` watches `DuetData/data/` via `fs.watch` (debounce 500ms). Detects external changes (Backend scan/merge) and triggers `updateAppState()` → tray icon refresh. Lifecycle managed by `updateAppState()`: starts when `duetDataPath` appears, restarts on path change, retries when `data/` directory appears after deploy. Stopped on quit. Non-critical: silently handles missing directory or watch errors.

**Auto-start on startup:** when `status === 'ready'` and VERSION file exists (`readDeployedVersion() !== null`) → `ensureBackendRunning()`. Deploy warnings (channel mismatch, stale version) do NOT block auto-start — backend is functional with warnings.

**Auto-scan on startup:** after backend auto-start succeeds, if `root_context_folders` is non-empty and `readCachedScan()` returns `null` (scan never ran) → `triggerScan(port)`. Populates sidebar status for wizard step 4 without manual visit.

**Auto-configure agents on startup:** after backend auto-start and auto-scan, if `readCachedErrors()` returns `null` (merge never ran) → `await configureAllAgents()`. The merge runs inside `configureAllAgents()` (it calls `triggerMerge()` first, then deploys). Both auto-scan and auto-configure finish with a single `updateAppState()` call.

**Auto-start after deploy:** `runDeploy()` calls `startBackend()` after writing VERSION.

**Stop on quit:** `before-quit` handler calls `ensureBackendStopped()` with re-entrance guard.

**Concurrent start guard:** in-memory `isStarting` flag in `ipc-handlers.ts` prevents race between auto-start and user click (single-instance lock guarantees one Host process).

**IPC push:** `backend:status-changed` broadcasts `BackendStatus` during start/stop operations.

Implementation: `core/backend.ts`.

### AI Clients

Detects and configures AI clients via direct file writes (no CLI). Backend produces two kinds of merged file: the **thin session prompt** `DuetData/duet.md` (bootstrapper, no agent core) and one **full per-agent** file `DuetData/duet-{agent}.md` (bootstrapper + agent core) for each agent declared in `index.json.agents` (e.g. `duet-executor.md`, `duet-vizir.md`). Host reads them via `readMergedAgents()` and deploys per platform.

`configureAllAgents()` is **async** and merges-then-deploys: it first calls `triggerMerge(port)` (Backend rebuilds `duet.md` + `duet-{agent}.md` from the bundled platform sources), then reads the merged files and deploys them to the AI clients. The "Настроить все" button on the AI Агенты page and the startup / post-deploy auto-configure paths all go through this single function.

**Thin/full split:** the session-level deployments — Claude output-style, Codex instructions, Antigravity `GEMINI.md` — all use the thin session prompt (`merged.sessionPrompt`, from `duet.md`). The behavioral agent layer comes from the per-context `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` (deployed by Backend), not from the session prompt. The Claude `duet-executor` / `duet-vizir` custom subagents still carry the full agent cores (`merged.executor` / `merged.vizir`, from `duet-{agent}.md`).

| Client | Config files | What |
|--------|-------------|------|
| Claude Code | `~/.claude/output-styles/duet-executor.md` | Thin session prompt (`duet.md` / `sessionPrompt`) as output style. Frontmatter `name: duet-executor`, `keep-coding-instructions: true` |
| Claude Code | `~/.claude/agents/duet-executor.md` | Executor full core as custom subagent (kebab-case `name`, separate frontmatter without `keep-coding-instructions`) |
| Claude Code | `~/.claude/agents/duet-vizir.md` | Vizir full core as custom subagent |
| Claude Code | `~/.claude/settings.json` | `outputStyle: "duet-executor"` |
| Claude Code | `~/.claude.json` | MCP server (`mcpServers.duet`, HTTP) |
| Codex | `~/.codex/duet_instructions.md` | Host-managed instructions file (thin session prompt) |
| Codex | `~/.codex/config.toml` | `model_instructions_file` + `[mcp_servers.duet]` |
| Antigravity | `~/.gemini/GEMINI.md` | Host-managed instructions file (thin session prompt) |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | MCP server (`mcpServers.duet`, HTTP) |

**Platform asymmetry:** custom subagents (full agent cores) are deployed only for Claude Code. Codex and Antigravity get only the thin session prompt.

**Host knows two agents:** the deployment logic is hard-coded for `executor` and `vizir` (`MergedAgents = { sessionPrompt, executor, vizir }`). Backend (`merge_duet_instructions`) accepts any agent set declared in `index.json.agents`, but additional agents would be merged to disk and ignored by host. If/when a third agent is added, host needs to be extended to read the agent set dynamically from the backend response.

**Pattern:** read per-agent merged content from disk (`DuetData/duet-{agent}.md`) → detect (config dir exists?) → configure (write files) → show result. Not found = info, not error. Content not generated = MCP configured, instructions skipped (`needs_setup`).

**Content freshness (per-file):** for each Claude Code file, detect compares on-disk content against the expected wrapper (frontmatter + body) for that file. Output style and each custom agent have **different** frontmatters wrapping (potentially) different bodies — staleness in any one file flips its `checkedFile.ok` to `false`.

**Issues:** `AgentIssue[]` — actionable problems beyond basic config (e.g. `additionalDirectories` in Claude Code `settings.json`). Each issue has `reason_code`, `description`, `fixable`. Fix via `fixAgentIssue(agentId, reasonCode)`.

**`additionalDirectories` check:** Claude Code `settings.json` may contain `additionalDirectories`, which pollutes VS Code multi-root workspace and breaks orientation. Detect reports issue with `reason_code: "additional_directories"`, fixable by removing the key.

**Legacy uborka:** `cleanupLegacyClaudeFiles(duetDataPath)` removes pre-multi-agent artifacts (`~/.claude/output-styles/duet.md`, `~/.claude/agents/duet.md`, `DuetData/duet-instructions.md`). Idempotent. Does **not** touch user-personal `~/.claude/agents/vizir.md` or any non-Duet files. **Runs automatically** at the end of every successful Claude Code configure pass — immediately after the three new files (`duet-executor.md` output-style + executor/vizir custom agents) are written. Safe-by-construction: the cleanup runs only after the new files exist on disk, so users have no migration window where both old and new are missing. Failed deletions surface in the agent's `details` string for the wizard.

Implementation: `core/ai-clients.ts`.

### Instructions

Manages merged AI instructions lifecycle. Platform instruction sources (`bootstrapper.md`, agent cores, `index.json`) are product-bundled at `packages/instructions/`. Backend merges them into the thin session prompt `DuetData/duet.md` and per-agent `DuetData/duet-{agent}.md` via `POST /merge-duet-instructions`.

**Operations:**
- `triggerMerge(port)` — calls Backend endpoint, returns `InstructionsMergeResult` (`{ status, paths: { agent → path }, errors }`). Not a user-facing screen — invoked internally as the prelude of `configureAllAgents()`.
- `readMergedAgent(duetDataPath, agent)` — reads one agent's merged file from disk; returns `null` if missing.
- `readSessionPrompt(duetDataPath)` — reads the thin session prompt `DuetData/duet.md` (const `SESSION_PROMPT_FILE = 'duet.md'`); returns `null` if missing.
- `readMergedAgents(duetDataPath)` — reads the session prompt + both agents into a `MergedAgents` bag (`{ sessionPrompt, executor, vizir }`).
- `readCachedErrors(duetDataPath)` — reads errors from `DuetData/data/duet-instructions-errors.json`.

Implementation: `core/instructions.ts`.

### Root Contexts

Manages root-context folder configuration in `DuetConfig/settings.json` under `root_context_folders`. Domain semantics (order is load-bearing, position 0 = meta-context) — see /spec/PRODUCT.md → Invariants. This section documents Host's implementation.

**Operations:**
- `getRootContextFolders()` — read raw `root_context_folders` (list of `@aliases`) from `settings.json`.
- `getResolvedRootContextFolders()` — same, but each entry is `{raw, resolved, isMeta}` (resolves `@alias` via `{machine}.json` and reads `context.json/meta` flag for each folder).
- `addRootContextFolder(absolutePath)` — alias-aware add. Validates pointer (`duetConfigPath`, valid `machine`) and throws if missing. Creates `@<basename>` alias in `{machine}.json` (suffix `_2`, `_3` on collision; reuses if path already aliased). Appends alias to `root_context_folders` in `settings.json`. Calls `enforceMetaInvariant` after the append — when the list was empty, the new folder becomes meta automatically; otherwise the existing first stays meta. The IPC handler runs a scoped schema-migration sweep on the new folder to upgrade legacy `business.json/stream.json/product.json` and self-heal a missing manifest.
- `resolveAliasPath(raw, machineConfig)` — resolves a `root_context_folders` entry: passes absolute paths through; looks up bare `@alias`; for `@alias/sub/path` splits, resolves alias, joins the rest via `path.join`. Returns `null` when alias is missing.
- `saveRootContextFolders(folders)` — overwrite full `root_context_folders` array (used by reorder/remove). Throws if `settings.json` missing or invalid (no silent recreate that would lose `timestampTZ`). Calls `enforceMetaInvariant` afterwards so drag-to-position-0 and removing the current meta both atomically swap the meta flag on disk.
- `enforceMetaInvariant(folders)` — restores the invariant «position 0 = meta-context». Idempotent on already-correct state. Tolerant: folders whose `context.json` is unparseable are skipped (migration sweep surfaces them as per-context errors). For atomicity when two manifests need to flip simultaneously, stages both `.tmp` files first and then renames in sequence; on a rename failure, earlier renames are rolled back from a backup of previous content, so the disk never settles with «two metas» or «no metas».
- `normalizePath(p)` — NFC + strip trailing separators. Cross-platform: NFC fixes macOS NFD from native dialogs, on Windows is a no-op. All path comparisons (alias reuse, dedup) and stored paths in `{machine}.json` go through this helper.
- `triggerScan(port)` — calls Backend `POST /scan`, returns `ScanResult` with errors.
- `readCachedScan(duetDataPath)` — reads cached `DuetData/data/scan.json`. Used by main process for wizard status without IPC.
- `readCachedContexts(duetDataPath)` — reads entity tree from `DuetData/data/contexts.json`. Returns `ContextsCache` with flat entity list (build tree via `parent_id`).

**Three mechanisms maintain the meta invariant** (see /spec/PRODUCT.md → Invariants):
1. `addRootContextFolder` — adding the first folder auto-promotes to meta. Adding to a non-empty list keeps the existing first as meta.
2. `saveRootContextFolders` — after reorder, drag-to-position-0 swaps meta to the new first; after delete of the current meta, the new first inherits meta.
3. Startup migration — `runMigrationsNow` calls `enforceMetaInvariant` after the manifest walk. Skipped when per-context errors are present (user fixes those first).

Drag-to-position-0 is the only UX mechanism for switching meta. The crown icon on `DuetPathsPage` is a read-only indicator of position 0 — not toggleable, no click handler, no `root-contexts:set-meta` IPC. Direct re-meta would create rule-bypass paths that disagreed with the saved order.

**Other invariants on `root_context_folders`:**
- Always contains `@aliases` (never absolute paths) — required for cross-machine sync via Drive.
- All path comparisons go through `normalizePath` so NFC/NFD and trailing-separator differences never produce false-distinct paths.

Implementation: `core/root-contexts.ts`.

### Schema Migrations

Host owns auto-upgrade of all on-disk Duet schemas. Policy and migration chain summary: /spec/PRODUCT.md → Schema Migration Policy. This section documents Host's implementation.

**Module:** `core/schema-migrations.ts`. No Electron imports — testable with plain Node.

**Schema specs (full chains):**

| Schema | File(s) | Target | Migration chain |
|--------|---------|--------|-----------------|
| `settings` | `settings.json` | v2 | v1 → v2: rename key `business_folders → root_context_folders`, add `version: 2`. Other keys preserved |
| `machine` | `{machine}.json` | v2 | v1 → v2: add `version: 2`. No field renames |
| `context` | `business.json` / `stream.json` / `product.json` → `context.json` | v4 | v1 → v2: rename file to `context.json`; rename field `root → meta` (only when `root: true`); add `version: 2`. Legacy file deleted after successful write. Other fields (`name`, `icon`, `git_url`, `reference_repos`, `description`, unknown keys) preserved. v2 → v3: when `git_url` is a non-empty string **and** `name` is a non-empty string, set `git_repos: { [name]: git_url }`; always delete `git_url`; bump `version: 3`. v3 → v4: delete `workspace_config` (the `primary_folder` option is removed — workspace assembly is now always context-first); bump `version: 4`. The v4 `skills`/`instructions`/`memory` fields are additive (absent is valid, no migration). All other fields preserved |

**Triggers:**
1. **Host startup** — full sweep before backend spawn. Order: settings → machine → manifests under each root context. If settings or machine produces a critical error, the manifest walk is skipped and backend does not spawn.
2. **`config:save-pointer`** with `duetConfigPath` or `machine` change → full sweep (settings/machine of new path may be legacy or future-version).
3. **`root-contexts:add`** → full sweep (idempotent on already-current settings/machine/context manifests; manifest walk picks up legacy/future files inside the new folder, self-heals on empty folder).
4. **DuetConfig file watcher** — `main/index.ts` watches `duetConfigPath` for changes to `settings.json` and `{machine}.json` (debounce 500ms). On any change, runs the full sweep so a runtime corruption (user edit, Drive sync overwrite) escalates to the same critical-banner mechanism that protects startup.

**Critical gate:** `MigrationResult.critical` is non-null iff the pointer file, `settings.json`, or `{machine}.json` is corrupted (`invalid_json`/`read_failed`) or future-version (`version > MAX_SUPPORTED`). While critical:
- `ensureBackendRunning` refuses to start the backend, broadcasts `BackendStatus { state: 'error', error: <description> }`.
- `backend:start` IPC throws.
- `DuetPathsPage` renders a blocking error banner with the file path. Title and recovery hint branch on `reason_code` and `file`: "Update Duet" for `future_version`; "Restore from backup or delete" for `invalid_json` on pointer; "Repair manually" for `invalid_json` on settings/machine.
- Auto-start on `whenReady` is skipped.

**Per-context errors:** all rendered red on `DuetPathsPage` — every per-context code marks data corruption (affected context is unreachable until the user repairs it). Backend still spawns; the offending context's manifest is silently ignored by Backend (`unrecognized_manifest_version` log entry). All reason codes share severity `error`:

| reason_code | Meaning |
|-------------|---------|
| `future_version` | `context.json` is `version > MAX_SUPPORTED`. Backend will skip this context |
| `invalid_json` | `context.json` is broken JSON or has missing/non-int `version`. File untouched |
| `migration_failed` | v1 → v2 → v3 → v4 migration chain could not complete (rare; usually IO error mid-write) |
| `unresolved_alias` | `root_context_folders` entry references an `@alias` not registered in this machine's `{machine}.json` |

**Atomic write:** `atomicWriteJson(path, data)` (in `core/json-io.ts`) writes `{path}.tmp` then `rename()`. On POSIX `rename(2)` is atomic on the same filesystem; a crash mid-write leaves either the original file or the new one — never a half-written file. For legacy → context migration the order is: write `context.json` → delete legacy. A crash between leaves both files; orphan resolution on the next sweep handles them.

**All Host-owned JSON writes go through `atomicWriteJson`:** pointer file (`writeConfig`), `settings.json` (`setSettingsConfigKey`, `ensureConfigDefaults`), `{machine}.json` (`setMachineConfigKey`, `ensureConfigDefaults`), context manifests (migration + self-heal). `enforceMetaInvariant` adds a two-phase commit on top — both manifests staged as `.tmp` first, then renamed in sequence with rollback-on-failure. Same crash-safety contract whether the write originates in startup migration, a wizard click, or the runtime config watcher.

**Pointer integrity:** `readPointerStrict()` distinguishes `missing` (legitimate first-run) from `invalid_json` / `read_failed` (recoverable corruption). Startup migration calls it before `readConfig()`'s graceful `{}` fallback would mask a corrupt pointer as no-config. A corrupt pointer surfaces as a `MigrationCriticalError { file: 'pointer' }` and blocks backend spawn until the user either restores the file or deletes it.

**Orphan resolution (context.json + legacy file coexist):** `context.json` wins, the legacy is removed without comparison. The earlier equivalence-aware variant (rename to `<name>.legacy-conflict.json` + warning) was overengineering for a single-machine install — the multi-machine Drive-sync race it protected against isn't a scenario Duet ships for today. Decision recorded in `stabilize-taxonomy-migration` (rename-taxonomy saga).

**Recursion rules** (mirror backend scanner):
- Skip directories starting with `.` (`.git`, `.venv`, etc.).
- Continue recursion through folders whose post-migration `context.json` has a non-empty `git_repos` map. `git_repos` declares product clones under `DuetData/repos`; it does not make the Drive folder a leaf in the context hierarchy.

**Forward-incompatibility** is documented at the policy level in /spec/PRODUCT.md → Schema Migration Policy. No rollback: first Host startup on an upgraded machine rewrites every legacy manifest in place.

**IPC:**

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `migrations:get-status` | renderer → main | Get cached `MigrationResult` from last sweep |
| `migrations:status-changed` | main → renderer | Pushed after each sweep (startup + scoped triggers) |

Implementation: `core/schema-migrations.ts`, wired in `main/index.ts:runMigrationsNow` and `main/ipc-handlers.ts`.

### Severity Framework

Единая модель статусов на все 4 уровня UI: страница → sidebar → таб → tray.

**Severity** — `'error' | 'warning'`, first-class type in `shared/types.ts`:

| Severity | Meaning | Examples |
|----------|---------|----------|
| `error` | Cannot function, needs action | Step not configured, backend crashed, broken manifests |
| `warning` | Works, but not ideal | Deploy channel mismatch, agent not configured, stale version |

**StatusItem** — единица проблемы на странице:

```typescript
interface StatusItem {
  severity: Severity      // error | warning
  message: string         // "Python не найден", "Установлена DEV-версия"
  fixable?: boolean
}
```

Each page produces `StatusItem[]` — single source of truth for all levels above. Rendered via shared `<StatusTable />`.

**PageStatus** — статус страницы:

`PageStatus = 'ok' | 'error' | 'warning' | 'skipped' | null`. General model for any page (wizard, apps, future). Derived from the page's `StatusItem[]`.

| PageStatus | Sidebar icon | Meaning | Severity at aggregation |
|-----------|-------------|---------|------------------------|
| `'ok'` | Green + checkmark | Page completed correctly | none |
| `'error'` | Red + X | Page has errors | **error** |
| `null` | Hollow gray circle | Not yet configured (blocks user) | **error** |
| `'warning'` | Amber + ! | Page has warnings | **warning** |
| `'skipped'` | Gray + arrows | Not relevant | none |

**Key:** `null` and `error` are visually different in sidebar (gray vs red), but both aggregate as severity `error` to tab and tray.

**Per-page StatusItem sources:**

| Page | Situation | Severity | Message |
|------|-----------|----------|---------|
| 1. Duet paths | DuetData / DuetConfig / machine not set | error | "Выберите папку…" / "Укажите имя машины" |
| 1. Duet paths | Schema migration critical | error | `{description}` — backend blocked until resolved |
| 1. Duet paths | Schema migration per-context error | error | `{description}` (one per offending context) |
| 2. Python | Not found / version < 3.10 | error | "Python 3.10+ не найден" / "Python {version} — нужен 3.10+" |
| 3. Backend | Not deployed | error | "Backend не установлен" |
| 3. Backend | Deploy error | error | `{error message}` |
| 3. Backend | Channel mismatch | warning | "Установлена DEV-версия — переустановите для PROD" |
| 3. Backend | Stale version | warning | "Версия устарела — переустановите" |
| 4. Workspaces | Scan error — `invalid_manifest`, `unrecognized_manifest_version`, other unknown codes | error | `{description}` (per scan error) |
| 4. Workspaces | Scan error — `name_collision`, `repo_collision`, `missing_manifest` | warning | `{description}` (scanner auto-heals; informational). Code: `SCAN_WARNING_CODES` in `core/wizard-status.ts` |
| 5. AI Agents | needs_setup | warning | "{agent}: не сконфигурирован" |
| 5. AI Agents | Issue | warning | `{description}` (fixable issues) |

**Four-level aggregation:**

```
Level 1: Page
  StatusItem[] → rendered via <StatusTable />
       ↓ maxSeverity(items) → PageStatus

Level 2: Sidebar
  PageStatus → page icon (5 variants)
       ↓ pageStatusToSeverity() — null and error both → 'error'

Level 3: Tab
  maxSeverity(all pages) → dot on tab button
  | Severity | Dot     |
  |----------|---------|
  | error    | Red     |
  | warning  | Amber   |
  | null     | Hidden  |

Level 4: Tray
  AppStatus != ready → warning (forced)
  AppStatus == ready → maxSeverity(settingsSeverity, deploySeverity)
                        (apps-tab severity NOT included here — visible in
                         sidebar tab indicator only)
  | Severity | Icon            |
  |----------|-----------------|
  | error    | Red dot         |
  | warning  | Warning template|
  | null     | Normal          |
```

**`computePageStatuses`** — pure function in `core/wizard-status.ts`. Computes sidebar `PageStatus` from system state. Used by renderer (`App.tsx`) and main process (tray).

| Page | Source | PageStatus |
|------|--------|-----------|
| 1 (Duet paths) | AppState (duetDataPath, duetConfigPath, machine) | `null` (not configured) or `ok` |
| 2 (Python) | AppState (`pythonPath` from machine.json) | `null` or `ok` |
| 3 (Backend) | DeployStatus + `hasDeployWarning` | `null` (not deployed), `warning` (mismatch/stale), or `ok` |
| 4 (Workspaces) | Cached `scan.json` (errors count, severity per code) | `error` (broken manifests) / `warning` (collisions) / `ok` |
| 5 (AI Agents) | Agent detection (needs_setup vs configured) | `warning` (works but not configured) or `ok` |

Pages 4-5 also report status dynamically via `onStatusChange` callbacks, which override computed values.

**Key functions** (all pure, in `core/wizard-status.ts`):
- `maxSeverity(severities[])` — pick highest (error > warning > null). Single aggregation primitive for all levels.
- `pageStatusToSeverity(status)` — error→error, **null→error**, warning→warning, ok/skipped→null.
- `processStateToSeverity(state)` — error→error, rest→null.
- `getSettingsSeverity(statuses)` — aggregate all wizard pages.

**Tray integration** in `main/index.ts`:
- `deploySeverity` — from `isDeployWarning()` (VERSION mismatch → warning).
- `settingsSeverity` — from `getSettingsSeverity(computePageStatuses(...))`.
- `overallSeverity = maxSeverity([deploySeverity, settingsSeverity])`.
- `updateTrayIcon(appStatus, overallSeverity)` — AppStatus != ready forces warning; otherwise uses severity.

Implementation: `core/wizard-status.ts`, `platform/tray.ts`.

## Engineering

### Development

```bash
npm run dev   # electron-vite dev — Vite dev server + Electron
```

Electron GUI требует доступ к оконной системе macOS. AI-агенты: запускать с `dangerouslyDisableSandbox: true` (sandbox блокирует GUI-процессы).

### Build & Release

Per-package pipeline (full release contract: see /spec/PRODUCT.md → Pre-commit Verification):

```bash
npm run release [-- --mac|--win|--linux]   # default: --mac
```

`build-release.cjs`: bump patch → write `resources/BUILD_SHA` (git short SHA) → `electron-vite build` → `electron-builder` → `dist/Duet-{version}.dmg`.

| Tool | Role |
|------|------|
| electron-vite | Bundle main/preload/renderer |
| electron-builder | Platform installer (DMG/NSIS/AppImage) |

Config: `electron-builder.yml`.
- `appId`: `org.ve68.duet`.
- macOS: DMG, no code signing, no notarize.
- Windows: NSIS installer.
- `extraResources`: `resources/` (tray icons), `backend/` (bundled Python backend deployed at runtime).

**CI:** `build-host.yml` builds all 3 platforms on push to main (if `packages/host/` changed). No auto-publish — artifacts downloaded manually from Actions → GitHub Release.

### Testing

```bash
npm run test:run     # vitest (unit)
npm run typecheck    # tsc
```

| Suite | Files | What |
|-------|-------|------|
| Unit | `__tests__/unit/core/`, `__tests__/unit/shared/`, `__tests__/unit/renderer/` | core-flow, config, app-state, deploy, backend, apps, ai-clients, instructions, root-contexts, schema-migrations, wizard-status, mappers, navigation |
| E2E | Disabled (CI) | WebdriverIO, monorepo symlink issues |

**Testability:**

| Module | Testable without Electron |
|--------|--------------------------|
| `core/config.ts` | Yes — pure fs, env override via `DUET_CONFIG_FILE` |
| `core/app-state.ts` | Yes — pure functions, depends only on config + fs |
| `platform/tray.ts` | No — requires Electron (manual testing) |
| `main/window.ts` | No — requires Electron |

### File Map

| When you need to find… | Look in |
|------------------------|---------|
| All IPC types (single source of truth) | `shared/types.ts` |
| Severity type, StatusItem, PageStatus | `shared/types.ts` (types), `core/wizard-status.ts` (functions) |
| VERSION metadata parsing + writing | `core/deploy.ts` (`parseVersionMeta`, `writeVersion`, `readBuildSha`) |
| Deploy warning logic (channel-aware) | `core/deploy.ts:isDeployWarning()` |
| Pointer file path / machine config | `core/config.ts` |
| What triggers tray icon change | `main/index.ts:updateAppState()` |
| How IPC channels are registered | `main/ipc-handlers.ts:setupIpcHandlers()` |
| What renderer exposes to pages | `preload/index.ts` (window.api shape) |
| Page status computation | `core/wizard-status.ts:computePageStatuses()` |
| How pages override computed status | `renderer/src/App.tsx` (pageStatuses + createStatusCallback) |
| Severity icons (unified) | `renderer/src/components/ui/severity-icon.tsx` |
| Status table for pages | `renderer/src/components/ui/status-table.tsx` |
| Tray icon file selection (per platform) | `platform/tray.ts:getTrayIconPath()` |
