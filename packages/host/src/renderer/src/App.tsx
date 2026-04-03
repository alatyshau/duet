/*
 * Корневой React-компонент приложения.
 * Управляет навигацией и получает AppState от main process.
 *
 * Фаза 5: wizard routes 1-6 рендерят InstallPage (монолитная страница),
 * route "agents" рендерит AgentsPage. В фазе 6 каждый route получит
 * свою страницу из pages/wizard/.
 */
import { useState, useEffect } from 'react'
import { Layout } from './components/layout/Layout'
import { InstallPage } from './pages/InstallPage'
import { AgentsPage } from './pages/AgentsPage'
import { AppPage } from './pages/apps/BackendAppPage'
import { backendStatusToProcessStatus } from '../../shared/mappers'
import { BUILTIN_APPS } from '../../core/apps'
import { DEFAULT_PAGE } from './navigation'
import type { Page } from './navigation'
import type { AppState, BackendStatus, ProcessStatus } from '../../preload/index.d'

function App(): React.JSX.Element {
  const [currentPage, setCurrentPage] = useState<Page>(DEFAULT_PAGE)
  const [appState, setAppState] = useState<AppState | null>(null)
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'stopped' })

  // Draft state for pointer fields (before saving).
  // Moves to individual wizard pages in Phase 6.
  const [draftDuetDataPath, setDraftDuetDataPath] = useState<string | null>(null)
  const [draftDuetConfigPath, setDraftDuetConfigPath] = useState<string | null>(null)
  const [draftMachine, setDraftMachine] = useState('')

  const backendProcessStatus: ProcessStatus = backendStatusToProcessStatus(backendStatus)

  useEffect(() => {
    if (!window.api) return

    window.api
      .getAppState()
      .then((state) => {
        setAppState(state)
        if (state.duetDataPath) setDraftDuetDataPath(state.duetDataPath)
        if (state.duetConfigPath) setDraftDuetConfigPath(state.duetConfigPath)
        if (state.machine) setDraftMachine(state.machine)
      })
      .catch(console.error)

    const unsubscribe = window.api.onAppStateChanged((state) => {
      setAppState(state)
      if (state.duetDataPath) setDraftDuetDataPath(state.duetDataPath)
      if (state.duetConfigPath) setDraftDuetConfigPath(state.duetConfigPath)
      if (state.machine) setDraftMachine(state.machine)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!window.api) return

    window.api.getBackendStatus().then(setBackendStatus).catch(console.error)

    const unsub = window.api.onBackendStatusChanged(setBackendStatus)
    return () => {
      unsub()
    }
  }, [])

  // Выбор папки через системный диалог
  const handleSelectFolder = async (field: 'duetDataPath' | 'duetConfigPath'): Promise<void> => {
    const currentPath = field === 'duetDataPath' ? draftDuetDataPath : draftDuetConfigPath
    const result = await window.api.selectFolder(currentPath || undefined)
    if (result) {
      if (field === 'duetDataPath') {
        setDraftDuetDataPath(result)
      } else {
        setDraftDuetConfigPath(result)
      }

      // Auto-save if all fields filled
      const data = field === 'duetDataPath' ? result : draftDuetDataPath
      const config = field === 'duetConfigPath' ? result : draftDuetConfigPath
      const machine = draftMachine.trim()

      if (data && config && machine) {
        const newState = await window.api.savePointer({
          duetDataPath: data,
          duetConfigPath: config,
          machine
        })
        setAppState(newState)
      }
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!draftDuetDataPath || !draftDuetConfigPath || !draftMachine.trim()) return

    const newState = await window.api.savePointer({
      duetDataPath: draftDuetDataPath,
      duetConfigPath: draftDuetConfigPath,
      machine: draftMachine.trim()
    })
    setAppState(newState)
  }

  const handleOpenPath = (path: string): void => {
    window.api.openPath(path)
  }

  // Backend controls
  const handleBackendStart = async (): Promise<void> => {
    try {
      await window.api.startBackend()
    } catch (e) {
      console.error('Backend start failed:', e)
    }
  }

  const handleBackendStop = async (): Promise<void> => {
    try {
      await window.api.stopBackend()
    } catch (e) {
      console.error('Backend stop failed:', e)
    }
  }

  const handleBackendRestart = async (): Promise<void> => {
    try {
      await window.api.stopBackend()
      await window.api.startBackend()
    } catch (e) {
      console.error('Backend restart failed:', e)
    }
  }

  const handleBackendRefresh = async (): Promise<void> => {
    try {
      const status = await window.api.getBackendStatus()
      setBackendStatus(status)
    } catch (e) {
      console.error('Backend refresh failed:', e)
    }
  }

  if (!window.api) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-red-500">Ошибка: preload не загрузился</div>
      </div>
    )
  }

  if (!appState) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    )
  }

  // Merge draft with appState for display
  const displayState: AppState = {
    ...appState,
    duetDataPath: draftDuetDataPath,
    duetConfigPath: draftDuetConfigPath,
    machine: draftMachine || appState.machine
  }

  const renderPage = (): React.ReactNode => {
    switch (currentPage) {
      // Wizard pages 1-6: temporarily render InstallPage (monolithic).
      // Phase 6 will replace each with its own page from pages/wizard/.
      case 'duet-data':
      case 'duet-config':
      case 'python':
      case 'backend':
      case 'business-folders':
      case 'instructions':
        return (
          <InstallPage
            appState={displayState}
            onSelectFolder={handleSelectFolder}
            onSave={handleSave}
            onOpenPath={handleOpenPath}
            machine={draftMachine}
            onMachineChange={setDraftMachine}
          />
        )
      // Wizard page 7: temporarily render AgentsPage.
      case 'agents':
        return <AgentsPage />
      case 'app:duet-backend': {
        const app = BUILTIN_APPS.find((a) => a.id === 'duet-backend')!
        return (
          <AppPage
            app={app}
            processStatuses={{ http: backendProcessStatus }}
            onStart={handleBackendStart}
            onStop={handleBackendStop}
            onRestart={handleBackendRestart}
            onRefresh={handleBackendRefresh}
          />
        )
      }
    }
  }

  return (
    <Layout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      onOpenFolder={() => appState.duetDataPath && handleOpenPath(appState.duetDataPath)}
      folderConfigured={appState.status === 'ready'}
      backendProcessState={backendProcessStatus.state}
    >
      {renderPage()}
    </Layout>
  )
}

export default App
