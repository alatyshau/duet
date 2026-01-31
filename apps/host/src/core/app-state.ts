/*
 * ЧТО: Логика определения состояния приложения.
 * ЗАЧЕМ: Единственный источник правды для статуса (no_config | path_lost | ready).
 * КТО ИСПОЛЬЗУЕТ: main process, unit-тесты.
 *
 * ТЕСТИРУЕМОСТЬ:
 * - Чистые функции, зависят только от config и fs
 * - Не зависят от Electron
 */
import { existsSync } from 'fs'
import { readConfig } from './config'

// =============================================================================
// ТИПЫ
// =============================================================================

export type AppStatus = 'no_config' | 'path_lost' | 'ready'

export interface AppState {
  status: AppStatus
  duetDataPath: string | null
  pathExists: boolean
}

// =============================================================================
// ЛОГИКА
// =============================================================================

/**
 * Проверяет состояние приложения:
 * - no_config: нет конфига или duetDataPath не указан
 * - path_lost: путь указан, но папка не существует
 * - ready: путь указан и папка существует
 */
export const checkAppState = (): AppState => {
  const config = readConfig()

  if (!config.duetDataPath) {
    return {
      status: 'no_config',
      duetDataPath: null,
      pathExists: false
    }
  }

  const pathExists = existsSync(config.duetDataPath)

  if (!pathExists) {
    return {
      status: 'path_lost',
      duetDataPath: config.duetDataPath,
      pathExists: false
    }
  }

  return {
    status: 'ready',
    duetDataPath: config.duetDataPath,
    pathExists: true
  }
}

/**
 * Создаёт начальное состояние (до первой проверки).
 */
export const createInitialState = (): AppState => ({
  status: 'no_config',
  duetDataPath: null,
  pathExists: false
})
