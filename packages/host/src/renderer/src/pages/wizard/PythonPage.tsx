/*
 * Шаг 3: Python 3.10+ — auto-detect при открытии + ручной выбор.
 * Перенос логики из InstallPage PythonField.
 */
import { useState, useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Code, CheckCircle, AlertTriangle, Search, FolderOpen, RefreshCw } from 'lucide-react'
import type { AppState, PythonStatus } from '../../../../preload/index.d'
import type { PageStatus } from '../../../../core/wizard-status'

interface PythonPageProps {
  appState: AppState
  onStatusChange: (status: PageStatus) => void
}

export function PythonPage({ appState, onStatusChange }: PythonPageProps): React.ReactElement {
  const isReady = appState.status === 'ready'
  const [pythonStatus, setPythonStatus] = useState<PythonStatus>(
    appState.pythonPath
      ? { state: 'found', path: appState.pythonPath, version: '' }
      : { state: 'unknown' }
  )

  // Auto-detect Python on mount when config is ready
  useEffect(() => {
    if (!isReady || !window.api) return

    const detect = async (): Promise<void> => {
      setPythonStatus({ state: 'detecting' })
      try {
        const result = await window.api.detectPython()
        setPythonStatus(result)
        if (result.state === 'found') {
          await window.api.savePythonPath(result.path)
          onStatusChange('ok')
        } else {
          onStatusChange(null)
        }
      } catch {
        setPythonStatus({ state: 'not_found', hint: 'Ошибка автодетекта' })
        onStatusChange(null)
      }
    }
    void detect()
  }, [isReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDetect = async (): Promise<void> => {
    setPythonStatus({ state: 'detecting' })
    try {
      const result = await window.api.detectPython()
      setPythonStatus(result)
      if (result.state === 'found') {
        await window.api.savePythonPath(result.path)
        onStatusChange('ok')
      } else {
        onStatusChange(null)
      }
    } catch {
      setPythonStatus({ state: 'not_found', hint: 'Ошибка автодетекта' })
      onStatusChange(null)
    }
  }

  const handleSelect = async (): Promise<void> => {
    const currentPath = pythonStatus.state === 'found' ? pythonStatus.path : undefined
    const path = await window.api.selectFile(currentPath)
    if (!path) return

    setPythonStatus({ state: 'detecting' })
    const result = await window.api.validatePython(path)
    setPythonStatus(result)
    if (result.state === 'found') {
      await window.api.savePythonPath(result.path)
      onStatusChange('ok')
    } else {
      onStatusChange(null)
    }
  }

  const disabled = !isReady

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Code size={24} />
          Python 3.10+
        </h2>
        <p className="text-muted-foreground mt-1">
          Интерпретатор для Backend — автоопределение или ручной выбор
        </p>
      </div>

      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <div
          className={`flex items-start gap-3 p-4 rounded-lg border border-border bg-background ${disabled ? 'opacity-50' : ''}`}
        >
          <div className="flex-shrink-0 mt-0.5">
            {pythonStatus.state === 'found' ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : pythonStatus.state === 'detecting' ? (
              <Search className="w-5 h-5 text-blue-500 animate-pulse" />
            ) : pythonStatus.state === 'unknown' ? (
              <AlertTriangle className="w-5 h-5 text-muted-foreground" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">Python 3.10+</div>

            {pythonStatus.state === 'unknown' && (
              <p className="text-xs text-muted-foreground mt-1">
                {isReady
                  ? 'Ожидание автоопределения...'
                  : 'Определится после сохранения конфигурации (шаги 1-2)'}
              </p>
            )}

            {pythonStatus.state === 'detecting' && (
              <p className="text-xs text-muted-foreground mt-1">Поиск...</p>
            )}

            {pythonStatus.state === 'found' && (
              <p className="text-sm text-green-600 mt-1 break-all">
                {pythonStatus.path}
                {pythonStatus.version && ` (${pythonStatus.version})`}
              </p>
            )}

            {pythonStatus.state === 'not_found' && (
              <p className="text-xs text-amber-500 mt-1">Не найден. {pythonStatus.hint}</p>
            )}

            {pythonStatus.state === 'invalid' && (
              <p className="text-xs text-amber-500 mt-1 break-all">
                {pythonStatus.path}: {pythonStatus.error}
              </p>
            )}

            {!disabled && pythonStatus.state !== 'detecting' && (
              <div className="flex gap-2 mt-3">
                {pythonStatus.state === 'found' ? (
                  <Button variant="outline" size="sm" onClick={handleSelect}>
                    <FolderOpen size={16} />
                    Изменить
                  </Button>
                ) : (
                  <>
                    <Button variant="default" size="sm" onClick={handleSelect}>
                      <FolderOpen size={16} />
                      Выбрать вручную
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDetect}>
                      <RefreshCw size={16} />
                      Повторить
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Зачем:</strong> Backend написан на Python. Требуется версия 3.10 или новее.
          </p>
          <p>
            <strong>macOS:</strong>{' '}
            <code className="text-[11px] bg-muted px-1 rounded">brew install python@3.12</code>
          </p>
          <p>
            <strong>Windows:</strong> установить с{' '}
            <code className="text-[11px] bg-muted px-1 rounded">python.org</code>
          </p>
        </div>
      </div>
    </div>
  )
}
