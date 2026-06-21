/*
 * ЧТО: Управление AI-инструкциями (merge, errors, cached content).
 * ЗАЧЕМ: Host вызывает Backend POST /merge-duet-instructions, результат —
 *        per-agent файлы DuetData/duet-{agent}.md + ошибки в DuetData/data/.
 * КТО ИСПОЛЬЗУЕТ: ipc-handlers (IPC instructions:*), core/ai-clients.ts.
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { InstructionsMergeResult, InstructionsError } from '../shared/types'

// Re-export types
export type { InstructionsMergeResult, InstructionsError } from '../shared/types'

/** Logical agent names for which Backend produces a merged file. */
export type AgentName = 'executor' | 'vizir'
export const AGENT_NAMES: readonly AgentName[] = ['executor', 'vizir'] as const

/** Filename of the thin session prompt (bootstrapper + skills, no core). */
export const SESSION_PROMPT_FILE = 'duet.md'

/** Bag of merged content read from disk. */
export interface MergedAgents {
  /** Thin session prompt (`duet.md`): Claude output-style + Codex/Antigravity system prompt. */
  sessionPrompt: string | null
  /** Full agent cores for the `duet-{agent}` subagents. */
  executor: string | null
  vizir: string | null
}

/** Filename of an agent's merged file under DuetData root. */
export function mergedAgentFilename(agent: AgentName): string {
  return `duet-${agent}.md`
}

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
        paths: {},
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
      paths: {},
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
 * Читает merged content одного агента с диска (DuetData/duet-{agent}.md).
 * Возвращает null если файла нет или I/O упал.
 */
export function readMergedAgent(duetDataPath: string, agent: AgentName): string | null {
  const filePath = join(duetDataPath, mergedAgentFilename(agent))
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Читает все merged-файлы из DuetData в один bag.
 * Каждое поле может быть null если файла нет.
 */
export function readMergedAgents(duetDataPath: string): MergedAgents {
  return {
    sessionPrompt: readSessionPrompt(duetDataPath),
    executor: readMergedAgent(duetDataPath, 'executor'),
    vizir: readMergedAgent(duetDataPath, 'vizir')
  }
}

/**
 * Читает тонкий сессионный промпт (DuetData/duet.md) с диска.
 * Возвращает null если файла нет или I/O упал.
 */
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
