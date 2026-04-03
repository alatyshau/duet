/*
 * Шаг 3: Python 3.10+ — auto-detect или ручной выбор интерпретатора.
 * Наполнение в фазе 6 (перенос из InstallPage).
 */
import { Code } from 'lucide-react'

export function PythonPage(): React.ReactElement {
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
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Страница будет наполнена в фазе 6.</p>
      </div>
    </div>
  )
}
