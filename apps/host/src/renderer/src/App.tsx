/*
 * ЧТО: Корневой React-компонент приложения.
 * ЗАЧЕМ: Управляет навигацией и получает AppState от main process.
 * КТО ИСПОЛЬЗУЕТ: main.tsx монтирует в DOM.
 */
import { useState, useEffect } from 'react'
import { Layout } from './components/layout/Layout'
import { SetupPage } from './pages/SetupPage'
import type { AppState } from '../../preload/index.d'

function App(): React.JSX.Element {
  const [currentPage, setCurrentPage] = useState('setup')
  const [appState, setAppState] = useState<AppState | null>(null)

  // Draft state for pointer fields (before saving)
  const [draftDuetDataPath, setDraftDuetDataPath] = useState<string | null>(null)
  const [draftDuetConfigPath, setDraftDuetConfigPath] = useState<string | null>(null)
  const [draftMachine, setDraftMachine] = useState('')

  // При загрузке получаем AppState и подписываемся на изменения
  useEffect(() => {
    if (!window.api) {
      console.error('window.api не определён — preload не загрузился')
      return
    }

    window.api.getAppState().then((state) => {
      setAppState(state)
      if (state.duetDataPath) setDraftDuetDataPath(state.duetDataPath)
      if (state.duetConfigPath) setDraftDuetConfigPath(state.duetConfigPath)
      if (state.machine) setDraftMachine(state.machine)
    }).catch(console.error)

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

  // Выбор папки через системный диалог
  const handleSelectFolder = async (field: 'duetDataPath' | 'duetConfigPath'): Promise<void> => {
    const result = await window.api.selectFolder()
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
        const newState = await window.api.savePointer({ duetDataPath: data, duetConfigPath: config, machine })
        setAppState(newState)
      }
    }
  }

  // Сохранить pointer файл
  const handleSave = async (): Promise<void> => {
    if (!draftDuetDataPath || !draftDuetConfigPath || !draftMachine.trim()) return

    const newState = await window.api.savePointer({
      duetDataPath: draftDuetDataPath,
      duetConfigPath: draftDuetConfigPath,
      machine: draftMachine.trim()
    })
    setAppState(newState)
  }

  // Открыть папку в Finder/Explorer
  const handleOpenPath = (path: string): void => {
    window.api.openPath(path)
  }

  const isReady = appState?.status === 'ready'

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
      case 'setup':
        return (
          <SetupPage
            appState={displayState}
            onSelectFolder={handleSelectFolder}
            onSave={handleSave}
            onOpenPath={handleOpenPath}
            machine={draftMachine}
            onMachineChange={setDraftMachine}
          />
        )
      case 'settings':
        return <div className="text-muted-foreground">Настройки (скоро)</div>
      default:
        return null
    }
  }

  return (
    <Layout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      onOpenFolder={() => appState.duetDataPath && handleOpenPath(appState.duetDataPath)}
      folderConfigured={isReady}
    >
      {renderPage()}
    </Layout>
  )
}

export default App
