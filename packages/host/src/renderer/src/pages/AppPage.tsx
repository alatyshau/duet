/*
 * ЧТО: Страница приложения — карточки процессов с управлением.
 * ЗАЧЕМ: Единый UI для мониторинга и управления процессами приложения.
 * КТО ИСПОЛЬЗУЕТ: App.tsx при навигации на app:*.
 */
import { Button } from '@renderer/components/ui/button'
import { Loader2, Play, Square, RefreshCw, AlertTriangle } from 'lucide-react'
import type { AppInfo, ProcessStatus } from '../../../preload/index.d'

// =============================================================================
// HELPERS
// =============================================================================

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}с`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}м`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}

// =============================================================================
// TYPES
// =============================================================================

interface AppPageProps {
  app: AppInfo
  processStatuses: Record<string, ProcessStatus>
  onStart: () => void
  onStop: () => void
  onRestart: () => void
}

// =============================================================================
// COMPONENT
// =============================================================================

export function AppPage({
  app,
  processStatuses,
  onStart,
  onStop,
  onRestart
}: AppPageProps): React.ReactElement {
  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h2 className="text-2xl font-semibold text-foreground">{app.name}</h2>
        <p className="text-muted-foreground mt-1">{app.description}</p>
      </div>

      {/* Карточки процессов */}
      {app.processes.map((proc) => {
        const status = processStatuses[proc.id] ?? { state: 'stopped' as const }

        return (
          <div key={proc.id} className="bg-card rounded-xl border border-border p-6 space-y-4">
            {/* Заголовок процесса + статус */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-medium text-foreground">
                  {proc.name}
                  {proc.port && (
                    <span className="text-sm text-muted-foreground ml-2">(порт {proc.port})</span>
                  )}
                </h3>
              </div>
              <ProcessStateLabel state={status.state} />
            </div>

            {/* Детали */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background">
              <ProcessDot state={status.state} />
              <div className="flex-1 min-w-0">
                {status.state === 'running' && (
                  <div>
                    <span className="text-sm font-medium text-foreground">Запущен</span>
                    {status.version && (
                      <span className="text-xs text-muted-foreground ml-2">v{status.version}</span>
                    )}
                    {status.uptime !== undefined && (
                      <span className="text-xs text-muted-foreground ml-2">
                        uptime {formatUptime(status.uptime)}
                      </span>
                    )}
                  </div>
                )}
                {status.state === 'starting' && (
                  <span className="text-sm text-muted-foreground">
                    {status.message ?? 'Запуск...'}
                  </span>
                )}
                {status.state === 'stopping' && (
                  <span className="text-sm text-muted-foreground">
                    {status.message ?? 'Остановка...'}
                  </span>
                )}
                {status.state === 'error' && (
                  <span className="text-sm text-red-500">{status.error}</span>
                )}
                {status.state === 'stopped' && (
                  <span className="text-sm text-muted-foreground">Остановлен</span>
                )}
              </div>
            </div>

            {/* Кнопки */}
            <div className="flex gap-2">
              {status.state === 'running' && (
                <>
                  <Button variant="outline" size="sm" onClick={onRestart}>
                    <RefreshCw size={14} />
                    Перезапустить
                  </Button>
                  <Button variant="outline" size="sm" onClick={onStop}>
                    <Square size={14} />
                    Остановить
                  </Button>
                </>
              )}
              {status.state === 'stopped' && (
                <Button variant="default" size="sm" onClick={onStart}>
                  <Play size={14} />
                  Запустить
                </Button>
              )}
              {status.state === 'error' && (
                <Button variant="default" size="sm" onClick={onStart}>
                  <Play size={14} />
                  Запустить
                </Button>
              )}
              {(status.state === 'starting' || status.state === 'stopping') && (
                <Button variant="outline" size="sm" disabled>
                  <Loader2 size={14} className="animate-spin" />
                  {status.state === 'starting' ? 'Запускается...' : 'Останавливается...'}
                </Button>
              )}
            </div>
          </div>
        )
      })}

      {/* Ошибки (placeholder) */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-lg font-medium text-foreground mb-3">Ошибки</h3>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle size={16} className="opacity-30" />
          <span>Нет ошибок</span>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Sub-components
// =============================================================================

function ProcessDot({ state }: { state: string }): React.ReactElement {
  if (state === 'starting' || state === 'stopping') {
    return <Loader2 className="w-4 h-4 text-blue-500 animate-spin flex-shrink-0" />
  }
  const color =
    state === 'running' ? 'bg-green-500' : state === 'error' ? 'bg-red-500' : 'bg-muted-foreground'
  return <div className={`w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`} />
}

function ProcessStateLabel({ state }: { state: string }): React.ReactElement {
  const config: Record<string, { text: string; className: string }> = {
    running: { text: 'Запущен', className: 'text-green-600 bg-green-500/10 border-green-500/20' },
    starting: { text: 'Запуск...', className: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
    stopping: {
      text: 'Остановка...',
      className: 'text-blue-500 bg-blue-500/10 border-blue-500/20'
    },
    error: { text: 'Ошибка', className: 'text-red-500 bg-red-500/10 border-red-500/20' },
    stopped: {
      text: 'Остановлен',
      className: 'text-muted-foreground bg-muted/50 border-border'
    }
  }
  const c = config[state] ?? config.stopped
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${c.className}`}>
      {c.text}
    </span>
  )
}
