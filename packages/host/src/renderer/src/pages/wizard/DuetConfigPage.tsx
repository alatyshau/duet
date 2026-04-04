/*
 * Шаг 2: DuetConfig + имя машины.
 * Folder picker для облачной конфигурации + text input для имени машины.
 */
import { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { FolderOpen, CheckCircle, AlertTriangle, Monitor } from 'lucide-react'
import type { AppState } from '../../../../preload/index.d'
import type { PageStatus } from '../../../../core/wizard-status'

interface DuetConfigPageProps {
  appState: AppState
  onStatusChange: (status: PageStatus) => void
}

export function DuetConfigPage({
  appState,
  onStatusChange
}: DuetConfigPageProps): React.ReactElement {
  const configPath = appState.duetConfigPath
  const [machine, setMachine] = useState(appState.machine ?? '')
  const [machineError, setMachineError] = useState(false)

  const isDone = !!configPath && !!appState.machine

  const handleSelectFolder = async (): Promise<void> => {
    const selected = await window.api.selectFolder(configPath ?? undefined)
    if (!selected) return
    const newState = await window.api.savePointer({ duetConfigPath: selected })
    onStatusChange(newState.duetConfigPath && newState.machine ? 'ok' : null)
  }

  const handleMachineSave = async (): Promise<void> => {
    const trimmed = machine.trim()
    if (!trimmed) {
      setMachineError(true)
      return
    }
    // Client-side validation matching isValidMachineName() in core/config.ts
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed) || trimmed.length > 64) {
      setMachineError(true)
      return
    }
    setMachineError(false)
    const newState = await window.api.savePointer({ machine: trimmed })
    onStatusChange(newState.duetConfigPath && newState.machine ? 'ok' : null)
  }

  const handleMachineKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      void handleMachineSave()
    }
  }

  const handleOpen = (): void => {
    if (configPath) window.api.openPath(configPath)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Monitor size={24} />
          DuetConfig + машина
        </h2>
        <p className="text-muted-foreground mt-1">
          Облачная конфигурация и уникальный идентификатор машины
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        {/* DuetConfig folder */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {configPath ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">Папка DuetConfig</div>
            {!configPath && (
              <p className="text-xs text-muted-foreground mt-1">
                Конфигурация в облаке (settings, aliases)
              </p>
            )}
            {configPath && <p className="text-sm text-green-600 mt-1 break-all">{configPath}</p>}
            <div className="flex gap-2 mt-3">
              <Button
                variant={configPath ? 'outline' : 'default'}
                size="sm"
                onClick={handleSelectFolder}
              >
                <FolderOpen size={16} />
                {configPath ? 'Изменить' : 'Выбрать'}
              </Button>
              {configPath && (
                <Button variant="outline" size="sm" onClick={handleOpen}>
                  Открыть
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Machine name */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {appState.machine ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">Имя машины</div>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              Уникальный идентификатор (например mac_work, win_home). Определяет какой файл
              конфигурации использовать.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={machine}
                onChange={(e) => {
                  setMachine(e.target.value)
                  if (machineError) setMachineError(false)
                }}
                onBlur={handleMachineSave}
                onKeyDown={handleMachineKeyDown}
                placeholder="mac_work"
                className={`flex-1 px-3 py-1.5 text-sm rounded-md border bg-background text-foreground
                  ${machineError ? 'border-red-500' : 'border-border'}
                  focus:outline-none focus:ring-2 focus:ring-ring`}
              />
            </div>
            {machineError && (
              <p className="text-xs text-red-500 mt-1">
                Латиница, цифры, дефисы, подчёркивания, точки. Начинается с буквы или цифры.
              </p>
            )}
          </div>
        </div>

        {!isDone && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong>DuetConfig</strong> — папка в облачном хранилище (Google Drive, iCloud).
              Синхронизируется между машинами.
            </p>
            <p>
              <strong>Имя машины</strong> — каждая машина имеет свой файл{' '}
              <code className="text-[11px] bg-muted px-1 rounded">{'{machine}.json'}</code> в
              DuetConfig.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
