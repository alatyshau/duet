/*
 * Шаг 1: Папка DuetData — folder picker для локального кэша.
 * Наполнение в фазе 6 (перенос из InstallPage).
 */
import { FolderOpen } from 'lucide-react'

export function DuetDataPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FolderOpen size={24} />
          Папка DuetData
        </h2>
        <p className="text-muted-foreground mt-1">
          Локальный кэш: клоны репозиториев, база данных, логи
        </p>
      </div>
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Страница будет наполнена в фазе 6.</p>
      </div>
    </div>
  )
}
