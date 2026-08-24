/*
 * ЧТО: Обнаружение и конфигурация AI клиентов (Claude Code, Codex, Antigravity, Kimi Code).
 * ЗАЧЕМ: Host конфигурирует AI клиенты прямой записью файлов (не CLI).
 * КТО ИСПОЛЬЗУЕТ: main process, страница "AI Агенты".
 *
 * АРХИТЕКТУРА (multi-agent):
 *   Backend produces a thin session prompt (`duet.md` — bootstrapper + skills,
 *   no core) and full per-agent cores (`duet-executor.md`, `duet-vizir.md`) in
 *   DuetData. Host reads them via `readMergedAgents()` and deploys:
 *
 *   - Claude Code:  output-style (thin `sessionPrompt`) + 2 full-core subagents in ~/.claude/agents/.
 *   - Codex:        single instructions file (thin `sessionPrompt`).
 *   - Antigravity:  single GEMINI.md (thin `sessionPrompt`).
 *   - Kimi Code:    SYSTEM.md (thin `sessionPrompt` wrapping `${base_prompt}`).
 *
 *   Custom subagents in Codex/Antigravity/Kimi Code are intentionally not
 *   deployed — Antigravity does not support them globally; Codex and Kimi Code
 *   deployment is held uniformly with Antigravity for now.
 *
 * ПАТТЕРН: detect (проверить реальные файлы конфигурации) → configure (write files) → show result.
 * detect и configure должны возвращать одинаковый status — это проверяется round-trip тестом.
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { readDeployedVersion } from './deploy'
import { readMergedAgents, triggerMerge, type MergedAgents } from './instructions'
import type { AgentInfo, AgentCheckedFile, AgentIssue } from '../shared/types'

// Re-export IPC types (source of truth: shared/types.ts)
export type { AgentStatus, AgentCheckedFile, AgentIssue, AgentInfo } from '../shared/types'

// =============================================================================
// FRONTMATTER HELPERS
// =============================================================================

/**
 * Description shown to the user (and to Claude when picking output styles)
 * for the Duet output-style. Always paired with the Executor body.
 */
const OUTPUT_STYLE_DESCRIPTION =
  'Core Duet workspace agent. Use for all software engineering and content work in Duet projects: orientation via MCP, spec-driven development, project folder discipline, and knowledge-persistence routing.'

/**
 * Description for the duet-executor custom subagent — when Claude should
 * delegate to it. Standard Duet operating mode.
 */
const AGENT_EXECUTOR_DESCRIPTION =
  'Use when the user explicitly invokes the Executor agent (e.g. via /agents or by name) to perform a focused task in a Duet project. Standard Duet operating mode.'

/**
 * Description for the duet-vizir custom subagent — when Claude should
 * delegate to it. Vizir orchestrates work folders and delegates implementation.
 */
const AGENT_VIZIR_DESCRIPTION =
  'Use when the user asks you to act as Vizir, PM (e.g. !менеджер, менеджер, PM, ПМ), or to coordinate work inside a Duet work folder — running the disciplined loop of delegating to agents, monitoring progress, updating plans, and gating archival on human review.'

/**
 * Wrap a string for safe use as a YAML frontmatter scalar.
 * Single-quote form: simplest reliable escape (' → '').
 */
function yamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Frontmatter for a Claude Code output-style file.
 * `keep-coding-instructions: true` is critical: without it Claude Code
 * removes the coding-related portion of its default system prompt
 * when this style is active.
 */
function outputStyleFrontmatter(): string {
  return [
    '---',
    `name: duet-executor`,
    `description: ${yamlString(OUTPUT_STYLE_DESCRIPTION)}`,
    `keep-coding-instructions: true`,
    '---',
    '',
    ''
  ].join('\n')
}

/**
 * Frontmatter for a Claude Code custom subagent file.
 * Two required fields per the Claude Code spec: `name` (lowercase + hyphens),
 * `description` (when Claude should delegate). `model` and other optional
 * fields are intentionally omitted — they would inherit from the session.
 */
function subagentFrontmatter(name: string, description: string): string {
  return ['---', `name: ${name}`, `description: ${yamlString(description)}`, '---', '', ''].join(
    '\n'
  )
}

/** Expected on-disk content for ~/.claude/output-styles/duet-executor.md (thin session prompt body). */
function expectedOutputStyleContent(sessionBody: string): string {
  return outputStyleFrontmatter() + sessionBody
}

