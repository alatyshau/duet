/*
 * Шаг 4: Backend — деплой в DuetData + переключатель DEV/PROD.
 * Перенос логики компонентов секции из InstallPage.
 */
import { useState, useEffect, useRef } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Package, Download, Loader2, Code, CheckCircle, AlertTriangle } from 'lucide-react'
import type { AppState, DeployStatus, DeployChannel } from '../../../../preload/index.d'
import type { PageStatus } from '../../../../core/wizard-status'

interface BackendPageProps {
  appState: AppState
  onStatusChange: (status: PageStatus) => void
}

export function BackendPage({ appState, onStatusChange }: BackendPageProps): React.ReactElement {
  const [deployStatus, setDeployStatus] = useState<DeployStatus>({ state: 'idle' })
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const isReady = appState.status === 'ready'

  useEffect(() => {
    if (!window.api) return
    window.api.getDeployStatus().then(setDeployStatus).catch(console.error)

    const unsubStatus = window.api.onDeployStatusChanged((status) => {
      setDeployStatus(status)
      const deployed = status.state === 'deployed' || status.state === 'up_to_date'
      const hasWarning = deployed && 'warningReason' in status && !!status.warningReason
      onStatusChange(deployed ? (hasWarning ? 'warning' : 'ok') : null)
    })
    const unsubLog = window.api.onDeployLog((message) => {
      setLogs((prev) => [...prev, message])
    })
    return () => {
      unsubStatus()
      unsubLog()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch deploy status when channel changes (warningReason depends on channel)
  useEffect(() => {
    if (!window.api) return
    window.api.getDeployStatus().then(setDeployStatus).catch(console.error)
  }, [appState.deployChannel])

  // Set initial status and update on deploy status change
  useEffect(() => {
    const deployed = deployStatus.state === 'deployed' || deployStatus.state === 'up_to_date'
    if (deployed) {
      const hasWarning = 'warningReason' in deployStatus && !!deployStatus.warningReason
      onStatusChange(hasWarning ? 'warning' : 'ok')
    }
  }, [deployStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

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
  const isDev = appState.deployChannel === 'dev'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Package size={24} />
          Backend
        </h2>
        <p className="text-muted-foreground mt-1">Деплой Python HTTP API + MCP в DuetData</p>
      </div>

      {!isReady && (
        <div className="bg-card rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">
            Сначала настройте DuetData (шаг 1) и Python (шаг 3).
          </p>
        </div>
      )}

      {isReady && (
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          {/* Header with channel toggle */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-foreground">Компоненты</h3>
            {appState.hasDevBackendPath && (
              <ChannelToggle channel={appState.deployChannel} onChange={handleChannelChange} />
            )}
          </div>

          {/* DEV banner */}
          {isDev && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/50 bg-amber-500/10">
              <Code className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-amber-500">DEV</span> — источник из репозитория
              </div>
            </div>
          )}

          {/* Status */}
          <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
            {isDeployed ? (
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
            )}
            <div>
              <div className="font-medium text-sm text-foreground">Backend</div>
              <div className="text-xs text-muted-foreground">Python HTTP API + MCP</div>
            </div>
          </div>

          {/* Version */}
          {'version' in deployStatus && deployStatus.version && (
            <VersionInfo
              version={deployStatus.version}
              isUpToDate={deployStatus.state === 'up_to_date'}
              currentChannel={appState.deployChannel}
            />
          )}

          {/* Deploy warning */}
          {'warningReason' in deployStatus && deployStatus.warningReason && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">{deployStatus.warningReason}</p>
            </div>
          )}

          {/* Deploy button */}
          <Button className="w-full" disabled={isDeploying} onClick={handleDeploy}>
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

      {/* Log */}
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

function VersionInfo({
  version,
  isUpToDate,
  currentChannel
}: {
  version: string
  isUpToDate: boolean
  currentChannel: 'dev' | 'prod'
}): React.ReactElement {
  // Parse channel from version metadata: `0.1.8+dev_xxx` or `0.1.8+prod_xxx`
  const versionChannel = version.includes('+dev_')
    ? 'dev'
    : version.includes('+prod_')
      ? 'prod'
      : null
  const channelMismatch = versionChannel !== null && versionChannel !== currentChannel
  const isActual = isUpToDate && !channelMismatch

  return (
    <div className="text-sm text-muted-foreground space-y-1">
      <p>
        Версия: {version}
        {isActual && ' (актуальна)'}
      </p>
      {channelMismatch && (
        <p className="text-amber-500 text-xs">
          {currentChannel === 'prod'
            ? 'Установлена DEV-версия — переустановите для PROD'
            : 'Установлена PROD-версия — переустановите для DEV'}
        </p>
      )}
    </div>
  )
}

function ChannelToggle({
  channel,
  onChange
}: {
  channel: DeployChannel
  onChange: (channel: DeployChannel) => void
}): React.ReactElement {
  const isDev = channel === 'dev'
  return (
    <button
      type="button"
      onClick={() => onChange(isDev ? 'prod' : 'dev')}
      className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors
        ${
          isDev
            ? 'border-amber-500/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
            : 'border-border bg-background text-muted-foreground hover:bg-muted'
        }`}
    >
      {isDev ? 'DEV' : 'PROD'}
    </button>
  )
}
