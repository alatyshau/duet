/*
 * ЧТО: Preload-скрипт — мост между main и renderer процессами.
 * ЗАЧЕМ: Безопасно экспонирует Electron API в renderer через contextBridge.
 * КТО ИСПОЛЬЗУЕТ: Electron загружает перед renderer; renderer использует window.electron.
 *
 * ЭКСПОРТЫ:
 * - window.electron: стандартный electronAPI из @electron-toolkit/preload
 * - window.api: кастомные API (пока пустой объект)
 */
import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {}

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
