/*
 * Типизированная навигация Host UI.
 *
 * Два таба: Settings (визард настроек) и Apps (запущенные процессы).
 * Каждый таб — свой набор страниц.
 */

// =============================================================================
// TABS
// =============================================================================

export type Tab = 'settings' | 'apps'

// =============================================================================
// PAGES
// =============================================================================

/** Шаги визарда настроек. Порядок массива = порядок в сайдбаре. */
export type WizardPage =
  | 'duet-data'
  | 'duet-config'
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
  /** Шаги, от которых зависит этот (должны быть ✅ для активации). */
  dependsOn: WizardPage[]
}

export const WIZARD_STEPS: WizardStep[] = [
  { page: 'duet-data', label: 'DuetData', dependsOn: [] },
  { page: 'duet-config', label: 'DuetConfig + машина', dependsOn: [] },
  { page: 'python', label: 'Python 3.10+', dependsOn: [] },
  { page: 'backend', label: 'Backend', dependsOn: ['duet-data', 'python'] },
  {
    page: 'business-folders',
    label: 'Business Folders',
    dependsOn: ['duet-data', 'duet-config', 'backend']
  },
  { page: 'instructions', label: 'Инструкции', dependsOn: ['duet-data', 'duet-config'] },
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

export const DEFAULT_PAGE: Page = 'duet-data'
