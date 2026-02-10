/*
 * ЧТО: IPC handlers для связи main ↔ renderer.
 * ЗАЧЕМ: Регистрирует все обработчики IPC в одном месте.
 * КТО ИСПОЛЬЗУЕТ: main process при инициализации.
 */
import { ipcMain, dialog, shell } from 'electron'
import { writeConfig } from '../core/config'
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
      title: 'Выберите папку'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // Сохранить pointer файл (~/.org.ve68.duet)
  ipcMain.handle('config:save-pointer', (_event, config: { duetDataPath: string; duetConfigPath: string; machine: string }) => {
    writeConfig({
      duetDataPath: config.duetDataPath,
      duetConfigPath: config.duetConfigPath,
      machine: config.machine
    })
    context.updateAppState()
    return context.getAppState()
  })

  // Открыть путь в Finder/Explorer
  ipcMain.handle('shell:open-path', (_event, path: string) => {
    shell.openPath(path)
  })
}
