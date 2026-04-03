/*
 * Шаг 2: DuetConfig + имя машины.
 * Наполнение в фазе 6 (перенос из InstallPage).
 */
import { Settings } from 'lucide-react'

export function DuetConfigPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Settings size={24} />
          DuetConfig + машина
        </h2>
        <p className="text-muted-foreground mt-1">
          Облачная конфигурация и уникальный идентификатор машины
        </p>
      </div>
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Страница будет наполнена в фазе 6.</p>
      </div>
    </div>
  )
}
