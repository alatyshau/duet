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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

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
 */
export const readConfig = (): Config => {
  const configFile = getConfigFile()
  if (existsSync(configFile)) {
    try {
      return JSON.parse(readFileSync(configFile, 'utf-8'))
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * Записывает конфиг.
 */
export const writeConfig = (config: Config): void => {
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2) + '\n')
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
 * Ничего не делает если pointer неполный или machine config не найден.
 */
export const setMachineConfigKey = (key: string, value: unknown): void => {
  const config = readConfig()
  if (!config.duetConfigPath || !config.machine) return
  if (!isValidMachineName(config.machine)) return
  const machineConfigPath = join(config.duetConfigPath, `${config.machine}.json`)
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(readFileSync(machineConfigPath, 'utf-8'))
  } catch {
    /* file missing or invalid — start fresh */
  }
  existing[key] = value
  writeFileSync(machineConfigPath, JSON.stringify(existing, null, 2) + '\n')
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
 * Ничего не делает если pointer неполный или settings.json не найден.
 */
export const setSettingsConfigKey = (key: string, value: unknown): void => {
  const config = readConfig()
  if (!config.duetConfigPath) return
  const settingsPath = join(config.duetConfigPath, 'settings.json')
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch {
    /* file missing or invalid — start fresh */
  }
  existing[key] = value
  writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n')
}

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_SETTINGS = {
  business_folders: [] as string[],
  timestampTZ: { id: 'Z', value: 'UTC' }
}

const DEFAULT_PORT = 19680

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
    writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2) + '\n')
  }

  const machineConfigPath = join(duetConfigPath, `${machine}.json`)
  if (!existsSync(machineConfigPath)) {
    writeFileSync(machineConfigPath, JSON.stringify({ port: DEFAULT_PORT }, null, 2) + '\n')
  }
}
