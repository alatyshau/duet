/*
 * ЧТО: Чтение/запись конфига ~/.org.ve68.duet
 * ЗАЧЕМ: Единственная точка для хранения пользовательских настроек.
 * КТО ИСПОЛЬЗУЕТ: main process, unit-тесты.
 *
 * ТЕСТИРУЕМОСТЬ:
 * - DUET_CONFIG_FILE переопределяет путь к файлу конфига
 * - Чистые функции, не зависят от Electron
 */
import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, mkdirSync } from 'fs'
import { atomicWriteJson, readJsonStrict } from './json-io'

// =============================================================================
// ТИПЫ
// =============================================================================

export interface Config {
  machine?: string
  duetDataPath?: string
  duetConfigPath?: string
}

// =============================================================================
// ПУТИ
// =============================================================================

/**
 * Путь к файлу конфига. Переопределяется через DUET_CONFIG_FILE в тестах.
 */
export const getConfigFile = (): string => {
  return process.env.DUET_CONFIG_FILE || join(homedir(), '.org.ve68.duet')
}

// =============================================================================
// ОПЕРАЦИИ
// =============================================================================

/**
 * Читает конфиг. Возвращает {} если файла нет или JSON невалидный.
 *
 * Graceful path: используется широко (checkAppState, readMachineConfig, deploy и т.д.).
 * Битый файл не должен валить приложение — оно покажет wizard. Strict-валидация
 * (для миграции) живёт в `readPointerStrict()`.
 */
export const readConfig = (): Config => {
  const result = readJsonStrict(getConfigFile())
  if (result.kind === 'ok' && result.data && typeof result.data === 'object') {
    return result.data as Config
  }
  return {}
}

/**
 * Strict pointer read — различает «файла нет» (legitimate first-run) от «файл битый»
 * (recoverable error, blocked startup). Используется startup-миграцией: если pointer
 * существует, но не парсится, мы НЕ должны переходить в no_config / first-run flow,
 * иначе следующий `config:save-pointer` затрёт повреждённый файл, потеряв данные.
 */
export const readPointerStrict = ():
  | { kind: 'ok'; config: Config }
  | { kind: 'missing' }
  | { kind: 'invalid_json'; path: string; error: string }
  | { kind: 'read_failed'; path: string; error: string } => {
  const filePath = getConfigFile()
  const result = readJsonStrict(filePath)
  if (result.kind === 'ok') {
    if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
      return {
        kind: 'invalid_json',
        path: filePath,
        error: `Expected an object in pointer file, got ${Array.isArray(result.data) ? 'array' : typeof result.data}.`
      }
    }
    return { kind: 'ok', config: result.data as Config }
  }
  if (result.kind === 'missing') return { kind: 'missing' }
  if (result.kind === 'invalid_json') return { kind: 'invalid_json', path: filePath, error: result.error }
  return { kind: 'read_failed', path: filePath, error: result.error }
}

/**
 * Записывает конфиг атомарно (.tmp → rename). См. core/json-io.
 */
export const writeConfig = (config: Config): void => {
  atomicWriteJson(getConfigFile(), config)
}

/**
 * Читает {machine}.json из DuetConfig.
 * Возвращает null если pointer неполный или файла нет.
 */
