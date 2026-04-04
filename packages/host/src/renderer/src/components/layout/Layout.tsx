/*
 * Главный layout приложения.
 * Объединяет сайдбар и контентную область.
 */
import { Sidebar } from './Sidebar'
import type { Page, WizardPage } from '../../navigation'
import type { ProcessState } from '../../../../shared/types'
import type { StepStatus } from '../../../../core/wizard-status'

interface LayoutProps {
  children: React.ReactNode
  currentPage: Page
  onNavigate: (page: Page) => void
  onOpenFolder: () => void
  folderConfigured: boolean
  backendProcessState?: ProcessState
  stepStatuses?: Partial<Record<WizardPage, StepStatus>>
}

export function Layout({
  children,
  currentPage,
  onNavigate,
  onOpenFolder,
  folderConfigured,
  backendProcessState,
  stepStatuses
}: LayoutProps): React.ReactElement {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        onOpenFolder={onOpenFolder}
        folderConfigured={folderConfigured}
        backendProcessState={backendProcessState}
        stepStatuses={stepStatuses}
      />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
