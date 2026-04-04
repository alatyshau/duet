/*
 * ЧТО: Точка входа главного процесса Electron (main process).
 * ЗАЧЕМ: Склейка модулей, lifecycle приложения.
 * КТО ИСПОЛЬЗУЕТ: Electron при запуске приложения.
 *
 * АРХИТЕКТУРА:
 * - core/ — чистые функции (config, app-state)
 * - platform/ — системные интеграции (tray, autolaunch)
 * - main/ — Electron-specific (window, ipc-handlers)
 */
import { app } from 'electron'
import { existsSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { checkAppState, createInitialState, type AppState } from '../core/app-state'
import { getConfigFile, readPort, readMachineConfig } from '../core/config'
import { isDeployWarning, readBuildSha, readDeployedVersion, resolveDeployStatus } from '../core/deploy'
import { readCachedScan, getBusinessFolders, triggerScan } from '../core/business-folders'
import { readCachedErrors, triggerMerge } from '../core/instructions'
import { detectAgents, configureAllAgents } from '../core/ai-clients'
import { computePageStatuses, getSettingsSeverity, maxSeverity } from '../core/wizard-status'
import type { DeployStatus, Severity } from '../shared/types'
import { createTray, updateTrayIcon } from '../platform/tray'
import { showWindow, sendAppState, setQuitting } from './window'
import { setupIpcHandlers, ensureBackendRunning, ensureBackendStopped } from './ipc-handlers'

// =============================================================================
// APP STATE
// =============================================================================

let appState: AppState = createInitialState()

/** Текущий статус деплоя (обновляется из ipc-handlers). */
let currentDeployStatus: DeployStatus = { state: 'idle' }

/** Обновить deploy status (вызывается из ipc-handlers через context). */
export const setCurrentDeployStatus = (status: DeployStatus): void => {
  currentDeployStatus = status
}

// =============================================================================
// FILE WATCHER (DuetData/data/)
// =============================================================================

let dataWatcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastWatchedPath: string | null = null

/**
 * Watch DuetData/data/ for external changes (scan.json, errors.json written by Backend CLI).
 * Debounced: multiple rapid changes coalesce into one updateAppState() call.
 */
function startDataWatcher(duetDataPath: string): void {
  stopDataWatcher()
  const dataDir = join(duetDataPath, 'data')
  if (!existsSync(dataDir)) return
  try {
    dataWatcher = watch(dataDir, { persistent: false }, () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        updateAppState()
        sendAppState(appState)
      }, 500)
    })
    dataWatcher.on('error', () => {
      // Directory deleted or inaccessible — stop watching silently
      stopDataWatcher()
    })
  } catch {
    // fs.watch not supported or path issue — non-critical
  }
}

function stopDataWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (dataWatcher) {
    dataWatcher.close()
    dataWatcher = null
  }
}

/**
 * Обновляет AppState и уведомляет tray + renderer.
 * Tray показывает warning если:
 * - VERSION mismatch (нужен деплой)
 * - Любой шаг визарда в состоянии 'error' (scan/instruction/agent проблемы)
 */
const updateAppState = (): void => {
  appState = checkAppState()

  // Manage DuetData/data/ watcher lifecycle — restart when path changes or retry if not running
  const newPath = appState.duetDataPath ?? null
  if (newPath !== lastWatchedPath) {
    lastWatchedPath = newPath
    if (newPath) {
      startDataWatcher(newPath)
    } else {
      stopDataWatcher()
    }
  } else if (newPath && !dataWatcher) {
    // Path unchanged but watcher not running (data dir may have appeared after deploy)
    startDataWatcher(newPath)
  }

  // Build metadata for deploy warning checks
  const resourcesPath = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources-dev')
  const buildSha = readBuildSha(resourcesPath)
  const machineConfig = readMachineConfig()
  const devBackendPath =
    typeof machineConfig?.devBackendPath === 'string' ? machineConfig.devBackendPath : undefined

  const hasDeployWarning = isDeployWarning(appState, app.getVersion(), buildSha, devBackendPath)

  // Always resolve deploy status from disk (currentDeployStatus may be stale 'idle')
  if (appState.status === 'ready') {
    currentDeployStatus = resolveDeployStatus(appState, app.getVersion(), currentDeployStatus)
  }

  // Compute wizard severity from cached data (all fs reads, cheap)
  let settingsSeverity: Severity | null = null
  if (appState.status === 'ready' && appState.duetDataPath) {
    try {
      const port = readPort()
      const statuses = computePageStatuses({
        appState,
        deployStatus: currentDeployStatus,
        cachedScan: readCachedScan(appState.duetDataPath),
        cachedInstructionsErrors: readCachedErrors(appState.duetDataPath),
        agents: detectAgents(appState.duetDataPath, port),
        hasDeployWarning
      })
      settingsSeverity = getSettingsSeverity(statuses)
    } catch {
      // Port not configured yet, or other issue — don't fail updateAppState
    }
  }

  // Deploy warning feeds into tray even when step statuses can't be computed
  const deploySeverity: Severity | null = hasDeployWarning ? 'warning' : null

  const overallSeverity = maxSeverity([deploySeverity, settingsSeverity])
  updateTrayIcon(appState.status, overallSeverity)
  sendAppState(appState)
}

