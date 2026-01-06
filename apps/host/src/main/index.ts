/*
 * ЧТО: Точка входа главного процесса Electron (main process).
 * ЗАЧЕМ: Создаёт tray-приложение (Menu Bar на macOS, System Tray на Windows).
 * КТО ИСПОЛЬЗУЕТ: Electron при запуске приложения.
 *
 * АРХИТЕКТУРА:
 * - Приложение живёт в трее, окно показывается по клику
 * - Закрытие окна скрывает его, а не завершает приложение
 * - Поддержка автозапуска при старте системы
 */
import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// Путь к ресурсам (разный для dev и production)
const getResourcePath = (relativePath: string): string => {
  if (app.isPackaged) {
    // В production: ресурсы в app.asar.unpacked (см. asarUnpack в electron-builder.yml)
    return join(process.resourcesPath, 'app.asar.unpacked', relativePath)
  }
  // В dev: относительно out/main/
  return join(__dirname, '../../', relativePath)
}

// Пути к иконкам tray
const getTrayIcon = (): string => {
  if (process.platform === 'darwin') {
    // macOS: Template иконка (автоматически адаптируется под тему)
    return getResourcePath('resources/trayTemplate.png')
  } else {
    // Windows/Linux
    return getResourcePath('resources/tray.ico')
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
  if (!mainWindow) {
    mainWindow = createWindow()
  }

  // На macOS показываем иконку в Dock когда окно видимо
  if (process.platform === 'darwin') {
    app.dock?.show()
  }

  mainWindow.show()
  mainWindow.focus()
}

function createTray(): void {
  const trayIconPath = getTrayIcon()
  const trayIcon = nativeImage.createFromPath(trayIconPath)

  // Для macOS делаем иконку Template (автоадаптация под тему)
  if (process.platform === 'darwin') {
    trayIcon.setTemplateImage(true)
  }

  tray = new Tray(trayIcon)
  tray.setToolTip('Duet')

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

  // Клик по иконке показывает окно (на Windows и Linux)
  // На macOS правый клик показывает меню, левый - показывает окно
  tray.on('click', () => {
    showWindow()
  })
}

app.whenReady().then(() => {
  // Windows: устанавливаем App User Model ID для правильной группировки в taskbar
  app.setAppUserModelId('org.ve68.duet')

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

  // IPC handlers
  ipcMain.on('ping', () => console.log('pong'))

  // Создаём tray и окно
  createTray()
  mainWindow = createWindow()

  // На macOS скрываем Dock иконку по умолчанию (живём в Menu Bar)
  if (process.platform === 'darwin') {
    app.dock?.hide()
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
