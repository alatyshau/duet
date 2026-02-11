/*
 * Unit тесты для src/core/ai-clients.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, type TestContext } from '../../helpers'

// Mock os.homedir to use test tmp dir
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    homedir: vi.fn()
  }
})

import { homedir } from 'os'
const mockedHomedir = vi.mocked(homedir)

import {
  configureClaudeCode,
  configureCodex,
  detectAgents,
  configureAllAgents
} from '../../../src/core/ai-clients'

// =============================================================================
// HELPERS
// =============================================================================

function setupDuetData(ctx: TestContext) {
  // Create ai-instructions with test content
  const instructionsDir = join(ctx.duetDataDir, 'ai-instructions')
  mkdirSync(instructionsDir, { recursive: true })
  writeFileSync(join(instructionsDir, 'core_instructions.md'), '# Test Instructions')
  writeFileSync(join(instructionsDir, 'core_instructions_short.md'), '# Short Instructions')
  return ctx.duetDataDir
}

// =============================================================================
// TESTS
// =============================================================================

describe('core/ai-clients', () => {
  let ctx: TestContext
  let homeDir: string

  beforeEach(() => {
    ctx = createTestContext()
    homeDir = join(ctx.tmpDir, 'home')
    mkdirSync(homeDir, { recursive: true })
    mockedHomedir.mockReturnValue(homeDir)
    // Reset CODEX_HOME to use default ~/.codex
    delete process.env.CODEX_HOME
  })

  afterEach(() => {
    delete process.env.CODEX_HOME
    ctx.cleanup()
  })

  // ===========================================================================
  // detectAgents
  // ===========================================================================

  describe('detectAgents', () => {
    it('returns not_found when no agents installed', () => {
      const agents = detectAgents()

      expect(agents).toHaveLength(2)
      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'not_found' })
      expect(agents[1]).toMatchObject({ id: 'codex', status: 'not_found' })
    })

    it('returns found when ~/.claude exists', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      const agents = detectAgents()

      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'needs_setup' })
    })

    it('returns found when ~/.codex exists', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      const agents = detectAgents()

      expect(agents[1]).toMatchObject({ id: 'codex', status: 'needs_setup' })
    })

    it('respects CODEX_HOME env variable', () => {
      const customCodexDir = join(ctx.tmpDir, 'custom-codex')
      mkdirSync(customCodexDir, { recursive: true })
      process.env.CODEX_HOME = customCodexDir

      const agents = detectAgents()

      expect(agents[1]).toMatchObject({ id: 'codex', status: 'needs_setup' })
    })
  })

  // ===========================================================================
  // configureClaudeCode
  // ===========================================================================

  describe('configureClaudeCode', () => {
    it('returns not_found when ~/.claude does not exist', () => {
      const result = configureClaudeCode(ctx.duetDataDir)

      expect(result.status).toBe('not_found')
      expect(result.id).toBe('claude-code')
    })

    it('returns found when ai-instructions not deployed', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      const result = configureClaudeCode(ctx.duetDataDir)

      expect(result.status).toBe('needs_setup')
      expect(result.details).toContain('ai-instructions не задеплоены')

      // MCP should still be written
      const claudeJsonPath = join(homeDir, '.claude.json')
      expect(existsSync(claudeJsonPath)).toBe(true)
      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('configures output style and MCP when ~/.claude exists', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const duetDataPath = setupDuetData(ctx)

      const result = configureClaudeCode(duetDataPath)

      expect(result.status).toBe('configured')

      // Output style written with Claude Code frontmatter
      const stylePath = join(homeDir, '.claude', 'output-styles', 'duet.md')
      expect(existsSync(stylePath)).toBe(true)
      const styleContent = readFileSync(stylePath, 'utf-8')
      expect(styleContent).toMatch(/^---\nname: Duet\n/)
      expect(styleContent).toContain('keep-coding-instructions: true')
      expect(styleContent).toContain('# Test Instructions')
    })

    it('removes legacy ai-kit.md output style', () => {
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      const legacyPath = join(homeDir, '.claude', 'output-styles', 'ai-kit.md')
      writeFileSync(legacyPath, 'old content')
      const duetDataPath = setupDuetData(ctx)

      configureClaudeCode(duetDataPath)

      expect(existsSync(legacyPath)).toBe(false)
      expect(existsSync(join(homeDir, '.claude', 'output-styles', 'duet.md'))).toBe(true)
    })

    it('writes MCP config to ~/.claude.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const duetDataPath = setupDuetData(ctx)

      configureClaudeCode(duetDataPath)

      const claudeJsonPath = join(homeDir, '.claude.json')
      expect(existsSync(claudeJsonPath)).toBe(true)

      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      expect(config.mcpServers).toBeDefined()
      expect(config.mcpServers.duet).toBeDefined()
      expect(config.mcpServers.duet.command).toBe('node')
      expect(config.mcpServers.duet.args).toContain('--data-dir')
    })

    it('preserves existing keys in ~/.claude.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const claudeJsonPath = join(homeDir, '.claude.json')
      writeFileSync(claudeJsonPath, JSON.stringify({
        existingKey: 'keep-me',
        mcpServers: { other: { command: 'other-cmd' } }
      }))
      const duetDataPath = setupDuetData(ctx)

      configureClaudeCode(duetDataPath)

      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      expect(config.existingKey).toBe('keep-me')
      expect(config.mcpServers.other).toBeDefined()
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('handles invalid JSON in ~/.claude.json gracefully', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(join(homeDir, '.claude.json'), 'not json {{{')
      const duetDataPath = setupDuetData(ctx)

      const result = configureClaudeCode(duetDataPath)

      expect(result.status).toBe('configured')
      // Should have overwritten with valid JSON
      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf-8'))
      expect(config.mcpServers.duet).toBeDefined()
    })
  })

  // ===========================================================================
  // configureCodex
  // ===========================================================================

  describe('configureCodex', () => {
    it('returns not_found when ~/.codex does not exist', () => {
      const result = configureCodex(ctx.duetDataDir)

      expect(result.status).toBe('not_found')
      expect(result.id).toBe('codex')
    })

    it('returns found when ai-instructions not deployed', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      const result = configureCodex(ctx.duetDataDir)

      expect(result.status).toBe('needs_setup')
      expect(result.details).toContain('ai-instructions не задеплоены')

      // MCP should still be written in config.toml
      const configPath = join(homeDir, '.codex', 'config.toml')
      expect(existsSync(configPath)).toBe(true)
      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).not.toContain('model_instructions_file')
    })

    it('configures config.toml when ~/.codex exists', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })
      const duetDataPath = setupDuetData(ctx)

      const result = configureCodex(duetDataPath)

      expect(result.status).toBe('configured')

      const configPath = join(homeDir, '.codex', 'config.toml')
      expect(existsSync(configPath)).toBe(true)

      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('model_instructions_file')
      expect(content).toContain('core_instructions_short.md')
    })

    it('adds MCP section to config.toml', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })
      const duetDataPath = setupDuetData(ctx)

      configureCodex(duetDataPath)

      const content = readFileSync(join(homeDir, '.codex', 'config.toml'), 'utf-8')
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).toContain('command = "node"')
    })

    it('preserves existing config.toml content', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'), 'model = "o3"\n')
      const duetDataPath = setupDuetData(ctx)

      configureCodex(duetDataPath)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).toContain('model = "o3"')
      expect(content).toContain('model_instructions_file')
      expect(content).toContain('[mcp_servers.duet]')
    })

    it('updates existing model_instructions_file value', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'), 'model_instructions_file = "/old/path"\n')
      const duetDataPath = setupDuetData(ctx)

      configureCodex(duetDataPath)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      // Should not contain old path
      expect(content).not.toContain('/old/path')
      // Should contain new path
      expect(content).toContain('core_instructions_short.md')
    })

    it('updates existing [mcp_servers.duet] section', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'),
        '[mcp_servers.duet]\ncommand = "old-command"\nargs = ["old"]\n'
      )
      const duetDataPath = setupDuetData(ctx)

      configureCodex(duetDataPath)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).not.toContain('old-command')
      expect(content).toContain('command = "node"')
    })

    it('migrates legacy [mcp.duet] to [mcp_servers.duet]', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'),
        'model = "o3"\n\n[mcp.duet]\ncommand = "old-command"\nargs = ["old"]\n'
      )
      const duetDataPath = setupDuetData(ctx)

      configureCodex(duetDataPath)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      // Legacy section removed
      expect(content).not.toContain('[mcp.duet]')
      // Correct section present
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).toContain('command = "node"')
      // Existing keys preserved
      expect(content).toContain('model = "o3"')
    })

    it('handles config starting with a section (no root keys)', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'),
        '[mcp_servers.other]\ncommand = "other-cmd"\n'
      )
      const duetDataPath = setupDuetData(ctx)

      configureCodex(duetDataPath)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      // Both sections present
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).toContain('[mcp_servers.other]')
      expect(content).toContain('command = "other-cmd"')
      // Instructions in root scope
      expect(content).toContain('model_instructions_file')
    })

    it('handles args with square brackets correctly', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'),
        '[mcp_servers.duet]\ncommand = "old"\nargs = ["old-server.js", "--data-dir", "/old/path"]\n\n[mcp_servers.other]\ncommand = "keep-me"\n'
      )
      const duetDataPath = setupDuetData(ctx)

      configureCodex(duetDataPath)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).not.toContain('old-server.js')
      expect(content).toContain('command = "node"')
      // Other section preserved intact
      expect(content).toContain('[mcp_servers.other]')
      expect(content).toContain('command = "keep-me"')
    })

    it('produces valid TOML parseable by smol-toml', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      const duetDataPath = setupDuetData(ctx)

      configureCodex(duetDataPath)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      // Must parse without errors
      const { parse } = require('smol-toml')
      const parsed = parse(content)
      expect(parsed.mcp_servers).toBeDefined()
      expect(parsed.mcp_servers.duet.command).toBe('node')
      expect(parsed.mcp_servers.duet.args).toContain('--data-dir')
      expect(parsed.model_instructions_file).toContain('core_instructions_short.md')
    })

    it('respects CODEX_HOME env variable', () => {
      const customCodexDir = join(ctx.tmpDir, 'custom-codex')
      mkdirSync(customCodexDir, { recursive: true })
      process.env.CODEX_HOME = customCodexDir
      const duetDataPath = setupDuetData(ctx)

      const result = configureCodex(duetDataPath)

      expect(result.status).toBe('configured')
      expect(existsSync(join(customCodexDir, 'config.toml'))).toBe(true)
    })
  })

  // ===========================================================================
  // configureAllAgents
  // ===========================================================================

  describe('configureAllAgents', () => {
    it('returns results for all agents', () => {
      const duetDataPath = setupDuetData(ctx)

      const results = configureAllAgents(duetDataPath)

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('claude-code')
      expect(results[1].id).toBe('codex')
    })

    it('configures all found agents', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      mkdirSync(join(homeDir, '.codex'), { recursive: true })
      const duetDataPath = setupDuetData(ctx)

      const results = configureAllAgents(duetDataPath)

      expect(results[0].status).toBe('configured')
      expect(results[1].status).toBe('configured')
    })
  })
})
