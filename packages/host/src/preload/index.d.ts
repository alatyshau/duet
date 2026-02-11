/*
 * ЧТО: TypeScript типы для глобальных объектов window в renderer.
 * ЗАЧЕМ: Даёт автокомплит и типизацию для window.electron и window.api.
 * КТО ИСПОЛЬЗУЕТ: TypeScript при компиляции renderer-кода.
 *
 * Типы реэкспортируются из shared/types.ts (single source of truth).
 */
import { ElectronAPI } from '@electron-toolkit/preload'

// Re-export shared types for renderer imports
export type { AppStatus, AppState, DeployChannel, DeployStatus, AgentStatus, AgentInfo } from '../shared/types'

// Import for use in DuetAPI interface
import type { AppState, DeployStatus, AgentInfo } from '../shared/types'

// Типы для Duet API
export interface DuetAPI {
  getAppState: () => Promise<AppState>
  onAppStateChanged: (callback: (state: AppState) => void) => () => void
  selectFolder: () => Promise<string | null>
  savePointer: (config: { duetDataPath: string; duetConfigPath: string; machine: string }) => Promise<AppState>
  openPath: (path: string) => Promise<void>

  // Config
  setDeployChannel: (channel: 'dev' | 'prod') => Promise<AppState>

  // Deploy
  getDeployStatus: () => Promise<DeployStatus>
  startDeploy: () => Promise<void>
  onDeployLog: (callback: (message: string) => void) => () => void
  onDeployStatusChanged: (callback: (status: DeployStatus) => void) => () => void

  // AI Agents
  getAgents: () => Promise<AgentInfo[]>
  configureAgents: () => Promise<AgentInfo[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DuetAPI
  }
}
