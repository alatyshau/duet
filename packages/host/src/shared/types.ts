/*
 * ЧТО: Типы, пересекающие границу IPC (main ↔ renderer).
 * ЗАЧЕМ: Single source of truth. Оба tsconfig (node + web) включают shared/.
 * КТО ИСПОЛЬЗУЕТ: core/, main/, platform/, preload/, renderer/.
 *
 * ПРАВИЛО: Только типы и константы. НЕТ runtime кода.
 */

// =============================================================================
// APP STATE (IPC: app:get-state, app-state-changed)
// =============================================================================

/** Severity level for aggregation across UI layers (page → tab → tray). */
export type Severity = 'error' | 'warning'

/** Unit of problem on a page — rendered via StatusTable, aggregated to PageStatus. */
export interface StatusItem {
  severity: Severity
  message: string
  fixable?: boolean
}

export type AppStatus = 'no_config' | 'path_lost' | 'ready'
export type DeployChannel = 'dev' | 'prod'

export interface AppState {
  status: AppStatus
  duetDataPath: string | null
  duetConfigPath: string | null
  machine: string | null
  pathExists: boolean
  deployChannel: DeployChannel
  /** Python interpreter path from machine.json (null if not configured). */
  pythonPath: string | null
  /** Path to Duet-Instructions git repo from machine.json (null if not configured). */
  instructionsPath: string | null
  /** Whether devBackendPath is set in machine.json (controls DEV/PROD toggle visibility). */
  hasDevBackendPath: boolean
}

// =============================================================================
// DEPLOY (IPC: deploy:get-status, deploy:start, deploy:status-changed)
// =============================================================================

export type DeployStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up_to_date'; version: string; warningReason?: string }
  | { state: 'deploying'; message: string }
  | { state: 'deployed'; version: string; warningReason?: string }
  | { state: 'error'; error: string }

// =============================================================================
// PYTHON (IPC: python:detect, python:validate, python:save)
// =============================================================================

export type PythonStatus =
  | { state: 'unknown' }
  | { state: 'detecting' }
  | { state: 'found'; path: string; version: string }
  | { state: 'not_found'; hint: string }
  | { state: 'invalid'; path: string; error: string }

// =============================================================================
// BACKEND (IPC: backend:get-status, backend:start, backend:stop, backend:status-changed)
// =============================================================================

export type BackendStatus =
  | { state: 'stopped' }
  | { state: 'starting'; message: string }
  | { state: 'running'; version: string; uptime: number }
  | { state: 'stopping' }
  | { state: 'error'; error: string }

// =============================================================================
// APPS (generalized process management)
// =============================================================================

export type ProcessType = 'http' | 'worker' | 'cron'
export type ProcessState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface ProcessStatus {
  state: ProcessState
  message?: string
  version?: string
  uptime?: number
  error?: string
}

export interface ProcessInfo {
  id: string
  name: string
  type: ProcessType
  port?: number
}

export interface AppInfo {
  id: string
  name: string
  description: string
  builtin: boolean
  processes: ProcessInfo[]
}

// =============================================================================
// AI AGENTS (IPC: agents:detect, agents:configure, agents:fix-issue)
// =============================================================================

export type AgentStatus = 'not_found' | 'needs_setup' | 'configured'

export interface AgentCheckedFile {
  path: string
  ok: boolean
}

/** Actionable issue on an AI agent (e.g. additionalDirectories in Claude Code settings). */
export interface AgentIssue {
  reason_code: string
  description: string
  /** Whether the issue can be auto-fixed via agents:fix-issue IPC. */
  fixable: boolean
}

export interface AgentInfo {
  id: string
  name: string
  status: AgentStatus
  details: string
  version?: string
  checkedFiles?: AgentCheckedFile[]
  issues?: AgentIssue[]
}

// =============================================================================
// INSTRUCTIONS (IPC: instructions:merge, instructions:get-errors)
// =============================================================================

export interface InstructionsError {
  path: string
  reason_code: string
  description: string
}

/**
 * Result shape returned by Backend POST /merge-duet-instructions.
 *
 * Multi-agent: backend writes one merged file per agent declared in index.json.
 * `paths` is a map { agent_name → absolute_path } populated only with
 * successfully merged agents. Empty map ⇒ fatal error.
 */
export interface InstructionsMergeResult {
  status: 'ok' | 'error'
  paths: Record<string, string>
  errors: InstructionsError[]
}

// =============================================================================
// ROOT CONTEXTS (IPC: root-contexts:get, root-contexts:save, root-contexts:scan)
// =============================================================================

/** Entry returned by root-contexts:get — raw alias for storage, resolved path for display. */
export interface RootContextEntry {
  /** Raw value from settings.json — @alias, @alias/subpath, or absolute path. Use for save/remove. */
  raw: string
  /** Resolved absolute path (alias looked up in machine config). Use for display. */
  resolved: string
  /** Whether this context has meta: true in its context.json manifest (e.g. !БАЗА). */
  isMeta: boolean
  /**
   * True iff `raw` references an `@alias` that doesn't exist in this machine's config — folder
   * cannot be located until the alias is registered. Migration walk skips these (raises a
   * warning); UI shows a "missing alias" affordance.
   */
  unresolved?: boolean
}

export interface ScanError {
  path: string
  reason_code: string
  description: string
  manifest_path?: string
}

export interface ScanResult {
  status: string
  entities_count: number
  duration_ms?: number
  errors: ScanError[]
}

// =============================================================================
// CONTEXTS (entity tree from DuetData/data/contexts.json)
// =============================================================================

export interface ContextEntity {
  id: string
  type: string
  name: string
  icon: string
  path: string
  absolute_path: string | null
  parent_id: string | null
  git_url: string | null
  /** True for meta-context (e.g. !БАЗА). Sister node `implement-backend-rename` adds this field. */
  meta?: boolean
}

export interface ContextsCache {
  contexts: ContextEntity[]
}

// =============================================================================
// SCHEMA MIGRATIONS (IPC: migrations:get-status)
// =============================================================================

/** Critical migration error — blocks backend spawn. */
export interface MigrationCriticalError {
  file: 'pointer' | 'settings' | 'machine'
  path: string
  reason_code: 'future_version' | 'invalid_json' | 'read_failed'
  description: string
}

/** Per-context migration error — all surface as red on DuetPathsPage; backend skips affected contexts but otherwise starts. */
export interface MigrationContextError {
  path: string
  root_context_path: string
  reason_code: 'future_version' | 'invalid_json' | 'migration_failed' | 'unresolved_alias'
  description: string
}

export interface MigrationResult {
  critical: MigrationCriticalError | null
  contextErrors: MigrationContextError[]
  migratedCount: number
}
