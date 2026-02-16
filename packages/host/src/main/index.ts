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
import { existsSync } from 'fs'
import { checkAppState, createInitialState, type AppState } from '../core/app-state'
import { getConfigFile } from '../core/config'
import { isDeployWarning } from '../core/deploy'
import { createTray, updateTrayIcon } from '../platform/tray'
import { showWindow, sendAppState, setQuitting } from './window'
import { setupIpcHandlers, ensureBackendRunning, ensureBackendStopped } from './ipc-handlers'

// =============================================================================
// APP STATE
// =============================================================================

let appState: AppState = createInitialState()

/**
 * Обновляет AppState и уведомляет tray + renderer.
 * Tray показывает warning если VERSION mismatch (нужен деплой).
 */
const updateAppState = (): void => {
  appState = checkAppState()
  updateTrayIcon(appState.status, isDeployWarning(appState, app.getVersion()))
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
      updateAppState
    })

    // Создаём tray
    createTray(appState.status, {
      onShowWindow: () => showWindow(appState),
      onQuit: () => {
        setQuitting(true)
        app.quit()
      }
    })

    // Учитываем deploy warning на старте (VERSION mismatch при status=ready)
    updateTrayIcon(appState.status, isDeployWarning(appState, app.getVersion()))

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

    // Auto-start backend if ready and deployed
    if (
      appState.status === 'ready' &&
      appState.duetDataPath &&
      !isDeployWarning(appState, app.getVersion())
    ) {
      ensureBackendRunning(appState.duetDataPath).catch((err) => {
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

  // Обработка перед выходом: остановить бэкенд
  let isQuitting = false
  app.on('before-quit', (e) => {
    setQuitting(true)

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
