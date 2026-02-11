/*
 * ЧТО: IPC handlers для связи main ↔ renderer.
 * ЗАЧЕМ: Регистрирует все обработчики IPC в одном месте.
 * КТО ИСПОЛЬЗУЕТ: main process при инициализации.
 */
import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { writeConfig, readPort, readMachineConfig, setMachineConfigKey, ensureConfigDefaults } from '../core/config'
import { resolveDeployStatus, runDeploy } from '../core/deploy'
import { detectAgents, configureAllAgents } from '../core/ai-clients'
import type { AppState, DeployStatus } from '../shared/types'

// =============================================================================
// ТИПЫ
// =============================================================================

export interface IpcHandlersContext {
  getAppState: () => AppState
  updateAppState: () => void
}

let deployStatus: DeployStatus = { state: 'idle' }

function setDeployStatus(status: DeployStatus): void {
  deployStatus = status
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('deploy:status-changed', status)
  }
}

function sendDeployLog(message: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('deploy:log', message)
  }
}

// =============================================================================
// SETUP
// =============================================================================

/**
 * Регистрирует все IPC handlers.
 */
export const setupIpcHandlers = (context: IpcHandlersContext): void => {
  ipcMain.on('ping', () => console.log('pong'))

  // Получить текущий AppState
  ipcMain.handle('app:get-state', () => {
    return context.getAppState()
  })

  // Диалог выбора папки
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Выберите папку'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // Сохранить pointer файл (~/.org.ve68.duet) + создать дефолтные конфиги
  ipcMain.handle('config:save-pointer', (_event, config: { duetDataPath: string; duetConfigPath: string; machine: string }) => {
    writeConfig({
      duetDataPath: config.duetDataPath,
      duetConfigPath: config.duetConfigPath,
      machine: config.machine
    })
    ensureConfigDefaults(config.duetConfigPath, config.machine)
    context.updateAppState()
    return context.getAppState()
  })

  // Открыть путь в Finder/Explorer
  ipcMain.handle('shell:open-path', (_event, path: string) => {
    shell.openPath(path)
  })

  // Переключить deploy channel (dev / prod)
  ipcMain.handle('config:set-deploy-channel', (_event, channel: 'dev' | 'prod') => {
    setMachineConfigKey('deployChannel', channel)
    context.updateAppState()
    return context.getAppState()
  })

  // === Deploy ===

  ipcMain.handle('deploy:get-status', () => {
    return resolveDeployStatus(context.getAppState(), app.getVersion(), deployStatus)
  })

  ipcMain.handle('deploy:start', async () => {
    // Guard: prevent concurrent deploys
    if (deployStatus.state === 'deploying') {
      throw new Error('Deploy already in progress')
    }

    const state = context.getAppState()
    if (state.status !== 'ready' || !state.duetDataPath) {
      throw new Error('App not ready for deploy')
    }

    const appVersion = app.getVersion()
    const resourcesPath = getResourcesPath()

    // Dev overrides: only when deployChannel === 'dev'
    const machineConfig = readMachineConfig()
    const isDev = machineConfig?.deployChannel === 'dev'
    const instructionsSourcePath = isDev && typeof machineConfig?.devInstructionsPath === 'string'
      ? machineConfig.devInstructionsPath : undefined
    const backendSourcePath = isDev && typeof machineConfig?.devBackendPath === 'string'
      ? machineConfig.devBackendPath : undefined

    setDeployStatus({ state: 'deploying', message: 'Начинаю деплой...' })

    try {
      const port = readPort()
      await runDeploy(
        { resourcesPath, duetDataPath: state.duetDataPath, appVersion, instructionsSourcePath, backendSourcePath },
        port,
        (message) => {
          sendDeployLog(message)
          setDeployStatus({ state: 'deploying', message })
        }
      )
      setDeployStatus({ state: 'deployed', version: appVersion })
      context.updateAppState() // Refresh tray icon (clear deploy warning)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      sendDeployLog(`ОШИБКА: ${error}`)
      setDeployStatus({ state: 'error', error })
      context.updateAppState() // Refresh tray icon on error too
    }
  })

  // === AI Agents ===

  ipcMain.handle('agents:detect', () => {
    const state = context.getAppState()
    if (!state.duetDataPath) return []
    return detectAgents()
  })

  ipcMain.handle('agents:configure', () => {
    const state = context.getAppState()
    if (!state.duetDataPath) return []
    return configureAllAgents(state.duetDataPath)
  })
}

// =============================================================================
// HELPERS
// =============================================================================

function getResourcesPath(): string {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  // Dev mode: extraResources aren't bundled.
  // Symlink or copy resources to resources-dev/ for testing.
  return join(__dirname, '../../resources-dev')
}
