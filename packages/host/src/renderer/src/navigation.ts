/*
 * Типизированная навигация Host UI.
 *
 * Два таба: Settings (визард настроек) и Apps (запущенные процессы).
 * Каждый таб — свой набор страниц.
 */
import type { PageStatus } from '../../core/wizard-status'

// =============================================================================
// TABS
// =============================================================================

export type Tab = 'settings' | 'apps'

// =============================================================================
// PAGES
// =============================================================================

/** Шаги визарда настроек. Порядок массива = порядок в сайдбаре. */
export type WizardPage =
  | 'duet-paths'
  | 'python'
  | 'backend'
  | 'business-folders'
  | 'instructions'
  | 'agents'

/** Страницы таба "Приложения". */
export type AppPage = 'app:duet-backend'

export type Page = WizardPage | AppPage

// =============================================================================
// WIZARD STEPS
// =============================================================================

export interface WizardStep {
  page: WizardPage
  label: string
  /** Шаги, от которых зависит этот (должны быть ok для активации). */
  dependsOn: WizardPage[]
}

export const WIZARD_STEPS: WizardStep[] = [
  { page: 'duet-paths', label: 'Duet: пути', dependsOn: [] },
  { page: 'python', label: 'Python 3.10+', dependsOn: [] },
  { page: 'backend', label: 'Backend', dependsOn: ['duet-paths', 'python'] },
  {
    page: 'business-folders',
    label: 'Business Folders',
    dependsOn: ['duet-paths', 'backend']
  },
  { page: 'instructions', label: 'Инструкции', dependsOn: ['duet-paths'] },
  { page: 'agents', label: 'AI Агенты', dependsOn: ['backend', 'instructions'] }
]

// =============================================================================
// APP ITEMS
// =============================================================================

export interface AppItem {
  page: AppPage
  label: string
}

export const APP_ITEMS: AppItem[] = [{ page: 'app:duet-backend', label: 'Duet Backend' }]

// =============================================================================
// HELPERS
// =============================================================================

export function tabForPage(page: Page): Tab {
  return page.startsWith('app:') ? 'apps' : 'settings'
}

export const DEFAULT_PAGE: Page = 'duet-paths'

// =============================================================================
// DEPENDENCY CHECKS
// =============================================================================

/** Check if all dependencies of a wizard step are ok. */
export function isStepAvailable(
  page: WizardPage,
  statuses: Partial<Record<WizardPage, PageStatus>>
): boolean {
  const step = WIZARD_STEPS.find((s) => s.page === page)
  if (!step) return true
  return step.dependsOn.every((dep) => statuses[dep] === 'ok' || statuses[dep] === 'warning')
}

/** Get labels of missing (not-ok) dependencies for a wizard step. */
export function getMissingDeps(
  page: WizardPage,
  statuses: Partial<Record<WizardPage, PageStatus>>
): string[] {
  const step = WIZARD_STEPS.find((s) => s.page === page)
  if (!step) return []
  return step.dependsOn
    .filter((dep) => statuses[dep] !== 'ok' && statuses[dep] !== 'warning')
    .map((dep) => {
      const depStep = WIZARD_STEPS.find((s) => s.page === dep)
      return depStep?.label ?? dep
    })
}
