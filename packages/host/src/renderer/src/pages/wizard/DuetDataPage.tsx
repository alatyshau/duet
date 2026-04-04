/*
 * Шаг 1: Папка DuetData — folder picker для локального кэша.
 * Читает текущий путь из AppState, сохраняет через savePointer (partial update).
 */
import { Button } from '@renderer/components/ui/button'
import { FolderOpen, CheckCircle, AlertTriangle } from 'lucide-react'
import type { AppState } from '../../../../preload/index.d'
import type { StepStatus } from '../../../../core/wizard-status'

interface DuetDataPageProps {
  appState: AppState
  onStatusChange: (status: StepStatus) => void
}

export function DuetDataPage({ appState, onStatusChange }: DuetDataPageProps): React.ReactElement {
  const path = appState.duetDataPath
  const isDone = !!path

  const handleSelect = async (): Promise<void> => {
    const selected = await window.api.selectFolder(path ?? undefined)
    if (!selected) return
    const newState = await window.api.savePointer({ duetDataPath: selected })
    onStatusChange(newState.duetDataPath ? 'done' : null)
  }

  const handleOpen = (): void => {
    if (path) window.api.openPath(path)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FolderOpen size={24} />
          Папка DuetData
        </h2>
        <p className="text-muted-foreground mt-1">
          Локальный кэш: клоны репозиториев, база данных, бэкенд, логи
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {isDone ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">DuetData</div>
            {!path && (
              <p className="text-xs text-muted-foreground mt-1">
                Выберите папку для хранения локальных данных Duet
              </p>
            )}
            {path && <p className="text-sm text-green-600 mt-1 break-all">{path}</p>}
            <div className="flex gap-2 mt-3">
              <Button variant={path ? 'outline' : 'default'} size="sm" onClick={handleSelect}>
                <FolderOpen size={16} />
                {path ? 'Изменить' : 'Выбрать'}
              </Button>
              {path && (
                <Button variant="outline" size="sm" onClick={handleOpen}>
                  Открыть
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Что хранится:</strong> клоны git-репозиториев, SQLite база, развёрнутый бэкенд,
            логи.
          </p>
          <p>
            <strong>Рекомендация:</strong> быстрый локальный диск (SSD), не в облачном хранилище.
          </p>
        </div>
      </div>
    </div>
  )
}
