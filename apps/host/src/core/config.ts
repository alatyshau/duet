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
import { existsSync, readFileSync, writeFileSync } from 'fs'

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
