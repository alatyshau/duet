/*
 * ЧТО: Preload-скрипт — мост между main и renderer процессами.
 * ЗАЧЕМ: Безопасно экспонирует Electron API в renderer через contextBridge.
 * КТО ИСПОЛЬЗУЕТ: Electron загружает перед renderer; renderer использует window.electron.
 *
 * ЭКСПОРТЫ:
 * - window.electron: стандартный electronAPI из @electron-toolkit/preload
 * - window.api: кастомные API для Duet
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Типы для AppState (должны совпадать с core/app-state.ts)
type AppStatus = 'no_config' | 'path_lost' | 'ready'

interface AppState {
  status: AppStatus
  duetDataPath: string | null
  duetConfigPath: string | null
  machine: string | null
  pathExists: boolean
}

// Custom APIs for renderer
const api = {
  // Получить текущий AppState
  getAppState: (): Promise<AppState> => ipcRenderer.invoke('app:get-state'),

  // Подписка на изменения AppState
  onAppStateChanged: (callback: (state: AppState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppState): void => {
      callback(state)
    }
    ipcRenderer.on('app-state-changed', handler)
    // Возвращаем функцию отписки
    return () => {
      ipcRenderer.removeListener('app-state-changed', handler)
    }
  },

  // Выбор папки через диалог
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-folder'),

  // Сохранить pointer файл (~/.org.ve68.duet)
  savePointer: (config: { duetDataPath: string; duetConfigPath: string; machine: string }): Promise<AppState> =>
    ipcRenderer.invoke('config:save-pointer', config),

  // Открыть папку в Finder/Explorer
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:open-path', path)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
