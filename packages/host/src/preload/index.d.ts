/*
 * ЧТО: TypeScript типы для глобальных объектов window в renderer.
 * ЗАЧЕМ: Даёт автокомплит и типизацию для window.electron и window.api.
 * КТО ИСПОЛЬЗУЕТ: TypeScript при компиляции renderer-кода.
 *
 * Типы реэкспортируются из shared/types.ts (single source of truth).
 */
import { ElectronAPI } from '@electron-toolkit/preload'

// Re-export shared types for renderer imports
export type {
  AppStatus,
  AppState,
  DeployChannel,
  DeployStatus,
  BackendStatus,
  PythonStatus,
  AgentStatus,
  AgentCheckedFile,
  AgentIssue,
  AgentInfo,
  ProcessType,
  ProcessState,
  ProcessStatus,
  ProcessInfo,
  AppInfo,
  InstructionsError,
  InstructionsMergeResult,
  ScanError,
  ScanResult,
  StreamEntity,
  StreamsCache
} from '../shared/types'

export type { PageStatus, PageStatuses, WizardPage } from '../core/wizard-status'

// Import for use in DuetAPI interface
import type {
  AppState,
  DeployStatus,
  BackendStatus,
  PythonStatus,
  AgentInfo,
  InstructionsMergeResult,
  InstructionsError,
  ScanResult,
  StreamsCache
} from '../shared/types'

// Типы для Duet API
export interface DuetAPI {
  getAppState: () => Promise<AppState>
  onAppStateChanged: (callback: (state: AppState) => void) => () => void
  selectFolder: (defaultPath?: string) => Promise<string | null>
  savePointer: (config: {
    duetDataPath?: string
    duetConfigPath?: string
    machine?: string
  }) => Promise<AppState>
  openPath: (path: string) => Promise<void>

  // Config
  setDeployChannel: (channel: 'dev' | 'prod') => Promise<AppState>

  // Deploy
  getDeployStatus: () => Promise<DeployStatus>
  startDeploy: () => Promise<void>
  onDeployLog: (callback: (message: string) => void) => () => void
  onDeployStatusChanged: (callback: (status: DeployStatus) => void) => () => void

  // Python
  detectPython: () => Promise<PythonStatus>
  validatePython: (path: string) => Promise<PythonStatus>
  savePythonPath: (path: string) => Promise<void>
  selectFile: (defaultPath?: string) => Promise<string | null>

  // Backend
  getBackendStatus: () => Promise<BackendStatus>
  startBackend: () => Promise<void>
  stopBackend: () => Promise<void>
  onBackendStatusChanged: (callback: (status: BackendStatus) => void) => () => void

  // AI Agents
  getAgents: () => Promise<AgentInfo[]>
  configureAgents: () => Promise<AgentInfo[]>
  fixAgentIssue: (agentId: string, reasonCode: string) => Promise<boolean>

  // Instructions
  mergeInstructions: () => Promise<InstructionsMergeResult>
  getInstructionsErrors: () => Promise<InstructionsError[] | null>
  setInstructionsPath: (path: string) => Promise<AppState>

  // Business Folders
  getBusinessFolders: () => Promise<string[]>
  saveBusinessFolders: (folders: string[]) => Promise<void>
  scanBusinessFolders: () => Promise<ScanResult>
  getCachedScan: () => Promise<ScanResult | null>
  getCachedStreams: () => Promise<StreamsCache | null>

  // Instructions fix
  fixInstructionsError: (relativePath: string, reasonCode: string) => Promise<boolean>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DuetAPI
  }
}
