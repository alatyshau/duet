/*
 * ЧТО: IPC handlers для связи main ↔ renderer.
 * ЗАЧЕМ: Регистрирует все обработчики IPC в одном месте.
 * КТО ИСПОЛЬЗУЕТ: main process при инициализации.
 */
import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  readConfig,
  writeConfig,
  readPort,
  readMachineConfig,
  setMachineConfigKey,
  ensureConfigDefaults,
  isValidMachineName
} from '../core/config'
import {
  resolveDeployStatus,
  runDeploy,
  readDeployedVersion,
  getDeployWarning,
  readBuildSha,
  findPython,
  validatePython,
  pythonInstallHint
} from '../core/deploy'
import { getBackendStatus, startBackend, stopBackend } from '../core/backend'
import { detectAgents, configureAllAgents, fixAgentIssue } from '../core/ai-clients'
import { triggerMerge, readCachedErrors, fixInstructionsError } from '../core/instructions'
import {
  downloadInstructionsTemplate,
  isFolderEmpty
} from '../core/instructions-download'
import {
  addBusinessFolder,
  getResolvedBusinessFolders,
  saveBusinessFolders,
  setRootBusiness,
  triggerScan,
  readCachedScan,
  readCachedStreams
} from '../core/business-folders'
import type {
  AppState,
  BusinessFolderEntry,
  DeployStatus,
  BackendStatus,
  PythonStatus,
  InstructionsMergeResult,
  InstructionsError,
  ScanResult,
  StreamsCache
} from '../shared/types'
import type { ChildProcess } from 'child_process'

// =============================================================================
// ТИПЫ
// =============================================================================

export interface IpcHandlersContext {
  getAppState: () => AppState
  updateAppState: () => void
  setDeployStatus: (status: DeployStatus) => void
}

let deployStatus: DeployStatus = { state: 'idle' }

