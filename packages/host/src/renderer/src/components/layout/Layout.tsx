/*
 * Главный layout приложения.
 * Объединяет сайдбар и контентную область.
 */
import { Sidebar } from './Sidebar'
import type { Page } from '../../navigation'
import type { ProcessState } from '../../../../shared/types'

interface LayoutProps {
  children: React.ReactNode
  currentPage: Page
  onNavigate: (page: Page) => void
  onOpenFolder: () => void
  folderConfigured: boolean
  backendProcessState?: ProcessState
}

export function Layout({
  children,
  currentPage,
  onNavigate,
  onOpenFolder,
  folderConfigured,
  backendProcessState
}: LayoutProps): React.ReactElement {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        onOpenFolder={onOpenFolder}
        folderConfigured={folderConfigured}
        backendProcessState={backendProcessState}
      />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
