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

  const base = {
    duetDataPath: config.duetDataPath ?? null,
    duetConfigPath: config.duetConfigPath ?? null,
    machine: config.machine ?? null
  }

  // Все 3 поля обязательны
  if (!config.duetDataPath || !config.duetConfigPath || !config.machine) {
    return {
      status: 'no_config' as const,
      ...base,
      pathExists: false,
      deployChannel: 'prod' as DeployChannel,
      pythonPath: null,
      instructionsPath: null,
      hasDevBackendPath: false
    }
  }

  const dataExists = existsSync(config.duetDataPath)
  const configExists = existsSync(config.duetConfigPath)
  const pathExists = dataExists && configExists

  if (!pathExists) {
    return {
      status: 'path_lost' as const,
      ...base,
      pathExists: false,
      deployChannel: 'prod' as DeployChannel,
      pythonPath: null,
      instructionsPath: null,
      hasDevBackendPath: false
    }
  }

  // Read machine config for extended fields
  const machineConfig = readMachineConfig()
  const channel = machineConfig?.deployChannel
  const deployChannel: DeployChannel = channel === 'dev' ? 'dev' : 'prod'
  const pythonPath = typeof machineConfig?.pythonPath === 'string' ? machineConfig.pythonPath : null
  const instructionsPath =
    typeof machineConfig?.instructionsPath === 'string' ? machineConfig.instructionsPath : null
  const hasDevBackendPath = typeof machineConfig?.devBackendPath === 'string'

  return {
    status: 'ready' as const,
    ...base,
    pathExists: true,
    deployChannel,
    pythonPath,
    instructionsPath,
    hasDevBackendPath
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
  deployChannel: 'prod',
  pythonPath: null,
  instructionsPath: null,
  hasDevBackendPath: false
})
