/*
 * Шаг 1: Duet: пути — DuetData, DuetConfig, имя машины, корневые контексты.
 *
 * Четыре секции на одной странице: folder picker для DuetData, folder picker для DuetConfig,
 * text input для имени машины, список корневых контекстов (add/remove/reorder/set-meta).
 *
 * Status:
 * - 'ok' когда три базовых пути настроены и schema-migration не нашёл ошибок (warning'ов нет).
 * - 'warning' если есть per-context migration warning (контекст с future-version manifest и т.п.).
 * - 'error' если schema-migration нашёл critical (settings/machine future-version) — backend
 *   тогда не запускается.
 *
 * Корневой контекст — top-level папка из `root_context_folders` settings.json. Один из них
 * может быть помечен `meta: true` (например `!БАЗА`), это показывается короной в списке.
 */
import { useState, useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import {
  FolderOpen,
  CheckCircle,
  AlertTriangle,
  MapPin,
  Plus,
  Trash2,
  GripVertical,
  Crown
} from 'lucide-react'
import type {
  AppState,
  RootContextEntry,
  MigrationCriticalError,
  MigrationResult
} from '../../../../preload/index.d'
import type { PageStatus } from '../../../../core/wizard-status'

function criticalBannerTitle(err: MigrationCriticalError): string {
  if (err.reason_code === 'future_version') return 'Конфиг Duet создан в более новой версии'
  if (err.file === 'pointer') return 'Pointer-файл Duet повреждён'
  if (err.file === 'settings') return 'Файл settings.json повреждён'
  return 'Файл machine config повреждён'
}

function criticalBannerHint(err: MigrationCriticalError): string {
  if (err.reason_code === 'future_version') {
    return 'Backend не запускается. Обновите Duet до версии, поддерживающей этот формат.'
  }
  if (err.file === 'pointer') {
    return 'Backend не запускается. Восстановите ~/.org.ve68.duet из backup или удалите файл — Host начнёт onboarding с нуля.'
  }
  return 'Backend не запускается, пока файл не будет восстановлен или удалён вручную.'
}

interface DuetPathsPageProps {
  appState: AppState
  onStatusChange: (status: PageStatus) => void
}

export function DuetPathsPage({
  appState,
  onStatusChange
}: DuetPathsPageProps): React.ReactElement {
  const dataPath = appState.duetDataPath
  const configPath = appState.duetConfigPath
  const [machine, setMachine] = useState(appState.machine ?? '')
  const [machineError, setMachineError] = useState(false)
  const [rootContexts, setRootContexts] = useState<RootContextEntry[]>([])
  const [folderError, setFolderError] = useState<string | null>(null)
  const [migrationStatus, setMigrationStatus] = useState<MigrationResult | null>(null)

  /**
   * Нормализация для dedup в UI. Должна совпадать с core/root-contexts.ts:normalizePath.
   * Дублируется здесь только потому что renderer не импортит core напрямую.
   */
  const normalizePathForCompare = (p: string): string => p.replace(/[\\/]+$/, '').normalize('NFC')

  // Load root contexts and migration status on mount
  useEffect(() => {
    if (!window.api) return
    Promise.all([window.api.getRootContextFolders(), window.api.getMigrationStatus()])
      .then(([folders, mig]) => {
        setRootContexts(folders)
        setMigrationStatus(mig)
      })
      .catch(console.error)
  }, [])

  // Derive status whenever inputs change (paths from props, migration from local state).
  // Critical migration → 'error'. Per-context errors also → 'error' (data corruption).
  useEffect(() => {
    if (migrationStatus?.critical) {
      onStatusChange('error')
      return
    }
    if (!appState.duetDataPath || !appState.duetConfigPath || !appState.machine) {
      onStatusChange(null)
      return
    }
    onStatusChange((migrationStatus?.contextErrors?.length ?? 0) > 0 ? 'error' : 'ok')
  }, [
    appState.duetDataPath,
    appState.duetConfigPath,
    appState.machine,
    migrationStatus,
    onStatusChange
  ])

  // Корневые контексты
  // Принцип: persist первым, UI обновляем только после успешной записи.
  // Иначе на ошибке записи UI и диск разойдутся.
  const handleAddFolder = async (): Promise<void> => {
    setFolderError(null)
    const selected = await window.api.selectFolder()
    if (!selected) return
    const selectedNorm = normalizePathForCompare(selected)
    if (rootContexts.some((f) => normalizePathForCompare(f.resolved) === selectedNorm)) return
    try {
      // Host creates @alias in {machine}.json, appends to settings.json,
      // and runs scoped schema-migration over the new folder.
      // settings.json is shared across machines — must contain @aliases, not absolute paths.
      const updated = await window.api.addRootContextFolder(selected)
      setRootContexts(updated)
      const mig = await window.api.getMigrationStatus()
      setMigrationStatus(mig)
    } catch (e) {
      setFolderError(`Не удалось добавить папку: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleRemoveFolder = async (index: number): Promise<void> => {
    setFolderError(null)
    const updated = rootContexts.filter((_, i) => i !== index)
    try {
      await window.api.saveRootContextFolders(updated.map((f) => f.raw))
      // Re-fetch — Host enforces meta-invariant on save (new pos 0 may have become meta).
      const refreshed = await window.api.getRootContextFolders()
      setRootContexts(refreshed)
    } catch (e) {
      setFolderError(`Не удалось удалить папку: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Drag-and-drop reordering
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDragStart = (e: React.DragEvent, index: number): void => {
    e.dataTransfer.effectAllowed = 'move'
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number): void => {
    e.preventDefault()
    if (dragOverIndex !== index) setDragOverIndex(index)
  }

  const handleDrop = async (targetIndex: number): Promise<void> => {
    setFolderError(null)
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      setDragOverIndex(null)
      return
    }
    const updated = [...rootContexts]
    const [moved] = updated.splice(dragIndex, 1)
    updated.splice(targetIndex, 0, moved)
    setDragIndex(null)
    setDragOverIndex(null)
    try {
      await window.api.saveRootContextFolders(updated.map((f) => f.raw))
      // Re-fetch — Host enforces meta-invariant on save (drag-to-position-0 swaps meta).
      const refreshed = await window.api.getRootContextFolders()
      setRootContexts(refreshed)
    } catch (e) {
      setFolderError(`Не удалось переупорядочить: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleDragEnd = (): void => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  // DuetData
  const handleSelectData = async (): Promise<void> => {
    const selected = await window.api.selectFolder(dataPath ?? undefined)
    if (!selected) return
    await window.api.savePointer({ duetDataPath: selected })
    const mig = await window.api.getMigrationStatus()
    setMigrationStatus(mig)
  }

  const handleOpenData = (): void => {
    if (dataPath) window.api.openPath(dataPath)
  }

  // DuetConfig
  const handleSelectConfig = async (): Promise<void> => {
    const selected = await window.api.selectFolder(configPath ?? undefined)
    if (!selected) return
    await window.api.savePointer({ duetConfigPath: selected })
    const mig = await window.api.getMigrationStatus()
    setMigrationStatus(mig)
  }

  const handleOpenConfig = (): void => {
    if (configPath) window.api.openPath(configPath)
  }

  // Machine
  const handleMachineSave = async (): Promise<void> => {
    const trimmed = machine.trim()
    if (!trimmed) {
      setMachineError(true)
      return
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed) || trimmed.length > 64) {
      setMachineError(true)
      return
    }
    setMachineError(false)
    await window.api.savePointer({ machine: trimmed })
    const mig = await window.api.getMigrationStatus()
    setMigrationStatus(mig)
  }

  const handleMachineKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      void handleMachineSave()
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <MapPin size={24} />
          Duet: пути
        </h2>
        <p className="text-muted-foreground mt-1">
          Локальные данные, облачная конфигурация и имя машины
        </p>
      </div>

      {/* Migration critical error — blocks backend. Title and recovery hint branch on
          reason_code so user gets the right action: "update Duet" for future-version vs
          "repair file" for invalid_json/read_failed (review issue 7). */}
      {migrationStatus?.critical && (
        <div className="rounded-xl border border-red-500/50 bg-red-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-red-600">{criticalBannerTitle(migrationStatus.critical)}</div>
            <p className="text-sm text-red-600/80 mt-1 break-words">
              {migrationStatus.critical.description}
            </p>
            <p className="text-xs text-muted-foreground mt-2 break-all">
              {migrationStatus.critical.path}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {criticalBannerHint(migrationStatus.critical)}
            </p>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        {/* DuetData */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {dataPath ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">DuetData</div>
            {!dataPath && (
              <p className="text-xs text-muted-foreground mt-1">
                Локальный кэш: клоны репозиториев, база данных, бэкенд, логи
              </p>
            )}
            {dataPath && <p className="text-sm text-green-600 mt-1 break-all">{dataPath}</p>}
            <div className="flex gap-2 mt-3">
              <Button
                variant={dataPath ? 'outline' : 'default'}
                size="sm"
                onClick={handleSelectData}
              >
                <FolderOpen size={16} />
                {dataPath ? 'Изменить' : 'Выбрать'}
              </Button>
              {dataPath && (
                <Button variant="outline" size="sm" onClick={handleOpenData}>
                  Открыть
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* DuetConfig */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {configPath ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">DuetConfig</div>
            {!configPath && (
              <p className="text-xs text-muted-foreground mt-1">
                Конфигурация в облаке (settings, aliases)
              </p>
            )}
            {configPath && <p className="text-sm text-green-600 mt-1 break-all">{configPath}</p>}
            <div className="flex gap-2 mt-3">
              <Button
                variant={configPath ? 'outline' : 'default'}
                size="sm"
                onClick={handleSelectConfig}
              >
                <FolderOpen size={16} />
                {configPath ? 'Изменить' : 'Выбрать'}
              </Button>
              {configPath && (
                <Button variant="outline" size="sm" onClick={handleOpenConfig}>
                  Открыть
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Machine name */}
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {appState.machine ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">Машина</div>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              Уникальный идентификатор (например mac_work, win_home). Определяет какой файл
              конфигурации использовать.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={machine}
                onChange={(e) => {
                  setMachine(e.target.value)
                  if (machineError) setMachineError(false)
                }}
                onBlur={handleMachineSave}
                onKeyDown={handleMachineKeyDown}
                placeholder="mac_work"
                className={`flex-1 px-3 py-1.5 text-sm rounded-md border bg-background text-foreground
                  ${machineError ? 'border-red-500' : 'border-border'}
                  focus:outline-none focus:ring-2 focus:ring-ring`}
              />
            </div>
            {machineError && (
              <p className="text-xs text-red-500 mt-1">
                Латиница, цифры, дефисы, подчёркивания, точки. Начинается с буквы или цифры.
              </p>
            )}
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>DuetData</strong> — быстрый локальный диск (SSD), не в облачном хранилище.
          </p>
          <p>
            <strong>DuetConfig</strong> — папка в облачном хранилище (Google Drive, iCloud).
            Синхронизируется между машинами.
          </p>
          <p>
            <strong>Машина</strong> — каждая машина имеет свой файл{' '}
            <code className="text-[11px] bg-muted px-1 rounded">{'{machine}.json'}</code> в
            DuetConfig.
          </p>
        </div>
      </div>

      {/* Root Contexts */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <h3 className="text-lg font-medium text-foreground flex items-center gap-2">
          <FolderOpen size={20} />
          Корневые контексты
        </h3>
        <p className="text-xs text-muted-foreground">
          Top-level папки на Google Drive — каждая со своим <code className="text-[11px] bg-muted px-1 rounded">context.json</code>.
          Можно отметить один meta-контекст (системный, например <code className="text-[11px] bg-muted px-1 rounded">!БАЗА</code>) короной.
        </p>

        {rootContexts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ни одного контекста не добавлено. Добавьте корневые папки бизнесов из облачного хранилища.
          </p>
        )}

        <div className="space-y-2">
          {rootContexts.map((entry, i) => (
            <div
              key={entry.raw}
              draggable
              onDragStart={(e) => handleDragStart(e, i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={(e) => {
                e.preventDefault()
                void handleDrop(i)
              }}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 p-3 rounded-lg border bg-background transition-colors
                ${dragOverIndex === i && dragIndex !== i ? 'border-blue-400 bg-blue-500/10' : 'border-border'}
                ${dragIndex === i ? 'opacity-50' : ''}`}
            >
              <GripVertical
                size={16}
                className="text-muted-foreground/50 flex-shrink-0 cursor-grab active:cursor-grabbing"
              />
              {/* Корона — read-only индикатор позиции 0. Меняется только перетаскиванием
                  папки на первую позицию (Host атомарно обновит meta-флаг на диске). */}
              <div
                className="h-6 w-6 flex-shrink-0 flex items-center justify-center"
                title={i === 0 ? 'Meta-контекст (первая позиция)' : undefined}
              >
                {i === 0 && <Crown size={14} className="text-amber-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {entry.resolved.split(/[\\/]/).pop()}
                  {i === 0 && (
                    <span className="ml-2 text-[11px] text-amber-600 font-normal">meta</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate" title={entry.resolved}>
                  {entry.resolved}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={() => handleRemoveFolder(i)}
              >
                <Trash2 size={14} className="text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={handleAddFolder}>
          <Plus size={16} />
          Добавить контекст
        </Button>

        {folderError && <p className="text-xs text-red-500 break-words">{folderError}</p>}

        {/* Per-context migration errors — все красные (поломка данных) */}
        {migrationStatus && migrationStatus.contextErrors.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-border">
            <p className="text-xs font-medium text-red-600">
              Ошибки по контекстам ({migrationStatus.contextErrors.length})
            </p>
            <ul className="space-y-1">
              {migrationStatus.contextErrors.map((err, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="text-red-600">⚠</span> {err.description}
                  <div className="text-[10px] break-all">{err.path}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
