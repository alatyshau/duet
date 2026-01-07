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
    <div className="flex min-h-screen">
      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
        onOpenFolder={onOpenFolder}
        folderConfigured={folderConfigured}
      />
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
