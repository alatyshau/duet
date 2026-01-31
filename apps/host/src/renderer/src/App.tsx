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

  // При загрузке получаем AppState и подписываемся на изменения
  useEffect(() => {
    // Проверяем что preload загрузился
    if (!window.api) {
      console.error('window.api не определён — preload не загрузился')
      return
    }

    // Получаем начальное состояние
    window.api.getAppState().then(setAppState).catch(console.error)

    // Подписываемся на изменения
    const unsubscribe = window.api.onAppStateChanged(setAppState)

    return () => {
      unsubscribe()
    }
  }, [])

  // Выбор папки через системный диалог
  const handleSelectFolder = async (): Promise<void> => {
    const result = await window.api.selectFolder()
    if (result) {
      // setDuetPath возвращает новый AppState
      const newState = await window.api.setDuetPath(result)
      setAppState(newState)
    }
  }

  // Открыть папку в Finder/Explorer
  const handleOpenFolder = (): void => {
    if (appState?.duetDataPath) {
      window.api.openPath(appState.duetDataPath)
    }
  }

  // Определяем готовность
  const isReady = appState?.status === 'ready'

  // Если preload не загрузился — показываем ошибку
  if (!window.api) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-red-500">Ошибка: preload не загрузился</div>
      </div>
    )
  }

  // Если ещё загружается - показываем пустой экран
  if (!appState) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    )
  }

  // Рендер текущей страницы
  const renderPage = (): React.ReactNode => {
    switch (currentPage) {
      case 'setup':
        return (
          <SetupPage
            appState={appState}
            onSelectFolder={handleSelectFolder}
            onOpenFolder={handleOpenFolder}
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
      onOpenFolder={handleOpenFolder}
      folderConfigured={isReady}
    >
      {renderPage()}
    </Layout>
  )
}

export default App