/** Expected on-disk content for ~/.claude/agents/duet-executor.md. */
function expectedExecutorAgentContent(executorBody: string): string {
  return subagentFrontmatter('duet-executor', AGENT_EXECUTOR_DESCRIPTION) + executorBody
}

/** Expected on-disk content for ~/.claude/agents/duet-vizir.md. */
function expectedVizirAgentContent(vizirBody: string): string {
  return subagentFrontmatter('duet-vizir', AGENT_VIZIR_DESCRIPTION) + vizirBody
}

// =============================================================================
// CLAUDE CODE
// =============================================================================

/**
 * Detect + configure Claude Code.
 *
 * Files written by host (Claude Code контракты):
 * - `~/.claude/output-styles/duet-executor.md` — executor body + output-style frontmatter
 * - `~/.claude/agents/duet-executor.md`        — executor body + subagent frontmatter
 * - `~/.claude/agents/duet-vizir.md`           — vizir body + subagent frontmatter
 * - `~/.claude/settings.json` → `outputStyle: "duet-executor"`
 * - `~/.claude.json`         → `mcpServers.duet` (HTTP MCP)
 */
export const configureClaudeCode = (
  merged: MergedAgents,
  duetDataPath: string,
  port: number
): AgentInfo => {
  const claudeDir = join(homedir(), '.claude')
  const claudeJson = join(homedir(), '.claude.json')

  // Detect
  if (!existsSync(claudeDir)) {
    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'not_found',
      details:
        'Папка ~/.claude не найдена. Установите Claude Code: npm install -g @anthropic-ai/claude-code'
    }
  }

  try {
    // 1. Output style directory
    const stylesDir = join(claudeDir, 'output-styles')
    mkdirSync(stylesDir, { recursive: true })

    // 2. Custom agents directory
    const agentsDir = join(claudeDir, 'agents')
    mkdirSync(agentsDir, { recursive: true })

    // 3. MCP server config in ~/.claude.json
    configureClaudeJsonMcp(claudeJson, port)

    // 4. outputStyle setting in ~/.claude/settings.json
    configureClaudeSettings(claudeDir)

    // 5. Output style + custom agents (require merged content from DuetData)
    if (merged.sessionPrompt === null || merged.executor === null || merged.vizir === null) {
      return {
        id: 'claude-code',
        name: 'Claude Code',
        status: 'needs_setup',
        details: 'MCP настроен. Output-style/agents не записаны: инструкции не сгенерированы'
      }
    }

    const styleDest = join(stylesDir, 'duet-executor.md')
    const executorAgentDest = join(agentsDir, 'duet-executor.md')
    const vizirAgentDest = join(agentsDir, 'duet-vizir.md')

    // Output style = thin session prompt (duet.md). Subagents = full agent cores.
    writeFileSync(styleDest, expectedOutputStyleContent(merged.sessionPrompt), 'utf-8')
    writeFileSync(executorAgentDest, expectedExecutorAgentContent(merged.executor), 'utf-8')
    writeFileSync(vizirAgentDest, expectedVizirAgentContent(merged.vizir), 'utf-8')

    // All three new files written successfully — clear legacy artifacts from
    // pre-multi-agent layout. Idempotent and safe-by-construction: runs only
    // after new files exist on disk, so users have no migration window where
    // both old and new are missing.
    const cleanup = cleanupLegacyClaudeFiles(duetDataPath)

    const version = readDeployedVersion(duetDataPath)
    const baseDetails = 'Output style + 2 custom agents + MCP настроены'
    const details =
      cleanup.failed.length > 0
        ? `${baseDetails}. Не удалось удалить legacy: ${cleanup.failed
            .map((f) => f.path)
            .join(', ')}`
        : baseDetails

    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'configured',
      details,
      version: version ?? undefined
    }
  } catch (e) {
    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'needs_setup',
      details: `Ошибка конфигурации: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

/**
 * Добавляет/обновляет MCP сервер duet в ~/.claude.json.
 * Формат: { "mcpServers": { "duet": { "type": "http", "url": "http://..." } } }
 */
function configureClaudeJsonMcp(claudeJsonPath: string, port: number): void {
  let config: Record<string, unknown> = {}

  if (existsSync(claudeJsonPath)) {
    try {
      config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
    } catch {
      // Invalid JSON — overwrite
    }
  }

  if (!config.mcpServers || typeof config.mcpServers !== 'object') {
    config.mcpServers = {}
  }

  const mcpServers = config.mcpServers as Record<string, unknown>

  // HTTP MCP pointing to Duet backend
  mcpServers['duet'] = {
    type: 'http',
    url: `http://127.0.0.1:${port}/mcp`
  }

  writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

