/*
 * ЧТО: Обнаружение и конфигурация AI клиентов (Claude Code, Codex, Antigravity).
 * ЗАЧЕМ: Host конфигурирует AI клиенты прямой записью файлов (не CLI).
 * КТО ИСПОЛЬЗУЕТ: main process, страница "AI Агенты".
 *
 * ПАТТЕРН: detect (проверить реальные файлы конфигурации) → configure (write files) → show result.
 * detect и configure должны возвращать одинаковый status — это проверяется round-trip тестом.
 * Ненайденный AI клиент — не ошибка, просто информация.
 *
 * КОНТЕНТ: Merged instructions читаются с диска (DuetData/duet-instructions.md),
 * а не запрашиваются по HTTP. Файл генерируется Backend через POST /merge-duet-instructions.
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { readDeployedVersion } from './deploy'
import { readMergedInstructions } from './instructions'
import type { AgentInfo, AgentCheckedFile, AgentIssue } from '../shared/types'

// Re-export IPC types (source of truth: shared/types.ts)
export type { AgentStatus, AgentCheckedFile, AgentIssue, AgentInfo } from '../shared/types'

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

    // 4. Output style (requires merged instructions from DuetData)
    if (!mergedContent) {
      return {
        id: 'claude-code',
        name: 'Claude Code',
        status: 'needs_setup',
        details: 'MCP настроен. Output style не записан: инструкции не сгенерированы'
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

    // 2. Instructions (requires merged content from DuetData)
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
 * - Instructions: ~/.gemini/GEMINI.md (копия merged instructions)
 * - MCP: ~/.gemini/antigravity/mcp_config.json → mcpServers.duet (HTTP MCP)
 */
export const configureAntigravity = (
  mergedContent: string | null,
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
      url: `http://127.0.0.1:${port}/mcp`
    }
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf-8')

    // 2. Instructions (requires merged content from DuetData)
    if (!mergedContent) {
      return {
        id: 'antigravity',
        name: 'Antigravity',
        status: 'needs_setup',
        details: 'MCP настроен. GEMINI.md не записан: инструкции не сгенерированы'
      }
    }

    writeFileSync(instructionsPath, mergedContent, 'utf-8')

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
// DETECT ALL
// =============================================================================

/**
 * Обнаружить все AI клиенты (без конфигурации).
 * Читает merged instructions с диска (DuetData/duet-instructions.md).
 */
export const detectAgents = (duetDataPath: string, port: number): AgentInfo[] => {
  const mergedContent = readMergedInstructions(duetDataPath)
  return [
    detectClaudeCode(mergedContent, duetDataPath, port),
    detectCodex(mergedContent, duetDataPath, port),
    detectAntigravity(mergedContent, duetDataPath, port)
  ]
}

function detectClaudeCode(
  mergedContent: string | null,
  duetDataPath: string,
  port: number
): AgentInfo {
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

  // Check for additionalDirectories issue
  const rawIssues = checkClaudeCodeIssues(settingsPath)
  const issues = rawIssues.length > 0 ? rawIssues : undefined

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
      checkedFiles,
      issues
    }
  }

  if (!contentFresh) {
    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'needs_setup',
      details: 'Инструкции устарели — нажмите «Настроить все»',
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
    details: 'Output style + MCP настроены',
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
    if (config?.additionalDirectories && Array.isArray(config.additionalDirectories)) {
      if (config.additionalDirectories.length > 0) {
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

function detectAntigravity(
  mergedContent: string | null,
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

  // Check content freshness
  let contentFresh = false
  if (hasInstructions && mergedContent) {
    const actual = readFileSync(instructionsPath, 'utf-8')
    contentFresh = actual === mergedContent
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

/** Проверяет наличие mcpServers.duet (HTTP MCP) в Antigravity mcp_config.json */
function geminiHasDuetMcp(mcpConfigPath: string, port: number): boolean {
  if (!existsSync(mcpConfigPath)) return false
  try {
    const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'))
    const mcp = config?.mcpServers?.duet
    if (!mcp) return false
    return mcp.type === 'http' && mcp.url === `http://127.0.0.1:${port}/mcp`
  } catch {
    return false
  }
}

/**
 * Конфигурировать все найденные AI клиенты.
 * Читает merged instructions с диска.
 */
export const configureAllAgents = (duetDataPath: string, port: number): AgentInfo[] => {
  const mergedContent = readMergedInstructions(duetDataPath)
  return [
    configureClaudeCode(mergedContent, duetDataPath, port),
    configureCodex(mergedContent, duetDataPath, port),
    configureAntigravity(mergedContent, duetDataPath, port)
  ]
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
    if (!config.additionalDirectories) return true // Already fixed
    delete config.additionalDirectories
    writeFileSync(settingsPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    return true
  } catch {
    return false
  }
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
