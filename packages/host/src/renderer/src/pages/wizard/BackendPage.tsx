/*
 * Шаг 4: Backend — деплой в DuetData + переключатель DEV/PROD.
 * Наполнение в фазе 6 (перенос из InstallPage).
 */
import { Package } from 'lucide-react'

export function BackendPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Package size={24} />
          Backend
        </h2>
        <p className="text-muted-foreground mt-1">Деплой Python HTTP API + MCP в DuetData</p>
      </div>
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Страница будет наполнена в фазе 6.</p>
      </div>
    </div>
  )
}
