/*
 * ЧТО: Страница "AI Агенты" — обнаружение и конфигурация AI клиентов.
 * ЗАЧЕМ: Показывает какие AI клиенты установлены, позволяет настроить.
 * КТО ИСПОЛЬЗУЕТ: App.tsx.
 *
 * ПАТТЕРН: detect → status → configure / manual instructions.
 * Ненайденный AI клиент — не ошибка, просто информация.
 */
import { useState, useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Bot, CheckCircle, AlertTriangle, XCircle, Settings2, Loader2 } from 'lucide-react'
import type { AgentInfo } from '../../../preload/index.d'

export function AgentsPage(): React.ReactElement {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [configuring, setConfiguring] = useState(false)

  useEffect(() => {
    if (!window.api) return
    window.api.getAgents()
      .then(setAgents)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleConfigure = async (): Promise<void> => {
    setConfiguring(true)
    try {
      const result = await window.api.configureAgents()
      setAgents(result)
    } catch (e) {
      console.error('Configure failed:', e)
    } finally {
      setConfiguring(false)
    }
  }

  const hasFoundAgents = agents.some(a => a.status !== 'not_found')

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Bot size={24} />
          AI Агенты
        </h2>
        <p className="text-muted-foreground mt-1">
          Обнаружение и конфигурация AI клиентов
        </p>
      </div>

      {/* Список агентов */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Поиск AI клиентов...
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {agents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>

            {/* Кнопка конфигурации */}
            {hasFoundAgents && (
              <Button
                className="w-full"
                onClick={handleConfigure}
                disabled={configuring}
              >
                {configuring ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Настраиваю...
                  </>
                ) : (
                  <>
                    <Settings2 size={16} />
                    Настроить все
                  </>
                )}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Подсказка */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-medium text-foreground mb-2">Что настраивается?</h3>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li><strong>Claude Code:</strong> output-style (инструкции) + MCP сервер (duet)</li>
          <li><strong>Codex:</strong> model_instructions_file + MCP сервер (duet)</li>
        </ul>
      </div>
    </div>
  )
}

// =============================================================================
// Sub-components
// =============================================================================

function AgentCard({ agent }: { agent: AgentInfo }): React.ReactElement {
  const statusIcon = {
    not_found: <XCircle className="w-5 h-5 text-muted-foreground flex-shrink-0" />,
    needs_setup: <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />,
    configured: <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
  }

  const statusLabel = {
    not_found: 'Не найден',
    needs_setup: 'Требует настройки',
    configured: 'Настроен'
  }

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
      {statusIcon[agent.status]}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground">{agent.name}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            agent.status === 'configured'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : agent.status === 'needs_setup'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}>
            {statusLabel[agent.status]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{agent.details}</p>
      </div>
    </div>
  )
}