export const readMachineConfig = (): Record<string, unknown> | null => {
  const config = readConfig()
  if (!config.duetConfigPath || !config.machine) return null
  const machineConfigPath = join(config.duetConfigPath, `${config.machine}.json`)
  if (!existsSync(machineConfigPath)) return null
  try {
    return JSON.parse(readFileSync(machineConfigPath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Читает порт бэкенда из machine config.
 * Throws если конфиг недоступен или порт не указан.
 */
export const readPort = (): number => {
  const config = readMachineConfig()
  if (!config) {
    throw new Error('Machine config not found. Configure DuetConfig path and machine name first.')
  }
  const port = config.port
  if (typeof port !== 'number') {
    throw new Error(
      'Port not configured in machine config. Add "port": 19680 to your machine config.'
    )
  }
  return port
}

/**
 * Обновляет одно поле в {machine}.json (read-modify-write).
 *
 * Бросает если:
 * - pointer неполный (нет duetConfigPath или machine)
 * - machine name невалидный (path-traversal protection)
 * - файл отсутствует или содержит невалидный JSON
 *
 * Раньше функция тихо начинала с пустого `{}` если файл отсутствовал/побит,
 * что приводило к беззвучной потере остальных полей (port, instructionsPath и т.д.)
 * Теперь — fail loud, чтобы UI показал ошибку и пользователь починил конфиг
 * через wizard step 1 (`ensureConfigDefaults`).
 */
export const setMachineConfigKey = (key: string, value: unknown): void => {
  const config = readConfig()
  if (!config.duetConfigPath || !config.machine) {
    throw new Error(
      'Cannot write machine config: pointer not fully configured (need duetConfigPath and machine).'
    )
  }
  if (!isValidMachineName(config.machine)) {
    throw new Error(`Invalid machine name in pointer config: "${config.machine}".`)
  }
  const machineConfigPath = join(config.duetConfigPath, `${config.machine}.json`)
  if (!existsSync(machineConfigPath)) {
    throw new Error(
      `Machine config not found: ${machineConfigPath}. Re-run wizard step 1 to recreate defaults.`
    )
  }
  let existing: Record<string, unknown>
  try {
    existing = JSON.parse(readFileSync(machineConfigPath, 'utf-8'))
  } catch (e) {
    throw new Error(
      `Invalid JSON in ${machineConfigPath}: ${e instanceof Error ? e.message : String(e)}`
    )
  }
  existing[key] = value
  atomicWriteJson(machineConfigPath, existing)
}

// =============================================================================
// SETTINGS CONFIG (DuetConfig/settings.json)
// =============================================================================

/**
 * Читает settings.json из DuetConfig.
 * Возвращает null если pointer неполный или файла нет.
 */
export const readSettingsConfig = (): Record<string, unknown> | null => {
  const config = readConfig()
  if (!config.duetConfigPath) return null
  const settingsPath = join(config.duetConfigPath, 'settings.json')
  if (!existsSync(settingsPath)) return null
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Обновляет одно поле в settings.json (read-modify-write).
 *
 * Бросает если:
 * - duetConfigPath не настроен в pointer
 * - settings.json отсутствует или содержит невалидный JSON
 *
 * Раньше функция тихо начинала с пустого `{}` если файл отсутствовал/побит,
 * что приводило к беззвучной потере `timestampTZ` и других полей.
 * Теперь — fail loud (см. setMachineConfigKey).
 */
export const setSettingsConfigKey = (key: string, value: unknown): void => {
  const config = readConfig()
  if (!config.duetConfigPath) {
    throw new Error('Cannot write settings: duetConfigPath is not configured in pointer.')
  }
  const settingsPath = join(config.duetConfigPath, 'settings.json')
  if (!existsSync(settingsPath)) {
    throw new Error(
      `Settings file not found: ${settingsPath}. Re-run wizard step 1 to recreate defaults.`
    )
  }
  let existing: Record<string, unknown>
  try {
    existing = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch (e) {
    throw new Error(
      `Invalid JSON in ${settingsPath}: ${e instanceof Error ? e.message : String(e)}`
    )
  }
  existing[key] = value
  atomicWriteJson(settingsPath, existing)
}

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_SETTINGS = {
  version: 2,
  root_context_folders: [] as string[],
  timestampTZ: { id: 'Z', value: 'UTC' }
}

const DEFAULT_MACHINE_CONFIG = {
  version: 2,
  port: 19680
}

/**
 * Проверяет что machine name безопасен для использования как имя файла.
 * Запрещает path traversal и спецсимволы.
 */
export const isValidMachineName = (name: string): boolean => {
  if (!name || name.length > 64) return false
  // Only allow alphanumeric, hyphens, underscores, dots (not leading)
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)
}

/**
 * Создаёт settings.json и {machine}.json с дефолтами если файлов нет.
 * Вызывается при сохранении pointer'а. Не перезаписывает существующие файлы.
 */
export const ensureConfigDefaults = (duetConfigPath: string, machine: string): void => {
  if (!isValidMachineName(machine)) {
    throw new Error(
      `Invalid machine name: "${machine}". Use alphanumeric characters, hyphens, underscores, dots.`
    )
  }
  mkdirSync(duetConfigPath, { recursive: true })

  const settingsPath = join(duetConfigPath, 'settings.json')
  if (!existsSync(settingsPath)) {
    atomicWriteJson(settingsPath, DEFAULT_SETTINGS)
  }

  const machineConfigPath = join(duetConfigPath, `${machine}.json`)
  if (!existsSync(machineConfigPath)) {
    atomicWriteJson(machineConfigPath, DEFAULT_MACHINE_CONFIG)
  }
}
