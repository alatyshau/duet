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
  readConfig,
  isValidMachineName,
  setMachineConfigKey,
  setSettingsConfigKey
} from './config'
import type { BusinessFolderEntry, ScanResult, StreamsCache } from '../shared/types'

/**
 * Канонизация пути: NFC + срез trailing-разделителей.
 *
 * Зачем NFC: macOS dialog возвращает имена в NFD (decomposed),
 * JSON-файлы хранят то что записано. Если сравнивать без нормализации,
 * "МетаЛаб" из dialog и "МетаЛаб" из {machine}.json могут не совпасть
 * по байтам и dedup/реюз alias сломается.
 *
 * Зачем strip разделителей: dialog/пользователь может прислать "/foo/" или "C:\foo\".
 *
 * Кроссплатформенно: на Windows NFC ≡ raw (NTFS уже NFC), на Mac/Linux фиксит NFD.
 */
export function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, '').normalize('NFC')
}

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
 * убирает root у всех остальных.
 *
 * Self-healing: если business.json отсутствует — создаёт его с дефолтным
 * `{name: basename(folder), icon: '📁'}` (поведение симметрично scanner.py:198
 * на бэкенде, который чинит missing manifests при скане).
 *
 * На невалидный JSON бросает ошибку — это пользовательский манифест,
 * перезаписать молча нельзя, иначе можно затереть данные.
 */
export function setRootBusiness(folders: BusinessFolderEntry[], rootIndex: number): void {
  for (let i = 0; i < folders.length; i++) {
    const folderPath = folders[i].resolved
    const manifestPath = join(folderPath, 'business.json')
    const shouldBeRoot = i === rootIndex

    let data: Record<string, unknown>
    if (existsSync(manifestPath)) {
      try {
        data = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      } catch (e) {
        throw new Error(
          `Invalid JSON in ${manifestPath}: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    } else {
      data = { name: basename(folderPath), icon: '📁' }
    }

    const currentRoot = data.root === true
    if (shouldBeRoot === currentRoot && existsSync(manifestPath)) continue

    if (shouldBeRoot) {
      data.root = true
    } else {
      delete data.root
    }
    writeFileSync(manifestPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
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
 * 1. Pre-check: pointer должен иметь duetConfigPath и валидный machine,
 *    иначе бросаем — иначе alias уйдёт в settings.json без mapping в
 *    {machine}.json и backend упадёт на резолве.
 * 2. Путь нормализуется (NFC + strip trailing separators) перед хранением
 *    и сравнением, чтобы macOS NFD/NFC расхождения не порождали дубликаты.
 * 3. Если путь уже привязан к существующему `@alias` — переиспользуем.
 * 4. Иначе генерируем `@<basename>` от имени папки. На коллизию имени —
 *    суффикс `_2`, `_3`, ...
 * 5. Записываем alias в `{machine}.json`, добавляем в `business_folders`.
 * 6. Если это первая папка в списке — автоматически назначаем её root
 *    (инвариант: при наличии папок ровно одна должна быть root).
 *
 * Возвращает обновлённый список `BusinessFolderEntry[]` для рендера.
 *
 * @throws Error если pointer-конфиг неполный (отсутствует duetConfigPath
 *   или machine, или machine name невалидный) — silent fail здесь оставит
 *   систему в несогласованном состоянии.
 */
export function addBusinessFolder(absolutePath: string): BusinessFolderEntry[] {
  const cfg = readConfig()
  if (!cfg.duetConfigPath) {
    throw new Error('Cannot add business folder: duetConfigPath is not set in pointer config.')
  }
  if (!cfg.machine || !isValidMachineName(cfg.machine)) {
    throw new Error(
      'Cannot add business folder: machine name is not set or invalid in pointer config.'
    )
  }

  const normalized = normalizePath(absolutePath)
  const mc = readMachineConfig() ?? {}

  // Существующие @aliases из {machine}.json
  const existingAliases: Record<string, string> = {}
  for (const [k, v] of Object.entries(mc)) {
    if (k.startsWith('@') && typeof v === 'string') existingAliases[k] = v
  }

  const { alias, isNew } = resolveAliasForPath(normalized, existingAliases)

  // Записать новый алиас в {machine}.json (нормализованным путём)
  if (isNew) {
    setMachineConfigKey(alias, normalized)
  }

  // Добавить в business_folders в settings.json (без дубликата)
  const current = getBusinessFolders()
  if (!current.includes(alias)) {
    setSettingsConfigKey('business_folders', [...current, alias])
  }

  // Инвариант: должен быть ровно один root. Если ни одна из папок ещё не root —
  // делаем root первую (она же только что добавленная при пустом начальном списке).
  const updated = getResolvedBusinessFolders()
  if (updated.length > 0 && !updated.some((f) => f.isRoot)) {
    setRootBusiness(updated, 0)
    return getResolvedBusinessFolders()
  }
  return updated
}

/**
 * Подбирает имя алиаса для абсолютного пути.
 *
 * - Если `path` уже привязан к существующему алиасу → переиспользуем его (idempotent).
 * - Иначе берём `@<basename(path)>`.
 * - На коллизию с другим путём — добавляем суффикс `_2`, `_3`, ...
 *
 * Сравнение путей идёт через `normalizePath()`, чтобы NFD/NFC расхождения
 * (macOS) и trailing separators не приводили к ложно-новому алиасу.
 *
 * Экспорт для тестируемости.
 */
export function resolveAliasForPath(
  absolutePath: string,
  existingAliases: Record<string, string>
): { alias: string; isNew: boolean } {
  const normalized = normalizePath(absolutePath)

  // 1. Reuse: путь уже привязан к существующему алиасу (сравниваем нормализованные формы)
  for (const [aliasName, aliasPath] of Object.entries(existingAliases)) {
    if (normalizePath(aliasPath) === normalized) return { alias: aliasName, isNew: false }
  }

  // 2. Базовое имя — `@<folder.name>`. basename() работает с разделителями текущей ОС;
  //    визард всегда вызывается локально, dialog возвращает OS-native пути.
  const folderName = basename(normalized)
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
