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
  RootContextEntry,
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
  ContextEntity,
  ContextsCache,
  MigrationContextError,
  MigrationCriticalError,
  MigrationResult
} from '../shared/types'

export type { PageStatus, PageStatuses, WizardPage } from '../core/wizard-status'

// Import for use in DuetAPI interface
import type {
  AppState,
  RootContextEntry,
  DeployStatus,
  BackendStatus,
  PythonStatus,
  AgentInfo,
  InstructionsMergeResult,
  InstructionsError,
  ScanResult,
  ContextsCache,
  MigrationResult
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

  // Root Contexts
  getRootContextFolders: () => Promise<RootContextEntry[]>
  saveRootContextFolders: (folders: string[]) => Promise<void>
  addRootContextFolder: (absolutePath: string) => Promise<RootContextEntry[]>
  scanContexts: () => Promise<ScanResult>
  getCachedScan: () => Promise<ScanResult | null>
  getCachedContexts: () => Promise<ContextsCache | null>

  // Schema migrations
  getMigrationStatus: () => Promise<MigrationResult>
  onMigrationStatusChanged: (callback: (status: MigrationResult) => void) => () => void

  // Instructions download
  downloadInstructionsTemplate: (targetFolder: string) => Promise<{ ok: boolean; error?: string }>
  isInstructionsFolderEmpty: (folderPath: string) => Promise<boolean>

  // Instructions fix
  fixInstructionsError: (relativePath: string, reasonCode: string) => Promise<boolean>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: DuetAPI
  }
}
