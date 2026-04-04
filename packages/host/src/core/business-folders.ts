/*
 * ЧТО: Управление бизнес-папками (business_folders в settings.json).
 * ЗАЧЕМ: Визард настроек — шаг 5. Пользователь указывает корневые папки бизнесов,
 *        Host сохраняет в DuetConfig/settings.json и вызывает Backend POST /scan.
 * КТО ИСПОЛЬЗУЕТ: ipc-handlers (IPC business-folders:*).
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { readSettingsConfig, setSettingsConfigKey } from './config'
import type { ScanResult, StreamsCache } from '../shared/types'

// Re-export types
export type { ScanError, ScanResult, StreamEntity, StreamsCache } from '../shared/types'

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
// CACHED SCAN
// =============================================================================

/** Path to scan cache relative to DuetData root. */
const SCAN_CACHE_FILE = join('data', 'scan.json')

/** Path to streams cache relative to DuetData root. */
const STREAMS_CACHE_FILE = join('data', 'streams.json')

/**
 * Читает результат последнего скана из кэша (DuetData/data/scan.json).
 * Возвращает null если файла нет или невалидный JSON.
 */
export function readCachedScan(duetDataPath: string): ScanResult | null {
  const filePath = join(duetDataPath, SCAN_CACHE_FILE)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ScanResult
  } catch {
    return null
  }
}

/**
 * Читает дерево сущностей из кэша (DuetData/data/streams.json).
 * Возвращает null если файла нет или невалидный JSON.
 */
export function readCachedStreams(duetDataPath: string): StreamsCache | null {
  const filePath = join(duetDataPath, STREAMS_CACHE_FILE)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as StreamsCache
  } catch {
    return null
  }
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
