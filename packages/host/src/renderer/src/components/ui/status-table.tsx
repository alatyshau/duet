/*
 * ЧТО: Единая таблица статусов для страниц визарда.
 * ЗАЧЕМ: Заменяет ad-hoc ScanErrorRow, InstructionsErrorRow, inline error JSX.
 *        Один компонент для отображения StatusItem[] на любой странице.
 * КТО ИСПОЛЬЗУЕТ: BusinessFoldersPage, InstructionsPage, BackendPage.
 */
import { useState } from 'react'
import { Button } from './button'
import { SeverityIcon } from './severity-icon'
import { Wrench, Copy, Check } from 'lucide-react'
import type { Severity } from '../../../../shared/types'

export interface StatusTableItem {
  severity: Severity
  message: string
  /** Secondary info (file path, version, etc.) */
  detail?: string
  fixable?: boolean
  onFix?: () => void
  /** Copyable text shown as a hint (e.g. prompt for AI agent) */
  copyText?: string
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
  const [copied, setCopied] = useState(false)
  const borderColor = item.severity === 'error' ? 'border-red-200' : 'border-amber-200'
  const bgColor = item.severity === 'error' ? 'bg-red-50' : 'bg-amber-50'

  const handleCopy = (): void => {
    if (!item.copyText) return
    navigator.clipboard.writeText(item.copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
        {item.copyText && (
          <div className="mt-2 flex items-start gap-2">
            <p className="text-xs text-muted-foreground bg-background rounded px-2 py-1 border border-border font-mono flex-1">
              {item.copyText}
            </p>
            <Button variant="outline" size="sm" className="flex-shrink-0 h-7" onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </div>
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