// =============================================================================
// SINGLE INSTANCE LOCK
// =============================================================================

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Другой экземпляр уже запущен — выходим
  app.quit()
} else {
  // При попытке запустить второй экземпляр — показываем окно первого
  app.on('second-instance', () => {
    showWindow(appState)
  })
}

// =============================================================================
// APP LIFECYCLE
// =============================================================================

if (gotTheLock) {
  app.whenReady().then(() => {
    // Windows: устанавливаем App User Model ID для правильной группировки в taskbar
    app.setAppUserModelId('org.ve68.duet')

    // Проверяем первый ли это запуск (нет конфига)
    const isFirstRun = !existsSync(getConfigFile())

    // Проверяем состояние приложения
    appState = checkAppState()

    // В production отключаем Cmd/Ctrl+R для перезагрузки
    if (app.isPackaged) {
      app.on('browser-window-created', (_, window) => {
        window.webContents.on('before-input-event', (event, input) => {
          if (input.control && input.key.toLowerCase() === 'r') {
            event.preventDefault()
          }
          if (input.meta && input.key.toLowerCase() === 'r') {
            event.preventDefault()
          }
        })
      })
    }

    // Настраиваем IPC handlers
    setupIpcHandlers({
      getAppState: () => appState,
      updateAppState,
      setDeployStatus: setCurrentDeployStatus
    })

    // Создаём tray
    createTray(appState.status, {
      onShowWindow: () => showWindow(appState),
      onQuit: () => {
        setQuitting(true)
        app.quit()
      }
    })



    // Обновляем tray с полным набором warnings (deploy + wizard)
    updateAppState()

    // На macOS скрываем Dock иконку по умолчанию (живём в Menu Bar)
    if (process.platform === 'darwin') {
      app.dock?.hide()
    }

    // Логика показа окна при старте:
    // - Первый запуск (no config) → показываем окно для onboarding
    // - path_lost → показываем окно (нужно исправить)
    // - ready → молча в tray
    if (isFirstRun || appState.status !== 'ready') {
      showWindow(appState)
    }

    // Auto-start backend if ready and deployed (warning is OK — backend is functional)
    if (
      appState.status === 'ready' &&
      appState.duetDataPath &&
      readDeployedVersion(appState.duetDataPath) !== null
    ) {
      const duetDataPath = appState.duetDataPath
      ensureBackendRunning(duetDataPath)
        .then(async () => {
          const port = readPort()

          // Auto-scan business folders if configured and scan never ran
          if (getBusinessFolders().length > 0 && readCachedScan(duetDataPath) === null) {
            try {
              await triggerScan(port)
            } catch (e) {
              console.error('Auto-scan business folders failed:', e)
            }
          }

          // Auto-merge instructions if path configured and merge never ran
          if (appState.instructionsPath && readCachedErrors(duetDataPath) === null) {
            try {
              const result = await triggerMerge(port)
              if (result.errors.length === 0) {
                configureAllAgents(duetDataPath, port)
              }
            } catch (e) {
              console.error('Auto-merge instructions failed:', e)
            }
          }

          updateAppState()
        })
        .catch((err) => {
          console.error('Auto-start backend failed:', err)
        })
    }

    app.on('activate', () => {
      showWindow(appState)
    })
  })

  // Не завершаем приложение при закрытии всех окон — живём в трее
  app.on('window-all-closed', () => {
    // Ничего не делаем — приложение продолжает работать в трее
  })

  // Обработка перед выходом: остановить бэкенд и watcher
  let isQuitting = false
  app.on('before-quit', (e) => {
    setQuitting(true)
    stopDataWatcher()

    // Prevent re-entrant quit while stopping backend
    if (isQuitting) return
    isQuitting = true

    if (appState.status === 'ready' && appState.duetDataPath) {
      e.preventDefault()
      ensureBackendStopped()
        .catch((err) => console.error('Stop backend on quit failed:', err))
        .finally(() => app.quit())
    }
  })
} // end if (gotTheLock)
