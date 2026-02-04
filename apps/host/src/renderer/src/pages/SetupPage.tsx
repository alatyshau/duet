/*
 * ЧТО: Страница первоначальной настройки.
 * ЗАЧЕМ: Позволяет указать 3 поля для создания pointer файла (~/.org.ve68.duet).
 * КТО ИСПОЛЬЗУЕТ: App.tsx при первом запуске или если конфиг неполный.
 */
import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { FolderOpen, CheckCircle, AlertTriangle, Monitor } from 'lucide-react'
import type { AppState } from '../../../preload/index.d'

interface SetupPageProps {
  appState: AppState
  onSelectFolder: (field: 'duetDataPath' | 'duetConfigPath') => void
  onSave: () => void
  onOpenPath: (path: string) => void
  machine: string
  onMachineChange: (value: string) => void
}

export function SetupPage({
  appState,
  onSelectFolder,
  onSave,
  onOpenPath,
  machine,
  onMachineChange
}: SetupPageProps): React.ReactElement {
  const { status, duetDataPath, duetConfigPath } = appState
  const [machineError, setMachineError] = useState(false)

  const isReady = status === 'ready'
  const canSave = !!duetDataPath && !!duetConfigPath && !!machine.trim()

  const handleSave = (): void => {
    if (!machine.trim()) {
      setMachineError(true)
      return
    }
    setMachineError(false)
    onSave()
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-3rem)]">
      <div className="bg-card rounded-2xl shadow-sm border border-border p-8 max-w-lg w-full">
        {/* Заголовок */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-2">Установка Duet</h2>
          <p className="text-muted-foreground">
            {isReady
              ? 'Всё настроено и готово к работе'
              : 'Укажите пути и имя машины'}
          </p>
        </div>

        {/* Поля */}
        <div className="space-y-4 mb-8">

          {/* 1. DuetData */}
          <FolderField
            label="Папка DuetData"
            description="Локальный кэш (repos, db, logs)"
            path={duetDataPath}
            onSelect={() => onSelectFolder('duetDataPath')}
            onOpen={onOpenPath}
          />

          {/* 2. DuetConfig */}
          <FolderField
            label="Папка DuetConfig"
            description="Конфигурация в облаке (settings, aliases)"
            path={duetConfigPath}
            onSelect={() => onSelectFolder('duetConfigPath')}
            onOpen={onOpenPath}
          />

          {/* 3. Machine */}
          <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
            <div className="flex-shrink-0 mt-0.5">
              {machine.trim() ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground flex items-center gap-2">
                <Monitor size={16} />
                Имя машины
              </div>
              <p className="text-xs text-muted-foreground mt-1 mb-2">
                Уникальный идентификатор (например mac_work, win_home)
              </p>
              <input
                type="text"
                value={machine}
                onChange={(e) => {
                  onMachineChange(e.target.value)
                  if (machineError) setMachineError(false)
                }}
                placeholder="mac_work"
                className={`w-full px-3 py-1.5 text-sm rounded-md border bg-background text-foreground
                  ${machineError ? 'border-red-500' : 'border-border'}
                  focus:outline-none focus:ring-2 focus:ring-ring`}
              />
              {machineError && (
                <p className="text-xs text-red-500 mt-1">Укажите имя машины</p>
              )}
            </div>
          </div>
        </div>

        {/* Кнопка сохранения */}
        {!isReady && (
          <Button
            className="w-full"
            disabled={!canSave}
            onClick={handleSave}
          >
            Сохранить
          </Button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Компонент поля для выбора папки
// =============================================================================

interface FolderFieldProps {
  label: string
  description: string
  path: string | null
  onSelect: () => void
  onOpen: (path: string) => void
}

function FolderField({ label, description, path, onSelect, onOpen }: FolderFieldProps): React.ReactElement {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
      <div className="flex-shrink-0 mt-0.5">
        {path ? (
          <CheckCircle className="w-5 h-5 text-green-600" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-amber-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground">{label}</div>
        {!path && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {path && (
          <p className="text-sm text-green-600 mt-1 break-all">{path}</p>
        )}
        <div className="flex gap-2 mt-3">
          <Button variant={path ? 'outline' : 'default'} size="sm" onClick={onSelect}>
            <FolderOpen size={16} />
            {path ? 'Изменить' : 'Выбрать'}
          </Button>
          {path && (
            <Button variant="outline" size="sm" onClick={() => onOpen(path)}>
              Открыть
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
