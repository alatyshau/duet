/*
 * ЧТО: Единая таблица статусов для страниц визарда.
 * ЗАЧЕМ: Заменяет ad-hoc ScanErrorRow, InstructionsErrorRow, inline error JSX.
 *        Один компонент для отображения StatusItem[] на любой странице.
 * КТО ИСПОЛЬЗУЕТ: BusinessFoldersPage, InstructionsPage, BackendPage.
 */
import { Button } from './button'
import { SeverityIcon } from './severity-icon'
import { Wrench } from 'lucide-react'
import type { Severity } from '../../../../shared/types'

export interface StatusTableItem {
  severity: Severity
  message: string
  /** Secondary info (file path, version, etc.) */
  detail?: string
  fixable?: boolean
  onFix?: () => void
}

export function StatusTable({ items }: { items: StatusTableItem[] }): React.ReactElement | null {
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <StatusRow key={i} item={item} />
      ))}
    </div>
  )
}

function StatusRow({ item }: { item: StatusTableItem }): React.ReactElement {
  const borderColor = item.severity === 'error' ? 'border-red-200' : 'border-amber-200'
  const bgColor = item.severity === 'error' ? 'bg-red-50' : 'bg-amber-50'

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderColor} ${bgColor}`}>
      <div className="flex-shrink-0 mt-0.5">
        <SeverityIcon severity={item.severity} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{item.message}</p>
        {item.detail && (
          <p className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
            {item.detail}
          </p>
        )}
      </div>
      {item.fixable && item.onFix && (
        <Button variant="outline" size="sm" className="flex-shrink-0" onClick={item.onFix}>
          <Wrench size={14} />
          Fix
        </Button>
      )}
    </div>
  )
}
