/*
 * Шаг 7: AI Агенты — обнаружение и конфигурация AI клиентов.
 * Наполнение в фазе 6 (перенос из pages/AgentsPage.tsx).
 */
import { Bot } from 'lucide-react'

export function WizardAgentsPage(): React.ReactElement {
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
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Страница будет наполнена в фазе 6.</p>
      </div>
    </div>
  )
}
