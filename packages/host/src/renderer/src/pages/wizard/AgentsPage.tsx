/*
 * Шаг 7: AI Агенты — обнаружение и конфигурация AI клиентов.
 * Три карточки (Claude Code, Codex, Antigravity) + кнопка "Настроить все".
 * Не установленный клиент = skipped (не ошибка).
 */
import { useState, useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import {
  Bot,
  CheckCircle,
  AlertTriangle,
  XCircle,
  SkipForward,
  Settings2,
  Loader2,
  Wrench,
  ExternalLink
} from 'lucide-react'
import type { AgentInfo, AgentIssue } from '../../../../preload/index.d'
import type { PageStatus } from '../../../../core/wizard-status'

interface WizardAgentsPageProps {
  onStatusChange: (status: PageStatus) => void
}

export function WizardAgentsPage({ onStatusChange }: WizardAgentsPageProps): React.ReactElement {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [configuring, setConfiguring] = useState(false)

  useEffect(() => {
    if (!window.api) return
    window.api
      .getAgents()
      .then((result) => {
        setAgents(result)
        updateStatus(result)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const updateStatus = (agentList: AgentInfo[]): void => {
    const found = agentList.filter((a) => a.status !== 'not_found')
    const needsSetup = found.some((a) => a.status === 'needs_setup')
    if (needsSetup) {
      onStatusChange('warning')
    } else {
      onStatusChange('ok')
    }
  }

  const handleConfigure = async (): Promise<void> => {
    setConfiguring(true)
    try {
      const result = await window.api.configureAgents()
      setAgents(result)
      updateStatus(result)
    } catch (e) {
      console.error('Configure failed:', e)
    } finally {
      setConfiguring(false)
    }
  }

  const handleFixIssue = async (agentId: string, issue: AgentIssue): Promise<void> => {
    try {
      const fixed = await window.api.fixAgentIssue(agentId, issue.reason_code)
      if (fixed) {
        // Re-detect to refresh status
        const result = await window.api.getAgents()
        setAgents(result)
        updateStatus(result)
      }
    } catch (e) {
      console.error('Fix issue failed:', e)
    }
  }

  const hasFoundAgents = agents.some((a) => a.status !== 'not_found')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Bot size={24} />
          AI Агенты
        </h2>
        <p className="text-muted-foreground mt-1">
          Обнаружение и конфигурация Claude Code, Codex, Antigravity
        </p>
      </div>

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
                <AgentCard key={agent.id} agent={agent} onFixIssue={handleFixIssue} />
              ))}
            </div>

            {hasFoundAgents && (
              <Button className="w-full" onClick={handleConfigure} disabled={configuring}>
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

      {/* Help */}
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-sm font-medium text-foreground mb-2">Что настраивается?</h3>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>
            <strong>Claude Code:</strong> output-style (инструкции) + MCP сервер (duet)
          </li>
          <li>
            <strong>Codex:</strong> model_instructions_file + MCP сервер (duet)
          </li>
          <li>
            <strong>Antigravity:</strong> GEMINI.md (инструкции) + MCP сервер (duet)
          </li>
        </ul>
      </div>
    </div>
  )
}

// =============================================================================
// Constants
// =============================================================================

const AGENT_INSTALL_INFO: Record<string, { desc: string; url: string }> = {
  'claude-code': {
    desc: 'Claude Code — AI-ассистент от Anthropic для терминала и IDE.',
    url: 'https://docs.anthropic.com/en/docs/claude-code'
  },
  codex: {
    desc: 'Codex — AI-агент от OpenAI для кодирования в терминале.',
    url: 'https://github.com/openai/codex'
  },
  antigravity: {
    desc: 'Antigravity — AI-ассистент на базе Gemini для терминала.',
    url: 'https://github.com/nichochar/antigravity'
  }
}

// =============================================================================
// Sub-components
// =============================================================================

function AgentCard({
  agent,
  onFixIssue
}: {
  agent: AgentInfo
  onFixIssue: (agentId: string, issue: AgentIssue) => void
}): React.ReactElement {
  const statusIcon = {
    not_found: <SkipForward className="w-5 h-5 text-muted-foreground flex-shrink-0" />,
    needs_setup: <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />,
    configured: <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
  }

  const statusLabel = {
    not_found: 'Не установлен',
    needs_setup: 'Требует настройки',
    configured: agent.version ? `v${agent.version}` : 'Настроен'
  }

  const statusBadgeClass = {
    configured: 'bg-green-100 text-green-700',
    needs_setup: 'bg-amber-100 text-amber-700',
    not_found: 'bg-gray-100 text-gray-600'
  }

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
      {statusIcon[agent.status]}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground">{agent.name}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadgeClass[agent.status]}`}>
            {statusLabel[agent.status]}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{agent.details}</p>

        {/* Checked files */}
        {agent.checkedFiles && agent.checkedFiles.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {agent.checkedFiles.map((f) => (
              <div
                key={f.path}
                className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground"
              >
                <span className={f.ok ? 'text-green-600' : 'text-red-400'}>
                  {f.ok ? '\u2713' : '\u2717'}
                </span>
                <span className="truncate">{f.path}</span>
              </div>
            ))}
          </div>
        )}

        {/* Issues with Fix buttons */}
        {agent.issues && agent.issues.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {agent.issues.map((issue) => (
              <div
                key={issue.reason_code}
                className="flex items-center gap-2 p-2 rounded border border-amber-200 bg-amber-50"
              >
                <XCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="text-xs text-foreground flex-1">{issue.description}</span>
                {issue.fixable && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] px-2"
                    onClick={() => onFixIssue(agent.id, issue)}
                  >
                    <Wrench size={12} />
                    Fix
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Not found — description + install link */}
        {agent.status === 'not_found' && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-muted-foreground">{AGENT_INSTALL_INFO[agent.id]?.desc}</p>
            {AGENT_INSTALL_INFO[agent.id]?.url && (
              <a
                href={AGENT_INSTALL_INFO[agent.id].url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <ExternalLink size={12} />
                Установить
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
