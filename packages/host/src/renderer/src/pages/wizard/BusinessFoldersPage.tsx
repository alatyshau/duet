/*
 * Шаг 5: Business Folders — корневые папки бизнесов + scan.
 * Пользователь указывает папки, нажимает Scan, видит результат + ошибки.
 */
import { useState, useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import { StatusTable, type StatusTableItem } from '@renderer/components/ui/status-table'
import {
  FolderOpen,
  Plus,
  Trash2,
  Search,
  Loader2,
  CheckCircle,
  AlertTriangle,
  ChevronRight
} from 'lucide-react'
import type {
  AppState,
  ScanResult,
  ScanError,
  StreamEntity,
  StreamsCache
} from '../../../../preload/index.d'
import type { PageStatus } from '../../../../core/wizard-status'

interface BusinessFoldersPageProps {
  appState: AppState
  onStatusChange: (status: PageStatus) => void
}

export function BusinessFoldersPage({
  appState,
  onStatusChange
}: BusinessFoldersPageProps): React.ReactElement {
  const isReady = appState.status === 'ready'
  const [folders, setFolders] = useState<string[]>([])
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [streamsCache, setStreamsCache] = useState<StreamsCache | null>(null)
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(true)

  // Load folders, cached scan, and streams on mount
  useEffect(() => {
    if (!window.api) return
    const load = async (): Promise<void> => {
      try {
        const [savedFolders, cached, streams] = await Promise.all([
          window.api.getBusinessFolders(),
          window.api.getCachedScan(),
          window.api.getCachedStreams()
        ])
        setFolders(savedFolders)
        if (streams) setStreamsCache(streams)
        if (cached) {
          setScanResult(cached)
          onStatusChange(cached.errors.length === 0 ? 'ok' : 'error')
        }
      } catch (e) {
        console.error('Failed to load business folders:', e)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddFolder = async (): Promise<void> => {
    const selected = await window.api.selectFolder()
    if (!selected) return
    if (folders.includes(selected)) return
    const updated = [...folders, selected]
    setFolders(updated)
    await window.api.saveBusinessFolders(updated)
    // Scan result is stale after adding a folder
    setScanResult(null)
    onStatusChange(null)
  }

  const handleRemoveFolder = async (index: number): Promise<void> => {
    const updated = folders.filter((_, i) => i !== index)
    setFolders(updated)
    await window.api.saveBusinessFolders(updated)
    setScanResult(null)
    onStatusChange(null)
  }

  const handleScan = async (): Promise<void> => {
    setScanning(true)
    try {
      const result = await window.api.scanBusinessFolders()
      setScanResult(result)
      onStatusChange(result.errors.length === 0 ? 'ok' : 'error')
      // Streams cache is updated by scan — read fresh
      const streams = await window.api.getCachedStreams()
      if (streams) setStreamsCache(streams)
    } catch (e) {
      console.error('Scan failed:', e)
    } finally {
      setScanning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 size={16} className="animate-spin" />
        Загрузка...
      </div>
    )
  }

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

      {/* Folders list */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <h3 className="text-lg font-medium text-foreground">Папки бизнесов</h3>

        {folders.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ни одной папки не добавлено. Добавьте корневые папки бизнесов из облачного хранилища.
          </p>
        )}

        <div className="space-y-2">
          {folders.map((folder, i) => (
            <div
              key={folder}
              className="flex items-center gap-2 p-3 rounded-lg border border-border bg-background"
            >
              <FolderOpen size={16} className="text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-foreground flex-1 break-all">{folder}</span>
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

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleAddFolder}>
            <Plus size={16} />
            Добавить папку
          </Button>

          {folders.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={handleScan}
              disabled={scanning || !isReady}
            >
              {scanning ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Сканирую...
                </>
              ) : (
                <>
                  <Search size={16} />
                  Сканировать
                </>
              )}
            </Button>
          )}
          {!isReady && folders.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Для сканирования нужен задеплоенный Backend (шаг 4).
            </p>
          )}
        </div>
      </div>

      {/* Scan result */}
      {scanResult && (
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div className="flex items-center gap-2">
            {scanResult.errors.length === 0 ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
            <h3 className="text-lg font-medium text-foreground">Результат сканирования</h3>
            {scanResult.duration_ms !== undefined && (
              <span className="text-xs text-muted-foreground">({scanResult.duration_ms}ms)</span>
            )}
          </div>

          {/* Entity tree */}
          {streamsCache && streamsCache.streams.length > 0 && (
            <EntityTree entities={streamsCache.streams} />
          )}
          {(!streamsCache || streamsCache.streams.length === 0) && (
            <p className="text-sm text-muted-foreground">
              Найдено сущностей: <strong>{scanResult.entities_count}</strong>
            </p>
          )}

          {/* Errors */}
          {scanResult.errors.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">
                Предупреждения ({scanResult.errors.length})
              </h4>
              <StatusTable items={scanErrorsToItems(scanResult.errors)} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Sub-components
// =============================================================================

/** Build tree from flat entity list using parent_id. */
function buildTree(entities: StreamEntity[]): Map<string | null, StreamEntity[]> {
  const children = new Map<string | null, StreamEntity[]>()
  for (const e of entities) {
    const key = e.parent_id
    const list = children.get(key) ?? []
    list.push(e)
    children.set(key, list)
  }
  return children
}

function EntityTree({ entities }: { entities: StreamEntity[] }): React.ReactElement {
  const tree = buildTree(entities)
  const roots = tree.get(null) ?? []

  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground mb-1">
        Найдено сущностей: <strong>{entities.length}</strong>
      </p>
      {roots.map((root) => (
        <TreeNode key={root.id} entity={root} tree={tree} depth={0} />
      ))}
    </div>
  )
}

function TreeNode({
  entity,
  tree,
  depth
}: {
  entity: StreamEntity
  tree: Map<string | null, StreamEntity[]>
  depth: number
}): React.ReactElement {
  const children = tree.get(entity.id) ?? []
  return (
    <>
      <div
        className="flex items-center gap-1.5 text-sm text-foreground py-0.5"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {children.length > 0 && (
          <ChevronRight size={12} className="text-muted-foreground flex-shrink-0" />
        )}
        <span>{entity.icon}</span>
        <span>{entity.name}</span>
        <span className="text-[10px] text-muted-foreground">{entity.type}</span>
      </div>
      {children.map((child) => (
        <TreeNode key={child.id} entity={child} tree={tree} depth={depth + 1} />
      ))}
    </>
  )
}

/** Severity by scan error reason code. Collisions are warnings, invalid manifests are errors. */
const SCAN_ERROR_SEVERITY: Record<string, 'error' | 'warning'> = {
  name_collision: 'warning',
  repo_collision: 'warning',
  missing_manifest: 'warning',
  invalid_manifest: 'error'
}

function scanErrorsToItems(errors: ScanError[]): StatusTableItem[] {
  return errors.map((e) => ({
    severity: SCAN_ERROR_SEVERITY[e.reason_code] ?? 'error',
    message: e.description,
    detail: e.path || undefined
  }))
}
