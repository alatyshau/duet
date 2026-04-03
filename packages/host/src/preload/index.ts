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
import type {
  AppState,
  DeployStatus,
  BackendStatus,
  PythonStatus,
  AgentInfo,
  InstructionsMergeResult,
  InstructionsError,
  ScanResult
} from '../shared/types'

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
    return () => {
      ipcRenderer.removeListener('app-state-changed', handler)
    }
  },

  // Выбор папки через диалог
  selectFolder: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:select-folder', defaultPath),

  // Сохранить pointer файл (~/.org.ve68.duet)
  savePointer: (config: {
    duetDataPath: string
    duetConfigPath: string
    machine: string
  }): Promise<AppState> => ipcRenderer.invoke('config:save-pointer', config),

  // Открыть папку в Finder/Explorer
  openPath: (path: string): Promise<void> => ipcRenderer.invoke('shell:open-path', path),

  // === Config ===

  setDeployChannel: (channel: 'dev' | 'prod'): Promise<AppState> =>
    ipcRenderer.invoke('config:set-deploy-channel', channel),

  // === Deploy ===

  getDeployStatus: (): Promise<DeployStatus> => ipcRenderer.invoke('deploy:get-status'),

  startDeploy: (): Promise<void> => ipcRenderer.invoke('deploy:start'),

  onDeployLog: (callback: (message: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => {
      callback(message)
    }
    ipcRenderer.on('deploy:log', handler)
    return () => {
      ipcRenderer.removeListener('deploy:log', handler)
    }
  },

  onDeployStatusChanged: (callback: (status: DeployStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DeployStatus): void => {
      callback(status)
    }
    ipcRenderer.on('deploy:status-changed', handler)
    return () => {
      ipcRenderer.removeListener('deploy:status-changed', handler)
    }
  },

  // === Python ===

  detectPython: (): Promise<PythonStatus> => ipcRenderer.invoke('python:detect'),

  validatePython: (path: string): Promise<PythonStatus> =>
    ipcRenderer.invoke('python:validate', path),

  savePythonPath: (path: string): Promise<void> => ipcRenderer.invoke('python:save', path),

  selectFile: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:select-file', defaultPath),

  // === Backend ===

  getBackendStatus: (): Promise<BackendStatus> => ipcRenderer.invoke('backend:get-status'),

  startBackend: (): Promise<void> => ipcRenderer.invoke('backend:start'),

  stopBackend: (): Promise<void> => ipcRenderer.invoke('backend:stop'),

  onBackendStatusChanged: (callback: (status: BackendStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: BackendStatus): void => {
      callback(status)
    }
    ipcRenderer.on('backend:status-changed', handler)
    return () => {
      ipcRenderer.removeListener('backend:status-changed', handler)
    }
  },

  // === AI Agents ===

  getAgents: (): Promise<AgentInfo[]> => ipcRenderer.invoke('agents:detect'),

  configureAgents: (): Promise<AgentInfo[]> => ipcRenderer.invoke('agents:configure'),

  fixAgentIssue: (agentId: string, reasonCode: string): Promise<boolean> =>
    ipcRenderer.invoke('agents:fix-issue', agentId, reasonCode),

  // === Instructions ===

  mergeInstructions: (): Promise<InstructionsMergeResult> =>
    ipcRenderer.invoke('instructions:merge'),

  getInstructionsErrors: (): Promise<InstructionsError[]> =>
    ipcRenderer.invoke('instructions:get-errors'),

  // === Business Folders ===

  getBusinessFolders: (): Promise<string[]> => ipcRenderer.invoke('business-folders:get'),

  saveBusinessFolders: (folders: string[]): Promise<void> =>
    ipcRenderer.invoke('business-folders:save', folders),

  scanBusinessFolders: (): Promise<ScanResult> => ipcRenderer.invoke('business-folders:scan')
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
