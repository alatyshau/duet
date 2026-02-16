/*
 * ЧТО: Компонент боковой панели навигации.
 * ЗАЧЕМ: Отображает логотип, навигационные ссылки и секции с вложенными элементами.
 * КТО ИСПОЛЬЗУЕТ: Layout компонент.
 */
import { useState } from 'react'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/button'
import { FolderOpen, Package, Bot, ChevronRight, Loader2, AppWindow } from 'lucide-react'
import type { ProcessState } from '../../../../shared/types'

// =============================================================================
// STATUS DOT
// =============================================================================

function StatusDot({ state }: { state: ProcessState }): React.ReactElement {
  if (state === 'starting' || state === 'stopping') {
    return <Loader2 className="w-3 h-3 text-blue-500 animate-spin flex-shrink-0" />
  }

  const color =
    state === 'running' ? 'bg-green-500' : state === 'error' ? 'bg-red-500' : 'bg-muted-foreground'

  return <div className={cn('w-2 h-2 rounded-full flex-shrink-0', color)} />
}

// =============================================================================
// TYPES
// =============================================================================

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
}

interface NavSection {
  id: string
  label: string
  icon: React.ReactNode
  children: NavSectionChild[]
}

interface NavSectionChild {
  id: string
  label: string
  processState?: ProcessState
}

interface SidebarProps {
  currentPage: string
  onNavigate: (page: string) => void
  onOpenFolder: () => void
  folderConfigured: boolean
  backendProcessState?: ProcessState
}

// =============================================================================
// COMPONENT
// =============================================================================

export function Sidebar({
  currentPage,
  onNavigate,
  onOpenFolder,
  folderConfigured,
  backendProcessState
}: SidebarProps): React.ReactElement {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['apps']))

  const toggleSection = (id: string): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const topItems: NavItem[] = [{ id: 'install', label: 'Установка', icon: <Package size={20} /> }]

  const sections: NavSection[] = [
    {
      id: 'apps',
      label: 'Приложения',
      icon: <AppWindow size={20} />,
      children: [
        { id: 'app:duet-backend', label: 'Duet Backend', processState: backendProcessState }
      ]
    }
  ]

  const bottomItems: NavItem[] = [{ id: 'agents', label: 'AI Агенты', icon: <Bot size={20} /> }]

  const isDisabled = (id: string): boolean => !folderConfigured && id !== 'install'

  const renderNavButton = (item: NavItem): React.ReactElement => {
    const disabled = isDisabled(item.id)
    const isActive = currentPage === item.id
    return (
      <button
        key={item.id}
        onClick={() => !disabled && onNavigate(item.id)}
        disabled={disabled}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
          isActive ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-accent',
          disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
        )}
      >
        {item.icon}
        {item.label}
      </button>
    )
  }

  const renderSection = (section: NavSection): React.ReactElement => {
    const disabled = isDisabled(section.id)
    const isExpanded = expandedSections.has(section.id)

    return (
      <div key={section.id}>
        <button
          onClick={() => !disabled && toggleSection(section.id)}
          disabled={disabled}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
            'text-foreground hover:bg-accent',
            disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
          )}
        >
          <ChevronRight
            size={14}
            className={cn('transition-transform', isExpanded && 'rotate-90')}
          />
          {section.icon}
          {section.label}
        </button>
        {isExpanded && !disabled && (
          <div className="ml-5">
            {section.children.map((child) => {
              const isActive = currentPage === child.id
              return (
                <button
                  key={child.id}
                  onClick={() => onNavigate(child.id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground hover:bg-accent'
                  )}
                >
                  {child.processState !== undefined && <StatusDot state={child.processState} />}
                  {child.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="w-64 bg-sidebar border-r border-border flex flex-col">
      {/* Логотип */}
      <div className="p-4 border-b border-border">
        <h1 className="text-xl font-semibold text-foreground">Duet</h1>
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
        {topItems.map(renderNavButton)}
        {sections.map(renderSection)}
        {bottomItems.map(renderNavButton)}
      </nav>
    </aside>
  )
}
