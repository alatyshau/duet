/*
 * ЧТО: Страница "Установка" — папки + установка компонентов + лог.
 * ЗАЧЕМ: Единая точка настройки DuetData/Config и деплоя AI инструкций + backend.
 * КТО ИСПОЛЬЗУЕТ: App.tsx.
 *
 * СТРУКТУРА:
 * - Верх: папки + имя машины (из SetupPage)
 * - Центр: статус компонентов + кнопка "Установить"
 * - Низ: лог деплоя
 */
import { useState, useEffect, useRef } from 'react'
import { Button } from '@renderer/components/ui/button'
import { FolderOpen, CheckCircle, AlertTriangle, Monitor, Package, Download, Loader2, Code } from 'lucide-react'
import type { AppState, DeployStatus, DeployChannel } from '../../../preload/index.d'

interface InstallPageProps {
  appState: AppState
  onSelectFolder: (field: 'duetDataPath' | 'duetConfigPath') => void
  onSave: () => void
  onOpenPath: (path: string) => void
  machine: string
  onMachineChange: (value: string) => void
}

export function InstallPage({
  appState,
  onSelectFolder,
  onSave,
  onOpenPath,
  machine,
  onMachineChange
}: InstallPageProps): React.ReactElement {
  const { status, duetDataPath, duetConfigPath } = appState
  const [machineError, setMachineError] = useState(false)
  const [deployStatus, setDeployStatus] = useState<DeployStatus>({ state: 'idle' })
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const isReady = status === 'ready'
  const canSave = !!duetDataPath && !!duetConfigPath && !!machine.trim()

  // Подписка на deploy status и logs
  useEffect(() => {
    if (!window.api) return

    // Get initial deploy status
    window.api.getDeployStatus().then(setDeployStatus).catch(console.error)

    const unsubStatus = window.api.onDeployStatusChanged(setDeployStatus)
    const unsubLog = window.api.onDeployLog((message) => {
      setLogs(prev => [...prev, message])
    })

    return () => {
      unsubStatus()
      unsubLog()
    }
  }, [isReady])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const handleSave = (): void => {
    if (!machine.trim()) {
      setMachineError(true)
      return
    }
    setMachineError(false)
    onSave()
  }

  const handleChannelChange = async (channel: DeployChannel): Promise<void> => {
    try {
      await window.api.setDeployChannel(channel)
    } catch (e) {
      console.error('Failed to set deploy channel:', e)
    }
  }

  const handleDeploy = async (): Promise<void> => {
    setLogs([])
    try {
      await window.api.startDeploy()
    } catch (e) {
      console.error('Deploy failed:', e)
    }
  }

  const isDeploying = deployStatus.state === 'deploying'
  const isDeployed = deployStatus.state === 'deployed' || deployStatus.state === 'up_to_date'

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Package size={24} />
          Установка
        </h2>
        <p className="text-muted-foreground mt-1">
          Пути, компоненты и деплой
        </p>
      </div>

      {/* Секция 1: Папки + машина */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <h3 className="text-lg font-medium text-foreground">Конфигурация</h3>

        <FolderField
          label="Папка DuetData"
          description="Локальный кэш (repos, db, logs)"
          path={duetDataPath}
          onSelect={() => onSelectFolder('duetDataPath')}
          onOpen={onOpenPath}
        />

        <FolderField
          label="Папка DuetConfig"
          description="Конфигурация в облаке (settings, aliases)"
          path={duetConfigPath}
          onSelect={() => onSelectFolder('duetConfigPath')}
          onOpen={onOpenPath}
        />

        {/* Machine name */}
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

        {!isReady && canSave && (
          <Button className="w-full" onClick={handleSave}>
            Сохранить
          </Button>
        )}
      </div>

      {/* Секция 2: Компоненты + Установить */}
      {isReady && (
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-foreground">Компоненты</h3>
            <ChannelToggle
              channel={appState.deployChannel}
              onChange={handleChannelChange}
            />
          </div>

          {/* DEV banner */}
          {appState.deployChannel === 'dev' && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/50 bg-amber-500/10">
              <Code className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-amber-500">DEV</span> — источник из репозитория
              </div>
            </div>
          )}

          <div className="space-y-2">
            <ComponentStatus
              name="AI инструкции"
              description="modes, stances, skills, personas"
              deployed={isDeployed}
            />
            <ComponentStatus
              name="Backend"
              description="Python HTTP API + MCP"
              deployed={isDeployed}
            />
          </div>

          {/* Статус версии */}
          {'version' in deployStatus && deployStatus.version && (
            <p className="text-sm text-muted-foreground">
              Версия: {deployStatus.version}
              {deployStatus.state === 'up_to_date' && ' (актуальна)'}
            </p>
          )}

          {/* Кнопка */}
          <Button
            className="w-full"
            disabled={isDeploying}
            onClick={handleDeploy}
          >
            {isDeploying ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Устанавливаю...
              </>
            ) : isDeployed ? (
              <>
                <Download size={16} />
                Переустановить
              </>
            ) : (
              <>
                <Download size={16} />
                Установить
              </>
            )}
          </Button>

          {deployStatus.state === 'error' && (
            <p className="text-sm text-red-500">{deployStatus.error}</p>
          )}
        </div>
      )}

      {/* Секция 3: Лог */}
      {logs.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h3 className="text-lg font-medium text-foreground mb-3">Лог</h3>
          <div
            ref={logRef}
            className="bg-background rounded-lg border border-border p-3 max-h-48 overflow-y-auto font-mono text-xs text-muted-foreground space-y-0.5"
          >
            {logs.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Sub-components
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

interface ChannelToggleProps {
  channel: DeployChannel
  onChange: (channel: DeployChannel) => void
}

function ChannelToggle({ channel, onChange }: ChannelToggleProps): React.ReactElement {
  const isDev = channel === 'dev'
  return (
    <button
      type="button"
      onClick={() => onChange(isDev ? 'prod' : 'dev')}
      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors
        ${isDev
          ? 'border-amber-500/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
          : 'border-border bg-background text-muted-foreground hover:bg-muted'
        }`}
    >
      {isDev ? 'DEV' : 'PROD'}
    </button>
  )
}

interface ComponentStatusProps {
  name: string
  description: string
  deployed: boolean
}

function ComponentStatus({ name, description, deployed }: ComponentStatusProps): React.ReactElement {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
      {deployed ? (
        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
      )}
      <div>
        <div className="font-medium text-sm text-foreground">{name}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}
