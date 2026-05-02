/*
 * ЧТО: Управление бизнес-папками (business_folders в settings.json).
 * ЗАЧЕМ: Визард настроек — шаг 5. Пользователь указывает корневые папки бизнесов,
 *        Host сохраняет в DuetConfig/settings.json и вызывает Backend POST /scan.
 * КТО ИСПОЛЬЗУЕТ: ipc-handlers (IPC business-folders:*).
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import {
  readSettingsConfig,
  readMachineConfig,
  setMachineConfigKey,
  setSettingsConfigKey
} from './config'
import type { BusinessFolderEntry, ScanResult, StreamsCache } from '../shared/types'

// Re-export types
export type {
  BusinessFolderEntry,
  ScanError,
  ScanResult,
  StreamEntity,
  StreamsCache
} from '../shared/types'

// =============================================================================
// BUSINESS FOLDERS CRUD
// =============================================================================

/**
 * Читает business_folders из settings.json (raw aliases).
 * Возвращает пустой массив если настройки не найдены.
 */
export function getBusinessFolders(): string[] {
  const settings = readSettingsConfig()
  if (!settings) return []
  const folders = settings.business_folders
  return Array.isArray(folders) ? folders : []
}

/**
 * Читает business_folders и резолвит @-алиасы через machine config.
 * Возвращает {raw, resolved, isRoot} — raw для хранения, resolved для отображения.
 */
export function getResolvedBusinessFolders(): BusinessFolderEntry[] {
  const folders = getBusinessFolders()
  const mc = readMachineConfig()
  return folders.map((f) => {
    const resolved = f.startsWith('@') && mc && typeof mc[f] === 'string' ? (mc[f] as string) : f
    return { raw: f, resolved, isRoot: readManifestRoot(resolved) }
  })
}

/**
 * Читает root из business.json в указанной папке.
 */
function readManifestRoot(folderPath: string): boolean {
  const manifestPath = join(folderPath, 'business.json')
  if (!existsSync(manifestPath)) return false
  try {
    const data = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    return data.root === true
  } catch {
    return false
  }
}

/**
 * Устанавливает root: true в business.json указанной папки,
 * убирает root у всех остальных бизнес-папок.
 */
export function setRootBusiness(folders: BusinessFolderEntry[], rootIndex: number): void {
  for (let i = 0; i < folders.length; i++) {
    const manifestPath = join(folders[i].resolved, 'business.json')
    if (!existsSync(manifestPath)) continue
    try {
      const data = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      const shouldBeRoot = i === rootIndex
      if (shouldBeRoot && !data.root) {
        data.root = true
        writeFileSync(manifestPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      } else if (!shouldBeRoot && data.root) {
        delete data.root
        writeFileSync(manifestPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
      }
    } catch {
      // Skip invalid manifests
    }
  }
}

/**
 * Сохраняет business_folders в settings.json (перезаписывает массив целиком).
 */
export function saveBusinessFolders(folders: string[]): void {
  setSettingsConfigKey('business_folders', folders)
}

// =============================================================================
// ADD BUSINESS FOLDER (with alias creation)
// =============================================================================

/**
 * Добавляет бизнес-папку через `@alias` механизм.
 *
 * Зачем: settings.json — shared между машинами (Google Drive). Прямые
 * абсолютные пути (например `C:\Projects\Baza`) ломают синхронизацию.
 * Алиас живёт в settings.json, маппинг алиас → путь — в per-machine
 * `{machine}.json`. Контракт описан в spec/PRODUCT.md.
 *
 * Поведение:
 * 1. Если путь уже привязан к существующему `@alias` — переиспользуем алиас.
 * 2. Иначе генерируем `@<basename>` от имени папки.
 * 3. На коллизию с другим путём — суффикс `_2`, `_3`, ...
 * 4. Записываем алиас в `{machine}.json`, добавляем в `business_folders`.
 *
 * Возвращает обновлённый список `BusinessFolderEntry[]` для рендера.
 */
export function addBusinessFolder(absolutePath: string): BusinessFolderEntry[] {
  const mc = readMachineConfig() ?? {}

  // Существующие @aliases из {machine}.json
  const existingAliases: Record<string, string> = {}
  for (const [k, v] of Object.entries(mc)) {
    if (k.startsWith('@') && typeof v === 'string') existingAliases[k] = v
  }

  const { alias, isNew } = resolveAliasForPath(absolutePath, existingAliases)

  // Записать новый алиас в {machine}.json
  if (isNew) {
    setMachineConfigKey(alias, absolutePath)
  }

  // Добавить в business_folders в settings.json (без дубликата)
  const current = getBusinessFolders()
  if (!current.includes(alias)) {
    setSettingsConfigKey('business_folders', [...current, alias])
  }

  return getResolvedBusinessFolders()
}

/**
 * Подбирает имя алиаса для абсолютного пути.
 *
 * - Если `path` уже привязан к существующему алиасу → переиспользуем его (idempotent).
 * - Иначе берём `@<basename(path)>`.
 * - На коллизию с другим путём — добавляем суффикс `_2`, `_3`, ...
 *
 * Экспорт для тестируемости.
 */
export function resolveAliasForPath(
  absolutePath: string,
  existingAliases: Record<string, string>
): { alias: string; isNew: boolean } {
  // 1. Reuse: путь уже привязан к существующему алиасу
  for (const [aliasName, aliasPath] of Object.entries(existingAliases)) {
    if (aliasPath === absolutePath) return { alias: aliasName, isNew: false }
  }

  // 2. Базовое имя — `@<folder.name>`. basename() работает с разделителями текущей ОС;
  //    визард всегда вызывается локально, dialog возвращает OS-native пути.
  const folderName = basename(absolutePath)
  if (folderName === '') {
    throw new Error(
      `Cannot derive alias from path "${absolutePath}": empty basename. ` +
        'Pick a folder, not a filesystem root.'
    )
  }
  const base = '@' + folderName

  if (!(base in existingAliases)) {
    return { alias: base, isNew: true }
  }

  // 3. Коллизия — суффикс. Не пересекаемся ни с одним существующим алиасом.
  let i = 2
  while (`${base}_${i}` in existingAliases) i++
  return { alias: `${base}_${i}`, isNew: true }
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
