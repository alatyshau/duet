/*
 * ЧТО: Lifecycle-менеджмент Python backend.
 * ЗАЧЕМ: Host — единственный владелец spawn/stop/health бэкенда.
 * КТО ИСПОЛЬЗУЕТ: main process при запуске, деплое, выходе + IPC handlers.
 *
 * АРХИТЕКТУРА:
 * - Чистые функции (без Electron imports) — тестируемо с plain Node.js.
 * - spawn(venvPython, [server.py]) → attached child, stdio: 'ignore'.
 * - Health check через GET /health (fetch + AbortSignal.timeout).
 * - Stop: POST /stop → grace → SIGTERM → SIGKILL.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'

import type { BackendStatus } from '../shared/types'

// Re-export IPC type (source of truth: shared/types.ts)
export type { BackendStatus } from '../shared/types'

// =============================================================================
// PYTHON PATHS
// =============================================================================

/**
 * Возвращает путь к Python внутри venv (platform-aware).
 * Windows: Scripts/python.exe, Unix: bin/python3.
 */
export const venvPythonPath = (
  venvDir: string,
  platform: NodeJS.Platform = process.platform
): string => {
  return platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python3')
}

// =============================================================================
// CONSTANTS
// =============================================================================

const HEALTH_TIMEOUT_MS = 2_000
const HEALTH_RETRY_COUNT = 10
const HEALTH_RETRY_DELAY_MS = 300

const STOP_API_TIMEOUT_MS = 2_000
const STOP_GRACE_PERIOD_MS = 3_000
const KILL_GRACE_PERIOD_MS = 1_000

// =============================================================================
// TYPES (internal, не пересекают IPC)
// =============================================================================

export interface StopOptions {
  /** Injectable sleep for testability. Default: real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>
}

interface HealthResponse {
  status: 'ok'
  version: string
  uptime_seconds: number
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

/**
 * Проверяет здоровье бэкенда через GET /health.
 * Возвращает данные или null при ошибке/таймауте.
 */
export const checkHealth = async (
  port: number,
  timeoutMs: number = HEALTH_TIMEOUT_MS
): Promise<HealthResponse | null> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return null
    const data = await response.json()
    // Runtime shape validation — prevents false-positive from port conflict
    if (
      data &&
      typeof data === 'object' &&
      data.status === 'ok' &&
      typeof data.version === 'string' &&
      typeof data.uptime_seconds === 'number'
    ) {
      return data as HealthResponse
    }
    return null
  } catch {
    return null
  }
}

/**
 * Ждёт, пока бэкенд станет healthy.
 * Поллит GET /health с задержкой между попытками.
 */
export const waitForHealth = async (
  port: number,
  retries: number = HEALTH_RETRY_COUNT,
  delayMs: number = HEALTH_RETRY_DELAY_MS
): Promise<HealthResponse | null> => {
  for (let i = 0; i < retries; i++) {
    if (i > 0) await sleep(delayMs)
    const health = await checkHealth(port)
    if (health) return health
  }
  return null
}

// =============================================================================
// START BACKEND
// =============================================================================

/**
 * Запускает бэкенд: spawn → waitForHealth.
 * Возвращает ChildProcess reference (для stop).
 * Бросает ошибку если бэкенд не ответил после spawn.
 *
 * NOTE: Не вешает proc.on('exit'/'error') — мониторинг после старта
 * это ответственность caller'а (см. monitorBackendProcess в ipc-handlers).
 */
export const startBackend = async (
  duetDataPath: string,
  port: number
): Promise<ChildProcess> => {
  const backendPath = join(duetDataPath, 'backend')
  const serverPath = join(backendPath, 'server.py')
  const venvPath = join(duetDataPath, '.venv')
  const pythonPath = venvPythonPath(venvPath)

  if (!existsSync(serverPath)) {
    throw new Error('Backend не установлен: server.py не найден')
  }

  if (!existsSync(pythonPath)) {
    throw new Error('Python venv не найден. Запустите деплой.')
  }

  const proc = spawn(pythonPath, [serverPath], {
    cwd: backendPath,
    stdio: 'ignore'
  })

  // Wait for backend to become healthy
  const health = await waitForHealth(port)

  if (!health) {
    // Kill the process we just spawned — it didn't come up
    try {
      proc.kill('SIGTERM')
      await sleep(KILL_GRACE_PERIOD_MS)
      // Escalate to SIGKILL if still alive
      if (!proc.killed) {
        proc.kill('SIGKILL')
      }
    } catch {
      // Process may have already exited
    }
    throw new Error('Backend не ответил после запуска')
  }

  return proc
}

// =============================================================================
// STOP BACKEND
// =============================================================================

/**
 * Останавливает бэкенд через HTTP API.
 * Ошибки не пробрасываются (бэкенд может быть не запущен).
 */
export const stopBackend = async (
  port: number,
  opts?: StopOptions
): Promise<void> => {
  const _sleep = opts?.sleep ?? sleep

  try {
    const response = await fetch(`http://127.0.0.1:${port}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(STOP_API_TIMEOUT_MS)
    })
    if (response.ok) {
      await _sleep(STOP_GRACE_PERIOD_MS)
    }
  } catch {
    // Backend not running or not responding — no-op
  }
}

// =============================================================================
// GET STATUS
// =============================================================================

/**
 * Определяет текущий BackendStatus.
 * Используется IPC handler'ом backend:get-status.
 */
export const getBackendStatus = async (
  duetDataPath: string,
  port: number
): Promise<BackendStatus> => {
  // No VERSION = not installed
  const versionPath = join(duetDataPath, 'backend', 'VERSION')
  if (!existsSync(versionPath)) {
    return { state: 'stopped' }
  }

  // Check health
  const health = await checkHealth(port)
  if (health) {
    return {
      state: 'running',
      version: health.version,
      uptime: health.uptime_seconds
    }
  }

  return { state: 'stopped' }
}

// =============================================================================
// HELPERS
// =============================================================================

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))
