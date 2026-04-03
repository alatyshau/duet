/*
 * ProcessStateLabel — бейдж с текстовым статусом процесса.
 * Используется в AppPage.
 */
import type { ProcessState } from '../../../../shared/types'

const config: Record<ProcessState, { text: string; className: string }> = {
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

export function ProcessStateLabel({ state }: { state: ProcessState }): React.ReactElement {
  const c = config[state]
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${c.className}`}>
      {c.text}
    </span>
  )
}
