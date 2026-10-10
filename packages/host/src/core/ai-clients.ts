/** Configure AI clients with the platform session prompt and Duet MCP.
 * Role-specific behavior belongs to explicitly invoked skills, not custom agents.
 * This module has no Electron imports; tests use isolated home directories.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { readDeployedVersion } from './deploy'
import { venvPythonPath } from './backend'
import { atomicWriteJson, readJsonStrict } from './json-io'
import { readSessionPrompt, triggerMerge } from './instructions'
import type { AgentInfo, AgentCheckedFile, AgentIssue } from '../shared/types'

// Re-export IPC types (source of truth: shared/types.ts)
export type { AgentStatus, AgentCheckedFile, AgentIssue, AgentInfo } from '../shared/types'

// =============================================================================
// FRONTMATTER HELPERS
// =============================================================================

/** Description of the shared platform output style. */
const OUTPUT_STYLE_DESCRIPTION =
  'Duet platform instructions: workspace orientation, business context, tools, and knowledge persistence.'

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
    `name: duet-core`,
    `description: ${yamlString(OUTPUT_STYLE_DESCRIPTION)}`,
    `keep-coding-instructions: true`,
    '---',
    '',
    ''
  ].join('\n')
}

/** Expected output-style content, including the backend provenance banner. */
function expectedOutputStyleContent(sessionBody: string): string {
  return outputStyleFrontmatter() + sessionBody
}

// =============================================================================
// CLAUDE CODE
// =============================================================================

