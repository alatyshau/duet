/*
 * ЧТО: Lifecycle-менеджмент Python backend.
 * ЗАЧЕМ: Host — единственный владелец spawn/stop/health бэкенда.
 * КТО ИСПОЛЬЗУЕТ: main process при запуске, деплое, выходе + IPC handlers.
 *
 * АРХИТЕКТУРА:
 * - Чистые функции (без Electron imports) — тестируемо с plain Node.js.
 * - spawn(venvPython, [server.py]) → attached child, stderr piped for diagnostics.
 * - Health check через GET /health (fetch + AbortSignal.timeout).
 * - Stop: POST /stop → grace → SIGTERM → SIGKILL.
 */
import { existsSync, appendFileSync } from 'fs'
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
// Budget ≈ RETRY_COUNT × RETRY_DELAY ≈ 12s. Backend binds the port fast
// (initial scan runs in background), but cold Python start + imports on a
// busy machine can exceed a short budget. Real crashes still fail fast via
// the earlyExit race in startBackend.
const HEALTH_RETRY_COUNT = 40
const HEALTH_RETRY_DELAY_MS = 300
const STDERR_MAX_LINES = 50

const STOP_API_TIMEOUT_MS = 2_000
const STOP_GRACE_PERIOD_MS = 2_000 // Backend SHUTDOWN_TIMEOUT_S (1s) + 1s margin
const KILL_GRACE_PERIOD_MS = 1_000

// =============================================================================
// TYPES (internal, не пересекают IPC)
// =============================================================================

export interface StopOptions {
  /** Injectable sleep for testability (used when no proc reference). */
  sleep?: (ms: number) => Promise<void>
}

interface HealthResponse {
  status: 'ok'
  version: string
  uptime_seconds: number
}

// =============================================================================
// HOST-SIDE BACKEND LOG
// =============================================================================

/**
 * Дописывает строку в DuetData/backend.log от имени хоста (тег [host]).
 *
 * ЗАЧЕМ: когда хост убивает бэкенд (health timeout → SIGTERM/SIGKILL),
 * сам бэкенд ничего залогировать не может — лог просто обрывается.
 * След обязан оставить хост, в том же файле, куда смотрят при диагностике.
 * Формат таймстампа совпадает с Python-логгером (локальное время).
 */
export const appendBackendLog = (
  duetDataPath: string,
  level: 'INFO' | 'WARNING' | 'ERROR',
  message: string
): void => {
  try {
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    appendFileSync(join(duetDataPath, 'backend.log'), `${ts} [${level}] [host] ${message}\n`)
  } catch {
    // Логирование не должно ломать lifecycle-менеджмент
  }
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
 * stderr пайпится для диагностики: если процесс упал, текст ошибки
 * попадает в throw и далее в BackendStatus.error → UI.
 *
 * NOTE: Не вешает proc.on('exit'/'error') — мониторинг после старта
 * это ответственность caller'а (см. monitorBackendProcess в ipc-handlers).
 */
export const startBackend = async (duetDataPath: string, port: number): Promise<ChildProcess> => {
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
    stdio: ['ignore', 'ignore', 'pipe']
  })

  // Collect stderr for diagnostics (ring buffer, last N lines)
  const stderrLines: string[] = []
  proc.stderr!.setEncoding('utf-8')
  proc.stderr!.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (line.trim()) stderrLines.push(line.trim())
    }
    if (stderrLines.length > STDERR_MAX_LINES) {
      stderrLines.splice(0, stderrLines.length - STDERR_MAX_LINES)
    }
  })

  // Detect early exit — short-circuits health polling if process dies
  const earlyExit = new Promise<null>((resolve) => {
    proc.on('exit', () => resolve(null))
  })

  // Race: health polling vs early process death
  const health = await Promise.race([
    waitForHealth(port),
    earlyExit
  ])

  if (!health) {
    // Timeout case (process still alive) vs crash case (died on its own)
    const timedOut = proc.exitCode === null
    if (timedOut) {
      try {
        proc.kill('SIGTERM')
        const exited = await waitForExit(proc, KILL_GRACE_PERIOD_MS)
        if (!exited) proc.kill('SIGKILL')
      } catch {
        // Process may have already exited
      }
    }

    // Honest reason first, stderr tail as context — stderr alone is
    // misleading (it is mostly INFO log lines, not the actual error).
    const budgetS = Math.round((HEALTH_RETRY_COUNT * HEALTH_RETRY_DELAY_MS) / 1000)
    const reason = timedOut
      ? `Backend не ответил на /health за ~${budgetS}с — процесс остановлен хостом (SIGTERM/SIGKILL)`
      : `Backend завершился при запуске (код ${proc.exitCode})`
    // Durable trace: the killed backend can't log its own death
    appendBackendLog(duetDataPath, 'ERROR', reason)

    const stderr = stderrLines.join('\n')
    throw new Error(stderr ? `${reason}\n--- stderr ---\n${stderr}` : reason)
  }

  // Startup succeeded — close stderr pipe (backend logs to file from here)
  proc.stderr!.destroy()

  return proc
}

// =============================================================================
// STOP BACKEND
// =============================================================================

/**
 * Останавливает бэкенд: POST /stop → SIGTERM → SIGKILL.
 * Host — единственный владелец lifecycle. Гарантирует смерть процесса.
 * Ошибки не пробрасываются (бэкенд может быть не запущен).
 */
export const stopBackend = async (
  port: number,
  proc?: ChildProcess | null,
  opts?: StopOptions
): Promise<void> => {
  const _sleep = opts?.sleep ?? sleep

  // 1. Graceful: POST /stop
  try {
    await fetch(`http://127.0.0.1:${port}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(STOP_API_TIMEOUT_MS)
    })
    // Wait for process to exit after /stop
    if (proc) {
      await waitForExit(proc, STOP_GRACE_PERIOD_MS)
    } else {
      await _sleep(STOP_GRACE_PERIOD_MS) // No proc reference — blind wait
    }
  } catch {
    // Backend not running or not responding — proceed to kill
  }

  if (!proc) return
  if (proc.exitCode !== null) return // Already dead from POST /stop

  // 2. SIGTERM
  proc.kill('SIGTERM')
  await waitForExit(proc, KILL_GRACE_PERIOD_MS)

  // 3. SIGKILL if SIGTERM didn't work
  if (proc.exitCode === null) {
    proc.kill('SIGKILL')
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

/**
 * Ждёт завершения child process с таймаутом.
 * Resolve true — процесс завершился, false — таймаут.
 * Слушает 'exit' event, чистит listener при таймауте (нет утечки).
 */
export const waitForExit = (proc: ChildProcess, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve(true)
    const timer = setTimeout(() => {
      proc.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    function onExit(): void {
      clearTimeout(timer)
      resolve(true)
    }
    proc.once('exit', onExit)
  })
