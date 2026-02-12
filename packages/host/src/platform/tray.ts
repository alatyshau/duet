/*
 * ЧТО: Системный трей (Menu Bar на macOS, System Tray на Windows).
 * ЗАЧЕМ: Приложение живёт в трее, иконка отражает статус.
 * КТО ИСПОЛЬЗУЕТ: main process.
 *
 * ⚠️ РУЧНЫЕ ТЕСТЫ: Playwright не видит системный трей.
 * Перед изменением — проверить вручную на Mac + Windows.
 * См. README.md в этой папке.
 */
import { app, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import type { AppStatus } from '../core/app-state'

// =============================================================================
// ТИПЫ
// =============================================================================

export interface TrayCallbacks {
  onShowWindow: () => void
  onQuit: () => void
}

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/** Тексты tooltip для каждого статуса */
const TRAY_TOOLTIPS: Record<AppStatus, string> = {
  no_config: 'Duet — требуется настройка',
  path_lost: 'Duet — папка не найдена',
  ready: 'Duet'
}

// =============================================================================
// ПУТИ К РЕСУРСАМ
// =============================================================================

/**
 * Путь к ресурсам (разный для dev и production).
 */
const getResourcePath = (relativePath: string): string => {
  if (app.isPackaged) {
    // В production: ресурсы копируются в process.resourcesPath через extraResources
    return join(process.resourcesPath, relativePath)
  }
  // В dev: относительно out/main/
  return join(__dirname, '../../', relativePath)
}

/**
 * Возвращает путь к tray иконке в зависимости от платформы и статуса.
 *
 * Файлы:
 * - macOS: resources/tray/mac/trayTemplate.png, trayWarningTemplate.png
 * - Windows: resources/tray/win/tray.ico, tray-warning.ico
 * - Linux: использует те же PNG что и macOS
 */
export const getTrayIconPath = (warning: boolean): string => {
  if (process.platform === 'darwin') {
    const file = warning ? 'trayWarningTemplate.png' : 'trayTemplate.png'
    return getResourcePath(`resources/tray/mac/${file}`)
  } else if (process.platform === 'win32') {
    const file = warning ? 'tray-warning.ico' : 'tray.ico'
    return getResourcePath(`resources/tray/win/${file}`)
  } else {
    // Linux
    const file = warning ? 'trayWarningTemplate.png' : 'trayTemplate.png'
    return getResourcePath(`resources/tray/mac/${file}`)
  }
}

/**
 * Создаёт NativeImage для tray иконки.
 */
export const createTrayImage = (status: AppStatus): Electron.NativeImage => {
  const isWarning = status !== 'ready'
  const iconPath = getTrayIconPath(isWarning)
  const image = nativeImage.createFromPath(iconPath)

  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  }

  return image
}

// =============================================================================
// TRAY MANAGEMENT
// =============================================================================

let tray: Tray | null = null

/**
 * Создаёт tray с контекстным меню.
 */
export const createTray = (status: AppStatus, callbacks: TrayCallbacks): Tray => {
  tray = new Tray(createTrayImage(status))
  tray.setToolTip(TRAY_TOOLTIPS[status])

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть Duet',
      click: callbacks.onShowWindow
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
      click: callbacks.onQuit
    }
  ])

  tray.setContextMenu(contextMenu)

  // Клик по иконке показывает окно
  tray.on('click', () => {
    callbacks.onShowWindow()
  })

  return tray
}

/**
 * Обновляет иконку и tooltip tray.
 * deployWarning=true показывает warning иконку даже при status=ready
 * (VERSION mismatch — нужен деплой через кнопку "Установить").
 */
export const updateTrayIcon = (status: AppStatus, deployWarning?: boolean): void => {
  if (!tray) return

  const isWarning = status !== 'ready' || deployWarning
  const iconPath = getTrayIconPath(!!isWarning)
  const image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  }

  tray.setImage(image)

  const tooltip =
    deployWarning && status === 'ready' ? 'Duet — требуется обновление' : TRAY_TOOLTIPS[status]
  tray.setToolTip(tooltip)
}

/**
 * Возвращает текущий экземпляр tray.
 */
export const getTray = (): Tray | null => tray
