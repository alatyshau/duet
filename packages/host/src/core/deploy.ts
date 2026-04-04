/*
 * ЧТО: Сервис деплоя backend в DuetData.
 * ЗАЧЕМ: Host — единая точка установки. VERSION check → deploy если изменилось.
 * КТО ИСПОЛЬЗУЕТ: main process при запуске и по кнопке "Установить".
 *
 * АРХИТЕКТУРА:
 * - Bundled resources в process.resourcesPath (extraResources в electron-builder)
 * - Backend: atomic swap (.new → rename) → DuetData/backend/
 * - Post-deploy: Python check, venv, pip install (async)
 * - VERSION file: app version → DuetData/backend/VERSION
 * - AI instructions: user-owned repo (configured via instructionsPath in machine.json)
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import {
  existsSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  readdirSync,
  statSync
} from 'fs'
import { join, basename } from 'path'
import { execFile } from 'child_process'

import { stopBackend, startBackend, venvPythonPath } from './backend'
import type { StopOptions } from './backend'
import type { ChildProcess } from 'child_process'
import type { AppState, DeployChannel, DeployStatus, PythonStatus } from '../shared/types'

type LogFn = (message: string) => void

/** Directory names excluded from deploy copy (dev artifacts, not needed at runtime). */
const DEPLOY_EXCLUDE_DIRS = new Set([
  '.venv',
  '__pycache__',
  '.pytest_cache',
  'node_modules',
  '.git'
])

/** cpSync filter: skip dev artifact directories. */
const deployFilter = (src: string): boolean => !DEPLOY_EXCLUDE_DIRS.has(basename(src))

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
  /** Dev override: direct path to backend source dir (bypasses resourcesPath) */
  backendSourcePath?: string
  /** Deploy channel for VERSION metadata. Default: 'prod'. */
  deployChannel?: DeployChannel
}

// =============================================================================
// VERSION METADATA
// =============================================================================

/** Parsed build metadata from VERSION string (e.g. `0.1.8+prod_abc1234`). */
export interface VersionMeta {
  semver: string
  channel: 'prod' | 'dev' | null
  identifier: string | null
}

/** Parse VERSION string: `0.1.8+prod_abc1234` → { semver, channel, identifier }. */
export function parseVersionMeta(version: string): VersionMeta {
  const plusIdx = version.indexOf('+')
  if (plusIdx === -1) {
    return { semver: version, channel: null, identifier: null }
  }
  const semver = version.slice(0, plusIdx)
  const meta = version.slice(plusIdx + 1)
  const underIdx = meta.indexOf('_')
  if (underIdx === -1) {
    return { semver, channel: null, identifier: null }
  }
  const channelStr = meta.slice(0, underIdx)
  const identifier = meta.slice(underIdx + 1)
  const channel = channelStr === 'prod' || channelStr === 'dev' ? channelStr : null
  return { semver, channel, identifier }
}

/** Read BUILD_SHA from bundled resources. Returns null in dev mode (file absent). */
export function readBuildSha(resourcesPath: string): string | null {
  const shaPath = join(resourcesPath, 'BUILD_SHA')
  if (!existsSync(shaPath)) return null
  try {
    return readFileSync(shaPath, 'utf-8').trim()
  } catch {
    return null
  }
}

