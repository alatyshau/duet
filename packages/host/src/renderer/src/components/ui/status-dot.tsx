/*
 * StatusDot — индикатор состояния процесса (цветная точка или спиннер).
 * Используется в Sidebar и AppPage.
 */
import { Loader2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import type { ProcessState } from '../../../../shared/types'

interface StatusDotProps {
  state: ProcessState
  size?: 'sm' | 'md'
}

export function StatusDot({ state, size = 'sm' }: StatusDotProps): React.ReactElement {
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
  const spinnerSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'

  if (state === 'starting' || state === 'stopping') {
    return <Loader2 className={cn(spinnerSize, 'text-blue-500 animate-spin flex-shrink-0')} />
  }

  const color =
    state === 'running' ? 'bg-green-500' : state === 'error' ? 'bg-red-500' : 'bg-muted-foreground'

  return <div className={cn('rounded-full flex-shrink-0', dotSize, color)} />
}
