/*
 * ЧТО: Сервис деплоя AI instructions и backend в DuetData.
 * ЗАЧЕМ: Host — единая точка установки. VERSION check → deploy если изменилось.
 * КТО ИСПОЛЬЗУЕТ: main process при запуске и по кнопке "Установить".
 *
 * АРХИТЕКТУРА:
 * - Bundled resources в process.resourcesPath (extraResources в electron-builder)
 * - AI instructions: простой copy → DuetData/ai-instructions/
 * - Backend: atomic swap (.new → rename) → DuetData/backend/
 * - Post-deploy: Python check, venv, pip install (async)
 * - VERSION file: app version → DuetData/backend/VERSION
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'

import type { AppState, DeployStatus, PythonStatus } from '../shared/types'

// Re-export IPC type (source of truth: shared/types.ts)
export type { DeployStatus } from '../shared/types'

// =============================================================================
// ТИПЫ (internal, не пересекают IPC)
// =============================================================================

export interface DeployPaths {
  /** process.resourcesPath (extraResources root) */
  resourcesPath: string
  /** DuetData root */
  duetDataPath: string
  /** App version (from package.json via app.getVersion()) */
  appVersion: string
  /** Dev override: direct path to ai-instructions source dir (bypasses resourcesPath) */
  instructionsSourcePath?: string
  /** Dev override: direct path to backend source dir (bypasses resourcesPath) */
  backendSourcePath?: string
}

export type LogFn = (message: string) => void

