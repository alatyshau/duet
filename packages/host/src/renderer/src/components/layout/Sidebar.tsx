/*
 * Сайдбар: горизонтальные табы (Settings / Apps) + список шагов или приложений.
 *
 * Таб "Settings" показывает визард — 7 шагов с иконками статуса.
 * Таб "Apps" показывает список запущенных приложений с ProcessState индикатором.
 *
 * Severity агрегация: каждый таб показывает максимальный severity дочерних элементов.
 */
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { StatusDot } from '@renderer/components/ui/status-dot'
import { FolderOpen, Settings, Play } from 'lucide-react'
import { WIZARD_STEPS, APP_ITEMS, tabForPage, isStepAvailable } from '../../navigation'
import type { Page, Tab, WizardPage } from '../../navigation'
import type { ProcessState, Severity } from '../../../../shared/types'
import type { StepStatus } from '../../../../core/wizard-status'
import {
  getSettingsSeverity,
  processStateToSeverity
} from '../../../../core/wizard-status'

// =============================================================================
// TYPES
// =============================================================================

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  onOpenFolder: () => void
  folderConfigured: boolean
  backendProcessState?: ProcessState
  /** Статусы шагов визарда. Ключ — WizardPage id. */
  stepStatuses?: Partial<Record<WizardPage, StepStatus>>
}

// =============================================================================
// COMPONENT
// =============================================================================

export function Sidebar({
  currentPage,
  onNavigate,
  onOpenFolder,
  folderConfigured,
  backendProcessState,
  stepStatuses = {}
}: SidebarProps): React.ReactElement {
  const activeTab = tabForPage(currentPage)

  const handleTabClick = (tab: Tab): void => {
    if (tab === activeTab) return
    // При переключении таба — переходим на первый элемент
    if (tab === 'settings') {
      onNavigate(WIZARD_STEPS[0].page)
    } else {
      onNavigate(APP_ITEMS[0].page)
    }
  }

  // Compute tab severities from children
  const settingsSeverity = getSettingsSeverity(stepStatuses)
  const appsSeverity = backendProcessState
    ? processStateToSeverity(backendProcessState)
    : null

  return (
    <aside className="w-64 bg-sidebar border-r border-border flex flex-col">
      {/* Логотип */}
      <div className="p-4 border-b border-border">
        <h1 className="text-xl font-semibold text-foreground">Duet</h1>
      </div>

      {/* Кнопка открыть DuetData */}
      <div className="p-4 pb-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={onOpenFolder}
          disabled={!folderConfigured}
        >
          <FolderOpen size={20} />
          Открыть DuetData
        </Button>
      </div>

      {/* Табы */}
      <div className="px-4 py-2 flex gap-1">
        <TabButton
          icon={<Settings size={16} />}
          label="Настройки"
          active={activeTab === 'settings'}
          severity={settingsSeverity}
          onClick={() => handleTabClick('settings')}
        />
        <TabButton
          icon={<Play size={16} />}
          label="Приложения"
          active={activeTab === 'apps'}
          severity={appsSeverity}
          onClick={() => handleTabClick('apps')}
        />
      </div>

      <div className="border-b border-border mx-4" />

      {/* Список элементов таба */}
      <nav className="flex-1 overflow-y-auto p-2">
        {activeTab === 'settings' && (
          <WizardNav
            currentPage={currentPage}
            onNavigate={onNavigate}
            stepStatuses={stepStatuses}
          />
        )}
        {activeTab === 'apps' && (
          <AppsNav
            currentPage={currentPage}
            onNavigate={onNavigate}
            backendProcessState={backendProcessState}
          />
        )}
      </nav>
    </aside>
  )
}

// =============================================================================
// TAB BUTTON
// =============================================================================

function TabButton({
  icon,
  label,
  active,
  severity,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  severity: Severity | null
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
    >
      {icon}
      {label}
      {severity && <SeverityDot severity={severity} />}
    </button>
  )
}

// =============================================================================
// SEVERITY DOT (tab indicator)
// =============================================================================

function SeverityDot({ severity }: { severity: Severity }): React.ReactElement {
  return (
    <span
      className={cn(
        'w-1.5 h-1.5 rounded-full flex-shrink-0',
        severity === 'error' ? 'bg-red-500' : 'bg-amber-500'
      )}
    />
  )
}

// =============================================================================
// WIZARD NAV (Settings tab)
// =============================================================================

function WizardNav({
  currentPage,
  onNavigate,
  stepStatuses
}: {
  currentPage: Page
  onNavigate: (page: Page) => void
  stepStatuses: Partial<Record<WizardPage, StepStatus>>
}): React.ReactElement {
  return (
    <div className="space-y-0.5">
      {WIZARD_STEPS.map((step) => {
        const isActive = currentPage === step.page
        const status = stepStatuses[step.page] ?? null
        const available = isStepAvailable(step.page, stepStatuses)

        return (
          <button
            key={step.page}
            onClick={() => onNavigate(step.page)}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              isActive
                ? 'bg-primary/10 text-primary font-medium'
                : available
                  ? 'text-foreground hover:bg-accent'
                  : 'text-muted-foreground/50'
            )}
          >
            <StepStatusIcon status={status} />
            {step.label}
          </button>
        )
      })}
    </div>
  )
}

// =============================================================================
// APPS NAV (Apps tab)
// =============================================================================

function AppsNav({
  currentPage,
  onNavigate,
  backendProcessState
}: {
  currentPage: Page
  onNavigate: (page: Page) => void
  backendProcessState?: ProcessState
}): React.ReactElement {
  return (
    <div className="space-y-0.5">
      {APP_ITEMS.map((item) => {
        const isActive = currentPage === item.page
        // TODO: Generalize process state lookup when more apps are added
        const processState = item.page === 'app:duet-backend' ? backendProcessState : undefined

        return (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              isActive
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground hover:bg-accent'
            )}
          >
            {processState !== undefined && <StatusDot state={processState} />}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// =============================================================================
// STEP STATUS ICON
// =============================================================================

function StepStatusIcon({ status }: { status: StepStatus }): React.ReactElement {
  if (status === 'done') {
    return (
      <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2 5L4.5 7.5L8 3"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3 3L7 7M7 3L3 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    )
  }

  if (status === 'warning') {
    return (
      <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M5 3V5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="5" cy="7.5" r="0.75" fill="white" />
        </svg>
      </div>
    )
  }

  if (status === 'skipped') {
    return (
      <div className="w-4 h-4 rounded-full bg-muted-foreground/30 flex items-center justify-center flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M3 5L5 3L7 5M3 5L5 7L7 5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          />
        </svg>
      </div>
    )
  }

  // null — не определён
  return <div className="w-4 h-4 rounded-full border-2 border-border flex-shrink-0" />
}
