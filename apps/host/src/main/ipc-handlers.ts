/*
 * ЧТО: IPC handlers для связи main ↔ renderer.
 * ЗАЧЕМ: Регистрирует все обработчики IPC в одном месте.
 * КТО ИСПОЛЬЗУЕТ: main process при инициализации.
 */
import { ipcMain, dialog, shell } from 'electron'
import { readConfig, writeConfig } from '../core/config'
import type { AppState } from '../core/app-state'

// =============================================================================
// ТИПЫ
// =============================================================================

export interface IpcHandlersContext {
  getAppState: () => AppState
  updateAppState: () => void
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
    context.updateAppState()
    return context.getAppState()
  })

  // Открыть путь в Finder/Explorer
  ipcMain.handle('shell:open-path', (_event, path: string) => {
    shell.openPath(path)
  })
}
