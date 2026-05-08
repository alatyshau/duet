/*
 * ЧТО: Управление root-контекстами (root_context_folders в settings.json).
 * ЗАЧЕМ: Wizard страница «Duet: пути» — пользователь указывает корневые папки контекстов на Drive,
 *        Host сохраняет в DuetConfig/settings.json и вызывает Backend POST /scan.
 * КТО ИСПОЛЬЗУЕТ: ipc-handlers (IPC root-contexts:*).
 *
 * Терминология (см. unification-design):
 * - root context = top-level папка в `root_context_folders` без флага `meta`.
 * - meta context = папка с `meta: true` в `context.json` (например `!БАЗА`). Уникальна на DB.
 * - Manifest на диске — `context.json` v2.
 *
 * Self-heal манифестов и rename legacy → v2 — прерогатива core/schema-migrations.ts. Этот модуль
 * только пишет минимальные новые манифесты при изменении meta-флага и читает текущий meta-флаг.
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join, sep } from 'path'
import {
  readSettingsConfig,
  readMachineConfig,
  readConfig,
  isValidMachineName,
  setMachineConfigKey,
  setSettingsConfigKey
} from './config'
import type { RootContextEntry, ScanResult, ContextsCache } from '../shared/types'

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
export type { RootContextEntry, ScanError, ScanResult, ContextEntity, ContextsCache } from '../shared/types'

// =============================================================================
// ROOT CONTEXTS CRUD
// =============================================================================

const SETTINGS_KEY = 'root_context_folders'
const MANIFEST_FILENAME = 'context.json'

/**
 * Читает root_context_folders из settings.json (raw aliases).
 * Возвращает пустой массив если настройки не найдены.
 */
export function getRootContextFolders(): string[] {
  const settings = readSettingsConfig()
  if (!settings) return []
  const folders = settings[SETTINGS_KEY]
  return Array.isArray(folders) ? folders : []
}

/**
 * Читает root_context_folders и резолвит @-алиасы через machine config.
 * Возвращает {raw, resolved, isMeta, unresolved?} — raw для хранения, resolved для отображения.
 *
 * Поддерживается синтаксис `@alias` и `@alias/subpath` (см. spec/PRODUCT.md). Если алиас не
 * найден в machine config — `resolved` равен исходной строке, `unresolved: true` поднимает
 * UI/migration warning (review issue 4: иначе папки беззвучно пропускаются).
 */
export function getResolvedRootContextFolders(): RootContextEntry[] {
  const folders = getRootContextFolders()
  const mc = readMachineConfig() ?? {}
  return folders.map((f) => {
    const resolved = resolveAliasPath(f, mc)
    if (resolved === null) {
      return { raw: f, resolved: f, isMeta: false, unresolved: true }
    }
    return { raw: f, resolved, isMeta: readManifestMeta(resolved) }
  })
}

/**
 * Резолвит строку `root_context_folders` в абсолютный путь.
 *
 * Правила:
 * - Не начинается с `@` → возвращается как есть (предположительно абсолютный путь).
 *   Не валидируем существование — это проверка caller'а.
 * - `@alias` exact match → значение из machine config.
 * - `@alias/sub/path` → split первого segment'а (по `/` или `\`), lookup, join остатка.
 *   Cross-platform: для рабочих subpath'ов используем `path.join` (он нормализует разделители
 *   под текущую ОС).
 * - Алиас не найден → `null`. Caller отвечает за surfacing (UI warning / migration warning).
 *
 * Экспорт для тестируемости и для main/index.ts (where resolved roots are passed to migration walk).
 */
export function resolveAliasPath(
  raw: string,
  machineConfig: Record<string, unknown>
): string | null {
  if (!raw.startsWith('@')) return raw

  // Split off the first path segment after `@…`. Accept both '/' and '\\' as separators
  // because user-edited settings.json on Windows can contain either.
  const sepMatch = raw.search(/[\\/]/)
  if (sepMatch === -1) {
    // Pure `@alias`
    const value = machineConfig[raw]
    return typeof value === 'string' ? value : null
  }
  const aliasKey = raw.slice(0, sepMatch)
  const subpath = raw.slice(sepMatch + 1)
  const aliasValue = machineConfig[aliasKey]
  if (typeof aliasValue !== 'string') return null
  // path.join handles cross-platform separator normalisation (POSIX/Windows). Replace any
  // explicit `\\` in the stored subpath with `sep` for predictability.
  return join(aliasValue, ...subpath.split(/[\\/]/).filter((seg) => seg.length > 0))
}

