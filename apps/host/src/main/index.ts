/*
 * ЧТО: Точка входа главного процесса Electron (main process).
 * ЗАЧЕМ: Создаёт tray-приложение (Menu Bar на macOS, System Tray на Windows).
 * КТО ИСПОЛЬЗУЕТ: Electron при запуске приложения.
 *
 * АРХИТЕКТУРА:
 * - Main process владеет AppState (source of truth)
 * - Приложение живёт в трее, окно показывается по клику
 * - Закрытие окна скрывает его, а не завершает приложение
 * - Tray иконка отражает статус (normal / warning)
 */
import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import icon from '../../resources/icon.png?asset'

// =============================================================================
// ТИПЫ
// =============================================================================

type AppStatus = 'no_config' | 'path_lost' | 'ready'

interface AppState {
  status: AppStatus
  duetDataPath: string | null
  pathExists: boolean
}

interface Config {
  duetDataPath?: string
}

// =============================================================================
// КОНФИГУРАЦИЯ: ~/.org.ve68.duet/config.json
// =============================================================================

const DUET_CONFIG_DIR = join(homedir(), '.org.ve68.duet')
const DUET_CONFIG_FILE = join(DUET_CONFIG_DIR, 'config.json')

/**
 * Создаёт директорию конфига если не существует
 */
const ensureConfigDir = (): void => {
  if (!existsSync(DUET_CONFIG_DIR)) {
    mkdirSync(DUET_CONFIG_DIR, { recursive: true })
  }
}

/**
 * Читает конфиг из ~/.org.ve68.duet/config.json
 */
const readConfig = (): Config => {
  if (existsSync(DUET_CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(DUET_CONFIG_FILE, 'utf-8'))
    } catch {
      return {}
    }
  }
  return {}
}

/**
 * Записывает конфиг в ~/.org.ve68.duet/config.json
 */
const writeConfig = (config: Config): void => {
  ensureConfigDir()
  writeFileSync(DUET_CONFIG_FILE, JSON.stringify(config, null, 2))
}

// =============================================================================
// APP STATE
// =============================================================================

let appState: AppState = {
  status: 'no_config',
  duetDataPath: null,
  pathExists: false
}

/**
 * Проверяет состояние приложения:
 * - Есть ли конфиг?
 * - Существует ли папка DuetData?
 */
const checkAppState = (): AppState => {
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
 * Обновляет AppState и tray иконку
 */
const updateAppState = (): void => {
  appState = checkAppState()
  updateTrayIcon()

  // Отправляем новый state в renderer если окно существует
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-state-changed', appState)
  }
}

// =============================================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// =============================================================================

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let isFirstRun = false

// =============================================================================
// РЕСУРСЫ И ИКОНКИ
// =============================================================================

/**
 * Путь к ресурсам (разный для dev и production)
 */
const getResourcePath = (relativePath: string): string => {
  if (app.isPackaged) {
    // В production: ресурсы копируются в process.resourcesPath через extraResources
    return join(process.resourcesPath, relativePath)
  }
  // В dev: относительно out/main/
  return join(__dirname, '../../', relativePath)
}

/** Тексты tooltip для каждого статуса */
const TRAY_TOOLTIPS: Record<AppStatus, string> = {
  no_config: 'Duet — требуется настройка',
  path_lost: 'Duet — папка не найдена',
  ready: 'Duet'
}

/**
 * Возвращает путь к tray иконке в зависимости от платформы и статуса
 *
 * Файлы генерируются скриптом из BUILD.md:
 * - macOS: trayTemplate.png, trayWarningTemplate.png (Template images)
 * - Windows: tray.ico, tray-warning.ico
 * - Linux: используем те же PNG что и macOS
 */
const getTrayIconPath = (warning: boolean): string => {
  if (process.platform === 'darwin') {
    return getResourcePath(warning ? 'resources/trayWarningTemplate.png' : 'resources/trayTemplate.png')
  } else if (process.platform === 'win32') {
    return getResourcePath(warning ? 'resources/tray-warning.ico' : 'resources/tray.ico')
  } else {
    return getResourcePath(warning ? 'resources/trayWarningTemplate.png' : 'resources/trayTemplate.png')
  }
}

/**
 * Создаёт NativeImage для tray иконки
 */
const createTrayImage = (status: AppStatus): Electron.NativeImage => {
  const isWarning = status !== 'ready'
  const iconPath = getTrayIconPath(isWarning)
  const image = nativeImage.createFromPath(iconPath)

  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  }

  return image
}

/**
 * Обновляет иконку tray в зависимости от статуса
 */
const updateTrayIcon = (): void => {
  if (!tray) return

  tray.setImage(createTrayImage(appState.status))
  tray.setToolTip(TRAY_TOOLTIPS[appState.status])
}

// =============================================================================
// ОКНО
// =============================================================================

function createWindow(): BrowserWindow {
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

  return window
}

function showWindow(): void {
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

// =============================================================================
// TRAY
// =============================================================================

function createTray(): void {
  tray = new Tray(createTrayImage(appState.status))
  tray.setToolTip(TRAY_TOOLTIPS[appState.status])

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть Duet',
      click: showWindow
    },
    { type: 'separator' },
    {
      label: 'Запускать при старте',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem): void => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          // macOS: скрывать окно при автозапуске
          openAsHidden: true
        })
      }
    },
    { type: 'separator' },
    {
      label: 'Выйти',
      click: (): void => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // Клик по иконке показывает окно
  tray.on('click', () => {
    showWindow()
  })
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

function setupIpcHandlers(): void {
  ipcMain.on('ping', () => console.log('pong'))

  // Получить текущий AppState
  ipcMain.handle('app:get-state', () => {
    return appState
  })

  // Диалог выбора папки
  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Выберите папку DuetData'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // Сохранить путь к DuetData в конфиг
  ipcMain.handle('config:set-duet-path', (_event, path: string) => {
    const config = readConfig()
    config.duetDataPath = path
    writeConfig(config)
    updateAppState()
    return appState
  })

  // Открыть путь в Finder/Explorer
  ipcMain.handle('shell:open-path', (_event, path: string) => {
    shell.openPath(path)
  })
}

// =============================================================================
// APP LIFECYCLE
// =============================================================================

app.whenReady().then(() => {
  // Windows: устанавливаем App User Model ID для правильной группировки в taskbar
  app.setAppUserModelId('org.ve68.duet')

  // Проверяем первый ли это запуск (нет конфига)
  isFirstRun = !existsSync(DUET_CONFIG_FILE)

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
  setupIpcHandlers()

  // Создаём tray
  createTray()

  // На macOS скрываем Dock иконку по умолчанию (живём в Menu Bar)
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }

  // Логика показа окна при старте:
  // - Первый запуск (no config) → показываем окно для onboarding
  // - path_lost → показываем окно (нужно исправить)
  // - ready → молча в tray
  if (isFirstRun || appState.status !== 'ready') {
    showWindow()
  }

  app.on('activate', () => {
    showWindow()
  })
})

// Не завершаем приложение при закрытии всех окон — живём в трее
app.on('window-all-closed', () => {
  // Ничего не делаем — приложение продолжает работать в трее
})

// Обработка перед выходом
app.on('before-quit', () => {
  isQuitting = true
})
