/*
 * ЧТО: Управление BrowserWindow.
 * ЗАЧЕМ: Создание, показ/скрытие окна.
 * КТО ИСПОЛЬЗУЕТ: main process.
 */
import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import type { AppState } from '../core/app-state'
import icon from '../../resources/app/icon.png?asset'

// =============================================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// =============================================================================

let mainWindow: BrowserWindow | null = null
let isQuitting = false

// =============================================================================
// WINDOW MANAGEMENT
// =============================================================================

/**
 * Создаёт главное окно.
 */
export const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false
    }
  })

  // Закрытие окна скрывает его вместо завершения приложения
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      window.hide()
      // На macOS скрываем иконку в Dock когда окно скрыто
      if (process.platform === 'darwin') {
        app.dock?.hide()
      }
    }
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer based on electron-vite cli
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = window
  return window
}

/**
 * Показывает окно. Создаёт если не существует.
 */
export const showWindow = (appState: AppState): void => {
  const isNewWindow = !mainWindow

  if (!mainWindow) {
    mainWindow = createWindow()
  }

  // На macOS показываем иконку в Dock когда окно видимо
  if (process.platform === 'darwin') {
    app.dock?.show()
  }

  // Для нового окна — ждём готовности перед показом (избегаем мерцания)
  // Для существующего — показываем сразу
  if (isNewWindow) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
    // Отправляем state после загрузки контента
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('app-state-changed', appState)
    })
  } else {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('app-state-changed', appState)
  }
}

/**
 * Отправляет app state в renderer если окно существует.
 */
export const sendAppState = (appState: AppState): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-state-changed', appState)
  }
}

/**
 * Возвращает текущее окно.
 */
export const getMainWindow = (): BrowserWindow | null => mainWindow

/**
 * Устанавливает флаг завершения приложения.
 */
export const setQuitting = (value: boolean): void => {
  isQuitting = value
}

/**
 * Возвращает флаг завершения.
 */
export const isAppQuitting = (): boolean => isQuitting
