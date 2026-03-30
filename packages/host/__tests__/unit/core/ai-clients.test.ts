/*
 * Unit тесты для src/core/ai-clients.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { stringify as stringifyToml } from 'smol-toml'
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

// Test port for MCP URL
const TEST_PORT = 19680
const MCP_URL = `http://127.0.0.1:${TEST_PORT}/mcp`

// Merged bootstrapper content returned by mocked fetch
const TEST_INSTRUCTIONS = '# Test Instructions'

// Mock fetch for bootstrapper endpoint (GET /bootstrapper)
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ content: TEST_INSTRUCTIONS })
})
vi.stubGlobal('fetch', mockFetch)

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
    it('returns not_found when no agents installed', async () => {
      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents).toHaveLength(2)
      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'not_found' })
      expect(agents[1]).toMatchObject({ id: 'codex', status: 'not_found' })
    })

    it('returns needs_setup when ~/.claude exists but not configured', async () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'needs_setup' })
    })

    it('returns needs_setup when ~/.codex exists but not configured', async () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[1]).toMatchObject({ id: 'codex', status: 'needs_setup' })
    })

    it('respects CODEX_HOME env variable', async () => {
      const customCodexDir = join(ctx.tmpDir, 'custom-codex')
      mkdirSync(customCodexDir, { recursive: true })
      process.env.CODEX_HOME = customCodexDir

      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[1]).toMatchObject({ id: 'codex', status: 'needs_setup' })
    })

    it('returns configured for Claude Code when output-style + settings + MCP exist and content matches', async () => {
      // Write output-style with correct content (frontmatter + merged content from mock)
      const frontmatter =
        '---\nname: Duet\ndescription: Core instructions for AI agents working in Duet ecosystem\nkeep-coding-instructions: true\n---\n\n'
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude', 'output-styles', 'duet.md'),
        frontmatter + TEST_INSTRUCTIONS
      )
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'Duet' })
      )
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            duet: { type: 'http', url: MCP_URL }
          }
        })
      )

      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'configured' })
      expect(agents[0].checkedFiles).toBeDefined()
      expect(agents[0].checkedFiles!.every((f) => f.ok)).toBe(true)
    })

    it('returns needs_setup for Claude Code when output-style content is stale', async () => {
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      writeFileSync(join(homeDir, '.claude', 'output-styles', 'duet.md'), '# Old content')
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'Duet' })
      )
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            duet: { type: 'http', url: MCP_URL }
          }
        })
      )

      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'needs_setup' })
      expect(agents[0].details).toContain('устарели')
    })

    it('returns needs_setup for Claude Code when only MCP exists', async () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            duet: { type: 'http', url: MCP_URL }
          }
        })
      )

      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'needs_setup' })
      expect(agents[0].details).toContain('MCP настроен')
    })

    it('returns configured for Codex when config.toml has MCP + instructions and content matches', async () => {
      const codexDir = join(homeDir, '.codex')
      const instructionsPath = join(codexDir, 'duet_instructions.md')
      mkdirSync(codexDir, { recursive: true })
      // Write instructions file with matching content
      writeFileSync(instructionsPath, TEST_INSTRUCTIONS)
      writeFileSync(
        join(codexDir, 'config.toml'),
        stringifyToml({
          model_instructions_file: instructionsPath,
          mcp_servers: {
            duet: { url: MCP_URL }
          }
        }) + '\n'
      )

      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[1]).toMatchObject({ id: 'codex', status: 'configured' })
    })

    it('returns needs_setup for Codex when only MCP configured', async () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(
        join(codexDir, 'config.toml'),
        stringifyToml({
          mcp_servers: {
            duet: { url: MCP_URL }
          }
        }) + '\n'
      )

      const agents = await detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[1]).toMatchObject({ id: 'codex', status: 'needs_setup' })
      expect(agents[1].details).toContain('MCP настроен')
    })

    it('detect after configure returns configured (round-trip)', async () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      // Configure
      const configResult = await configureAllAgents(ctx.duetDataDir, TEST_PORT)
      expect(configResult[0].status).toBe('configured')
      expect(configResult[1].status).toBe('configured')

      // Detect should also return configured
      const detectResult = await detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(detectResult[0]).toMatchObject({ id: 'claude-code', status: 'configured' })
      expect(detectResult[1]).toMatchObject({ id: 'codex', status: 'configured' })
    })
  })

  // ===========================================================================
  // configureClaudeCode
  // ===========================================================================

  describe('configureClaudeCode', () => {
    it('returns not_found when ~/.claude does not exist', () => {
      const result = configureClaudeCode(null, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('not_found')
      expect(result.id).toBe('claude-code')
    })

    it('returns needs_setup when mergedContent is null', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      const result = configureClaudeCode(null, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('needs_setup')
      expect(result.details).toContain('backend недоступен')

      // MCP should still be written
      const claudeJsonPath = join(homeDir, '.claude.json')
      expect(existsSync(claudeJsonPath)).toBe(true)
      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('configures output style and MCP when ~/.claude exists', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      const result = configureClaudeCode(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')

      // Output style written with Claude Code frontmatter
      const stylePath = join(homeDir, '.claude', 'output-styles', 'duet.md')
      expect(existsSync(stylePath)).toBe(true)
      const styleContent = readFileSync(stylePath, 'utf-8')
      expect(styleContent).toMatch(/^---\nname: Duet\n/)
      expect(styleContent).toContain('keep-coding-instructions: true')
      expect(styleContent).toContain('# Test Instructions')
    })

    it('writes outputStyle to ~/.claude/settings.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      configureClaudeCode(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const settingsPath = join(homeDir, '.claude', 'settings.json')
      expect(existsSync(settingsPath)).toBe(true)
      const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(config.outputStyle).toBe('Duet')
    })

    it('preserves existing keys in ~/.claude/settings.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Edit'] } })
      )

      configureClaudeCode(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const config = JSON.parse(readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf-8'))
      expect(config.outputStyle).toBe('Duet')
      expect(config.permissions).toEqual({ allow: ['Edit'] })
    })

    it('writes HTTP MCP config to ~/.claude.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      configureClaudeCode(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const claudeJsonPath = join(homeDir, '.claude.json')
      expect(existsSync(claudeJsonPath)).toBe(true)

      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      expect(config.mcpServers).toBeDefined()
      expect(config.mcpServers.duet).toBeDefined()
      expect(config.mcpServers.duet.type).toBe('http')
      expect(config.mcpServers.duet.url).toBe(MCP_URL)
    })

    it('preserves existing MCP entries when adding duet', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const claudeJsonPath = join(homeDir, '.claude.json')
      writeFileSync(
        claudeJsonPath,
        JSON.stringify({
          mcpServers: { 'ai-kit': { command: 'python', args: ['server.py'] } }
        })
      )

      configureClaudeCode(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      // Legacy entries are preserved (user may remove manually)
      expect(config.mcpServers['ai-kit']).toBeDefined()
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('preserves existing keys in ~/.claude.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const claudeJsonPath = join(homeDir, '.claude.json')
      writeFileSync(
        claudeJsonPath,
        JSON.stringify({
          existingKey: 'keep-me',
          mcpServers: { other: { command: 'other-cmd' } }
        })
      )

      configureClaudeCode(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      expect(config.existingKey).toBe('keep-me')
      expect(config.mcpServers.other).toBeDefined()
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('handles invalid JSON in ~/.claude.json gracefully', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(join(homeDir, '.claude.json'), 'not json {{{')

      const result = configureClaudeCode(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

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
      const result = configureCodex(null, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('not_found')
      expect(result.id).toBe('codex')
    })

    it('returns needs_setup when mergedContent is null', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      const result = configureCodex(null, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('needs_setup')
      expect(result.details).toContain('backend недоступен')

      // MCP should still be written in config.toml
      const configPath = join(homeDir, '.codex', 'config.toml')
      expect(existsSync(configPath)).toBe(true)
      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).not.toContain('model_instructions_file')
    })

    it('configures config.toml and writes instructions when ~/.codex exists', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      const result = configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')

      const configPath = join(homeDir, '.codex', 'config.toml')
      expect(existsSync(configPath)).toBe(true)

      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('model_instructions_file')
      expect(content).toContain('duet_instructions.md')

      // Instructions file written
      const instructionsPath = join(homeDir, '.codex', 'duet_instructions.md')
      expect(existsSync(instructionsPath)).toBe(true)
      expect(readFileSync(instructionsPath, 'utf-8')).toBe(TEST_INSTRUCTIONS)
    })

    it('adds HTTP MCP section to config.toml', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(homeDir, '.codex', 'config.toml'), 'utf-8')
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).toContain(`url = "${MCP_URL}"`)
    })

    it('preserves existing config.toml content', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'), 'model = "o3"\n')

      configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).toContain('model = "o3"')
      expect(content).toContain('model_instructions_file')
      expect(content).toContain('[mcp_servers.duet]')
    })

    it('updates existing model_instructions_file value', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'), 'model_instructions_file = "/old/path"\n')

      configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      // Should not contain old path
      expect(content).not.toContain('/old/path')
      // Should contain new path
      expect(content).toContain('duet_instructions.md')
    })

    it('updates existing [mcp_servers.duet] section', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(
        join(codexDir, 'config.toml'),
        '[mcp_servers.duet]\ncommand = "old-command"\nargs = ["old"]\n'
      )

      configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).not.toContain('old-command')
      expect(content).toContain(`url = "${MCP_URL}"`)
    })

    it('migrates legacy [mcp.duet] to [mcp_servers.duet]', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(
        join(codexDir, 'config.toml'),
        'model = "o3"\n\n[mcp.duet]\ncommand = "old-command"\nargs = ["old"]\n'
      )

      configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      // Legacy section removed
      expect(content).not.toContain('[mcp.duet]')
      // Correct section present
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).toContain(`url = "${MCP_URL}"`)
      // Existing keys preserved
      expect(content).toContain('model = "o3"')
    })

    it('handles config starting with a section (no root keys)', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'), '[mcp_servers.other]\ncommand = "other-cmd"\n')

      configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

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
      writeFileSync(
        join(codexDir, 'config.toml'),
        '[mcp_servers.duet]\ncommand = "old"\nargs = ["old-server.js", "--data-dir", "/old/path"]\n\n[mcp_servers.other]\ncommand = "keep-me"\n'
      )

      configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).not.toContain('old-server.js')
      expect(content).toContain(`url = "${MCP_URL}"`)
      // Other section preserved intact
      expect(content).toContain('[mcp_servers.other]')
      expect(content).toContain('command = "keep-me"')
    })

    it('produces valid TOML parseable by smol-toml', async () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })

      configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      // Must parse without errors
      const { parse } = await import('smol-toml')
      const parsed = parse(content)
      expect(parsed.mcp_servers).toBeDefined()
      expect(parsed.mcp_servers.duet.url).toBe(MCP_URL)
      expect(parsed.model_instructions_file).toContain('duet_instructions.md')
    })

    it('respects CODEX_HOME env variable', () => {
      const customCodexDir = join(ctx.tmpDir, 'custom-codex')
      mkdirSync(customCodexDir, { recursive: true })
      process.env.CODEX_HOME = customCodexDir

      const result = configureCodex(TEST_INSTRUCTIONS, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')
      expect(existsSync(join(customCodexDir, 'config.toml'))).toBe(true)
    })
  })

  // ===========================================================================
  // configureAllAgents
  // ===========================================================================

  describe('configureAllAgents', () => {
    it('returns results for all agents', async () => {
      const results = await configureAllAgents(ctx.duetDataDir, TEST_PORT)

      expect(results).toHaveLength(2)
      expect(results[0].id).toBe('claude-code')
      expect(results[1].id).toBe('codex')
    })

    it('configures all found agents', async () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      const results = await configureAllAgents(ctx.duetDataDir, TEST_PORT)

      expect(results[0].status).toBe('configured')
      expect(results[1].status).toBe('configured')
    })
  })
})
