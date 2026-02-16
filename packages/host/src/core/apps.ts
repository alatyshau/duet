/*
 * ЧТО: Реестр приложений.
 * ЗАЧЕМ: Единый источник правды о приложениях и их процессах.
 * КТО ИСПОЛЬЗУЕТ: renderer (sidebar, AppPage), main (в будущем).
 *
 * Сейчас — только встроенный Duet Backend.
 * В будущем — дополняется динамически из DuetConfig/apps.json.
 */
import type { AppInfo } from '../shared/types'

export const BUILTIN_APPS: AppInfo[] = [
  {
    id: 'duet-backend',
    name: 'Duet Backend',
    description: 'Python HTTP API + MCP',
    builtin: true,
    processes: [
      {
        id: 'http',
        name: 'HTTP',
        type: 'http',
        port: 19680
      }
    ]
  }
]
