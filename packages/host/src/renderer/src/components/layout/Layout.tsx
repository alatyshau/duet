/*
 * Главный layout приложения.
 * Объединяет сайдбар и контентную область.
 */
import { Sidebar } from './Sidebar'
import type { Page, WizardPage } from '../../navigation'
import type { ProcessState } from '../../../../shared/types'
import type { PageStatus } from '../../../../core/wizard-status'

interface LayoutProps {
  children: React.ReactNode
  currentPage: Page
  onNavigate: (page: Page) => void
  onOpenFolder: () => void
  folderConfigured: boolean
  backendProcessState?: ProcessState
  pageStatuses?: Partial<Record<WizardPage, PageStatus>>
}

export function Layout({
  children,
  currentPage,
  onNavigate,
  onOpenFolder,
  folderConfigured,
  backendProcessState,
  pageStatuses
}: LayoutProps): React.ReactElement {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        onOpenFolder={onOpenFolder}
        folderConfigured={folderConfigured}
        backendProcessState={backendProcessState}
        pageStatuses={pageStatuses}
      />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
