/*
 * ЧТО: Управление бизнес-папками (business_folders в settings.json).
 * ЗАЧЕМ: Визард настроек — шаг 5. Пользователь указывает корневые папки бизнесов,
 *        Host сохраняет в DuetConfig/settings.json и вызывает Backend POST /scan.
 * КТО ИСПОЛЬЗУЕТ: ipc-handlers (IPC business-folders:*).
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { readSettingsConfig, setSettingsConfigKey } from './config'
import type { ScanResult } from '../shared/types'

// Re-export types
export type { ScanError, ScanResult } from '../shared/types'

// =============================================================================
// BUSINESS FOLDERS CRUD
// =============================================================================

/**
 * Читает business_folders из settings.json.
 * Возвращает пустой массив если настройки не найдены.
 */
export function getBusinessFolders(): string[] {
  const settings = readSettingsConfig()
  if (!settings) return []
  const folders = settings.business_folders
  return Array.isArray(folders) ? folders : []
}

/**
 * Сохраняет business_folders в settings.json (перезаписывает массив целиком).
 */
export function saveBusinessFolders(folders: string[]): void {
  setSettingsConfigKey('business_folders', folders)
}

// =============================================================================
// SCAN
// =============================================================================

/**
 * Вызывает POST /scan на Backend.
 * Backend сканирует business_folders, записывает scan.json,
 * возвращает результат с ошибками.
 */
export async function triggerScan(port: number): Promise<ScanResult> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000)
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return {
        status: 'error',
        entities_count: 0,
        errors: [
          {
            path: '',
            reason_code: 'backend_error',
            description: (body as Record<string, string>).error || `HTTP ${res.status}`
          }
        ]
      }
    }

    return (await res.json()) as ScanResult
  } catch (e) {
    return {
      status: 'error',
      entities_count: 0,
      errors: [
        {
          path: '',
          reason_code: 'backend_unavailable',
          description: `Backend недоступен: ${e instanceof Error ? e.message : String(e)}`
        }
      ]
    }
  }
}