export interface StopOptions {
  /** Injectable sleep for testability. Default: real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>
}

// =============================================================================
// VERSION CHECK
// =============================================================================

/**
 * Читает текущую VERSION из DuetData/backend/VERSION.
 * Возвращает null если файла нет.
 */
export const readDeployedVersion = (duetDataPath: string): string | null => {
  const versionPath = join(duetDataPath, 'backend', 'VERSION')
  if (!existsSync(versionPath)) return null
  try {
    return readFileSync(versionPath, 'utf-8').trim()
  } catch {
    return null
  }
}

/**
 * Проверяет, нужен ли деплой.
 * true только если app version > deployed version (upgrade).
 * Downgrade и equal → false.
 * Отсутствие VERSION файла → первый деплой → true.
 */
export const isDeployNeeded = (paths: DeployPaths): boolean => {
  const deployed = readDeployedVersion(paths.duetDataPath)
  if (deployed === null) return true
  return compareSemver(paths.appVersion, deployed) > 0
}

// =============================================================================
// DEPLOY STATUS RESOLUTION (pure logic, no Electron)
// =============================================================================

/**
 * Определяет текущий DeployStatus на основе AppState и версии.
 * Используется IPC handler'ом deploy:get-status.
 *
 * @param appState — текущее состояние приложения
 * @param appVersion — версия приложения (app.getVersion())
 * @param activeStatus — текущий статус деплоя (idle/deploying/error)
 */
export const resolveDeployStatus = (
  appState: AppState,
  appVersion: string,
  activeStatus: DeployStatus
): DeployStatus => {
  if (appState.status !== 'ready' || !appState.duetDataPath) {
    return { state: 'idle' }
  }

  const deployedVersion = readDeployedVersion(appState.duetDataPath)

  // up_to_date: deployed >= app (equal or newer, e.g. downgrade scenario)
  if (deployedVersion !== null && compareSemver(deployedVersion, appVersion) >= 0) {
    return { state: 'up_to_date', version: deployedVersion }
  }

  // Upgrade needed: show active status if deploying, otherwise idle
  return activeStatus.state === 'idle'
    ? { state: 'idle' }
    : activeStatus
}

/**
 * Определяет, нужно ли показывать warning в tray (VERSION mismatch).
 * Используется main/index.ts для updateTrayIcon.
 */
export const isDeployWarning = (appState: AppState, appVersion: string): boolean => {
  if (appState.status !== 'ready' || !appState.duetDataPath) {
    return false
  }
  const deployed = readDeployedVersion(appState.duetDataPath)
  if (deployed === null) return true
  return compareSemver(appVersion, deployed) > 0
}

// =============================================================================
// STOP BACKEND (before deploy)
// =============================================================================

const STOP_API_TIMEOUT_MS = 2_000
const STOP_GRACE_PERIOD_MS = 3_000
const KILL_GRACE_PERIOD_MS = 1_000

/**
 * Останавливает запущенный бэкенд перед деплоем.
 * Flow: POST /stop → wait 3s → check PID → SIGTERM → wait 1s → SIGKILL.
 * Ошибки не прерывают деплой (бэкенд может быть не запущен).
 */
export const stopBackend = async (duetDataPath: string, port: number, log: LogFn, opts?: StopOptions): Promise<void> => {
  const _sleep = opts?.sleep ?? sleep

  // 1. Try graceful stop via API
  try {
    const response = await fetch(`http://127.0.0.1:${port}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(STOP_API_TIMEOUT_MS)
    })
    if (response.ok) {
      log('Остановка backend...')
      await _sleep(STOP_GRACE_PERIOD_MS)
    }
  } catch {
    // Backend not running or not responding — continue
  }

  // 2. Kill by PID if still alive
  await killByPid(duetDataPath, log, _sleep)
}

const killByPid = async (duetDataPath: string, log: LogFn, _sleep: (ms: number) => Promise<void>): Promise<void> => {
  const pidPath = join(duetDataPath, '.pid')
  if (!existsSync(pidPath)) return

  try {
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10)
    if (isNaN(pid)) return
    if (!isProcessAlive(pid)) return

    log(`Завершение процесса ${pid}...`)
    process.kill(pid, 'SIGTERM')
    await _sleep(KILL_GRACE_PERIOD_MS)

    if (isProcessAlive(pid)) {
      process.kill(pid, 'SIGKILL')
      await _sleep(500)
    }
  } catch {
    // Process might not exist
  }
}

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

// =============================================================================
// DEPLOY AI INSTRUCTIONS
// =============================================================================

/**
 * Деплоит AI instructions в DuetData/ai-instructions/.
 * Source: instructionsSourcePath (dev override) или resourcesPath/ai-instructions (default).
 * Простой recursive copy (не atomic — инструкции read-only для AI агентов).
 */
export const deployInstructions = (paths: DeployPaths, log: LogFn): void => {
  const src = paths.instructionsSourcePath || join(paths.resourcesPath, 'ai-instructions')
  const dest = join(paths.duetDataPath, 'ai-instructions')

  if (!existsSync(src)) {
    throw new Error(`AI instructions source not found: ${src}`)
  }

  log('Копирование AI инструкций...')

  // Создаём целевую папку
  mkdirSync(dest, { recursive: true })

  // Recursive copy (overwrite)
  cpSync(src, dest, { recursive: true, force: true })

  const count = countFiles(dest)
  log(`AI инструкции: ${count} файлов`)
}

// =============================================================================
// DEPLOY BACKEND
// =============================================================================

/**
 * Деплоит backend в DuetData/backend/.
 * Source: backendSourcePath (dev override) или resourcesPath/backend (default).
 * Использует atomic swap: copy → .new → rename (.old → delete).
 * Crash-safe: если крэш между rename — .old остаётся, cleanup при следующем запуске.
 */
export const deployBackend = (paths: DeployPaths, log: LogFn): void => {
  const src = paths.backendSourcePath || join(paths.resourcesPath, 'backend')
  const dest = join(paths.duetDataPath, 'backend')
  const destNew = dest + '.new'
  const destOld = dest + '.old'

  if (!existsSync(src)) {
    throw new Error(`Backend source not found: ${src}`)
  }

  log('Копирование backend...')

  // Cleanup stale .new/.old from previous failed deploy
  if (existsSync(destNew)) rmSync(destNew, { recursive: true, force: true })
  if (existsSync(destOld)) rmSync(destOld, { recursive: true, force: true })

  // Copy to .new
  mkdirSync(destNew, { recursive: true })
  cpSync(src, destNew, { recursive: true, force: true })

  // Atomic swap
  if (existsSync(dest)) {
    renameSync(dest, destOld)
  }
  renameSync(destNew, dest)

  // Cleanup .old
  if (existsSync(destOld)) {
    rmSync(destOld, { recursive: true, force: true })
  }

  const count = countFiles(dest)
  log(`Backend: ${count} файлов`)
}

// =============================================================================
// WRITE VERSION
// =============================================================================

/**
 * Записывает VERSION файл в DuetData/backend/VERSION.
 */
export const writeVersion = (paths: DeployPaths): void => {
  const versionPath = join(paths.duetDataPath, 'backend', 'VERSION')
  mkdirSync(join(paths.duetDataPath, 'backend'), { recursive: true })
  writeFileSync(versionPath, paths.appVersion, 'utf-8')
}

// =============================================================================
// PYTHON CHECK + VENV + PIP
// =============================================================================

const MIN_PYTHON_VERSION: [number, number] = [3, 10]

/**
 * Возвращает путь к Python внутри venv (platform-aware).
 * Windows: Scripts/python.exe, Unix: bin/python3.
 */
export const venvPythonPath = (venvDir: string, platform: NodeJS.Platform = process.platform): string => {
  return platform === 'win32'
    ? join(venvDir, 'Scripts', 'python.exe')
    : join(venvDir, 'bin', 'python3')
}

/**
 * Возвращает подсказку по установке Python для платформы.
 */
export const pythonInstallHint = (platform: NodeJS.Platform = process.platform): string => {
  if (platform === 'win32') return 'Скачайте с python.org'
  if (platform === 'darwin') return 'brew install python@3.12'
  return 'Установите через пакетный менеджер (apt/dnf)'
}

/**
 * Находит Python 3.10+ в системе.
 * Возвращает путь к интерпретатору или null.
 * Windows: python, py. Unix/macOS: python3, python + well-known brew paths.
 *
 * NOTE: Electron apps launched from Finder/Spotlight get minimal PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin). Homebrew paths are NOT included,
 * so we explicitly check /opt/homebrew/bin (Apple Silicon) and /usr/local/bin (Intel).
 */
export const findPython = async (platform: NodeJS.Platform = process.platform): Promise<string | null> => {
  const candidates = platform === 'win32'
    ? ['python', 'py']
    : [
        'python3', 'python',
        // Explicit brew paths for macOS Electron (Finder/Spotlight PATH is minimal)
        '/opt/homebrew/bin/python3',   // Apple Silicon
        '/usr/local/bin/python3',      // Intel
      ]

  for (const cmd of candidates) {
    try {
      const version = await execAsync(cmd, ['--version'])
      const match = version.match(/Python (\d+)\.(\d+)/)
      if (match) {
        const major = parseInt(match[1])
        const minor = parseInt(match[2])
        if (major > MIN_PYTHON_VERSION[0] || (major === MIN_PYTHON_VERSION[0] && minor >= MIN_PYTHON_VERSION[1])) {
          return cmd
        }
      }
    } catch {
      // not found, try next
    }
  }

  return null
}

/**
 * Проверяет конкретный путь к Python: запускает --version, парсит результат.
 * Возвращает PythonStatus ('found' или 'invalid').
 */
export const validatePython = async (pythonPath: string): Promise<PythonStatus> => {
  try {
    const output = await execAsync(pythonPath, ['--version'])
    const match = output.match(/Python (\d+)\.(\d+)\.?(\d*)/)
    if (!match) {
      return { state: 'invalid', path: pythonPath, error: 'Не удалось определить версию' }
    }
    const major = parseInt(match[1])
    const minor = parseInt(match[2])
    const version = `${major}.${minor}${match[3] ? '.' + match[3] : ''}`

    if (major < MIN_PYTHON_VERSION[0] || (major === MIN_PYTHON_VERSION[0] && minor < MIN_PYTHON_VERSION[1])) {
      return { state: 'invalid', path: pythonPath, error: `Python ${version} слишком старый (нужен 3.10+)` }
    }

    return { state: 'found', path: pythonPath, version }
  } catch {
    return { state: 'invalid', path: pythonPath, error: 'Файл не найден или не является Python' }
  }
}

/**
 * Создаёт venv и устанавливает зависимости.
 * venv живёт в DuetData/.venv/
 */
export const setupVenv = async (paths: DeployPaths, pythonCmd: string, log: LogFn): Promise<void> => {
  const venvPath = join(paths.duetDataPath, '.venv')
  const venvPython = venvPythonPath(venvPath)
  const requirementsPath = join(paths.duetDataPath, 'backend', 'requirements.txt')

  // Создаём venv если не существует
  if (!existsSync(venvPython)) {
    log('Создание Python venv...')
    await execAsync(pythonCmd, ['-m', 'venv', venvPath])
    log('venv создан')
  }

  // pip install
  if (existsSync(requirementsPath)) {
    log('Установка Python зависимостей...')
    await execAsync(venvPython, ['-m', 'pip', 'install', '-q', '-r', requirementsPath])
    log('Зависимости установлены')
  }
}

// =============================================================================
// FULL DEPLOY
// =============================================================================

/**
 * Полный деплой: stop backend + instructions + backend + venv + version.
 * Вызывается из main process.
 *
 * pythonCmd — путь к Python, определённый ДО деплоя через UI (python:detect / python:validate).
 * Файлы копируются всегда. VERSION записывается только если всё ОК.
 */
export const runDeploy = async (paths: DeployPaths, port: number, pythonCmd: string, log: LogFn, opts?: StopOptions): Promise<void> => {
  log(`Деплой v${paths.appVersion}...`)

  // 0. Stop running backend before file operations
  await stopBackend(paths.duetDataPath, port, log, opts)

  // 1. Deploy AI instructions (always)
  deployInstructions(paths, log)

  // 2. Deploy backend files (always, atomic swap)
  deployBackend(paths, log)

  // 3. Setup venv + pip install
  log(`Python: ${pythonCmd}`)
  await setupVenv(paths, pythonCmd, log)

  // 4. Write VERSION only after full success
  writeVersion(paths)
  log(`VERSION: ${paths.appVersion}`)

  log(`Деплой v${paths.appVersion} завершён`)
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Сравнивает два semver (major.minor.patch).
 * Возвращает: 1 если a > b, -1 если a < b, 0 если равны.
 * Невалидные строки трактуются как 0.0.0.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): [number, number, number] => {
    const parts = v.split('.').map(Number)
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
  }
  const [aMajor, aMinor, aPatch] = parse(a)
  const [bMajor, bMinor, bPatch] = parse(b)

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
  return 0
}

function countFiles(dir: string): number {
  let count = 0
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += countFiles(join(dir, entry.name))
    } else {
      count++
    }
  }
  return count
}

function execAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} failed: ${error.message}\n${stderr}`))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}
