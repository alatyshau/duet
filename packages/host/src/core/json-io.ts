/*
 * ЧТО: Атомарные read/write для JSON-файлов Host'а.
 * ЗАЧЕМ: pointer / settings / machine config / context manifests — все чтения/записи должны
 *        быть atomic, иначе сбой при Drive sync, kill, OOM оставляет битый файл и
 *        пользовательские данные теряются.
 * КТО ИСПОЛЬЗУЕТ: core/config.ts, core/root-contexts.ts, core/schema-migrations.ts.
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { renameSync, writeFileSync, readFileSync } from 'fs'

/**
 * Атомарная запись JSON: write to .tmp → rename. POSIX rename(2) atomic on same FS.
 * При сбое до rename'а — на диске только .tmp, оригинал цел. После — старого имени уже нет.
 *
 * Не fsync — современные FS на macOS/Linux + Drive sync дают достаточные гарантии для
 * пользовательских конфигов. Дублирующиеся .tmp от прерванной записи перезатираются на
 * следующем запуске.
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
  renameSync(tmpPath, filePath)
}

/**
 * Strict JSON read: возвращает либо успешный parse, либо причину ошибки.
 * Caller сам решает — fallback к {} для graceful degradation, или surface как critical.
 *
 * Отличается от `try { JSON.parse(readFileSync(...)) } catch { return null }` тем, что
 * различает «файла нет», «прочитать не получилось» и «JSON битый» — это нужно для
 * pointer-валидации в startup-миграции.
 */
export function readJsonStrict(
  filePath: string
): { kind: 'ok'; data: unknown } | { kind: 'missing' } | { kind: 'read_failed'; error: string } | { kind: 'invalid_json'; error: string } {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'read_failed', error: err.message ?? String(err) }
  }
  try {
    return { kind: 'ok', data: JSON.parse(raw) }
  } catch (e) {
    return { kind: 'invalid_json', error: e instanceof Error ? e.message : String(e) }
  }
}
