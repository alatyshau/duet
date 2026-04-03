/*
 * Шаг 6: Инструкции — путь к Duet-Instructions + merge + ошибки.
 * Наполнение в фазе 6 (новая страница).
 */
import { FileText } from 'lucide-react'

export function InstructionsPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FileText size={24} />
          Инструкции
        </h2>
        <p className="text-muted-foreground mt-1">
          Путь к Duet-Instructions — персоны, скиллы, core_instructions
        </p>
      </div>
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Страница будет наполнена в фазе 6.</p>
      </div>
    </div>
  )
}
