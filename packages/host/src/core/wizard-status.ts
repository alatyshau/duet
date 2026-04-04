/*
 * ЧТО: Pure-функции для вычисления статусов шагов визарда.
 * ЗАЧЕМ: Единственный источник правды для статусных иконок в Sidebar.
 *        Используется renderer'ом для отображения и main process для tray.
 * КТО ИСПОЛЬЗУЕТ: renderer/App.tsx, main/index.ts.
 *
 * НЕТ Electron и React imports — тестируемо с plain Node.js.
 */
import type {
  AppState,
  DeployStatus,
  ScanResult,
  InstructionsError,
  AgentInfo,
  Severity,
  ProcessState
} from '../shared/types'

// =============================================================================
// TYPES
// =============================================================================

/** Статус шага визарда: done, error, warning, skipped, или null (не определён). */
export type StepStatus = 'done' | 'error' | 'warning' | 'skipped' | null

/** Все страницы визарда (должен совпадать с navigation.ts WizardPage). */
export type WizardPage =
  | 'duet-data'
  | 'duet-config'
  | 'python'
  | 'backend'
  | 'business-folders'
  | 'instructions'
  | 'agents'

export type StepStatuses = Partial<Record<WizardPage, StepStatus>>

/** Входные данные для вычисления статусов, собранные из разных источников. */
export interface WizardStatusInput {
  appState: AppState
  deployStatus: DeployStatus
  /** Cached scan result (null = no scan performed yet). */
  cachedScan: ScanResult | null
  /** Cached instruction errors (null = no merge performed yet). */
  cachedInstructionsErrors: InstructionsError[] | null
  /** Detected agents (null = not queried yet). */
  agents: AgentInfo[] | null
}

// =============================================================================
// COMPUTATION
// =============================================================================

/**
 * Вычисляет статусы всех шагов визарда из входных данных.
 * Чистая функция — никаких side effects.
 */
export function computeStepStatuses(input: WizardStatusInput): StepStatuses {
  const { appState, deployStatus, cachedScan, cachedInstructionsErrors, agents } = input
  const s: StepStatuses = {}

  // Step 1: DuetData — path set and exists
  s['duet-data'] = appState.duetDataPath ? 'done' : null

  // Step 2: DuetConfig + machine — both set
  s['duet-config'] = appState.duetConfigPath && appState.machine ? 'done' : null

  // Step 3: Python — path configured in machine.json
  s['python'] = appState.pythonPath ? 'done' : null

  // Step 4: Backend — deployed successfully
  const isDeployed = deployStatus.state === 'deployed' || deployStatus.state === 'up_to_date'
  s['backend'] = isDeployed ? 'done' : null

  // Step 5: Business Folders — scanned with no errors
  if (cachedScan !== null) {
    s['business-folders'] = cachedScan.errors.length === 0 ? 'done' : 'error'
  }

  // Step 6: Instructions — merged with no errors
  if (cachedInstructionsErrors !== null) {
    s['instructions'] = cachedInstructionsErrors.length === 0 ? 'done' : 'error'
  }

  // Step 7: AI Agents — needs_setup is warning (works, just not configured), not error
  if (agents !== null) {
    const found = agents.filter((a) => a.status !== 'not_found')
    const needsSetup = found.some((a) => a.status === 'needs_setup')
    if (needsSetup) {
      s['agents'] = 'warning'
    } else {
      // All found agents configured (or no agents found at all) = done
      s['agents'] = 'done'
    }
  }

  return s
}

// =============================================================================
// SEVERITY
// =============================================================================

const SEVERITY_RANK: Record<Severity, number> = { warning: 1, error: 2 }

/** Pick highest severity from a list. null = no issues. */
export function maxSeverity(severities: (Severity | null | undefined)[]): Severity | null {
  let max: Severity | null = null
  let maxRank = 0
  for (const s of severities) {
    if (s && SEVERITY_RANK[s] > maxRank) {
      max = s
      maxRank = SEVERITY_RANK[s]
    }
  }
  return max
}

/** Map StepStatus to Severity (error/warning → severity, done/skipped/null → null). */
export function stepStatusToSeverity(status: StepStatus): Severity | null {
  if (status === 'error') return 'error'
  if (status === 'warning') return 'warning'
  return null
}

/** Map ProcessState to Severity (error → error, rest → null). */
export function processStateToSeverity(state: ProcessState): Severity | null {
  return state === 'error' ? 'error' : null
}

/** Aggregate severity of all wizard steps (Settings tab). */
export function getSettingsSeverity(statuses: StepStatuses): Severity | null {
  return maxSeverity(Object.values(statuses).map(stepStatusToSeverity))
}

/** @deprecated Use getSettingsSeverity + maxSeverity instead. */
export function hasWizardWarning(statuses: StepStatuses): boolean {
  return getSettingsSeverity(statuses) !== null
}