// =============================================================================
// CODEX
// =============================================================================

/**
 * Detect + configure Codex.
 *
 * Контракты:
 * - Instructions: ~/.codex/config.toml → model_instructions_file
 * - MCP: ~/.codex/config.toml → [mcp_servers.duet] url (HTTP MCP)
 *
 * Custom subagents (~/.codex/agents/*.toml) intentionally not written —
 * scope decision documented in `agents/spec/COMPONENT.md`.
 */
export const configureCodex = (
  executorContent: string | null,
  duetDataPath: string,
  port: number
): AgentInfo => {
  const codexDir = getCodexDir()

  // Detect
  if (!existsSync(codexDir)) {
    return {
      id: 'codex',
      name: 'Codex',
      status: 'not_found',
      details: 'Папка ~/.codex не найдена. Codex не установлен.'
    }
  }

  try {
    const configPath = join(codexDir, 'config.toml')
    const instructionsPath = join(codexDir, 'duet_instructions.md')

    // Parse existing config or start fresh
    const raw = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : ''
    const config = raw ? parseToml(raw) : ({} as Record<string, unknown>)

    // 1. MCP server: [mcp_servers.duet] — HTTP MCP pointing to backend
    if (!config.mcp_servers || typeof config.mcp_servers !== 'object') {
      config.mcp_servers = {}
    }
    ;(config.mcp_servers as Record<string, unknown>).duet = {
      url: `http://127.0.0.1:${port}/mcp`
    }

    // Remove legacy [mcp.duet] (was incorrectly used before)
    if (config.mcp && typeof config.mcp === 'object') {
      delete (config.mcp as Record<string, unknown>).duet
      if (Object.keys(config.mcp as object).length === 0) delete config.mcp
    }

    // 2. Instructions (require merged content from DuetData)
    if (executorContent !== null) {
      writeFileSync(instructionsPath, executorContent, 'utf-8')
      config.model_instructions_file = instructionsPath
    }

    writeFileSync(configPath, stringifyToml(config) + '\n', 'utf-8')

    if (executorContent === null) {
      return {
        id: 'codex',
        name: 'Codex',
        status: 'needs_setup',
        details: 'MCP настроен. Instructions не записаны: инструкции не сгенерированы'
      }
    }

    const version = readDeployedVersion(duetDataPath)
    return {
      id: 'codex',
      name: 'Codex',
      status: 'configured',
      details: 'Instructions + MCP настроены',
      version: version ?? undefined
    }
  } catch (e) {
    return {
      id: 'codex',
      name: 'Codex',
      status: 'needs_setup',
      details: `Ошибка конфигурации: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

// =============================================================================
// ANTIGRAVITY
// =============================================================================

/**
 * Detect + configure Antigravity (Gemini).
 *
 * Контракты:
 * - Instructions: ~/.gemini/GEMINI.md (executor merged content)
 * - MCP: ~/.gemini/antigravity/mcp_config.json → mcpServers.duet (HTTP MCP)
 *
 * Custom subagents intentionally not deployed — Antigravity does not support
 * them globally (only `~/.gemini/GEMINI.md` and `~/.gemini/AGENTS.md`).
 */
export const configureAntigravity = (
  executorContent: string | null,
  duetDataPath: string,
  port: number
): AgentInfo => {
  const geminiDir = getGeminiDir()

  // Detect
  if (!existsSync(geminiDir)) {
    return {
      id: 'antigravity',
      name: 'Antigravity',
      status: 'not_found',
      details: 'Папка ~/.gemini не найдена. Antigravity не установлен.'
    }
  }

  try {
    const instructionsPath = join(geminiDir, 'GEMINI.md')
    const mcpDir = join(geminiDir, 'antigravity')
    const mcpConfigPath = join(mcpDir, 'mcp_config.json')

    // 1. MCP config
    mkdirSync(mcpDir, { recursive: true })
    let mcpConfig: Record<string, unknown> = {}
    if (existsSync(mcpConfigPath)) {
      try {
        mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'))
      } catch {
        // Invalid JSON — overwrite
      }
    }
    if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
      mcpConfig.mcpServers = {}
    }
    ;(mcpConfig.mcpServers as Record<string, unknown>).duet = {
      type: 'http',
      serverURL: `http://127.0.0.1:${port}/mcp`
    }
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf-8')

    // 2. Instructions (require merged content from DuetData)
    if (executorContent === null) {
      return {
        id: 'antigravity',
        name: 'Antigravity',
        status: 'needs_setup',
        details: 'MCP настроен. GEMINI.md не записан: инструкции не сгенерированы'
      }
    }

    writeFileSync(instructionsPath, executorContent, 'utf-8')

    const version = readDeployedVersion(duetDataPath)
    return {
      id: 'antigravity',
      name: 'Antigravity',
      status: 'configured',
      details: 'GEMINI.md + MCP настроены',
      version: version ?? undefined
    }
  } catch (e) {
    return {
      id: 'antigravity',
      name: 'Antigravity',
      status: 'needs_setup',
      details: `Ошибка конфигурации: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

// =============================================================================
// KIMI CODE
// =============================================================================

/**
 * Detect + configure Kimi Code.
 *
 * Контракты:
 * - System prompt: ~/.kimi-code/SYSTEM.md (thin session prompt + `${base_prompt}`)
 * - MCP: ~/.kimi-code/mcp.json → mcpServers.duet (HTTP MCP)
 *
 * SYSTEM.md — аналог Claude output-style: полная замена системного промпта
 * главного агента (эталонный уровень интеграции). `${base_prompt}` в конце
 * подставляет встроенный дефолтный промпт Kimi — эквивалент
 * `keep-coding-instructions: true` у Claude output-style.
 *
 * В mcp.json поле `type` не пишется: по спецификации Kimi Code наличие `url`
 * само означает HTTP-транспорт.
 *
 * Custom subagents intentionally not deployed — held uniformly with
 * Codex/Antigravity for now.
 */

/**
 * Expected on-disk content for ~/.kimi-code/SYSTEM.md: thin session prompt,
 * then `${base_prompt}` — Kimi renders SYSTEM.md as a template and substitutes
 * the built-in default system prompt in its place.
 */
function expectedKimiSystemContent(sessionBody: string): string {
  return sessionBody + '\n\n${base_prompt}\n'
}

export const configureKimi = (
  sessionContent: string | null,
  duetDataPath: string,
  port: number
): AgentInfo => {
  const kimiDir = getKimiDir()

  // Detect
  if (!existsSync(kimiDir)) {
    return {
      id: 'kimi',
      name: 'Kimi Code',
      status: 'not_found',
      details: 'Папка ~/.kimi-code не найдена. Kimi Code не установлен.'
    }
  }

  try {
    const instructionsPath = join(kimiDir, 'SYSTEM.md')
    const mcpConfigPath = join(kimiDir, 'mcp.json')

    // 1. MCP config
    let mcpConfig: Record<string, unknown> = {}
    if (existsSync(mcpConfigPath)) {
      try {
        mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'))
      } catch {
        // Invalid JSON — overwrite
      }
    }
    if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
      mcpConfig.mcpServers = {}
    }
    ;(mcpConfig.mcpServers as Record<string, unknown>).duet = {
      url: `http://127.0.0.1:${port}/mcp`
    }
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf-8')

    // 2. System prompt (require merged content from DuetData)
    if (sessionContent === null) {
      return {
        id: 'kimi',
        name: 'Kimi Code',
        status: 'needs_setup',
        details: 'MCP настроен. SYSTEM.md не записан: инструкции не сгенерированы'
      }
    }

    writeFileSync(instructionsPath, expectedKimiSystemContent(sessionContent), 'utf-8')

    const version = readDeployedVersion(duetDataPath)
    return {
      id: 'kimi',
      name: 'Kimi Code',
      status: 'configured',
      details: 'SYSTEM.md + MCP настроены',
      version: version ?? undefined
    }
  } catch (e) {
    return {
      id: 'kimi',
      name: 'Kimi Code',
      status: 'needs_setup',
      details: `Ошибка конфигурации: ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

// =============================================================================
// DETECT ALL
// =============================================================================

/**
 * Обнаружить все AI клиенты (без конфигурации).
 * Читает merged content per-agent с диска (DuetData/duet-{agent}.md).
 */
export const detectAgents = (duetDataPath: string, port: number): AgentInfo[] => {
  const merged = readMergedAgents(duetDataPath)
  return [
    detectClaudeCode(merged, duetDataPath, port),
    detectCodex(merged.sessionPrompt, duetDataPath, port),
    detectAntigravity(merged.sessionPrompt, duetDataPath, port),
    detectKimi(merged.sessionPrompt, duetDataPath, port)
  ]
}

function detectClaudeCode(merged: MergedAgents, duetDataPath: string, port: number): AgentInfo {
  const claudeDir = join(homedir(), '.claude')
  if (!existsSync(claudeDir)) {
    return { id: 'claude-code', name: 'Claude Code', status: 'not_found', details: 'Не установлен' }
  }

  const stylePath = join(claudeDir, 'output-styles', 'duet-executor.md')
  const executorAgentPath = join(claudeDir, 'agents', 'duet-executor.md')
  const vizirAgentPath = join(claudeDir, 'agents', 'duet-vizir.md')
  const settingsPath = join(claudeDir, 'settings.json')
  const claudeJsonPath = join(homedir(), '.claude.json')

  const stylePresent = existsSync(stylePath)
  const executorAgentPresent = existsSync(executorAgentPath)
  const vizirAgentPresent = existsSync(vizirAgentPath)
  const hasMcp = claudeJsonHasDuetMcp(claudeJsonPath, port)
  const hasOutputStyleSetting = claudeSettingsHasOutputStyle(settingsPath)

  // Per-file freshness: each compares against its own expected (frontmatter + body).
  const styleFresh =
    stylePresent && merged.sessionPrompt !== null
      ? readFileSync(stylePath, 'utf-8') === expectedOutputStyleContent(merged.sessionPrompt)
      : false
  const executorAgentFresh =
    executorAgentPresent && merged.executor !== null
      ? readFileSync(executorAgentPath, 'utf-8') === expectedExecutorAgentContent(merged.executor)
      : false
  const vizirAgentFresh =
    vizirAgentPresent && merged.vizir !== null
      ? readFileSync(vizirAgentPath, 'utf-8') === expectedVizirAgentContent(merged.vizir)
      : false

  const checkedFiles: AgentCheckedFile[] = [
    { path: stylePath, ok: stylePresent && styleFresh },
    { path: executorAgentPath, ok: executorAgentPresent && executorAgentFresh },
    { path: vizirAgentPath, ok: vizirAgentPresent && vizirAgentFresh },
    { path: settingsPath, ok: hasOutputStyleSetting },
    { path: claudeJsonPath, ok: hasMcp }
  ]

  // Check for additionalDirectories issue
  const rawIssues = checkClaudeCodeIssues(settingsPath)
  const issues = rawIssues.length > 0 ? rawIssues : undefined

  const allFilesOk = checkedFiles.every((f) => f.ok)

  if (!allFilesOk) {
    // Build a focused detail message
    const parts: string[] = []
    if (hasMcp) parts.push('MCP настроен')
    if (stylePresent && styleFresh) parts.push('Output style настроен')
    if (executorAgentPresent && executorAgentFresh && vizirAgentPresent && vizirAgentFresh) {
      parts.push('Custom agents настроены')
    }
    if (hasOutputStyleSetting) parts.push('Settings настроены')

    // Stale (file present but content mismatched) — call it out specifically
    const stale =
      (stylePresent && !styleFresh && merged.sessionPrompt !== null) ||
      (executorAgentPresent && !executorAgentFresh && merged.executor !== null) ||
      (vizirAgentPresent && !vizirAgentFresh && merged.vizir !== null)

    let detail: string
    if (stale) {
      detail = 'Инструкции устарели — нажмите «Настроить все»'
    } else if (parts.length > 0) {
      detail = parts.join(', ')
    } else {
      detail = '~/.claude найдена'
    }

    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'needs_setup',
      details: detail,
      checkedFiles,
      issues
    }
  }

  // Issues alone trigger needs_setup (e.g. additionalDirectories present)
  if (issues) {
    const version = readDeployedVersion(duetDataPath)
    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'needs_setup',
      details: 'Конфигурация настроена, но есть проблемы',
      version: version ?? undefined,
      checkedFiles,
      issues
    }
  }

  const version = readDeployedVersion(duetDataPath)
  return {
    id: 'claude-code',
    name: 'Claude Code',
    status: 'configured',
    details: 'Output style + 2 custom agents + MCP настроены',
    version: version ?? undefined,
    checkedFiles
  }
}

/**
 * Проверяет проблемы конфигурации Claude Code.
 * additionalDirectories в settings.json засоряет multi-root workspace VS Code,
 * ломая orientation (лишние пути попадают в workspace_paths).
 */
function checkClaudeCodeIssues(settingsPath: string): AgentIssue[] {
  const issues: AgentIssue[] = []

  if (!existsSync(settingsPath)) return issues

  try {
    const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const additionalDirs =
      config?.permissions?.additionalDirectories ?? config?.additionalDirectories
    if (Array.isArray(additionalDirs)) {
      if (additionalDirs.length > 0) {
        issues.push({
          reason_code: 'additional_directories',
          description:
            'settings.json содержит additionalDirectories — этот параметр засоряет workspace в VS Code и ломает orientation. Удалите его.',
          fixable: true
        })
      }
    }
  } catch {
    // Invalid JSON — not our problem here
  }

  return issues
}

function detectCodex(
  executorContent: string | null,
  duetDataPath: string,
  port: number
): AgentInfo {
  const codexDir = getCodexDir()
  if (!existsSync(codexDir)) {
    return { id: 'codex', name: 'Codex', status: 'not_found', details: 'Не установлен' }
  }

  const configPath = join(codexDir, 'config.toml')
  const instructionsPath = join(codexDir, 'duet_instructions.md')

  if (!existsSync(configPath)) {
    return {
      id: 'codex',
      name: 'Codex',
      status: 'needs_setup',
      details: '~/.codex найдена',
      checkedFiles: [{ path: configPath, ok: false }]
    }
  }

  try {
    const config = parseToml(readFileSync(configPath, 'utf-8'))
    const mcpServers = config.mcp_servers as Record<string, unknown> | undefined
    const duetMcp = mcpServers?.duet as Record<string, unknown> | undefined
    const hasMcp = !!(duetMcp && duetMcp.url === `http://127.0.0.1:${port}/mcp`)
    const hasInstructions =
      typeof config.model_instructions_file === 'string' &&
      config.model_instructions_file === instructionsPath

    const instructionsExist = existsSync(instructionsPath)

    // Check content freshness against executor merged content
    let contentFresh = false
    if (instructionsExist && executorContent !== null) {
      const actual = readFileSync(instructionsPath, 'utf-8')
      contentFresh = actual === executorContent
    }

    const checkedFiles: AgentCheckedFile[] = [
      { path: configPath, ok: hasMcp && hasInstructions },
      { path: instructionsPath, ok: instructionsExist && contentFresh }
    ]

    if (hasMcp && hasInstructions && contentFresh) {
      const version = readDeployedVersion(duetDataPath)
      return {
        id: 'codex',
        name: 'Codex',
        status: 'configured',
        details: 'Instructions + MCP настроены',
        version: version ?? undefined,
        checkedFiles
      }
    }

    const parts: string[] = []
    if (hasMcp) parts.push('MCP настроен')
    if (hasInstructions && contentFresh) parts.push('Instructions настроены')
    const detail = parts.length > 0 ? parts.join(', ') : '~/.codex найдена'

    return { id: 'codex', name: 'Codex', status: 'needs_setup', details: detail, checkedFiles }
  } catch {
    return {
      id: 'codex',
      name: 'Codex',
      status: 'needs_setup',
      details: '~/.codex найдена',
      checkedFiles: [{ path: configPath, ok: false }]
    }
  }
}

function detectAntigravity(
  executorContent: string | null,
  duetDataPath: string,
  port: number
): AgentInfo {
  const geminiDir = getGeminiDir()
  if (!existsSync(geminiDir)) {
    return {
      id: 'antigravity',
      name: 'Antigravity',
      status: 'not_found',
      details: 'Не установлен'
    }
  }

  const instructionsPath = join(geminiDir, 'GEMINI.md')
  const mcpConfigPath = join(geminiDir, 'antigravity', 'mcp_config.json')

  const hasInstructions = existsSync(instructionsPath)
  const hasMcp = geminiHasDuetMcp(mcpConfigPath, port)

  // Check content freshness against executor merged content
  let contentFresh = false
  if (hasInstructions && executorContent !== null) {
    const actual = readFileSync(instructionsPath, 'utf-8')
    contentFresh = actual === executorContent
  }

  const checkedFiles: AgentCheckedFile[] = [
    { path: instructionsPath, ok: hasInstructions && contentFresh },
    { path: mcpConfigPath, ok: hasMcp }
  ]

  if (hasMcp && hasInstructions && contentFresh) {
    const version = readDeployedVersion(duetDataPath)
    return {
      id: 'antigravity',
      name: 'Antigravity',
      status: 'configured',
      details: 'GEMINI.md + MCP настроены',
      version: version ?? undefined,
      checkedFiles
    }
  }

  const parts: string[] = []
  if (hasMcp) parts.push('MCP настроен')
  if (hasInstructions && contentFresh) parts.push('GEMINI.md настроен')
  const detail = parts.length > 0 ? parts.join(', ') : '~/.gemini найдена'

  return {
    id: 'antigravity',
    name: 'Antigravity',
    status: 'needs_setup',
    details: detail,
    checkedFiles
  }
}

function detectKimi(sessionContent: string | null, duetDataPath: string, port: number): AgentInfo {
  const kimiDir = getKimiDir()
  if (!existsSync(kimiDir)) {
    return {
      id: 'kimi',
      name: 'Kimi Code',
      status: 'not_found',
      details: 'Не установлен'
    }
  }

  const instructionsPath = join(kimiDir, 'SYSTEM.md')
  const mcpConfigPath = join(kimiDir, 'mcp.json')

  const hasInstructions = existsSync(instructionsPath)
  const hasMcp = kimiHasDuetMcp(mcpConfigPath, port)

  // Check content freshness against expected SYSTEM.md (session prompt + ${base_prompt})
  let contentFresh = false
  if (hasInstructions && sessionContent !== null) {
    const actual = readFileSync(instructionsPath, 'utf-8')
    contentFresh = actual === expectedKimiSystemContent(sessionContent)
  }

  const checkedFiles: AgentCheckedFile[] = [
    { path: instructionsPath, ok: hasInstructions && contentFresh },
    { path: mcpConfigPath, ok: hasMcp }
  ]

  if (hasMcp && hasInstructions && contentFresh) {
    const version = readDeployedVersion(duetDataPath)
    return {
      id: 'kimi',
      name: 'Kimi Code',
      status: 'configured',
      details: 'SYSTEM.md + MCP настроены',
      version: version ?? undefined,
      checkedFiles
    }
  }

  const parts: string[] = []
  if (hasMcp) parts.push('MCP настроен')
  if (hasInstructions && contentFresh) parts.push('SYSTEM.md настроен')
  const detail = parts.length > 0 ? parts.join(', ') : '~/.kimi-code найдена'

  return {
    id: 'kimi',
    name: 'Kimi Code',
    status: 'needs_setup',
    details: detail,
    checkedFiles
  }
}

/** Устанавливает outputStyle: "duet-executor" в ~/.claude/settings.json */
function configureClaudeSettings(claudeDir: string): void {
  const settingsPath = join(claudeDir, 'settings.json')
  let config: Record<string, unknown> = {}

  if (existsSync(settingsPath)) {
    try {
      config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch {
      // Invalid JSON — overwrite
    }
  }

  config.outputStyle = 'duet-executor'
  writeFileSync(settingsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Проверяет наличие outputStyle: "duet-executor" в ~/.claude/settings.json */
function claudeSettingsHasOutputStyle(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false
  try {
    const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    return config?.outputStyle === 'duet-executor'
  } catch {
    return false
  }
}

/** Проверяет наличие mcpServers.duet (HTTP MCP) в ~/.claude.json */
function claudeJsonHasDuetMcp(claudeJsonPath: string, port: number): boolean {
  if (!existsSync(claudeJsonPath)) return false
  try {
    const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
    const mcp = config?.mcpServers?.duet
    if (!mcp) return false
    return mcp.type === 'http' && mcp.url === `http://127.0.0.1:${port}/mcp`
  } catch {
    return false
  }
}

/** Проверяет наличие mcpServers.duet (HTTP MCP) в Antigravity mcp_config.json */
function geminiHasDuetMcp(mcpConfigPath: string, port: number): boolean {
  if (!existsSync(mcpConfigPath)) return false
  try {
    const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'))
    const mcp = config?.mcpServers?.duet
    if (!mcp) return false
    return mcp.type === 'http' && mcp.serverURL === `http://127.0.0.1:${port}/mcp`
  } catch {
    return false
  }
}

/** Проверяет наличие mcpServers.duet (HTTP MCP) в Kimi Code mcp.json */
function kimiHasDuetMcp(mcpConfigPath: string, port: number): boolean {
  if (!existsSync(mcpConfigPath)) return false
  try {
    const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'))
    const mcp = config?.mcpServers?.duet
    if (!mcp) return false
    return mcp.url === `http://127.0.0.1:${port}/mcp`
  } catch {
    return false
  }
}

/**
 * Конфигурировать все найденные AI клиенты.
 *
 * Сначала пересобирает merged-инструкции из платформенного бандла (`triggerMerge` →
 * `POST /merge-duet-instructions`), затем читает свежие per-agent файлы с диска и
 * распределяет по клиентам. Мёрж — детерминированная сборка из bundled-источников
 * (bootstrapper + ядра агентов), поэтому каждый configure отдаёт актуальный `duet.md`
 * (в т.ч. после апгрейда backend). Это единый путь produce→deploy: ручная кнопка
 * «Настроить все», автомёрж на старте и пост-деплой все идут через него.
 */
export const configureAllAgents = async (
  duetDataPath: string,
  port: number
): Promise<AgentInfo[]> => {
  await triggerMerge(port)
  const merged = readMergedAgents(duetDataPath)
  configureClaudeCode(merged, duetDataPath, port)
  configureCodex(merged.sessionPrompt, duetDataPath, port)
  configureAntigravity(merged.sessionPrompt, duetDataPath, port)
  configureKimi(merged.sessionPrompt, duetDataPath, port)
  // Re-detect after configure to return full AgentInfo with checkedFiles
  return detectAgents(duetDataPath, port)
}

/**
 * Исправляет конкретную проблему агента.
 * Возвращает true если проблема исправлена.
 */
export function fixAgentIssue(agentId: string, reasonCode: string): boolean {
  if (agentId === 'claude-code' && reasonCode === 'additional_directories') {
    return fixClaudeAdditionalDirectories()
  }
  return false
}

/** Удаляет additionalDirectories из ~/.claude/settings.json */
function fixClaudeAdditionalDirectories(): boolean {
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(settingsPath)) return false

  try {
    const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    let changed = false
    if (config.additionalDirectories) {
      delete config.additionalDirectories
      changed = true
    }
    if (config.permissions?.additionalDirectories) {
      delete config.permissions.additionalDirectories
      changed = true
    }
    if (!changed) return true // Already fixed
    writeFileSync(settingsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    return true
  } catch {
    return false
  }
}

// =============================================================================
// LEGACY UBORKA (кладётся отдельно, вызывается отдельным шагом плана —
// после end-to-end проверки новой раскатки)
// =============================================================================

/** Filename of the legacy single merged file (pre-multi-agent layout). */
const LEGACY_MERGED_INSTRUCTIONS_FILE = 'duet-instructions.md'

/** Result of a legacy-cleanup pass. `failed` entries surface to UI/logs. */
export interface LegacyCleanupResult {
  /** Files actually deleted in this pass. */
  removed: string[]
  /** Files present on disk but `unlinkSync` refused (permissions, etc.). */
  failed: { path: string; error: string }[]
}

/**
 * Removes legacy Duet files left over from the pre-multi-agent layout.
 * Idempotent: missing files are silently skipped.
 *
 * Called automatically by `configureClaudeCode` after successful write of new
 * files (output-style + 2 custom agents) — runs only when new files exist on
 * disk, so users have no migration window where both old and new are missing.
 *
 * Targets:
 *   - `~/.claude/output-styles/duet.md` — old single output-style (host previously wrote it)
 *   - `~/.claude/agents/duet.md`        — historically user-managed but its
 *                                          name is reserved by Duet now;
 *                                          deletion is approved per migration plan
 *   - `<duetDataPath>/duet-instructions.md` — old single merged file (host previously wrote it)
 *
 * NOT removed:
 *   - `~/.claude/agents/vizir.md` — user's personal draft, name does not collide
 *     with Duet-managed `duet-vizir.md`. Out of scope for migration.
 *
 * Returns `{ removed, failed }`. Failures (e.g. permission denied) are
 * recorded but do NOT throw — the surrounding configure flow continues.
 * Caller may surface `failed` in agent details or logs.
 */
export function cleanupLegacyClaudeFiles(duetDataPath: string): LegacyCleanupResult {
  const targets = [
    join(homedir(), '.claude', 'output-styles', 'duet.md'),
    join(homedir(), '.claude', 'agents', 'duet.md'),
    join(duetDataPath, LEGACY_MERGED_INSTRUCTIONS_FILE)
  ]
  const removed: string[] = []
  const failed: { path: string; error: string }[] = []
  for (const path of targets) {
    if (!existsSync(path)) continue
    try {
      unlinkSync(path)
      removed.push(path)
    } catch (e) {
      failed.push({
        path,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }
  return { removed, failed }
}

// =============================================================================
// UTILITIES
// =============================================================================

function getCodexDir(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

function getGeminiDir(): string {
  return process.env.GEMINI_HOME || join(homedir(), '.gemini')
}

function getKimiDir(): string {
  return process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code')
}
