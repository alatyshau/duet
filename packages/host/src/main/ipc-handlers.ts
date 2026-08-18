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
import { appendBackendLog, getBackendStatus, startBackend, stopBackend } from '../core/backend'
import { detectAgents, configureAllAgents, fixAgentIssue } from '../core/ai-clients'
import {
  addRootContextFolder,
  getResolvedRootContextFolders,
  saveRootContextFolders,
  triggerScan,
  readCachedScan,
  readCachedContexts
} from '../core/root-contexts'
import type {
  AppState,
  RootContextEntry,
  DeployStatus,
  BackendStatus,
  PythonStatus,
  ScanResult,
  ContextsCache,
  MigrationResult
} from '../shared/types'
import type { ChildProcess } from 'child_process'

// =============================================================================
// ТИПЫ
// =============================================================================

export interface IpcHandlersContext {
  getAppState: () => AppState
  updateAppState: () => void
  setDeployStatus: (status: DeployStatus) => void
  /** Запустить полный startup-sweep миграции. Обновляет module-state main/index.ts. */
  runMigrations: () => Promise<MigrationResult>
  /** Прочитать кешированный результат последней миграции. */
  getMigrationStatus: () => MigrationResult
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
function monitorBackendProcess(proc: ChildProcess, duetDataPath: string): void {
  currentBackendProc = proc
  proc.on('exit', (code, signal) => {
    if (proc !== currentBackendProc) return // stale listener
    currentBackendProc = null
    const detail = signal ? `сигнал ${signal}` : `код ${code}`
    // Durable trace: a process killed by signal can't log its own death
    appendBackendLog(duetDataPath, 'ERROR', `Backend завершился неожиданно (${detail})`)
    broadcastBackendStatus({ state: 'error', error: `Backend упал (${detail})` })
  })
}

/**
 * Запускает бэкенд (используется IPC handler и auto-start).
 * Идемпотентен: если бэкенд уже запущен или запускается, ничего не делает.
 *
 * Перед спавном проверяется migration.critical: если settings/machine конфиг невалиден или
 * future-version — backend не запускается, broadcast'им error со ссылкой на DuetPathsPage.
 */
export async function ensureBackendRunning(
  duetDataPath: string,
  migrationStatus: MigrationResult
): Promise<void> {
  if (migrationStatus.critical) {
    broadcastBackendStatus({
      state: 'error',
      error: migrationStatus.critical.description
    })
    return
  }

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
    monitorBackendProcess(proc, duetDataPath)
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
  //
  // После любых изменений в pointer'е, влияющих на конфиги (`duetConfigPath`, `machine`),
  // прогоняем startup-sweep миграции — settings.json и {machine}.json могут оказаться
  // legacy/future, и backend нельзя запускать без этой проверки.
  ipcMain.handle(
    'config:save-pointer',
    async (
      _event,
      config: { duetDataPath?: string; duetConfigPath?: string; machine?: string }
    ) => {
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
      // Re-run migration sweep if config-relevant fields changed (or first set).
      const configChanged =
        merged.duetConfigPath !== existing.duetConfigPath || merged.machine !== existing.machine
      if (configChanged) {
        await context.runMigrations()
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
      if (proc) monitorBackendProcess(proc, state.duetDataPath)
      // Re-merge + re-deploy agents from the freshly deployed platform bundle, so
      // duet.md / duet-{agent}.md never go stale after a backend upgrade. Needs the
      // backend running (merge is an HTTP call) — skip if it didn't start.
      if (proc) {
        try {
          await configureAllAgents(state.duetDataPath, port)
        } catch (e) {
          sendDeployLog(
            `Конфигурация агентов после деплоя не удалась: ${e instanceof Error ? e.message : String(e)}`
          )
        }
      }
      // Read actual VERSION (includes build metadata) instead of plain appVersion
      const deployedVersion = readDeployedVersion(state.duetDataPath) ?? appVersion
      const postDeployReason = getDeployWarning(
        context.getAppState(),
        app.getVersion(),
        readBuildSha(resourcesPath),
        backendSourcePath
      )
      setDeployStatus(
        {
          state: 'deployed',
          version: deployedVersion,
          ...(postDeployReason ? { warningReason: postDeployReason } : {})
        },
        context
      )
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
    const migration = context.getMigrationStatus()
    if (migration.critical) {
      throw new Error(`Не могу запустить backend: ${migration.critical.description}`)
    }
    await ensureBackendRunning(state.duetDataPath, migration)
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

  ipcMain.handle('agents:configure', async () => {
    const state = context.getAppState()
    if (!state.duetDataPath) return []
    const port = readPort()
    const result = await configureAllAgents(state.duetDataPath, port)
    context.updateAppState()
    return result
  })

  ipcMain.handle('agents:fix-issue', (_event, agentId: string, reasonCode: string): boolean => {
    const fixed = fixAgentIssue(agentId, reasonCode)
    if (fixed) context.updateAppState()
    return fixed
  })

  // === Root Contexts ===

  ipcMain.handle('root-contexts:get', (): RootContextEntry[] => {
    return getResolvedRootContextFolders()
  })

  ipcMain.handle('root-contexts:save', async (_event, folders: string[]): Promise<void> => {
    saveRootContextFolders(folders)
    // Removing/reordering may clear unresolved-alias warnings; re-sweep so the renderer
    // and tray see the fresh state. Idempotent on already-current files (settings/machine v2,
    // context.json v3) — review issue 6.
    await context.runMigrations()
    context.updateAppState()
  })

  ipcMain.handle(
    'root-contexts:add',
    async (_event, absolutePath: string): Promise<RootContextEntry[]> => {
      const result = addRootContextFolder(absolutePath)
      // Sweep picks up legacy/future manifests inside the new folder and self-heals an
      // empty root. Cheap on existing v3 context.json roots. updateAppState pushes the new
      // tray severity (review issue 6: previously skipped, leaving stale warning state).
      await context.runMigrations()
      context.updateAppState()
      return result
    }
  )

  ipcMain.handle('root-contexts:scan', async (): Promise<ScanResult> => {
    const port = readPort()
    return triggerScan(port)
  })

  ipcMain.handle('root-contexts:get-cached-scan', (): ScanResult | null => {
    const state = context.getAppState()
    if (!state.duetDataPath) return null
    return readCachedScan(state.duetDataPath)
  })

  ipcMain.handle('root-contexts:get-cached-contexts', (): ContextsCache | null => {
    const state = context.getAppState()
    if (!state.duetDataPath) return null
    return readCachedContexts(state.duetDataPath)
  })

  // === Schema migrations ===

  ipcMain.handle('migrations:get-status', (): MigrationResult => {
    return context.getMigrationStatus()
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
