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
  AgentInfo,
  MigrationResult,
  Severity,
  ProcessState
} from '../shared/types'

// =============================================================================
// TYPES
// =============================================================================

/** Статус страницы: ok, error, warning, skipped, или null (не настроено). */
export type PageStatus = 'ok' | 'error' | 'warning' | 'skipped' | null

/** Все страницы визарда (должен совпадать с navigation.ts WizardPage). */
export type WizardPage = 'duet-paths' | 'python' | 'backend' | 'workspaces' | 'agents'

export type PageStatuses = Partial<Record<WizardPage, PageStatus>>

/** Входные данные для вычисления статусов, собранные из разных источников. */
export interface PageStatusInput {
  appState: AppState
  deployStatus: DeployStatus
  /** Cached scan result (null = no scan performed yet). */
  cachedScan: ScanResult | null
  /** Detected agents (null = not queried yet). */
  agents: AgentInfo[] | null
  /** Deploy staleness flag from isDeployWarning() — channel mismatch, stale version, etc. */
  hasDeployWarning?: boolean
  /** Schema-migration sweep result. Critical → DuetPathsPage error; per-context → warning. */
  migrationStatus?: MigrationResult
}

// =============================================================================
// WARNING REASON CODES (not blocking — don't escalate to error)
// =============================================================================

/** Scan reason codes that are warnings, not errors. */
const SCAN_WARNING_CODES = new Set(['name_collision', 'repo_collision', 'missing_manifest'])

/**
 * Map a backend scan result into a PageStatus.
 *
 * Single source of truth — used both by `computePageStatuses` (main-process tray)
 * and by WorkspacesPage (renderer). Without this, the renderer would treat every
 * scan error as page-level 'error', escalating warnings to red — which is the bug
 * behind review issue 5.
 */
export function scanResultToPageStatus(scan: ScanResult): PageStatus {
  if (scan.errors.length === 0) return 'ok'
  const hasRealError = scan.errors.some((e) => !SCAN_WARNING_CODES.has(e.reason_code))
  return hasRealError ? 'error' : 'warning'
}

// =============================================================================
// COMPUTATION
// =============================================================================

/**
 * Вычисляет статусы всех страниц визарда из входных данных.
 * Чистая функция — никаких side effects.
 */
export function computePageStatuses(input: PageStatusInput): PageStatuses {
  const { appState, deployStatus, cachedScan, agents } = input
  const s: PageStatuses = {}

  // Page 1: Duet paths — all three set; downgrade if schema-migration produced errors.
  // Critical migration error (settings/machine future-version, invalid JSON) → 'error'.
  // Per-context migration errors (broken/future manifest, unresolved alias) → 'error'
  // (data corruption — context unreachable until user fixes).
  if (input.migrationStatus?.critical) {
    s['duet-paths'] = 'error'
  } else if (appState.duetDataPath && appState.duetConfigPath && appState.machine) {
    s['duet-paths'] = (input.migrationStatus?.contextErrors?.length ?? 0) > 0 ? 'error' : 'ok'
  } else {
    s['duet-paths'] = null
  }

  // Page 3: Python — path configured in machine.json
  s['python'] = appState.pythonPath ? 'ok' : null

  // Page 4: Backend — deployed, stale (warning), or not deployed (null)
  const isDeployed = deployStatus.state === 'deployed' || deployStatus.state === 'up_to_date'
  s['backend'] = isDeployed ? (input.hasDeployWarning ? 'warning' : 'ok') : null

  // Page 5: Workspaces — scanned with no errors. Derived via shared helper so renderer
  // and main process stay in sync (review issue 5).
  if (cachedScan !== null) {
    s['workspaces'] = scanResultToPageStatus(cachedScan)
  }

  // AI Agents — needs_setup is warning, none found is skipped. Also the surface for
  // a failed instructions merge: configureAllAgents merges before deploying, so a
  // broken platform bundle leaves merged content missing → agents show needs_setup.
  if (agents !== null) {
    const found = agents.filter((a) => a.status !== 'not_found')
    if (found.length === 0) {
      s['agents'] = 'skipped'
    } else if (found.some((a) => a.status === 'needs_setup')) {
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

const ALL_WIZARD_PAGES: WizardPage[] = ['duet-paths', 'python', 'backend', 'workspaces', 'agents']

/** Aggregate severity of all wizard pages (Settings tab). */
export function getSettingsSeverity(statuses: PageStatuses): Severity | null {
  // Check ALL wizard pages — missing keys treated as undefined → error severity.
  return maxSeverity(ALL_WIZARD_PAGES.map((page) => pageStatusToSeverity(statuses[page])))
}