/** Format deploy timestamp: YYMMDDHHMM (compact, human-readable). */
export function formatDeployTimestamp(date: Date = new Date()): string {
  const yy = String(date.getFullYear()).slice(2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yy}${mm}${dd}${hh}${mi}`
}

/** Parse deploy timestamp YYMMDDHHMM back to Date. Returns null on invalid format. */
export function parseDeployTimestamp(ts: string): Date | null {
  if (ts.length !== 10) return null
  const yy = parseInt(ts.slice(0, 2))
  const mm = parseInt(ts.slice(2, 4)) - 1 // 0-indexed month
  const dd = parseInt(ts.slice(4, 6))
  const hh = parseInt(ts.slice(6, 8))
  const mi = parseInt(ts.slice(8, 10))
  if ([yy, mm + 1, dd, hh, mi].some(isNaN)) return null
  return new Date(2000 + yy, mm, dd, hh, mi)
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
  return activeStatus.state === 'idle' ? { state: 'idle' } : activeStatus
}

/**
 * Определяет, нужно ли показывать warning в tray.
 * Channel-aware: проверяет не только semver, но и соответствие канала деплоя.
 *
 * PROD mode warnings:
 * - No VERSION (never deployed)
 * - Channel is 'dev' in VERSION (dev deploy in prod mode)
 * - Channel is 'prod' but SHA differs from bundled BUILD_SHA (stale build)
 * - App version > deployed semver (upgrade needed, fallback when no buildSha)
 *
 * DEV mode warnings:
 * - No VERSION (never deployed)
 * - Channel is 'prod' in VERSION (prod deploy in dev mode)
 * - Semver differs (version bumped since deploy)
 * - Source .py files newer than deploy timestamp (code changed since deploy)
 *
 * @param buildSha — SHA from BUILD_SHA (bundled at build time). Null in dev electron.
 * @param devBackendPath — path to dev backend source. Enables source freshness check.
 */
/**
 * Returns a human-readable warning reason, or null if no warning.
 * Backward compat: `isDeployWarning(...)` is truthy when there's a warning.
 */
export const getDeployWarning = (
  appState: AppState,
  appVersion: string,
  buildSha?: string | null,
  devBackendPath?: string
): string | null => {
  if (appState.status !== 'ready' || !appState.duetDataPath) return null

  const deployed = readDeployedVersion(appState.duetDataPath)
  if (deployed === null) return 'Backend не установлен'

  const meta = parseVersionMeta(deployed)

  if (appState.deployChannel === 'prod') {
    if (meta.channel === 'dev') return 'Установлена DEV-версия в режиме PROD'
    if (meta.channel === 'prod' && buildSha && meta.identifier !== buildSha)
      return 'Версия устарела (другой билд)'
    if (!buildSha || !meta.channel) {
      if (compareSemver(appVersion, meta.semver) > 0)
        return `Версия устарела (${meta.semver} → ${appVersion})`
    }
    return null
  }

  // DEV mode
  if (meta.channel === 'prod') return 'Установлена PROD-версия в режиме DEV'
  if (compareSemver(appVersion, meta.semver) !== 0)
    return `Версия не совпадает (${meta.semver} → ${appVersion})`
  if (meta.channel === 'dev' && meta.identifier && devBackendPath) {
    const deployTime = parseDeployTimestamp(meta.identifier)
    if (deployTime && isSourceNewer(devBackendPath, deployTime)) {
      const newest = new Date(newestPyMtime(devBackendPath))
      const pad = (n: number): string => String(n).padStart(2, '0')
      const ts = `${pad(newest.getDate())}.${pad(newest.getMonth() + 1)} ${pad(newest.getHours())}:${pad(newest.getMinutes())}`
      return `Исходники изменились (${ts})`
    }
  }
  return null
}

/** @deprecated Use getDeployWarning instead */
export const isDeployWarning = (
  appState: AppState,
  appVersion: string,
  buildSha?: string | null,
  devBackendPath?: string
): boolean => getDeployWarning(appState, appVersion, buildSha, devBackendPath) !== null

// =============================================================================
// DEPLOY BACKEND
// =============================================================================

/**
 * Деплоит backend в DuetData/backend/.
 * Source: backendSourcePath (dev override) или resourcesPath/backend (default).
 * Использует atomic swap: copy → .new → rename (.old → delete).
 * Crash-safe: если крэш между rename — .old остаётся, cleanup при следующем запуске.
 * Возвращает количество скопированных файлов.
 */
export const deployBackend = (paths: DeployPaths): number => {
  const src = paths.backendSourcePath || join(paths.resourcesPath, 'backend')
  const dest = join(paths.duetDataPath, 'backend')
  const destNew = dest + '.new'
  const destOld = dest + '.old'

  if (!existsSync(src)) {
    throw new Error(`Backend source not found: ${src}`)
  }

  // Cleanup stale .new/.old from previous failed deploy
  if (existsSync(destNew)) rmSync(destNew, { recursive: true, force: true })
  if (existsSync(destOld)) rmSync(destOld, { recursive: true, force: true })

  // Copy to .new (filter excludes dev artifacts like .venv, __pycache__)
  mkdirSync(destNew, { recursive: true })
  cpSync(src, destNew, { recursive: true, force: true, filter: deployFilter })

  // Atomic swap
  if (existsSync(dest)) {
    renameSync(dest, destOld)
  }
  renameSync(destNew, dest)

  // Cleanup .old
  if (existsSync(destOld)) {
    rmSync(destOld, { recursive: true, force: true })
  }

  return countFiles(dest)
}

// =============================================================================
// WRITE VERSION
// =============================================================================

/**
 * Записывает VERSION файл в DuetData/backend/VERSION с build metadata.
 * Format: `{semver}+{channel}_{identifier}`
 * - prod: `0.1.8+prod_abc1234` (SHA from BUILD_SHA)
 * - dev: `0.1.8+dev_2604041330` (deploy timestamp YYMMDDHHMM)
 * - fallback: plain semver if no metadata available
 *
 * Returns the written version string.
 */
export const writeVersion = (paths: DeployPaths): string => {
  const versionPath = join(paths.duetDataPath, 'backend', 'VERSION')
  mkdirSync(join(paths.duetDataPath, 'backend'), { recursive: true })

  let version = paths.appVersion
  if (paths.deployChannel === 'dev') {
    version = `${paths.appVersion}+dev_${formatDeployTimestamp()}`
  } else {
    const sha = readBuildSha(paths.resourcesPath)
    if (sha) {
      version = `${paths.appVersion}+prod_${sha}`
    }
  }

  writeFileSync(versionPath, version, 'utf-8')
  return version
}

// =============================================================================
// PYTHON CHECK + VENV + PIP
// =============================================================================

const MIN_PYTHON_VERSION: [number, number] = [3, 10]

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
export const findPython = async (
  platform: NodeJS.Platform = process.platform
): Promise<string | null> => {
  const candidates =
    platform === 'win32'
      ? ['python', 'py']
      : [
          'python3',
          'python',
          // Explicit brew paths for macOS Electron (Finder/Spotlight PATH is minimal)
          '/opt/homebrew/bin/python3', // Apple Silicon
          '/usr/local/bin/python3' // Intel
        ]

  for (const cmd of candidates) {
    try {
      const version = await execAsync(cmd, ['--version'])
      const match = version.match(/Python (\d+)\.(\d+)/)
      if (match) {
        const major = parseInt(match[1])
        const minor = parseInt(match[2])
        if (
          major > MIN_PYTHON_VERSION[0] ||
          (major === MIN_PYTHON_VERSION[0] && minor >= MIN_PYTHON_VERSION[1])
        ) {
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

    if (
      major < MIN_PYTHON_VERSION[0] ||
      (major === MIN_PYTHON_VERSION[0] && minor < MIN_PYTHON_VERSION[1])
    ) {
      return {
        state: 'invalid',
        path: pythonPath,
        error: `Python ${version} слишком старый (нужен 3.10+)`
      }
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
export const setupVenv = async (paths: DeployPaths, pythonCmd: string): Promise<void> => {
  const venvPath = join(paths.duetDataPath, '.venv')
  const venvPython = venvPythonPath(venvPath)
  const requirementsPath = join(paths.duetDataPath, 'backend', 'requirements.txt')

  if (!existsSync(venvPython)) {
    await execAsync(pythonCmd, ['-m', 'venv', venvPath])
  }

  if (existsSync(requirementsPath)) {
    await execAsync(venvPython, ['-m', 'pip', 'install', '-q', '-r', requirementsPath])
  }
}

// =============================================================================
// FULL DEPLOY
// =============================================================================

/**
 * Полный деплой: stop backend + instructions + backend + venv + version + start backend.
 * Вызывается из main process.
 *
 * pythonCmd — путь к Python, определённый ДО деплоя через UI (python:detect / python:validate).
 * Файлы копируются всегда. VERSION записывается только если всё ОК.
 * После успешного деплоя бэкенд запускается автоматически.
 * Возвращает ChildProcess если backend запустился (для мониторинга caller'ом), null при ошибке.
 */
export const runDeploy = async (
  paths: DeployPaths,
  port: number,
  pythonCmd: string,
  log: LogFn,
  opts?: StopOptions
): Promise<ChildProcess | null> => {
  log(`Деплой v${paths.appVersion}...`)

  // 0. Stop running backend before file operations
  log('Остановка backend...')
  await stopBackend(port, null, opts)

  // 1. Deploy backend files (always, atomic swap)
  log('Копирование backend...')
  const backendCount = deployBackend(paths)
  log(`Backend: ${backendCount} файлов`)

  // 2. Copy DuetData README
  copyDuetDataReadme(paths)

  // 3. Setup venv + pip install
  log(`Python: ${pythonCmd}`)
  log('Настройка Python venv и зависимостей...')
  await setupVenv(paths, pythonCmd)

  // 4. Write VERSION only after full success
  const writtenVersion = writeVersion(paths)
  log(`VERSION: ${writtenVersion}`)

  // 5. Start backend after successful deploy
  let proc: ChildProcess | null = null
  try {
    log('Запуск backend...')
    proc = await startBackend(paths.duetDataPath, port)
    log('Backend запущен')
  } catch (e) {
    // Log but don't fail deploy — files are deployed, backend can be started manually
    log(`Не удалось запустить backend: ${e instanceof Error ? e.message : String(e)}`)
  }

  log(`Деплой v${paths.appVersion} завершён`)
  return proc
}

// =============================================================================
// DUETDATA README
// =============================================================================

/**
 * Копирует README.md шаблон в DuetData root.
 * Source: resources/duetdata-readme.md (bundled) или src-adjacent (dev).
 */
export const copyDuetDataReadme = (paths: DeployPaths): void => {
  const src = join(paths.resourcesPath, 'duetdata-readme.md')
  const dest = join(paths.duetDataPath, 'README.md')
  if (existsSync(src)) {
    cpSync(src, dest, { force: true })
  }
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
    // Strip build metadata per semver spec (everything after +)
    const clean = v.split('+')[0]
    const parts = clean.split('.').map(Number)
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
  }
  const [aMajor, aMinor, aPatch] = parse(a)
  const [bMajor, bMinor, bPatch] = parse(b)

  if (aMajor !== bMajor) return aMajor > bMajor ? 1 : -1
  if (aMinor !== bMinor) return aMinor > bMinor ? 1 : -1
  if (aPatch !== bPatch) return aPatch > bPatch ? 1 : -1
  return 0
}

/**
 * Check if any .py file in dirPath has mtime newer than `since`.
 * Used for DEV mode: detect source changes after deploy.
 * Excludes dev artifact dirs (.venv, __pycache__, etc.).
 */
export function isSourceNewer(dirPath: string, since: Date): boolean {
  return newestPyMtime(dirPath) > since.getTime()
}

/** Returns mtime (ms) of the newest .py file, or 0. */
export function newestPyMtime(dirPath: string): number {
  if (!existsSync(dirPath)) return 0
  try {
    return _newestPyMtime(dirPath)
  } catch {
    return 0
  }
}

function _newestPyMtime(dir: string): number {
  let max = 0
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (DEPLOY_EXCLUDE_DIRS.has(entry.name)) continue
      const sub = _newestPyMtime(join(dir, entry.name))
      if (sub > max) max = sub
    } else if (entry.name.endsWith('.py')) {
      const mt = statSync(join(dir, entry.name)).mtimeMs
      if (mt > max) max = mt
    }
  }
  return max
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
        reject(new Error(`${cmd} failed: ${error.message}\n${stdout}\n${stderr}`))
      } else {
        // Some commands (e.g. python --version) write to stderr on certain platforms
        resolve(stdout.trim() || stderr.trim())
      }
    })
  })
}
