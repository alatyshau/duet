/*
 * ЧТО: Страница первоначальной настройки.
 * ЗАЧЕМ: Показывает чеклист состояния и позволяет выбрать папку DuetData.
 * КТО ИСПОЛЬЗУЕТ: App.tsx при первом запуске или если папка не найдена.
 */
import { Button } from '@renderer/components/ui/button'
import { FolderOpen, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import type { AppState } from '../../../preload/index.d'

interface SetupPageProps {
  appState: AppState
  onSelectFolder: () => void
  onOpenFolder: () => void
}

export function SetupPage({
  appState,
  onSelectFolder,
  onOpenFolder
}: SetupPageProps): React.ReactElement {
  const { status, duetDataPath, pathExists } = appState

  // Определяем состояние чеклиста
  const hasFolderConfigured = duetDataPath !== null
  const isFolderAccessible = pathExists
  const isReady = status === 'ready'

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-3rem)]">
      <div className="bg-card rounded-2xl shadow-sm border border-border p-8 max-w-lg w-full">
        {/* Заголовок */}
        <div className="text-center mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-2">Установка Duet</h2>
          <p className="text-muted-foreground">
            {isReady
              ? 'Всё настроено и готово к работе'
              : 'Настройте Duet для начала работы'}
          </p>
        </div>

        {/* Чеклист */}
        <div className="space-y-4 mb-8">
          {/* Пункт 1: Папка DuetData */}
          <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
            {/* Иконка статуса */}
            <div className="flex-shrink-0 mt-0.5">
              {hasFolderConfigured && isFolderAccessible ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : hasFolderConfigured && !isFolderAccessible ? (
                <XCircle className="w-5 h-5 text-red-500" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              )}
            </div>

            {/* Контент */}
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">
                Папка DuetData
              </div>

              {/* Статус папки */}
              {status === 'no_config' && (
                <p className="text-sm text-muted-foreground mt-1">
                  Выберите папку, где хранятся ваши данные DuetData
                </p>
              )}

              {status === 'path_lost' && (
                <div className="mt-1">
                  <p className="text-sm text-red-600">
                    Папка не найдена: {duetDataPath}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Папка была удалена или перемещена. Выберите заново.
                  </p>
                </div>
              )}

              {status === 'ready' && (
                <p className="text-sm text-green-600 mt-1 break-all">
                  {duetDataPath}
                </p>
              )}

              {/* Кнопки действий */}
              <div className="flex gap-2 mt-3">
                <Button
                  variant={isReady ? 'outline' : 'default'}
                  size="sm"
                  onClick={onSelectFolder}
                >
                  <FolderOpen size={16} />
                  {hasFolderConfigured ? 'Изменить' : 'Выбрать папку'}
                </Button>

                {isReady && (
                  <Button variant="outline" size="sm" onClick={onOpenFolder}>
                    Открыть в Finder
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