/** Configure the platform output style and HTTP MCP server for Claude Code. */
export const configureClaudeCode = (
  sessionPrompt: string | null,
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

    // MCP server configuration in ~/.claude.json
    configureClaudeJsonMcp(claudeJson, port)

    if (sessionPrompt === null) {
      return {
        id: 'claude-code',
        name: 'Claude Code',
        status: 'needs_setup',
        details: 'MCP configured. Session prompt has not been generated.'
      }
    }

    // Select the new style only after its file is ready; retire old files last.
    const styleDest = join(stylesDir, 'duet-core.md')
    writeFileSync(styleDest, expectedOutputStyleContent(sessionPrompt), 'utf-8')
    configureClaudeSettings(claudeDir)
    const cleanup = cleanupLegacyClaudeFiles(duetDataPath)

    const version = readDeployedVersion(duetDataPath)
    const baseDetails = 'Output style + MCP configured'
    const details =
      cleanup.failed.length > 0
        ? `${baseDetails}. Не удалось удалить legacy: ${cleanup.failed
            .map((f) => f.path)
            .join(', ')}`
        : baseDetails

    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: cleanup.failed.length > 0 ? 'needs_setup' : 'configured',
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
  sessionPrompt: string | null,
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
    if (sessionPrompt !== null) {
      writeFileSync(instructionsPath, sessionPrompt, 'utf-8')
      config.model_instructions_file = instructionsPath
    }

    writeFileSync(configPath, stringifyToml(config) + '\n', 'utf-8')

    if (sessionPrompt === null) {
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
 * - Instructions: ~/.gemini/GEMINI.md (platform session prompt)
 * - MCP: ~/.gemini/antigravity/mcp_config.json → mcpServers.duet (HTTP MCP)
 *
 * Custom subagents intentionally not deployed — Antigravity does not support
 * them globally (only `~/.gemini/GEMINI.md` and `~/.gemini/AGENTS.md`).
 */
export const configureAntigravity = (
  sessionPrompt: string | null,
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
    if (sessionPrompt === null) {
      return {
        id: 'antigravity',
        name: 'Antigravity',
        status: 'needs_setup',
        details: 'MCP настроен. GEMINI.md не записан: инструкции не сгенерированы'
      }
    }

    writeFileSync(instructionsPath, sessionPrompt, 'utf-8')

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
// CLAUDE DESKTOP
// =============================================================================

/**
 * Detect + configure Claude Desktop.
 *
 * Контракт: `claude_desktop_config.json` → `mcpServers.duet` — stdio-сервер
 *   `command` = Python из `DuetData/.venv`,
 *   `args`    = [`DuetData/backend/mcp_stdio_bridge.py`, `http://127.0.0.1:<port>/mcp/`].
 *
 * Claude Desktop запускает из этого файла только stdio-процессы (`type: "http"` он не
 * читает), поэтому до HTTP MCP backend'а он доходит через мост. Python и мост ставит
 * деплой (venv + DuetData/backend), так что запись одинакова на macOS и Windows и не
 * зависит от Node/npx. URL со слэшем: `/mcp` отвечает 307, а мост редиректы не ходит.
 *
 * Файл принадлежит Claude Desktop (в нём его preferences): меняется только ключ `duet`,
 * атомарно и только если запись отличается; битый JSON не перезаписывается. Desktop
 * читает файл на старте — после настройки его нужно перезапустить.
 *
 * Системный промпт не разливается: у чатов Claude Desktop нет файла для него.
 */

const CLAUDE_DESKTOP_CONFIG_FILE = 'claude_desktop_config.json'
const MCP_STDIO_BRIDGE_FILE = 'mcp_stdio_bridge.py'

interface StdioServer {
  command: string
  args: string[]
}

/**
 * Папка конфигурации Claude Desktop (документирована на modelcontextprotocol.io,
 * «Connect to local MCP servers»). Linux-сборки официально нет; путь — по XDG.
 * Windows MSIX-установка (Microsoft Store) читает другой путь — не поддержана.
 */
export function claudeDesktopConfigDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude')
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude')
}

/** Ожидаемая запись `mcpServers.duet` для Claude Desktop. */
export function claudeDesktopDuetServer(
  duetDataPath: string,
  port: number,
  platform: NodeJS.Platform = process.platform
): StdioServer {
  return {
    command: venvPythonPath(join(duetDataPath, '.venv'), platform),
    args: [join(duetDataPath, 'backend', MCP_STDIO_BRIDGE_FILE), `http://127.0.0.1:${port}/mcp/`]
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sameStdioServer(entry: unknown, expected: StdioServer): boolean {
  if (!isPlainObject(entry)) return false
  return (
    entry.command === expected.command &&
    Array.isArray(entry.args) &&
    JSON.stringify(entry.args) === JSON.stringify(expected.args)
  )
}

export const configureClaudeDesktop = (duetDataPath: string, port: number): AgentInfo => {
  const desktopDir = claudeDesktopConfigDir()
  if (!existsSync(desktopDir)) return detectClaudeDesktop(duetDataPath, port)

  const configPath = join(desktopDir, CLAUDE_DESKTOP_CONFIG_FILE)
  const read = readJsonStrict(configPath)
  let config: Record<string, unknown> = {}
  if (read.kind === 'ok' && isPlainObject(read.data)) {
    config = read.data
  } else if (read.kind !== 'missing') {
    const reason = read.kind === 'ok' ? 'не JSON-объект' : read.error
    return {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      status: 'needs_setup',
      details: `${CLAUDE_DESKTOP_CONFIG_FILE} не читается (${reason}) — Duet его не трогает`,
      checkedFiles: [{ path: configPath, ok: false }]
    }
  }

  try {
    if (!isPlainObject(config.mcpServers)) {
      config.mcpServers = {}
    }
    const mcpServers = config.mcpServers as Record<string, unknown>
    const expected = claudeDesktopDuetServer(duetDataPath, port)
    if (!sameStdioServer(mcpServers.duet, expected)) {
      mcpServers.duet = expected
      atomicWriteJson(configPath, config)
      const info = detectClaudeDesktop(duetDataPath, port)
      return info.status === 'configured'
        ? { ...info, details: `${info.details}. Перезапустите Claude Desktop` }
        : info
    }
  } catch (e) {
    return {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      status: 'needs_setup',
      details: `Ошибка конфигурации: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return detectClaudeDesktop(duetDataPath, port)
}

// =============================================================================
// DETECT ALL
// =============================================================================

/**
 * Обнаружить все AI клиенты (без конфигурации).
 * Reads the platform session prompt from DuetData/duet.md.
 */
export const detectAgents = (duetDataPath: string, port: number): AgentInfo[] => {
  const sessionPrompt = readSessionPrompt(duetDataPath)
  return [
    detectClaudeCode(sessionPrompt, duetDataPath, port),
    detectCodex(sessionPrompt, duetDataPath, port),
    detectAntigravity(sessionPrompt, duetDataPath, port),
    detectKimi(sessionPrompt, duetDataPath, port),
    detectClaudeDesktop(duetDataPath, port)
  ]
}

function detectClaudeCode(
  sessionPrompt: string | null,
  duetDataPath: string,
  port: number
): AgentInfo {
  const claudeDir = join(homedir(), '.claude')
  if (!existsSync(claudeDir)) {
    return { id: 'claude-code', name: 'Claude Code', status: 'not_found', details: 'Не установлен' }
  }

  const stylePath = join(claudeDir, 'output-styles', 'duet-core.md')
  const settingsPath = join(claudeDir, 'settings.json')
  const claudeJsonPath = join(homedir(), '.claude.json')

  const stylePresent = existsSync(stylePath)
  const hasMcp = claudeJsonHasDuetMcp(claudeJsonPath, port)
  const hasOutputStyleSetting = claudeSettingsHasOutputStyle(settingsPath)

  // Per-file freshness: each compares against its own expected (frontmatter + body).
  const styleFresh =
    stylePresent && sessionPrompt !== null
      ? readFileSync(stylePath, 'utf-8') === expectedOutputStyleContent(sessionPrompt)
      : false
  const checkedFiles: AgentCheckedFile[] = [
    { path: stylePath, ok: stylePresent && styleFresh },
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
    if (hasOutputStyleSetting) parts.push('Settings настроены')

    // Stale (file present but content mismatched) — call it out specifically
    const stale = stylePresent && !styleFresh && sessionPrompt !== null

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
    details: 'Output style + MCP configured',
    version: version ?? undefined,
    checkedFiles
  }
}

/**
 * Проверяет проблемы конфигурации Claude Code.
 * additionalDirectories в settings.json добавляет лишние папки в multi-root
 * workspace VS Code.
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
            'settings.json содержит additionalDirectories — этот параметр добавляет лишние папки в workspace VS Code. Удалите его.',
          fixable: true
        })
      }
    }
  } catch {
    // Invalid JSON — not our problem here
  }

  return issues
}

function detectCodex(sessionPrompt: string | null, duetDataPath: string, port: number): AgentInfo {
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

    // Check content freshness against platform session prompt
    let contentFresh = false
    if (instructionsExist && sessionPrompt !== null) {
      const actual = readFileSync(instructionsPath, 'utf-8')
      contentFresh = actual === sessionPrompt
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
  sessionPrompt: string | null,
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

  // Check content freshness against platform session prompt
  let contentFresh = false
  if (hasInstructions && sessionPrompt !== null) {
    const actual = readFileSync(instructionsPath, 'utf-8')
    contentFresh = actual === sessionPrompt
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

function detectClaudeDesktop(duetDataPath: string, port: number): AgentInfo {
  const desktopDir = claudeDesktopConfigDir()
  if (!existsSync(desktopDir)) {
    return {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      status: 'not_found',
      details: 'Не установлен'
    }
  }

  const configPath = join(desktopDir, CLAUDE_DESKTOP_CONFIG_FILE)
  const expected = claudeDesktopDuetServer(duetDataPath, port)
  const read = readJsonStrict(configPath)
  const mcpServers =
    read.kind === 'ok' && isPlainObject(read.data) ? read.data.mcpServers : undefined
  const hasMcp = isPlainObject(mcpServers) && sameStdioServer(mcpServers.duet, expected)
  const hasPython = existsSync(expected.command)
  const hasBridge = existsSync(expected.args[0])

  const checkedFiles: AgentCheckedFile[] = [
    { path: configPath, ok: hasMcp },
    { path: expected.command, ok: hasPython },
    { path: expected.args[0], ok: hasBridge }
  ]

  if (hasMcp && hasPython && hasBridge) {
    const version = readDeployedVersion(duetDataPath)
    return {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      status: 'configured',
      details: 'MCP настроен (stdio-мост)',
      version: version ?? undefined,
      checkedFiles
    }
  }

  const parts: string[] = []
  if (hasMcp) parts.push('MCP прописан')
  if (!hasPython || !hasBridge) parts.push('мост не развёрнут — запустите деплой backend')
  const detail = parts.length > 0 ? parts.join(', ') : 'Claude Desktop найден'

  return {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    status: 'needs_setup',
    details: detail,
    checkedFiles
  }
}

/** Устанавливает outputStyle: "duet-core" в ~/.claude/settings.json */
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

  config.outputStyle = 'duet-core'
  writeFileSync(settingsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Проверяет наличие outputStyle: "duet-core" в ~/.claude/settings.json */
function claudeSettingsHasOutputStyle(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false
  try {
    const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    return config?.outputStyle === 'duet-core'
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

/** Rebuild the platform prompt, then deploy it and MCP settings to AI clients. */
export const configureAllAgents = async (
  duetDataPath: string,
  port: number
): Promise<AgentInfo[]> => {
  const build = await triggerMerge(port)
  if (build.status !== 'ok') {
    const details = `Cannot build the Duet session prompt: ${build.errors
      .map((error) => error.description)
      .join('; ')}`
    return detectAgents(duetDataPath, port).map((client) =>
      client.status === 'not_found' ? client : { ...client, status: 'needs_setup', details }
    )
  }
  const sessionPrompt = readSessionPrompt(duetDataPath)
  const configured = [
    configureClaudeCode(sessionPrompt, duetDataPath, port),
    configureCodex(sessionPrompt, duetDataPath, port),
    configureAntigravity(sessionPrompt, duetDataPath, port),
    configureKimi(sessionPrompt, duetDataPath, port),
    configureClaudeDesktop(duetDataPath, port)
  ]
  // Keep write/cleanup failures visible even when the new files pass detection.
  return detectAgents(duetDataPath, port).map((detected, index) => {
    const result = configured[index]
    return result.status === 'needs_setup'
      ? { ...detected, status: result.status, details: result.details }
      : detected
  })
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
// RETIRED PLATFORM FILES
// =============================================================================

/** Result of removing retired, provenance-marked Duet artifacts. */
export interface LegacyCleanupResult {
  removed: string[]
  failed: { path: string; error: string }[]
}

/**
 * Retire generated role files only after the replacement style is configured.
 * Never remove hand-written files, including a user's personal vizir.md.
 */
export function cleanupLegacyClaudeFiles(duetDataPath: string): LegacyCleanupResult {
  const targets = [
    join(homedir(), '.claude', 'output-styles', 'duet.md'),
    join(homedir(), '.claude', 'output-styles', 'duet-executor.md'),
    join(homedir(), '.claude', 'agents', 'duet-executor.md'),
    join(homedir(), '.claude', 'agents', 'duet-vizir.md'),
    join(homedir(), '.claude', 'agents', 'duet.md'),
    join(duetDataPath, 'duet-executor.md'),
    join(duetDataPath, 'duet-vizir.md'),
    join(duetDataPath, 'duet-instructions.md')
  ]
  const removed: string[] = []
  const failed: { path: string; error: string }[] = []
  for (const path of targets) {
    if (!existsSync(path)) continue
    try {
      if (
        !readFileSync(path, 'utf-8').includes(
          'AUTO-GENERATED by Duet from @Duet.git/packages/instructions/'
        )
      )
        continue
      unlinkSync(path)
      removed.push(path)
    } catch (e) {
      failed.push({ path, error: e instanceof Error ? e.message : String(e) })
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
