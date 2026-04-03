/*
 * Шаг 5: Business Folders — корневые папки бизнесов + scan.
 * Наполнение в фазе 6 (новая страница).
 */
import { FolderOpen } from 'lucide-react'

export function BusinessFoldersPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FolderOpen size={24} />
          Business Folders
        </h2>
        <p className="text-muted-foreground mt-1">
          Корневые папки бизнесов на Google Drive — источник для сканирования сущностей
        </p>
      </div>
      <div className="bg-card rounded-xl border border-border p-6">
        <p className="text-sm text-muted-foreground">Страница будет наполнена в фазе 6.</p>
      </div>
    </div>
  )
}
