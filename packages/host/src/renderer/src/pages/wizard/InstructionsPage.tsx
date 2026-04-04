/*
 * Шаг 6: Инструкции — путь к Duet-Instructions + merge + ошибки.
 * Folder picker для instructionsPath, таблица ошибок, кнопка Regenerate.
 */
import { useState, useEffect } from 'react'
import { Button } from '@renderer/components/ui/button'
import { StatusTable, type StatusTableItem } from '@renderer/components/ui/status-table'
import {
  FileText,
  FolderOpen,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertTriangle
} from 'lucide-react'
import type {
  AppState,
  AgentInfo,
  InstructionsError,
  InstructionsMergeResult
} from '../../../../preload/index.d'
import type { PageStatus } from '../../../../core/wizard-status'

interface InstructionsPageProps {
  appState: AppState
  onStatusChange: (status: PageStatus) => void
  onAgentsUpdated: (agents: AgentInfo[]) => void
}

export function InstructionsPage({
  appState,
  onStatusChange,
  onAgentsUpdated
}: InstructionsPageProps): React.ReactElement {
  const [errors, setErrors] = useState<InstructionsError[]>([])
  const [merging, setMerging] = useState(false)
  const [mergeResult, setMergeResult] = useState<InstructionsMergeResult | null>(null)
  const [loading, setLoading] = useState(true)

  const instructionsPath = appState.instructionsPath
  const hasMachineConfig = !!(appState.duetConfigPath && appState.machine)

  // Load cached errors on mount.
  // null = cache missing (merge never ran) → status stays null (not determined).
  // [] = cache exists with 0 errors → done.
  useEffect(() => {
    if (!window.api) return
    window.api
      .getInstructionsErrors()
      .then((cached) => {
        if (cached !== null) {
          setErrors(cached)
          if (instructionsPath) {
            onStatusChange(_errorsToPageStatus(cached))
          }
        }
        // cached === null → merge never ran, leave status as null
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectPath = async (): Promise<void> => {
    const selected = await window.api.selectFolder(instructionsPath ?? undefined)
    if (!selected) return
    const newState = await window.api.setInstructionsPath(selected)

    // Auto-merge on first path set
    if (newState.instructionsPath) {
      await handleMerge()
    }
  }

  const handleMerge = async (): Promise<void> => {
    setMerging(true)
    try {
      const result = await window.api.mergeInstructions()
      setMergeResult(result)
      setErrors(result.errors)
      onStatusChange(_errorsToPageStatus(result.errors))

      // Auto-configure agents when merge has no real errors — propagate to App.tsx for sidebar update
      const hasRealError = result.errors.some((e: InstructionsError) => !WARNING_CODES.has(e.reason_code))
      if (!hasRealError) {
        const agents = await window.api.configureAgents()
        onAgentsUpdated(agents)
      }
    } catch (e) {
      console.error('Merge failed:', e)
    } finally {
      setMerging(false)
    }
  }

  const handleFixError = async (error: InstructionsError): Promise<void> => {
    const fixed = await window.api.fixInstructionsError(error.path, error.reason_code)
    if (fixed) {
      // Re-merge to refresh errors
      await handleMerge()
    }
  }

  const handleOpen = (): void => {
    if (instructionsPath) window.api.openPath(instructionsPath)
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
          <FileText size={24} />
          Инструкции
        </h2>
        <p className="text-muted-foreground mt-1">
          Путь к Duet-Instructions — персоны, скиллы, core_instructions
        </p>
      </div>

      {/* Dependency banner */}
      {!hasMachineConfig && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">Необходима предварительная настройка</p>
            <p className="text-xs text-muted-foreground mt-1">
              Сначала настройте DuetConfig и имя машины (шаг 2).
            </p>
          </div>
        </div>
      )}

      {/* Path picker */}
      <div className="bg-card rounded-xl border border-border p-6 space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
          <div className="flex-shrink-0 mt-0.5">
            {instructionsPath ? (
              <CheckCircle className="w-5 h-5 text-green-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-foreground">Duet-Instructions</div>
            {!instructionsPath && (
              <p className="text-xs text-muted-foreground mt-1">
                Git-репозиторий с пользовательскими инструкциями для AI
              </p>
            )}
            {instructionsPath && (
              <p className="text-sm text-green-600 mt-1 break-all">{instructionsPath}</p>
            )}
            <div className="flex gap-2 mt-3">
              <Button
                variant={instructionsPath ? 'outline' : 'default'}
                size="sm"
                onClick={handleSelectPath}
                disabled={!hasMachineConfig}
              >
                <FolderOpen size={16} />
                {instructionsPath ? 'Изменить' : 'Выбрать'}
              </Button>
              {instructionsPath && (
                <Button variant="outline" size="sm" onClick={handleOpen}>
                  Открыть
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Regenerate button */}
        {instructionsPath && (
          <Button variant="outline" className="w-full" onClick={handleMerge} disabled={merging}>
            {merging ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Генерирую...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Regenerate
              </>
            )}
          </Button>
        )}

        {/* Merge result */}
        {mergeResult && mergeResult.status === 'ok' && mergeResult.errors.length === 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200 bg-green-50">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700">
              Инструкции сгенерированы. AI агенты обновлены.
            </span>
          </div>
        )}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h3 className="text-lg font-medium text-foreground">
              {errors.some((e) => !WARNING_CODES.has(e.reason_code))
                ? `Ошибки валидации (${errors.length})`
                : `Предупреждения (${errors.length})`}
            </h3>
          </div>

          <StatusTable items={instructionErrorsToItems(errors, handleFixError)} />
        </div>
      )}

      {/* Help text */}
      <div className="text-xs text-muted-foreground space-y-1 px-1">
        <p>
          <strong>Что делает Regenerate:</strong> мержит платформенный bootstrapper.md с
          пользовательскими core_instructions.md, строит таблицу скиллов, записывает в{' '}
          <code className="text-[11px] bg-muted px-1 rounded">DuetData/duet-instructions.md</code>.
        </p>
        <p>При 0 ошибок — автоматически обновляет конфигурацию AI агентов (шаг 7).</p>
      </div>
    </div>
  )
}

// =============================================================================
// Helpers
// =============================================================================

/** Reason codes that can be auto-fixed by Host. */
const FIXABLE_CODES = new Set(['no_frontmatter', 'invalid_yaml', 'missing_fields'])

/** Reason codes that are warnings, not errors. */
const WARNING_CODES = new Set(['missing_description', 'version_suffix'])

function _errorsToPageStatus(errors: InstructionsError[]): PageStatus {
  if (errors.length === 0) return 'ok'
  const hasRealError = errors.some((e) => !WARNING_CODES.has(e.reason_code))
  return hasRealError ? 'error' : 'warning'
}

function _copyTextForReason(reasonCode: string, path: string): string | undefined {
  switch (reasonCode) {
    case 'missing_description':
      return `Прочитай файл ${path} и добавь в frontmatter поле description — одну строку, описывающую назначение этого скилла/персоны.`
    case 'version_suffix':
      return `Найден файл ${path} с суффиксом версии. Сравни его с оригиналом (без суффикса), замени оригинал новой версией если она лучше, затем удали файл с суффиксом.`
    default:
      return undefined
  }
}

function instructionErrorsToItems(
  errors: InstructionsError[],
  onFix: (error: InstructionsError) => void
): StatusTableItem[] {
  return errors.map((e) => {
    const isWarning = WARNING_CODES.has(e.reason_code)
    return {
      severity: isWarning ? 'warning' as const : 'error' as const,
      message: e.description,
      detail: e.path || undefined,
      fixable: FIXABLE_CODES.has(e.reason_code),
      onFix: () => onFix(e),
      copyText: e.path ? _copyTextForReason(e.reason_code, e.path) : undefined,
    }
  })
}
