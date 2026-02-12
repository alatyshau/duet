/*
 * ЧТО: Главный layout приложения.
 * ЗАЧЕМ: Объединяет сайдбар и контентную область.
 * КТО ИСПОЛЬЗУЕТ: App.tsx как обёртка для страниц.
 */
import { Sidebar } from './Sidebar'

interface LayoutProps {
  children: React.ReactNode
  currentPage: string
  onNavigate: (page: string) => void
  onOpenFolder: () => void
  folderConfigured: boolean
}

export function Layout({
  children,
  currentPage,
  onNavigate,
  onOpenFolder,
  folderConfigured
}: LayoutProps): React.ReactElement {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        onOpenFolder={onOpenFolder}
        folderConfigured={folderConfigured}
      />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  )
}
