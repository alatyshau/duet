/*
 * ЧТО: Компонент боковой панели навигации.
 * ЗАЧЕМ: Отображает логотип и навигационные ссылки.
 * КТО ИСПОЛЬЗУЕТ: Layout компонент.
 */
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { FolderOpen, RefreshCw, Settings, Package } from 'lucide-react'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
  disabled?: boolean
}

interface SidebarProps {
  currentPage: string
  onNavigate: (page: string) => void
  onOpenFolder: () => void
  folderConfigured: boolean
}

const navItems: NavItem[] = [
  { id: 'sync', label: 'Статус синхронизации', icon: <RefreshCw size={20} /> },
  { id: 'settings', label: 'Настройки', icon: <Settings size={20} /> },
  { id: 'setup', label: 'Установка', icon: <Package size={20} /> }
]

export function Sidebar({
  currentPage,
  onNavigate,
  onOpenFolder,
  folderConfigured
}: SidebarProps): React.ReactElement {
  return (
    <aside className="w-64 bg-sidebar border-r border-border flex flex-col">
      {/* Логотип */}
      <div className="p-4 border-b border-border">
        <h1 className="text-xl font-semibold text-foreground">🎵 Duet</h1>
      </div>

      {/* Кнопка открыть папку */}
      <div className="p-4">
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

      {/* Навигация */}
      <nav className="flex-1 p-2">
        {navItems.map((item) => {
          // На шаге 1 только Setup активна
          const isDisabled = !folderConfigured && item.id !== 'setup'
          const isActive = currentPage === item.id

          return (
            <button
              key={item.id}
              onClick={() => !isDisabled && onNavigate(item.id)}
              disabled={isDisabled}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-accent',
                isDisabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
