/*
 * ЧТО: Чтение/запись конфига ~/.org.ve68.duet/config.json
 * ЗАЧЕМ: Единственная точка для хранения пользовательских настроек.
 * КТО ИСПОЛЬЗУЕТ: main process, unit-тесты.
 *
 * ТЕСТИРУЕМОСТЬ:
 * - DUET_CONFIG_DIR переопределяет путь к директории конфига
 * - Чистые функции, не зависят от Electron
 */
import { homedir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

// =============================================================================
// ТИПЫ
// =============================================================================

export interface Config {
  duetDataPath?: string
}

// =============================================================================
// ПУТИ
// =============================================================================

/**
 * Директория конфига. Переопределяется через DUET_CONFIG_DIR в тестах.
 */
export const getConfigDir = (): string => {
  return process.env.DUET_CONFIG_DIR || join(homedir(), '.org.ve68.duet')
}

/**
 * Путь к файлу конфига.
 */
export const getConfigFile = (): string => {
  return join(getConfigDir(), 'config.json')
}

// =============================================================================
// ОПЕРАЦИИ
// =============================================================================

/**
 * Создаёт директорию конфига если не существует.
 */
export const ensureConfigDir = (): void => {
  const configDir = getConfigDir()
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
}

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
 * Записывает конфиг. Создаёт директорию при необходимости.
 */
export const writeConfig = (config: Config): void => {
  ensureConfigDir()
  writeFileSync(getConfigFile(), JSON.stringify(config, null, 2))
}