/** Path module separator constant — re-exported for clarity in callers/tests. */
export const PATH_SEPARATOR = sep

/**
 * Читает meta из context.json в указанной папке.
 */
function readManifestMeta(folderPath: string): boolean {
  const manifestPath = join(folderPath, MANIFEST_FILENAME)
  if (!existsSync(manifestPath)) return false
  try {
    const data = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    return data.meta === true
  } catch {
    return false
  }
}

/**
 * Восстанавливает инвариант «первый элемент списка = meta». Все остальные манифесты
 * получают `meta: false` (поле удаляется). См. spec/PRODUCT.md и host/spec/COMPONENT.md
 * → Root Contexts → Meta required.
 *
 * Идемпотентен: если состояние диска уже правильное, ничего не пишется.
 *
 * Self-healing: отсутствующий context.json создаётся с `{version: 2, name: basename(folder)}`.
 * Невалидный JSON бросает ошибку — пользовательский манифест нельзя молча затирать.
 *
 * Атомарность two-write при смене meta. Когда нужно одновременно убрать meta у одной
 * папки и поставить у другой, мы:
 *   1) Готовим обе новые версии в памяти.
 *   2) Пишем `.tmp` для обеих.
 *   3) Последовательно rename'им; если второй rename падает — откатываем первый из бэкапа.
 * Полная FS-атомарность (один-syscall на двух файлах) недоступна на POSIX, но окно
 * рассогласованности сжато до одного rename(2), а данные защищены бэкапом.
 */
export function enforceMetaInvariant(folders: RootContextEntry[]): void {
  if (folders.length === 0) return

  type Plan = {
    manifestPath: string
    nextData: Record<string, unknown>
    prevRaw: string | null
    needsWrite: boolean
  }

  const plans: Plan[] = []
  for (let i = 0; i < folders.length; i++) {
    const folderPath = folders[i].resolved
    // Folder may not exist on disk yet (newly-aliased path the user hasn't created,
    // or a folder lost after a Drive re-sync). Skip — UI will surface "path lost"
    // elsewhere; trying to self-heal a non-existent parent dir would just throw.
    if (!existsSync(folderPath)) continue

    const manifestPath = join(folderPath, MANIFEST_FILENAME)
    const shouldBeMeta = i === 0

    let prevRaw: string | null = null
    let data: Record<string, unknown> | null = null
    if (existsSync(manifestPath)) {
      prevRaw = readFileSync(manifestPath, 'utf-8')
      try {
        data = JSON.parse(prevRaw)
        if (!data || typeof data !== 'object' || Array.isArray(data)) data = null
      } catch {
        data = null
      }
      if (data === null) {
        // Malformed manifest — skip silently. The migration sweep surfaces this as a
        // per-context error; enforcing meta on top of unparseable JSON would either
        // throw or silently overwrite user data, both worse than skipping.
        continue
      }
    } else {
      data = { version: 2, name: basename(folderPath) }
    }

    const currentMeta = data.meta === true
    if (shouldBeMeta) {
      data.meta = true
    } else {
      delete data.meta
    }
    if (typeof data.version !== 'number') data.version = 2

    const needsWrite =
      prevRaw === null || // self-heal
      shouldBeMeta !== currentMeta // meta flag changed

    plans.push({ manifestPath, nextData: data, prevRaw, needsWrite })
  }

  const writes = plans.filter((p) => p.needsWrite)
  if (writes.length === 0) return

  // Phase 1: stage all .tmp files. If any stage fails, clean up tmp files written so far
  // and rethrow. No target file has been touched yet.
  const staged: string[] = []
  try {
    for (const w of writes) {
      const tmpPath = `${w.manifestPath}.tmp`
      writeFileSync(tmpPath, JSON.stringify(w.nextData, null, 2) + '\n', 'utf-8')
      staged.push(tmpPath)
    }
  } catch (e) {
    for (const tmp of staged) {
      try {
        unlinkSync(tmp)
      } catch {
        // best-effort cleanup
      }
    }
    throw e
  }

  // Phase 2: rename in sequence. If a rename fails after we already swapped earlier files,
  // restore those from their pre-write backup so the disk reflects a consistent state.
  const completed: { manifestPath: string; prevRaw: string | null }[] = []
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i]
    try {
      renameSync(`${w.manifestPath}.tmp`, w.manifestPath)
      completed.push({ manifestPath: w.manifestPath, prevRaw: w.prevRaw })
    } catch (e) {
      // Roll back any earlier successful renames.
      for (const c of completed.reverse()) {
        try {
          if (c.prevRaw === null) {
            unlinkSync(c.manifestPath) // we self-healed it; remove
          } else {
            writeFileSync(c.manifestPath, c.prevRaw, 'utf-8')
          }
        } catch {
          // best-effort
        }
      }
      // Clean up any remaining staged tmp files.
      for (let j = i; j < writes.length; j++) {
        try {
          unlinkSync(`${writes[j].manifestPath}.tmp`)
        } catch {
          // best-effort
        }
      }
      throw e
    }
  }
}

