/*
 * ЧТО: Автозапуск приложения при старте системы.
 * ЗАЧЕМ: Duet должен работать в фоне после перезагрузки.
 * КТО ИСПОЛЬЗУЕТ: main process, tray menu.
 *
 * ⚠️ РУЧНЫЕ ТЕСТЫ: Требует проверки на реальной системе.
 * См. README.md в этой папке.
 */
import { app } from 'electron'

// =============================================================================
// AUTOLAUNCH
// =============================================================================

/**
 * Проверяет включён ли автозапуск.
 */
export const isAutoLaunchEnabled = (): boolean => {
  return app.getLoginItemSettings().openAtLogin
}

/**
 * Включает/выключает автозапуск.
 */
export const setAutoLaunch = (enabled: boolean): void => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // macOS: скрывать окно при автозапуске
    openAsHidden: true
  })
}
