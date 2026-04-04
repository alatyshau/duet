/*
 * ЧТО: Pure-функции для вычисления статусов страниц и severity aggregation.
 * ЗАЧЕМ: Единственный источник правды для статусных иконок в Sidebar и tray.
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

/** Статус страницы: ok, error, warning, skipped, или null (не настроено). */
export type PageStatus = 'ok' | 'error' | 'warning' | 'skipped' | null

/** Все страницы визарда (должен совпадать с navigation.ts WizardPage). */
export type WizardPage =
  | 'duet-data'
  | 'duet-config'
  | 'python'
  | 'backend'
  | 'business-folders'
  | 'instructions'
  | 'agents'

export type PageStatuses = Partial<Record<WizardPage, PageStatus>>

/** Входные данные для вычисления статусов, собранные из разных источников. */
export interface PageStatusInput {
  appState: AppState
  deployStatus: DeployStatus
  /** Cached scan result (null = no scan performed yet). */
  cachedScan: ScanResult | null
  /** Cached instruction errors (null = no merge performed yet). */
  cachedInstructionsErrors: InstructionsError[] | null
  /** Detected agents (null = not queried yet). */
  agents: AgentInfo[] | null
  /** Deploy staleness flag from isDeployWarning() — channel mismatch, stale version, etc. */
  hasDeployWarning?: boolean
}

// =============================================================================
// WARNING REASON CODES (not blocking — don't escalate to error)
// =============================================================================

/** Scan reason codes that are warnings, not errors. */
const SCAN_WARNING_CODES = new Set(['name_collision', 'repo_collision', 'missing_manifest'])

/** Instructions reason codes that are warnings, not errors. */
const INSTRUCTIONS_WARNING_CODES = new Set(['missing_description', 'version_suffix'])

// =============================================================================
// COMPUTATION
// =============================================================================

/**
 * Вычисляет статусы всех страниц визарда из входных данных.
 * Чистая функция — никаких side effects.
 */
export function computePageStatuses(input: PageStatusInput): PageStatuses {
  const { appState, deployStatus, cachedScan, cachedInstructionsErrors, agents } = input
  const s: PageStatuses = {}

  // Page 1: DuetData — path set and exists
  s['duet-data'] = appState.duetDataPath ? 'ok' : null

  // Page 2: DuetConfig + machine — both set
  s['duet-config'] = appState.duetConfigPath && appState.machine ? 'ok' : null

  // Page 3: Python — path configured in machine.json
  s['python'] = appState.pythonPath ? 'ok' : null

  // Page 4: Backend — deployed, stale (warning), or not deployed (null)
  const isDeployed = deployStatus.state === 'deployed' || deployStatus.state === 'up_to_date'
  s['backend'] = isDeployed ? (input.hasDeployWarning ? 'warning' : 'ok') : null

  // Page 5: Business Folders — scanned with no errors
  if (cachedScan !== null) {
    if (cachedScan.errors.length === 0) {
      s['business-folders'] = 'ok'
    } else {
      const hasRealError = cachedScan.errors.some((e) => !SCAN_WARNING_CODES.has(e.reason_code))
      s['business-folders'] = hasRealError ? 'error' : 'warning'
    }
  }

  // Page 6: Instructions — merged with no errors
  if (cachedInstructionsErrors !== null) {
    if (cachedInstructionsErrors.length === 0) {
      s['instructions'] = 'ok'
    } else {
      const hasRealError = cachedInstructionsErrors.some((e) => !INSTRUCTIONS_WARNING_CODES.has(e.reason_code))
      s['instructions'] = hasRealError ? 'error' : 'warning'
    }
  }

  // Page 7: AI Agents — needs_setup is warning (works, just not configured), not error
  if (agents !== null) {
    const found = agents.filter((a) => a.status !== 'not_found')
    const needsSetup = found.some((a) => a.status === 'needs_setup')
    if (needsSetup) {
      s['agents'] = 'warning'
    } else {
      s['agents'] = 'ok'
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

/**
 * Map PageStatus to Severity for aggregation.
 * error AND null both → 'error' (null = not configured = blocks user).
 * warning → 'warning'. ok/skipped → null (no severity).
 */
export function pageStatusToSeverity(status: PageStatus | undefined): Severity | null {
  if (status === 'error') return 'error'
  if (status === null || status === undefined) return 'error'
  if (status === 'warning') return 'warning'
  return null
}

/** Map ProcessState to Severity (error → error, rest → null). */
export function processStateToSeverity(state: ProcessState): Severity | null {
  return state === 'error' ? 'error' : null
}

const ALL_WIZARD_PAGES: WizardPage[] = [
  'duet-data',
  'duet-config',
  'python',
  'backend',
  'business-folders',
  'instructions',
  'agents'
]

/** Aggregate severity of all wizard pages (Settings tab). */
export function getSettingsSeverity(statuses: PageStatuses): Severity | null {
  // Check ALL wizard pages — missing keys treated as undefined → error severity.
  return maxSeverity(ALL_WIZARD_PAGES.map((page) => pageStatusToSeverity(statuses[page])))
}
