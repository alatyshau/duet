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

export type AppStatus = 'no_config' | 'path_lost' | 'ready'
export type DeployChannel = 'dev' | 'prod'

export interface AppState {
  status: AppStatus
  duetDataPath: string | null
  duetConfigPath: string | null
  machine: string | null
  pathExists: boolean
  deployChannel: DeployChannel
}

// =============================================================================
// DEPLOY (IPC: deploy:get-status, deploy:start, deploy:status-changed)
// =============================================================================

export type DeployStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up_to_date'; version: string }
  | { state: 'deploying'; message: string }
  | { state: 'deployed'; version: string }
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
// AI AGENTS (IPC: agents:detect, agents:configure)
// =============================================================================

export type AgentStatus = 'not_found' | 'needs_setup' | 'configured'

export interface AgentInfo {
  id: string
  name: string
  status: AgentStatus
  details: string
}
