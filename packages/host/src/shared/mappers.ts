/*
 * ЧТО: Маппинг IPC-типов в обобщённые UI-типы.
 * ЗАЧЕМ: BackendStatus (IPC) → ProcessStatus (UI). Чистая функция без зависимостей.
 * КТО ИСПОЛЬЗУЕТ: renderer (App.tsx), потенциально main.
 */
import type { BackendStatus, ProcessStatus } from './types'

export function backendStatusToProcessStatus(backend: BackendStatus): ProcessStatus {
  switch (backend.state) {
    case 'stopped':
      return { state: 'stopped' }
    case 'starting':
      return { state: 'starting', message: backend.message }
    case 'running':
      return { state: 'running', version: backend.version, uptime: backend.uptime }
    case 'stopping':
      return { state: 'stopping', message: 'Остановка...' }
    case 'error':
      return { state: 'error', error: backend.error }
  }
}
