/** Build and read the shared platform prompt and its diagnostic cache. */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { InstructionsMergeResult, InstructionsError } from '../shared/types'

// Re-export types
export type { InstructionsMergeResult, InstructionsError } from '../shared/types'

/** Filename of the platform session prompt. */
export const SESSION_PROMPT_FILE = 'duet.md'

/** Path to errors cache relative to DuetData root. */
const ERRORS_CACHE_FILE = join('data', 'duet-instructions-errors.json')

// =============================================================================
// MERGE
// =============================================================================

/** Ask Backend to rebuild DuetData/duet.md and its error cache. */
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
        output_style: null,
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
      output_style: null,
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

/** Read the platform prompt, returning null when it is unavailable. */
export function readSessionPrompt(duetDataPath: string): string | null {
  const filePath = join(duetDataPath, SESSION_PROMPT_FILE)
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

// =============================================================================
// CACHED ERRORS
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