/**
 * Сохраняет root_context_folders в settings.json (перезаписывает массив целиком).
 *
 * После записи восстанавливает meta-инвариант («первый элемент = meta»). Это покрывает:
 * - drag-and-drop reorder (включая drag-to-position-0);
 * - удаление текущей meta-папки (новая первая получает meta автоматически).
 */
export function saveRootContextFolders(folders: string[]): void {
  setSettingsConfigKey(SETTINGS_KEY, folders)
  enforceMetaInvariant(getResolvedRootContextFolders())
}

// =============================================================================
// ADD ROOT CONTEXT (with alias creation)
// =============================================================================

/**
 * Добавляет корневой контекст через `@alias` механизм.
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
 * 5. Записываем alias в `{machine}.json`, добавляем в `root_context_folders`.
 *
 * Возвращает обновлённый список `RootContextEntry[]` для рендера.
 *
 * @throws Error если pointer-конфиг неполный (отсутствует duetConfigPath
 *   или machine, или machine name невалидный) — silent fail здесь оставит
 *   систему в несогласованном состоянии.
 */
export function addRootContextFolder(absolutePath: string): RootContextEntry[] {
  const cfg = readConfig()
  if (!cfg.duetConfigPath) {
    throw new Error('Cannot add root context: duetConfigPath is not set in pointer config.')
  }
  if (!cfg.machine || !isValidMachineName(cfg.machine)) {
    throw new Error(
      'Cannot add root context: machine name is not set or invalid in pointer config.'
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

  // Добавить в root_context_folders в settings.json (без дубликата)
  const current = getRootContextFolders()
  if (!current.includes(alias)) {
    setSettingsConfigKey(SETTINGS_KEY, [...current, alias])
  }

  // Восстановить meta-инвариант: при добавлении первой папки она автоматически становится
  // meta-контекстом; при добавлении в непустой список — no-op (первый уже остался первым).
  const resolved = getResolvedRootContextFolders()
  enforceMetaInvariant(resolved)
  return getResolvedRootContextFolders()
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

/**
 * Path to entity-tree cache relative to DuetData root.
 *
 * Имя файла — sister node `implement-backend-rename` решает (rename `streams.json` → `contexts.json`
 * — синхронно с rename БД-колонок и API endpoint). Здесь мы читаем то имя, которое выберет backend.
 * До обновления backend имя останется `streams.json` — старое чтение упадёт на null без ошибки.
 */
const CONTEXTS_CACHE_FILE = join('data', 'contexts.json')

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
 * Читает дерево сущностей из кэша (DuetData/data/contexts.json).
 * Возвращает null если файла нет или невалидный JSON.
 */
export function readCachedContexts(duetDataPath: string): ContextsCache | null {
  const filePath = join(duetDataPath, CONTEXTS_CACHE_FILE)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ContextsCache
  } catch {
    return null
  }
}

// =============================================================================
// SCAN
// =============================================================================

/**
 * Вызывает POST /scan на Backend.
 * Backend сканирует root_context_folders, записывает scan.json,
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
