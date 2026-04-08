/*
 * Шаг 1: Duet: пути — DuetData, DuetConfig, имя машины, бизнес-папки.
 * Четыре секции на одной странице: folder picker для DuetData, folder picker для DuetConfig,
 * text input для имени машины, список бизнес-папок (add/remove).
 * Статус = ok когда три базовых пути настроены (бизнес-папки опциональны).
 */
import { useState, useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import { FolderOpen, CheckCircle, AlertTriangle, MapPin, Plus, Trash2 } from 'lucide-react'
import type { AppState, BusinessFolderEntry } from '../../../../preload/index.d'
import type { PageStatus } from '../../../../core/wizard-status'

interface DuetPathsPageProps {
  appState: AppState
  onStatusChange: (status: PageStatus) => void
}

export function DuetPathsPage({
  appState,
  onStatusChange
}: DuetPathsPageProps): React.ReactElement {
  const dataPath = appState.duetDataPath
  const configPath = appState.duetConfigPath
  const [machine, setMachine] = useState(appState.machine ?? '')
  const [machineError, setMachineError] = useState(false)
  const [businessFolders, setBusinessFolders] = useState<BusinessFolderEntry[]>([])

  const _updateStatus = (state: AppState): void => {
    onStatusChange(state.duetDataPath && state.duetConfigPath && state.machine ? 'ok' : null)
  }

  // Load business folders on mount
  useEffect(() => {
    if (!window.api) return
    window.api.getBusinessFolders().then(setBusinessFolders).catch(console.error)
  }, [])

  // Business folders
  const handleAddFolder = async (): Promise<void> => {
    const selected = await window.api.selectFolder()
    if (!selected) return
    if (businessFolders.some((f) => f.resolved === selected)) return
    const updated = [...businessFolders, { raw: selected, resolved: selected }]
    setBusinessFolders(updated)
    await window.api.saveBusinessFolders(updated.map((f) => f.raw))
  }

  const handleRemoveFolder = async (index: number): Promise<void> => {
    const updated = businessFolders.filter((_, i) => i !== index)
    setBusinessFolders(updated)
    await window.api.saveBusinessFolders(updated.map((f) => f.raw))
  }

  // DuetData
  const handleSelectData = async (): Promise<void> => {
    const selected = await window.api.selectFolder(dataPath ?? undefined)
    if (!selected) return
    const newState = await window.api.savePointer({ duetDataPath: selected })
    _updateStatus(newState)
  }

  const handleOpenData = (): void => {
    if (dataPath) window.api.openPath(dataPath)
  }

  // DuetConfig
  const handleSelectConfig = async (): Promise<void> => {
    const selected = await window.api.selectFolder(configPath ?? undefined)
    if (!selected) return
    const newState = await window.api.savePointer({ duetConfigPath: selected })
    _updateStatus(newState)
  }

  const handleOpenConfig = (): void => {
    if (configPath) window.api.openPath(configPath)
  }

  // Machine
  const handleMachineSave = async (): Promise<void> => {
    const trimmed = machine.trim()
    if (!trimmed) {
      setMachineError(true)
      return
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed) || trimmed.length > 64) {
      setMachineError(true)
      return
    }
    setMachineError(false)
    const newState = await window.api.savePointer({ machine: trimmed })
    _updateStatus(newState)
  }

  const handleMachineKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      void handleMachineSave()
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <MapPin size={24} />
          Duet: пути
        </h2>
        <p className="text-muted-foreground mt-1">
          Локальные данные, облачная конфигурация и имя машины
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        {/* DuetData */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {dataPath ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">DuetData</div>
            {!dataPath && (
              <p className="text-xs text-muted-foreground mt-1">
                Локальный кэш: клоны репозиториев, база данных, бэкенд, логи
              </p>
            )}
            {dataPath && <p className="text-sm text-green-600 mt-1 break-all">{dataPath}</p>}
            <div className="flex gap-2 mt-3">
              <Button
                variant={dataPath ? 'outline' : 'default'}
                size="sm"
                onClick={handleSelectData}
              >
                <FolderOpen size={16} />
                {dataPath ? 'Изменить' : 'Выбрать'}
              </Button>
              {dataPath && (
                <Button variant="outline" size="sm" onClick={handleOpenData}>
                  Открыть
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* DuetConfig */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {configPath ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">DuetConfig</div>
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
                onClick={handleSelectConfig}
              >
                <FolderOpen size={16} />
                {configPath ? 'Изменить' : 'Выбрать'}
              </Button>
              {configPath && (
                <Button variant="outline" size="sm" onClick={handleOpenConfig}>
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
            <div className="font-medium text-foreground">Машина</div>
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

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>DuetData</strong> — быстрый локальный диск (SSD), не в облачном хранилище.
          </p>
          <p>
            <strong>DuetConfig</strong> — папка в облачном хранилище (Google Drive, iCloud).
            Синхронизируется между машинами.
          </p>
          <p>
            <strong>Машина</strong> — каждая машина имеет свой файл{' '}
            <code className="text-[11px] bg-muted px-1 rounded">{'{machine}.json'}</code> в
            DuetConfig.
          </p>
        </div>
      </div>

      {/* Business Folders */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          <FolderOpen size={20} />
          Бизнес-папки
        </h3>
        <p className="text-xs text-muted-foreground">
          Корневые папки бизнесов на Google Drive — источник для сканирования сущностей.
        </p>

        {businessFolders.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ни одной папки не добавлено. Добавьте корневые папки бизнесов из облачного хранилища.
          </p>
        )}

        <div className="space-y-2">
          {businessFolders.map((entry, i) => (
            <div
              key={entry.raw}
              className="flex items-center gap-2 p-3 rounded-lg border border-border bg-background"
            >
              <FolderOpen size={16} className="text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {entry.resolved.split(/[\\/]/).pop()}
                </div>
                <div className="text-xs text-muted-foreground truncate" title={entry.resolved}>
                  {entry.resolved}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={() => handleRemoveFolder(i)}
              >
                <Trash2 size={14} className="text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={handleAddFolder}>
          <Plus size={16} />
          Добавить папку
        </Button>
      </div>
    </div>
  )
}
