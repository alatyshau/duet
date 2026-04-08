/*
 * Шаг 5: Инструкции — onboarding (скачать/указать) + configured (merge + ошибки).
 * Два состояния: onboarding (instructionsPath не задан) и configured (задан).
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
  AlertTriangle,
  Download,
  ChevronRight,
  ChevronDown,
  ExternalLink
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
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [pendingFolder, setPendingFolder] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const instructionsPath = appState.instructionsPath
  const hasMachineConfig = !!(appState.duetConfigPath && appState.machine)

  // Load cached errors on mount
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
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // === Shared actions ===

  const handleMerge = async (): Promise<void> => {
    setMerging(true)
    try {
      const result = await window.api.mergeInstructions()
      setMergeResult(result)
      setErrors(result.errors)
      onStatusChange(_errorsToPageStatus(result.errors))

      const hasRealError = result.errors.some(
        (e: InstructionsError) => !WARNING_CODES.has(e.reason_code)
      )
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

  const setPathAndMerge = async (path: string): Promise<void> => {
    await window.api.setInstructionsPath(path)
    await handleMerge()
  }

  const handleFixError = async (error: InstructionsError): Promise<void> => {
    const fixed = await window.api.fixInstructionsError(error.path, error.reason_code)
    if (fixed) {
      await handleMerge()
    }
  }

  // === Onboarding: download template ===

  const handleDownloadTemplate = async (): Promise<void> => {
    setDownloadError(null)
    const selected = await window.api.selectFolder()
    if (!selected) return

    const empty = await window.api.isInstructionsFolderEmpty(selected)
    if (!empty) {
      setPendingFolder(selected)
      setConfirmOverwrite(true)
      return
    }

    await doDownload(selected)
  }

  const doDownload = async (folder: string): Promise<void> => {
    setConfirmOverwrite(false)
    setPendingFolder(null)
    setDownloading(true)
    setDownloadError(null)
    try {
      const result = await window.api.downloadInstructionsTemplate(folder)
      if (!result.ok) {
        setDownloadError(result.error ?? 'Неизвестная ошибка')
        return
      }
      await setPathAndMerge(folder)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(false)
    }
  }

  // === Onboarding: pick existing folder ===

  const handlePickExisting = async (): Promise<void> => {
    const selected = await window.api.selectFolder()
    if (!selected) return
    await setPathAndMerge(selected)
  }

  // === Configured: change path ===

  const handleChangePath = async (): Promise<void> => {
    const selected = await window.api.selectFolder(instructionsPath ?? undefined)
    if (!selected) return
    await setPathAndMerge(selected)
  }

  // === Configured: reset ===

  const handleReset = async (): Promise<void> => {
    await window.api.setInstructionsPath('')
    setErrors([])
    setMergeResult(null)
    onStatusChange(null)
    setConfirmReset(false)
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

  const isOnboarding = !instructionsPath

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <FileText size={24} />
          Инструкции
        </h2>
        <p className="text-muted-foreground mt-1">Персоны, скиллы и настройки для AI</p>
      </div>

      {/* Dependency banner */}
      {!hasMachineConfig && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Необходима предварительная настройка
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Сначала настройте DuetConfig и имя машины (шаг 2).
            </p>
          </div>
        </div>
      )}

      {isOnboarding ? (
        // =================================================================
        // State 1: Onboarding
        // =================================================================
        <>
          {/* Card 1: Download template (primary) */}
          <div className="bg-card rounded-xl border-2 border-primary/30 p-6 space-y-4 relative">
            <div className="absolute -top-3 left-4 bg-primary text-primary-foreground text-xs font-medium px-2 py-0.5 rounded-full">
              Рекомендуется
            </div>
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-foreground">Скачать шаблон Duet</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Готовый набор инструкций. Персоны, скиллы, core_instructions — всё включено. Можно
                  кастомизировать под себя потом.
                </p>
              </div>
            </div>

            {/* Confirm overwrite */}
            {confirmOverwrite && pendingFolder && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                <p className="text-sm text-foreground">
                  Папка содержит файлы. Шаблон будет добавлен поверх.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => doDownload(pendingFolder)}>
                    Продолжить
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmOverwrite(false)
                      setPendingFolder(null)
                    }}
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            )}

            {/* Download error */}
            {downloadError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm text-red-700">{downloadError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={handleDownloadTemplate}
                  >
                    Повторить
                  </Button>
                </div>
              </div>
            )}

            <Button onClick={handleDownloadTemplate} disabled={!hasMachineConfig || downloading}>
              {downloading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Скачиваю шаблон...
                </>
              ) : (
                <>
                  <FolderOpen size={16} />
                  Выбрать папку и скачать
                </>
              )}
            </Button>
          </div>

          {/* Card 2: Pick existing folder (secondary) */}
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <div className="flex items-start gap-3">
              <FolderOpen className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-medium text-foreground">Указать существующую папку</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Если вы уже клонировали репо или у вас есть папка с инструкциями.
                </p>
              </div>
            </div>

            <Button variant="outline" onClick={handlePickExisting} disabled={!hasMachineConfig}>
              <FolderOpen size={16} />
              Выбрать папку
            </Button>
          </div>

          {/* Expandable: advanced git instructions */}
          <div className="px-1">
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Для продвинутых: fork + git clone
            </button>
            {showAdvanced && (
              <div className="mt-2 ml-5 text-sm text-muted-foreground space-y-2">
                <p>Если хотите управлять инструкциями через git:</p>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>
                    Откройте{' '}
                    <a
                      href="https://github.com/alatyshau/Duet-Instructions"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      github.com/alatyshau/Duet-Instructions
                      <ExternalLink size={12} />
                    </a>
                  </li>
                  <li>Нажмите Fork — создаст копию в вашем GitHub</li>
                  <li>
                    Клонируйте свой форк:
                    <code className="block mt-1 text-xs bg-muted px-2 py-1 rounded">
                      git clone https://github.com/&lt;you&gt;/Duet-Instructions &lt;путь&gt;
                    </code>
                  </li>
                  <li>Укажите папку выше через «Выбрать папку»</li>
                </ol>
              </div>
            )}
          </div>
        </>
      ) : (
        // =================================================================
        // State 2: Configured
        // =================================================================
        <>
          {/* Path card */}
          <div className="bg-card rounded-xl border border-border p-6 space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground">Duet-Instructions</div>
                <p className="text-sm text-green-600 mt-1 break-all">{instructionsPath}</p>
                <div className="flex gap-2 mt-3">
                  <Button variant="outline" size="sm" onClick={handleChangePath}>
                    <FolderOpen size={16} />
                    Изменить
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleOpen}>
                    Открыть
                  </Button>
                </div>
              </div>
            </div>

            {/* Regenerate button */}
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

          {/* Reset link */}
          <div className="flex justify-end px-1">
            {!confirmReset ? (
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setConfirmReset(true)}
              >
                Сбросить настройку
              </button>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  Сбросить путь к инструкциям? Файлы на диске не будут удалены.
                </span>
                <Button variant="outline" size="sm" onClick={handleReset}>
                  Сбросить
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmReset(false)}>
                  Отмена
                </Button>
              </div>
            )}
          </div>

          {/* Help text */}
          <div className="text-xs text-muted-foreground space-y-1 px-1">
            <p>
              <strong>Что делает Regenerate:</strong> мержит платформенный bootstrapper.md с
              пользовательскими core_instructions.md, строит таблицу скиллов, записывает в{' '}
              <code className="text-[11px] bg-muted px-1 rounded">
                DuetData/duet-instructions.md
              </code>
              .
            </p>
            <p>При 0 ошибок — автоматически обновляет конфигурацию AI агентов (шаг 6).</p>
          </div>
        </>
      )}
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
      severity: isWarning ? ('warning' as const) : ('error' as const),
      message: e.description,
      detail: e.path || undefined,
      fixable: FIXABLE_CODES.has(e.reason_code),
      onFix: () => onFix(e),
      copyText: e.path ? _copyTextForReason(e.reason_code, e.path) : undefined
    }
  })
}
