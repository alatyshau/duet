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
import type { Severity } from '../shared/types'

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

/** Tooltip overrides when app is ready but has severity issues. */
const SEVERITY_TOOLTIPS: Record<Severity, string> = {
  error: 'Duet — требуется внимание',
  warning: 'Duet — требуется обновление'
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
 * Возвращает путь к tray иконке в зависимости от платформы и severity.
 *
 * Файлы:
 * - macOS: resources/tray/mac/trayTemplate.png (normal), trayWarningTemplate.png (warning), trayError.png (error)
 * - Windows: resources/tray/win/tray.ico (normal), tray-warning.ico (warning), tray-error.ico (error)
 * - Linux: использует те же PNG что и macOS
 */
export const getTrayIconPath = (severity: Severity | null): string => {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const dir = 'resources/tray/mac'
    if (severity === 'error') return getResourcePath(`${dir}/trayError.png`)
    if (severity === 'warning') return getResourcePath(`${dir}/trayWarningTemplate.png`)
    return getResourcePath(`${dir}/trayTemplate.png`)
  } else {
    // Windows
    const dir = 'resources/tray/win'
    if (severity === 'error') return getResourcePath(`${dir}/tray-error.ico`)
    if (severity === 'warning') return getResourcePath(`${dir}/tray-warning.ico`)
    return getResourcePath(`${dir}/tray.ico`)
  }
}

/**
 * Создаёт NativeImage для tray иконки.
 */
export const createTrayImage = (severity: Severity | null): Electron.NativeImage => {
  const iconPath = getTrayIconPath(severity)
  const image = nativeImage.createFromPath(iconPath)

  if (process.platform === 'darwin') {
    // Error icon is colored (non-template) — red dot must stay red.
    // Normal and warning are template images — adapt to light/dark menu bar.
    image.setTemplateImage(severity !== 'error')
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
  const severity: Severity | null = status !== 'ready' ? 'warning' : null
  tray = new Tray(createTrayImage(severity))
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
 *
 * AppStatus != ready → severity from status (no_config/path_lost = warning icon).
 * AppStatus == ready → use provided severity (from wizard + deploy aggregation).
 */
export const updateTrayIcon = (status: AppStatus, severity: Severity | null): void => {
  if (!tray) return

  // AppStatus errors override external severity
  const effectiveSeverity: Severity | null = status !== 'ready' ? 'warning' : severity

  const image = createTrayImage(effectiveSeverity)
  tray.setImage(image)

  const tooltip =
    status === 'ready' && effectiveSeverity
      ? SEVERITY_TOOLTIPS[effectiveSeverity]
      : TRAY_TOOLTIPS[status]
  tray.setToolTip(tooltip)
}

/**
 * Возвращает текущий экземпляр tray.
 */
export const getTray = (): Tray | null => tray
