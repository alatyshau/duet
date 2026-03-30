/*
 * ЧТО: Обнаружение и конфигурация AI клиентов (Claude Code, Codex).
 * ЗАЧЕМ: Host конфигурирует AI клиенты прямой записью файлов (не CLI).
 * КТО ИСПОЛЬЗУЕТ: main process, страница "AI Агенты".
 *
 * ПАТТЕРН: detect (проверить реальные файлы конфигурации) → configure (write files) → show result.
 * detect и configure должны возвращать одинаковый status — это проверяется round-trip тестом.
 * Ненайденный AI клиент — не ошибка, просто информация.
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { readDeployedVersion } from './deploy'
import type { AgentInfo, AgentCheckedFile } from '../shared/types'

// Re-export IPC types (source of truth: shared/types.ts)
export type { AgentStatus, AgentCheckedFile, AgentInfo } from '../shared/types'

// =============================================================================
// BOOTSTRAPPER CONTENT
// =============================================================================

/**
 * Получает скомпонованный bootstrapper от backend (GET /bootstrapper).
 * Возвращает null если backend недоступен или merge невозможен.
 */
async function fetchBootstrapperContent(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/bootstrapper`, {
      signal: AbortSignal.timeout(5000)
    })
    if (!res.ok) return null
    const data = (await res.json()) as { content?: string }
    return data.content || null
  } catch {
    return null
  }
}

// =============================================================================
// CLAUDE CODE
// =============================================================================

/** YAML frontmatter required by Claude Code output-style format. */
const CLAUDE_OUTPUT_STYLE_FRONTMATTER = `---
name: Duet
description: Core instructions for AI agents working in Duet ecosystem
keep-coding-instructions: true
---\n\n`

/**
 * Detect + configure Claude Code.
 *
 * Контракты:
 * - output-style: ~/.claude/output-styles/duet.md (инструкции как system prompt)
 * - MCP: ~/.claude.json → mcpServers.duet (HTTP MCP: http://127.0.0.1:<port>/mcp)
 */
export const configureClaudeCode = (
  mergedContent: string | null,
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
    const styleDest = join(stylesDir, 'duet.md')

    // 2. MCP server config in ~/.claude.json
    configureClaudeJsonMcp(claudeJson, port)

    // 3. outputStyle in ~/.claude/settings.json
    configureClaudeSettings(claudeDir)

    // 4. Output style (requires merged bootstrapper content from backend)
    if (!mergedContent) {
      return {
        id: 'claude-code',
        name: 'Claude Code',
        status: 'needs_setup',
        details: 'MCP настроен. Output style не записан: backend недоступен'
      }
    }

    writeFileSync(styleDest, CLAUDE_OUTPUT_STYLE_FRONTMATTER + mergedContent, 'utf-8')

    const version = readDeployedVersion(duetDataPath)
    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'configured',
      details: 'Output style + MCP настроены',
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
 */
export const configureCodex = (
  mergedContent: string | null,
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

    // 2. Instructions (requires merged bootstrapper content from backend)
    if (mergedContent) {
      writeFileSync(instructionsPath, mergedContent, 'utf-8')
      config.model_instructions_file = instructionsPath
    }

    writeFileSync(configPath, stringifyToml(config) + '\n', 'utf-8')

    if (!mergedContent) {
      return {
        id: 'codex',
        name: 'Codex',
        status: 'needs_setup',
        details: 'MCP настроен. Instructions не записаны: backend недоступен'
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
// DETECT ALL
// =============================================================================

/**
 * Обнаружить все AI клиенты (без конфигурации).
 * Проверяет реальные файлы конфигурации, а не только директории.
 */
export const detectAgents = async (duetDataPath: string, port: number): Promise<AgentInfo[]> => {
  const mergedContent = await fetchBootstrapperContent(port)
  return [
    detectClaudeCode(mergedContent, duetDataPath, port),
    detectCodex(mergedContent, duetDataPath, port)
  ]
}

function detectClaudeCode(mergedContent: string | null, duetDataPath: string, port: number): AgentInfo {
  const claudeDir = join(homedir(), '.claude')
  if (!existsSync(claudeDir)) {
    return { id: 'claude-code', name: 'Claude Code', status: 'not_found', details: 'Не установлен' }
  }

  const stylePath = join(claudeDir, 'output-styles', 'duet.md')
  const settingsPath = join(claudeDir, 'settings.json')
  const claudeJsonPath = join(homedir(), '.claude.json')

  const hasOutputStyle = existsSync(stylePath)
  const hasMcp = claudeJsonHasDuetMcp(claudeJsonPath, port)
  const hasOutputStyleSetting = claudeSettingsHasOutputStyle(settingsPath)

  // Check content freshness (only when merged content available)
  let contentFresh = false
  if (hasOutputStyle && mergedContent) {
    const expected = CLAUDE_OUTPUT_STYLE_FRONTMATTER + mergedContent
    const actual = readFileSync(stylePath, 'utf-8')
    contentFresh = actual === expected
  }

  const checkedFiles: AgentCheckedFile[] = [
    { path: stylePath, ok: hasOutputStyle && contentFresh },
    { path: settingsPath, ok: hasOutputStyleSetting },
    { path: claudeJsonPath, ok: hasMcp }
  ]

  if (!hasOutputStyle || !hasMcp || !hasOutputStyleSetting) {
    const parts: string[] = []
    if (hasMcp) parts.push('MCP настроен')
    if (hasOutputStyle) parts.push('Output style настроен')
    if (hasOutputStyleSetting) parts.push('Settings настроены')
    const detail = parts.length > 0 ? parts.join(', ') : '~/.claude найдена'
    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'needs_setup',
      details: detail,
      checkedFiles
    }
  }

  if (!contentFresh) {
    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'needs_setup',
      details: 'Инструкции устарели — нажмите «Настроить все»',
      checkedFiles
    }
  }

  const version = readDeployedVersion(duetDataPath)
  return {
    id: 'claude-code',
    name: 'Claude Code',
    status: 'configured',
    details: 'Output style + MCP настроены',
    version: version ?? undefined,
    checkedFiles
  }
}

function detectCodex(mergedContent: string | null, duetDataPath: string, port: number): AgentInfo {
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

    // Check content freshness
    let contentFresh = false
    if (instructionsExist && mergedContent) {
      const actual = readFileSync(instructionsPath, 'utf-8')
      contentFresh = actual === mergedContent
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

/** Устанавливает outputStyle: "Duet" в ~/.claude/settings.json */
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

  config.outputStyle = 'Duet'
  writeFileSync(settingsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Проверяет наличие outputStyle: "Duet" в ~/.claude/settings.json */
function claudeSettingsHasOutputStyle(settingsPath: string): boolean {
  if (!existsSync(settingsPath)) return false
  try {
    const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    return config?.outputStyle === 'Duet'
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

/**
 * Конфигурировать все найденные AI клиенты.
 */
export const configureAllAgents = async (
  duetDataPath: string,
  port: number
): Promise<AgentInfo[]> => {
  const mergedContent = await fetchBootstrapperContent(port)
  return [
    configureClaudeCode(mergedContent, duetDataPath, port),
    configureCodex(mergedContent, duetDataPath, port)
  ]
}

// =============================================================================
// UTILITIES
// =============================================================================

function getCodexDir(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}
