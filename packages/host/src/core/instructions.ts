/*
 * ЧТО: Управление AI-инструкциями (merge, errors, cached content).
 * ЗАЧЕМ: Host вызывает Backend POST /merge-duet-instructions, результат —
 *        файл DuetData/duet-instructions.md + ошибки в DuetData/data/.
 * КТО ИСПОЛЬЗУЕТ: ipc-handlers (IPC instructions:*), core/ai-clients.ts.
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import type { InstructionsMergeResult, InstructionsError } from '../shared/types'

// Re-export types
export type { InstructionsMergeResult, InstructionsError } from '../shared/types'

/** Path to merged instructions file relative to DuetData root. */
const MERGED_INSTRUCTIONS_FILE = 'duet-instructions.md'

/** Path to errors cache relative to DuetData root. */
const ERRORS_CACHE_FILE = join('data', 'duet-instructions-errors.json')

// =============================================================================
// MERGE
// =============================================================================

/**
 * Вызывает POST /merge-duet-instructions на Backend.
 * Backend генерит DuetData/duet-instructions.md + errors cache.
 */
export async function triggerMerge(port: number): Promise<InstructionsMergeResult> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/merge-duet-instructions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000)
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return {
        status: 'error',
        path: null,
        errors: [
          {
            path: '',
            reason_code: 'backend_error',
            description: (body as Record<string, string>).error || `HTTP ${res.status}`
          }
        ]
      }
    }

    return (await res.json()) as InstructionsMergeResult
  } catch (e) {
    return {
      status: 'error',
      path: null,
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

// =============================================================================
// CACHED DATA
// =============================================================================

/**
 * Читает merged instructions с диска (DuetData/duet-instructions.md).
 * Возвращает null если файла нет.
 */
export function readMergedInstructions(duetDataPath: string): string | null {
  const filePath = join(duetDataPath, MERGED_INSTRUCTIONS_FILE)
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// =============================================================================
// FIX ERRORS
// =============================================================================

/** Reason codes that can be auto-fixed. */
const FIXABLE_REASON_CODES = new Set(['no_frontmatter', 'invalid_yaml', 'missing_fields'])

/** Check if an instructions error can be auto-fixed. */
export function isFixableError(reasonCode: string): boolean {
  return FIXABLE_REASON_CODES.has(reasonCode)
}

/**
 * Auto-fix an instructions error by modifying the source file.
 * Returns true if fix was applied, false if not applicable.
 */
export function fixInstructionsError(
  instructionsPath: string,
  relativePath: string,
  reasonCode: string
): boolean {
  if (!isFixableError(reasonCode)) return false

  const filePath = join(instructionsPath, relativePath)
  if (!existsSync(filePath)) return false

  const content = readFileSync(filePath, 'utf-8')
  const stem = basename(relativePath, '.md')

  let fixed: string

  switch (reasonCode) {
    case 'no_frontmatter':
      fixed = `---\nname: ${stem}\ndescription: \n---\n${content}`
      break

    case 'invalid_yaml': {
      // Replace existing broken frontmatter with valid template
      const match = content.match(/^---\n[\s\S]*?\n---\n?/)
      if (match) {
        fixed = `---\nname: ${stem}\ndescription: \n---\n${content.slice(match[0].length)}`
      } else {
        fixed = `---\nname: ${stem}\ndescription: \n---\n${content}`
      }
      break
    }

    case 'missing_fields': {
      // Parse existing frontmatter, add missing name/description
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?/)
      if (!fmMatch) return false
      const fmBody = fmMatch[1]
      const rest = content.slice(fmMatch[0].length)
      const lines = fmBody.split('\n')
      const hasName = lines.some((l) => l.startsWith('name:'))
      const hasDesc = lines.some((l) => l.startsWith('description:'))
      if (!hasName) lines.push(`name: ${stem}`)
      if (!hasDesc) lines.push('description: ')
      fixed = `---\n${lines.join('\n')}\n---\n${rest}`
      break
    }

    default:
      return false
  }

  writeFileSync(filePath, fixed, 'utf-8')
  return true
}

// =============================================================================
// CACHED DATA
// =============================================================================

/**
 * Читает ошибки из кэша (DuetData/data/duet-instructions-errors.json).
 * Возвращает null если файла нет (merge never ran), массив если кэш существует.
 */
export function readCachedErrors(duetDataPath: string): InstructionsError[] | null {
  const filePath = join(duetDataPath, ERRORS_CACHE_FILE)
  if (!existsSync(filePath)) return null
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}
