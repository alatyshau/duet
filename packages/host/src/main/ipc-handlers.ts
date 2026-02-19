/*
 * ЧТО: IPC handlers для связи main ↔ renderer.
 * ЗАЧЕМ: Регистрирует все обработчики IPC в одном месте.
 * КТО ИСПОЛЬЗУЕТ: main process при инициализации.
 */
import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import {
  writeConfig,
  readPort,
  readMachineConfig,
  setMachineConfigKey,
  ensureConfigDefaults
} from '../core/config'
import {
  resolveDeployStatus,
  runDeploy,
  findPython,
  validatePython,
  pythonInstallHint
} from '../core/deploy'
import { getBackendStatus, startBackend, stopBackend } from '../core/backend'
import { detectAgents, configureAllAgents } from '../core/ai-clients'
import type { AppState, DeployStatus, BackendStatus, PythonStatus } from '../shared/types'
import type { ChildProcess } from 'child_process'

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

function broadcastBackendStatus(status: BackendStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('backend:status-changed', status)
  }
}

let isStarting = false
let currentBackendProc: ChildProcess | null = null

/**
 * Сохраняет ref на процесс и слушает exit.
 * Backend — long-running сервер, любое самостоятельное завершение = ошибка.
 * Намеренная остановка (ensureBackendStopped / deploy) обнуляет ref ДО stop.
 */
function monitorBackendProcess(proc: ChildProcess): void {
  currentBackendProc = proc
  proc.on('exit', (code) => {
    if (proc !== currentBackendProc) return // stale listener
    currentBackendProc = null
    broadcastBackendStatus({ state: 'error', error: `Backend упал (код ${code})` })
  })
}

/**
 * Запускает бэкенд (используется IPC handler и auto-start).
 * Идемпотентен: если бэкенд уже запущен или запускается, ничего не делает.
 */
export async function ensureBackendRunning(duetDataPath: string): Promise<void> {
  // If we already own a running process, just broadcast its status
  if (currentBackendProc) {
    const port = readPort()
    const status = await getBackendStatus(duetDataPath, port)
    if (status.state === 'running') {
      broadcastBackendStatus(status)
      return
    }
  }

  // Already starting? (in-memory guard against concurrent calls)
  if (isStarting) return
  isStarting = true

  broadcastBackendStatus({ state: 'starting', message: 'Запуск backend...' })

  try {
    const port = readPort()
    // Always stop first — kills orphans from previous Host sessions
    await stopBackend(port, currentBackendProc)
    const proc = await startBackend(duetDataPath, port)
    monitorBackendProcess(proc)
    const status = await getBackendStatus(duetDataPath, port)
    broadcastBackendStatus(status)
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    broadcastBackendStatus({ state: 'error', error })
  } finally {
    isStarting = false
  }
}

/**
 * Останавливает бэкенд (используется IPC handler и stop-on-quit).
 */
export async function ensureBackendStopped(): Promise<void> {
  const proc = currentBackendProc
  currentBackendProc = null // Detach monitor — intentional stop, not a crash
  const port = readPort()
  broadcastBackendStatus({ state: 'stopping' })
  await stopBackend(port, proc)
  broadcastBackendStatus({ state: 'stopped' })
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
  ipcMain.handle('dialog:select-folder', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Выберите папку',
      ...(defaultPath ? { defaultPath } : {})
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // Сохранить pointer файл (~/.org.ve68.duet) + создать дефолтные конфиги
  ipcMain.handle(
    'config:save-pointer',
    (_event, config: { duetDataPath: string; duetConfigPath: string; machine: string }) => {
      writeConfig({
        duetDataPath: config.duetDataPath,
        duetConfigPath: config.duetConfigPath,
        machine: config.machine
      })
      ensureConfigDefaults(config.duetConfigPath, config.machine)
      context.updateAppState()
      return context.getAppState()
    }
  )

  // Открыть путь в Finder/Explorer
  ipcMain.handle('shell:open-path', async (_event, path: string) => {
    const error = await shell.openPath(path)
    if (error) console.error(`shell.openPath failed: ${error}`)
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
    const instructionsSourcePath =
      isDev && typeof machineConfig?.devInstructionsPath === 'string'
        ? machineConfig.devInstructionsPath
        : undefined
    const backendSourcePath =
      isDev && typeof machineConfig?.devBackendPath === 'string'
        ? machineConfig.devBackendPath
        : undefined

    // Python path must be configured before deploy
    const pythonPath =
      typeof machineConfig?.pythonPath === 'string' ? machineConfig.pythonPath : null
    if (!pythonPath) {
      throw new Error('Укажите путь к Python в настройках')
    }

    setDeployStatus({ state: 'deploying', message: 'Начинаю деплой...' })

    // Detach old monitor — deploy will stop and restart backend
    currentBackendProc = null

    try {
      const port = readPort()
      const proc = await runDeploy(
        {
          resourcesPath,
          duetDataPath: state.duetDataPath,
          appVersion,
          instructionsSourcePath,
          backendSourcePath
        },
        port,
        pythonPath,
        (message) => {
          sendDeployLog(message)
          setDeployStatus({ state: 'deploying', message })
        }
      )
      if (proc) monitorBackendProcess(proc)
      setDeployStatus({ state: 'deployed', version: appVersion })
      context.updateAppState() // Refresh tray icon (clear deploy warning)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      sendDeployLog(`ОШИБКА: ${error}`)
      setDeployStatus({ state: 'error', error })
      context.updateAppState() // Refresh tray icon on error too
    }
  })

  // === Python ===

  ipcMain.handle('python:detect', async (): Promise<PythonStatus> => {
    // Check saved path first
    const machineConfig = readMachineConfig()
    const saved = typeof machineConfig?.pythonPath === 'string' ? machineConfig.pythonPath : null

    if (saved) {
      const result = await validatePython(saved)
      if (result.state === 'found') return result
      // Saved path invalid — fall through to auto-detect
    }

    // Auto-detect
    const cmd = await findPython()
    if (!cmd) {
      return { state: 'not_found', hint: pythonInstallHint() }
    }
    return validatePython(cmd)
  })

  ipcMain.handle('python:validate', async (_event, path: string): Promise<PythonStatus> => {
    return validatePython(path)
  })

  ipcMain.handle('python:save', (_event, path: string) => {
    setMachineConfigKey('pythonPath', path)
  })

  ipcMain.handle('dialog:select-file', async (_event, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'showHiddenFiles'],
      title: 'Выберите Python',
      ...(defaultPath ? { defaultPath } : {})
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // === Backend ===

  ipcMain.handle('backend:get-status', async () => {
    const state = context.getAppState()
    if (!state.duetDataPath) return { state: 'stopped' } as BackendStatus
    const port = readPort()
    return getBackendStatus(state.duetDataPath, port)
  })

  ipcMain.handle('backend:start', async () => {
    const state = context.getAppState()
    if (!state.duetDataPath) throw new Error('App not configured')
    await ensureBackendRunning(state.duetDataPath)
  })

  ipcMain.handle('backend:stop', async () => {
    const state = context.getAppState()
    if (!state.duetDataPath) return
    await ensureBackendStopped()
  })

  // === AI Agents ===

  ipcMain.handle('agents:detect', () => {
    const state = context.getAppState()
    if (!state.duetDataPath) return []
    const port = readPort()
    return detectAgents(state.duetDataPath, port)
  })

  ipcMain.handle('agents:configure', () => {
    const state = context.getAppState()
    if (!state.duetDataPath) return []
    const port = readPort()
    return configureAllAgents(state.duetDataPath, port)
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
