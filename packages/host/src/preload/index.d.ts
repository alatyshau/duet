/*
 * ЧТО: TypeScript типы для глобальных объектов window в renderer.
 * ЗАЧЕМ: Даёт автокомплит и типизацию для window.electron и window.api.
 * КТО ИСПОЛЬЗУЕТ: TypeScript при компиляции renderer-кода.
 */
import { ElectronAPI } from '@electron-toolkit/preload'

// Типы AppState (должны совпадать с core/app-state.ts и preload/index.ts)
export type AppStatus = 'no_config' | 'path_lost' | 'ready'

export interface AppState {
  status: AppStatus
  duetDataPath: string | null
  duetConfigPath: string | null
  machine: string | null
  pathExists: boolean
}

// Типы для Duet API
export interface DuetAPI {
  getAppState: () => Promise<AppState>
  onAppStateChanged: (callback: (state: AppState) => void) => () => void
  selectFolder: () => Promise<string | null>
  savePointer: (config: { duetDataPath: string; duetConfigPath: string; machine: string }) => Promise<AppState>
  openPath: (path: string) => Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DuetAPI
  }
}