function setDeployStatus(status: DeployStatus, context?: IpcHandlersContext): void {
  deployStatus = status
  context?.setDeployStatus(status)
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
  // Supports partial saves: missing fields are preserved from current config.
  ipcMain.handle(
    'config:save-pointer',
    (_event, config: { duetDataPath?: string; duetConfigPath?: string; machine?: string }) => {
      // Validate machine name before writing anything
      const machine = config.machine?.trim()
      if (machine !== undefined && !isValidMachineName(machine)) {
        throw new Error(
          `Invalid machine name: "${machine}". Use alphanumeric characters, hyphens, underscores, dots.`
        )
      }

      const existing = readConfig()
      const merged = {
        duetDataPath: config.duetDataPath ?? existing.duetDataPath,
        duetConfigPath: config.duetConfigPath ?? existing.duetConfigPath,
        machine: machine ?? existing.machine
      }
      writeConfig(merged)
      if (merged.duetConfigPath && merged.machine) {
        ensureConfigDefaults(merged.duetConfigPath, merged.machine)
      }
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
    const appState = context.getAppState()
    const resolved = resolveDeployStatus(appState, app.getVersion(), deployStatus)
    // Enrich deployed/up_to_date with warning flag for renderer sidebar
    if (resolved.state === 'deployed' || resolved.state === 'up_to_date') {
      const resourcesPath = app.isPackaged
        ? process.resourcesPath
        : join(__dirname, '../../resources-dev')
      const buildSha = readBuildSha(resourcesPath)
      const machineConfig = readMachineConfig()
      const devBackendPath =
        typeof machineConfig?.devBackendPath === 'string' ? machineConfig.devBackendPath : undefined
      const warningReason = getDeployWarning(appState, app.getVersion(), buildSha, devBackendPath)
      return { ...resolved, ...(warningReason ? { warningReason } : {}) }
    }
    return resolved
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
    const deployChannel = isDev ? ('dev' as const) : ('prod' as const)
    const backendSourcePath =
      isDev && typeof machineConfig?.devBackendPath === 'string'
        ? machineConfig.devBackendPath
        : undefined

    // Guard: PROD deploy in dev Electron — bundled backend doesn't exist
    if (!isDev && !app.isPackaged) {
      const bundledBackend = join(resourcesPath, 'backend')
      if (!existsSync(bundledBackend)) {
        throw new Error(
          'PROD-деплой недоступен в dev-режиме. Соберите приложение или переключитесь на DEV.'
        )
      }
    }

    // Python path must be configured before deploy
    const pythonPath =
      typeof machineConfig?.pythonPath === 'string' ? machineConfig.pythonPath : null
    if (!pythonPath) {
      throw new Error('Укажите путь к Python в настройках')
    }

    setDeployStatus({ state: 'deploying', message: 'Начинаю деплой...' }, context)

    // Detach old monitor — deploy will stop and restart backend
    currentBackendProc = null

    try {
      const port = readPort()
      const proc = await runDeploy(
        {
          resourcesPath,
          duetDataPath: state.duetDataPath,
          appVersion,
          backendSourcePath,
          deployChannel
        },
        port,
        pythonPath,
        (message) => {
          sendDeployLog(message)
          setDeployStatus({ state: 'deploying', message }, context)
        }
      )
      if (proc) monitorBackendProcess(proc)
      // Read actual VERSION (includes build metadata) instead of plain appVersion
      const deployedVersion = readDeployedVersion(state.duetDataPath) ?? appVersion
      const postDeployReason = getDeployWarning(
        context.getAppState(),
        app.getVersion(),
        readBuildSha(resourcesPath),
        backendSourcePath
      )
      setDeployStatus({ state: 'deployed', version: deployedVersion, ...(postDeployReason ? { warningReason: postDeployReason } : {}) }, context)
      context.updateAppState() // Refresh tray icon (clear deploy warning)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      sendDeployLog(`ОШИБКА: ${error}`)
      setDeployStatus({ state: 'error', error }, context)
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
    const result = detectAgents(state.duetDataPath, port)
    context.updateAppState() // Refresh tray icon (agents severity may change)
    return result
  })

  ipcMain.handle('agents:configure', () => {
    const state = context.getAppState()
    if (!state.duetDataPath) return []
    const port = readPort()
    const result = configureAllAgents(state.duetDataPath, port)
    context.updateAppState()
    return result
  })

  ipcMain.handle('agents:fix-issue', (_event, agentId: string, reasonCode: string): boolean => {
    const fixed = fixAgentIssue(agentId, reasonCode)
    if (fixed) context.updateAppState()
    return fixed
  })

  // === Instructions ===

  ipcMain.handle('instructions:merge', async (): Promise<InstructionsMergeResult> => {
    const port = readPort()
    return triggerMerge(port)
  })

  ipcMain.handle('instructions:get-errors', (): InstructionsError[] | null => {
    const state = context.getAppState()
    if (!state.duetDataPath) return null
    return readCachedErrors(state.duetDataPath)
  })

  // === Business Folders ===

  ipcMain.handle('business-folders:get', (): BusinessFolderEntry[] => {
    return getResolvedBusinessFolders()
  })

  ipcMain.handle('business-folders:save', (_event, folders: string[]): void => {
    saveBusinessFolders(folders)
  })

  ipcMain.handle(
    'business-folders:add',
    (_event, absolutePath: string): BusinessFolderEntry[] => {
      return addBusinessFolder(absolutePath)
    }
  )

  ipcMain.handle(
    'business-folders:set-root',
    (_event, rootIndex: number): BusinessFolderEntry[] => {
      const folders = getResolvedBusinessFolders()
      setRootBusiness(folders, rootIndex)
      return getResolvedBusinessFolders() // re-read with updated isRoot
    }
  )

  ipcMain.handle('business-folders:scan', async (): Promise<ScanResult> => {
    const port = readPort()
    return triggerScan(port)
  })

  ipcMain.handle('business-folders:get-cached-scan', (): ScanResult | null => {
    const state = context.getAppState()
    if (!state.duetDataPath) return null
    return readCachedScan(state.duetDataPath)
  })

  ipcMain.handle('business-folders:get-cached-streams', (): StreamsCache | null => {
    const state = context.getAppState()
    if (!state.duetDataPath) return null
    return readCachedStreams(state.duetDataPath)
  })

  // === Instructions fix ===

  ipcMain.handle(
    'instructions:fix-error',
    (_event, relativePath: string, reasonCode: string): boolean => {
      const state = context.getAppState()
      if (!state.instructionsPath) return false
      return fixInstructionsError(state.instructionsPath, relativePath, reasonCode)
    }
  )

  // === Instructions download ===

  ipcMain.handle(
    'instructions:download-template',
    async (
      _event,
      targetFolder: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        await downloadInstructionsTemplate(targetFolder)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'instructions:is-folder-empty',
    (_event, folderPath: string): boolean => {
      return isFolderEmpty(folderPath)
    }
  )

  // === Instructions path ===

  ipcMain.handle('config:set-instructions-path', (_event, path: string) => {
    const config = readConfig()
    if (!config.duetConfigPath || !config.machine) {
      throw new Error('Сначала настройте DuetConfig и имя машины (шаг 2)')
    }
    setMachineConfigKey('instructionsPath', path)
    context.updateAppState()
    return context.getAppState()
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
