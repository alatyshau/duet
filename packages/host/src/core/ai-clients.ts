/*
 * ЧТО: Обнаружение и конфигурация AI клиентов (Claude Code, Codex).
 * ЗАЧЕМ: Host конфигурирует AI клиенты прямой записью файлов (не CLI).
 * КТО ИСПОЛЬЗУЕТ: main process, страница "AI Агенты".
 *
 * ПАТТЕРН: detect (есть config dir?) → configure (write files) → show result.
 * Ненайденный AI клиент — не ошибка, просто информация.
 *
 * НЕТ Electron imports — тестируемо с plain Node.js.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import type { AgentInfo } from '../shared/types'

// Re-export IPC types (source of truth: shared/types.ts)
export type { AgentStatus, AgentInfo } from '../shared/types'

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
 * - MCP: ~/.claude.json → mcpServers.duet (Node stdio MCP: DuetData/mcp/mcp-server.js)
 */
export const configureClaudeCode = (duetDataPath: string): AgentInfo => {
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
    // 1. Output style
    const stylesDir = join(claudeDir, 'output-styles')
    mkdirSync(stylesDir, { recursive: true })

    const instructionsSource = join(duetDataPath, 'ai-instructions', 'core_instructions.md')
    const styleDest = join(stylesDir, 'duet.md')

    // Cleanup legacy output-style (renamed from ai-kit → duet)
    const legacyStyle = join(stylesDir, 'ai-kit.md')
    if (existsSync(legacyStyle)) unlinkSync(legacyStyle)

    // 2. MCP server config in ~/.claude.json
    configureClaudeJsonMcp(claudeJson, duetDataPath)

    // 3. Output style (requires deployed ai-instructions)
    if (!existsSync(instructionsSource)) {
      return {
        id: 'claude-code',
        name: 'Claude Code',
        status: 'needs_setup',
        details: 'MCP настроен. Output style не записан: ai-instructions не задеплоены'
      }
    }

    const content = readFileSync(instructionsSource, 'utf-8')
    writeFileSync(styleDest, CLAUDE_OUTPUT_STYLE_FRONTMATTER + content, 'utf-8')

    return {
      id: 'claude-code',
      name: 'Claude Code',
      status: 'configured',
      details: 'Output style + MCP настроены'
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
 * Формат: { "mcpServers": { "duet": { "command": "...", "args": [...] } } }
 */
function configureClaudeJsonMcp(claudeJsonPath: string, duetDataPath: string): void {
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

  // MCP server pointing to deployed mcp-server.js
  const mcpServerPath = join(duetDataPath, 'mcp', 'mcp-server.js')
  mcpServers['duet'] = {
    command: 'node',
    args: [mcpServerPath, '--data-dir', duetDataPath]
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
 * - MCP: ~/.codex/config.toml → [mcp_servers.duet] секция
 *   (формат по Codex config-schema.json: https://developers.openai.com/codex/config-schema.json)
 */
export const configureCodex = (duetDataPath: string): AgentInfo => {
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
    const instructionsPath = join(duetDataPath, 'ai-instructions', 'core_instructions_short.md')
    const mcpServerPath = join(duetDataPath, 'mcp', 'mcp-server.js')
    const hasInstructions = existsSync(instructionsPath)

    // Parse existing config or start fresh
    const raw = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : ''
    const config = raw ? parseToml(raw) : ({} as Record<string, unknown>)

    // 1. MCP server: [mcp_servers.duet]
    if (!config.mcp_servers || typeof config.mcp_servers !== 'object') {
      config.mcp_servers = {}
    }
    ;(config.mcp_servers as Record<string, unknown>).duet = {
      command: 'node',
      args: [mcpServerPath, '--data-dir', duetDataPath]
    }

    // Remove legacy [mcp.duet] (was incorrectly used before)
    if (config.mcp && typeof config.mcp === 'object') {
      delete (config.mcp as Record<string, unknown>).duet
      if (Object.keys(config.mcp as object).length === 0) delete config.mcp
    }

    // 2. Instructions (requires deployed ai-instructions)
    if (hasInstructions) {
      config.model_instructions_file = instructionsPath
    }

    writeFileSync(configPath, stringifyToml(config) + '\n', 'utf-8')

    if (!hasInstructions) {
      return {
        id: 'codex',
        name: 'Codex',
        status: 'needs_setup',
        details: 'MCP настроен. Instructions не записаны: ai-instructions не задеплоены'
      }
    }

    return {
      id: 'codex',
      name: 'Codex',
      status: 'configured',
      details: 'Instructions + MCP настроены'
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
 */
export const detectAgents = (): AgentInfo[] => {
  const agents: AgentInfo[] = []

  // Claude Code
  const claudeDir = join(homedir(), '.claude')
  if (existsSync(claudeDir)) {
    agents.push({
      id: 'claude-code',
      name: 'Claude Code',
      status: 'needs_setup',
      details: '~/.claude найдена'
    })
  } else {
    agents.push({
      id: 'claude-code',
      name: 'Claude Code',
      status: 'not_found',
      details: 'Не установлен'
    })
  }

  // Codex
  const codexDir = getCodexDir()
  if (existsSync(codexDir)) {
    agents.push({ id: 'codex', name: 'Codex', status: 'needs_setup', details: '~/.codex найдена' })
  } else {
    agents.push({ id: 'codex', name: 'Codex', status: 'not_found', details: 'Не установлен' })
  }

  return agents
}

/**
 * Конфигурировать все найденные AI клиенты.
 */
export const configureAllAgents = (duetDataPath: string): AgentInfo[] => {
  return [configureClaudeCode(duetDataPath), configureCodex(duetDataPath)]
}

// =============================================================================
// UTILITIES
// =============================================================================

function getCodexDir(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}
