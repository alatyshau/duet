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
import { readConfig, readMachineConfig } from './config'
import type { AppState, DeployChannel } from '../shared/types'

// Re-export types for existing importers (source of truth: shared/types.ts)
export type { AppStatus, AppState } from '../shared/types'

// =============================================================================
// ЛОГИКА
// =============================================================================

/**
 * Проверяет состояние приложения:
 * - no_config: нет конфига или обязательные поля не заполнены
 * - path_lost: поля заполнены, но папки не существуют
 * - ready: всё заполнено и папки доступны
 */
export const checkAppState = (): AppState => {
  const config = readConfig()

  // Все 3 поля обязательны
  if (!config.duetDataPath || !config.duetConfigPath || !config.machine) {
    return {
      status: 'no_config',
      duetDataPath: config.duetDataPath ?? null,
      duetConfigPath: config.duetConfigPath ?? null,
      machine: config.machine ?? null,
      pathExists: false,
      deployChannel: 'prod'
    }
  }

  const dataExists = existsSync(config.duetDataPath)
  const configExists = existsSync(config.duetConfigPath)
  const pathExists = dataExists && configExists

  if (!pathExists) {
    return {
      status: 'path_lost',
      duetDataPath: config.duetDataPath,
      duetConfigPath: config.duetConfigPath,
      machine: config.machine,
      pathExists: false,
      deployChannel: 'prod'
    }
  }

  // Read deployChannel from machine config (default: 'prod')
  const machineConfig = readMachineConfig()
  const channel = machineConfig?.deployChannel
  const deployChannel: DeployChannel = channel === 'dev' ? 'dev' : 'prod'

  return {
    status: 'ready',
    duetDataPath: config.duetDataPath,
    duetConfigPath: config.duetConfigPath,
    machine: config.machine,
    pathExists: true,
    deployChannel
  }
}

/**
 * Создаёт начальное состояние (до первой проверки).
 */
export const createInitialState = (): AppState => ({
  status: 'no_config',
  duetDataPath: null,
  duetConfigPath: null,
  machine: null,
  pathExists: false,
  deployChannel: 'prod'
})
