/*
 * Unit тесты для src/core/ai-clients.ts (multi-agent layout).
 *
 * Backend produces per-agent merged files in DuetData (`duet-executor.md`,
 * `duet-vizir.md`). Host configures:
 *   - Claude Code: output-style + 2 custom subagents
 *   - Codex: single instructions file (executor only)
 *   - Antigravity: single GEMINI.md (executor only)
 *
 * Tests create the merged files in DuetData/tmp before exercising configure/detect.
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
  configureAntigravity,
  detectAgents,
  configureAllAgents,
  fixAgentIssue,
  cleanupLegacyClaudeFiles
} from '../../../src/core/ai-clients'
import type { MergedAgents } from '../../../src/core/instructions'

// Test port for MCP URL
const TEST_PORT = 19680
const MCP_URL = `http://127.0.0.1:${TEST_PORT}/mcp`

// Per-agent merged content written to DuetData/duet-{agent}.md.
const EXECUTOR_BODY = '# Executor merged content\nbody-x'
const VIZIR_BODY = '# Vizir merged content\nbody-y'

// =============================================================================
// HELPERS
// =============================================================================

/** Writes both agent merged files to DuetData. */
function writeMergedAgents(
  duetDataDir: string,
  executor: string = EXECUTOR_BODY,
  vizir: string = VIZIR_BODY
): void {
  writeFileSync(join(duetDataDir, 'duet-executor.md'), executor, 'utf-8')
  writeFileSync(join(duetDataDir, 'duet-vizir.md'), vizir, 'utf-8')
}

/**
 * Reconstructs the on-disk frontmatter that ai-clients.ts produces.
 * Mirrors the production helpers — kept in sync via fresh-content tests.
 */
function expectedOutputStyleFrontmatter(): string {
  // Description is wrapped in single quotes in YAML
  return [
    '---',
    'name: duet-executor',
    "description: 'Core Duet workspace agent. Use for all software engineering and content work in Duet projects: orientation via MCP, spec-driven development, project folder discipline, L7 staff-engineer principles.'",
    'keep-coding-instructions: true',
    '---',
    '',
    ''
  ].join('\n')
}

function expectedExecutorAgentFrontmatter(): string {
  return [
    '---',
    'name: duet-executor',
    "description: 'Use when the user explicitly invokes the Executor agent (e.g. via /agents or by name) to perform a focused task in a Duet project. Standard Duet operating mode.'",
    '---',
    '',
    ''
  ].join('\n')
}

function expectedVizirAgentFrontmatter(): string {
  return [
    '---',
    'name: duet-vizir',
    "description: 'Use when the user asks you to act as Vizir, PM (e.g. !менеджер, менеджер, PM, ПМ), or to coordinate work inside a Duet work folder — running the disciplined loop of delegating to agents, monitoring progress, updating plans, and gating archival on human review.'",
    '---',
    '',
    ''
  ].join('\n')
}

const FRESH_MERGED: MergedAgents = { executor: EXECUTOR_BODY, vizir: VIZIR_BODY }
const NULL_MERGED: MergedAgents = { executor: null, vizir: null }

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
    delete process.env.CODEX_HOME
    delete process.env.GEMINI_HOME
  })

  afterEach(() => {
    delete process.env.CODEX_HOME
    delete process.env.GEMINI_HOME
    ctx.cleanup()
  })

  // ===========================================================================
  // detectAgents
  // ===========================================================================

  describe('detectAgents', () => {
    it('returns not_found when no agents installed', () => {
      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents).toHaveLength(3)
      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'not_found' })
      expect(agents[1]).toMatchObject({ id: 'codex', status: 'not_found' })
      expect(agents[2]).toMatchObject({ id: 'antigravity', status: 'not_found' })
    })

    it('returns needs_setup when ~/.claude exists but not configured', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'needs_setup' })
    })

    it('returns needs_setup when ~/.codex exists but not configured', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })
      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[1]).toMatchObject({ id: 'codex', status: 'needs_setup' })
    })

    it('returns needs_setup when ~/.gemini exists but not configured', () => {
      mkdirSync(join(homeDir, '.gemini'), { recursive: true })
      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[2]).toMatchObject({ id: 'antigravity', status: 'needs_setup' })
    })

    it('respects CODEX_HOME env variable', () => {
      const customCodexDir = join(ctx.tmpDir, 'custom-codex')
      mkdirSync(customCodexDir, { recursive: true })
      process.env.CODEX_HOME = customCodexDir

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[1]).toMatchObject({ id: 'codex', status: 'needs_setup' })
    })

    it('respects GEMINI_HOME env variable', () => {
      const customGeminiDir = join(ctx.tmpDir, 'custom-gemini')
      mkdirSync(customGeminiDir, { recursive: true })
      process.env.GEMINI_HOME = customGeminiDir

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[2]).toMatchObject({ id: 'antigravity', status: 'needs_setup' })
    })

    // --- H1: Claude full happy path ---
    it('returns configured for Claude Code when output-style + 2 agents + settings + MCP all match', () => {
      writeMergedAgents(ctx.duetDataDir)

      const stylesDir = join(homeDir, '.claude', 'output-styles')
      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(stylesDir, { recursive: true })
      mkdirSync(agentsDir, { recursive: true })

      writeFileSync(
        join(stylesDir, 'duet-executor.md'),
        expectedOutputStyleFrontmatter() + EXECUTOR_BODY
      )
      writeFileSync(
        join(agentsDir, 'duet-executor.md'),
        expectedExecutorAgentFrontmatter() + EXECUTOR_BODY
      )
      writeFileSync(
        join(agentsDir, 'duet-vizir.md'),
        expectedVizirAgentFrontmatter() + VIZIR_BODY
      )
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'duet-executor' })
      )
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { duet: { type: 'http', url: MCP_URL } } })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'configured' })
      expect(agents[0].checkedFiles).toBeDefined()
      expect(agents[0].checkedFiles!.every((f) => f.ok)).toBe(true)
      // 5 files: output-style, 2 agents, settings, claude.json
      expect(agents[0].checkedFiles).toHaveLength(5)
    })

    // --- H4a: stale executor body (frontmatter ok, body diverged) ---
    it('detects stale executor agent body (frontmatter intact)', () => {
      writeMergedAgents(ctx.duetDataDir, 'NEW EXECUTOR', VIZIR_BODY)

      const stylesDir = join(homeDir, '.claude', 'output-styles')
      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(stylesDir, { recursive: true })
      mkdirSync(agentsDir, { recursive: true })

      // executor agent on disk has a *stale* body but correct frontmatter
      writeFileSync(
        join(stylesDir, 'duet-executor.md'),
        expectedOutputStyleFrontmatter() + 'NEW EXECUTOR'
      )
      writeFileSync(
        join(agentsDir, 'duet-executor.md'),
        expectedExecutorAgentFrontmatter() + 'OLD body'
      )
      writeFileSync(
        join(agentsDir, 'duet-vizir.md'),
        expectedVizirAgentFrontmatter() + VIZIR_BODY
      )
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'duet-executor' })
      )
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { duet: { type: 'http', url: MCP_URL } } })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)

      const claude = agents[0]
      expect(claude.status).toBe('needs_setup')
      const executorAgentFile = claude.checkedFiles!.find((f) =>
        f.path.endsWith(join('agents', 'duet-executor.md'))
      )
      expect(executorAgentFile?.ok).toBe(false)
      expect(claude.details).toContain('устарели')
    })

    // --- H4b: stale frontmatter (body intact) ---
    it('detects stale frontmatter (body intact)', () => {
      writeMergedAgents(ctx.duetDataDir)

      const stylesDir = join(homeDir, '.claude', 'output-styles')
      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(stylesDir, { recursive: true })
      mkdirSync(agentsDir, { recursive: true })

      // Old-style frontmatter (`name: Duet` from pre-migration) but with the
      // current executor body — body matches, frontmatter doesn't.
      writeFileSync(
        join(stylesDir, 'duet-executor.md'),
        '---\nname: Duet\ndescription: old\nkeep-coding-instructions: true\n---\n\n' + EXECUTOR_BODY
      )
      writeFileSync(
        join(agentsDir, 'duet-executor.md'),
        expectedExecutorAgentFrontmatter() + EXECUTOR_BODY
      )
      writeFileSync(
        join(agentsDir, 'duet-vizir.md'),
        expectedVizirAgentFrontmatter() + VIZIR_BODY
      )
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'duet-executor' })
      )
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { duet: { type: 'http', url: MCP_URL } } })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      const claude = agents[0]
      expect(claude.status).toBe('needs_setup')
      const styleFile = claude.checkedFiles!.find((f) =>
        f.path.endsWith(join('output-styles', 'duet-executor.md'))
      )
      expect(styleFile?.ok).toBe(false)
    })

    // --- H3: one of two custom agents missing ---
    it('detects when vizir custom agent is missing', () => {
      writeMergedAgents(ctx.duetDataDir)

      const stylesDir = join(homeDir, '.claude', 'output-styles')
      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(stylesDir, { recursive: true })
      mkdirSync(agentsDir, { recursive: true })

      writeFileSync(
        join(stylesDir, 'duet-executor.md'),
        expectedOutputStyleFrontmatter() + EXECUTOR_BODY
      )
      writeFileSync(
        join(agentsDir, 'duet-executor.md'),
        expectedExecutorAgentFrontmatter() + EXECUTOR_BODY
      )
      // duet-vizir.md NOT created
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'duet-executor' })
      )
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { duet: { type: 'http', url: MCP_URL } } })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      const claude = agents[0]
      expect(claude.status).toBe('needs_setup')
      const vizirFile = claude.checkedFiles!.find((f) =>
        f.path.endsWith(join('agents', 'duet-vizir.md'))
      )
      expect(vizirFile?.ok).toBe(false)
    })

    it('returns needs_setup for Claude Code when only MCP exists', () => {
      writeMergedAgents(ctx.duetDataDir)
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { duet: { type: 'http', url: MCP_URL } } })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[0]).toMatchObject({ id: 'claude-code', status: 'needs_setup' })
      expect(agents[0].details).toContain('MCP настроен')
    })

    it('returns configured for Codex when config.toml has MCP + instructions and content matches', () => {
      writeMergedAgents(ctx.duetDataDir)

      const codexDir = join(homeDir, '.codex')
      const instructionsPath = join(codexDir, 'duet_instructions.md')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(instructionsPath, EXECUTOR_BODY)
      writeFileSync(
        join(codexDir, 'config.toml'),
        stringifyToml({
          model_instructions_file: instructionsPath,
          mcp_servers: { duet: { url: MCP_URL } }
        }) + '\n'
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[1]).toMatchObject({ id: 'codex', status: 'configured' })
    })

    it('returns needs_setup for Codex when only MCP configured', () => {
      writeMergedAgents(ctx.duetDataDir)

      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(
        join(codexDir, 'config.toml'),
        stringifyToml({ mcp_servers: { duet: { url: MCP_URL } } }) + '\n'
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[1]).toMatchObject({ id: 'codex', status: 'needs_setup' })
      expect(agents[1].details).toContain('MCP настроен')
    })

    it('returns configured for Antigravity when GEMINI.md + MCP exist and content matches', () => {
      writeMergedAgents(ctx.duetDataDir)

      const geminiDir = join(homeDir, '.gemini')
      mkdirSync(join(geminiDir, 'antigravity'), { recursive: true })
      writeFileSync(join(geminiDir, 'GEMINI.md'), EXECUTOR_BODY)
      writeFileSync(
        join(geminiDir, 'antigravity', 'mcp_config.json'),
        JSON.stringify({ mcpServers: { duet: { type: 'http', serverURL: MCP_URL } } })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[2]).toMatchObject({ id: 'antigravity', status: 'configured' })
      expect(agents[2].checkedFiles).toBeDefined()
      expect(agents[2].checkedFiles!.every((f) => f.ok)).toBe(true)
    })

    // --- H1 / H7: round-trip detect after configure ---
    it('detect after configure returns configured (round-trip, idempotent)', () => {
      writeMergedAgents(ctx.duetDataDir)

      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      mkdirSync(join(homeDir, '.codex'), { recursive: true })
      mkdirSync(join(homeDir, '.gemini'), { recursive: true })

      // First configure
      const r1 = configureAllAgents(ctx.duetDataDir, TEST_PORT)
      expect(r1[0].status).toBe('configured')
      expect(r1[1].status).toBe('configured')
      expect(r1[2].status).toBe('configured')

      // Second configure (idempotency)
      const r2 = configureAllAgents(ctx.duetDataDir, TEST_PORT)
      expect(r2[0].status).toBe('configured')
      expect(r2[1].status).toBe('configured')
      expect(r2[2].status).toBe('configured')

      // Detect agrees
      const detect = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(detect[0].status).toBe('configured')
      expect(detect[1].status).toBe('configured')
      expect(detect[2].status).toBe('configured')
    })

    // --- H13: detect when merged content is null (merge never ran) ---
    it('claude detect with no merged content returns needs_setup without crashing', () => {
      // No DuetData/duet-*.md files

      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[0].status).toBe('needs_setup')
      // Should not crash
    })
  })

  // ===========================================================================
  // configureClaudeCode
  // ===========================================================================

  describe('configureClaudeCode', () => {
    it('returns not_found when ~/.claude does not exist', () => {
      const result = configureClaudeCode(NULL_MERGED, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('not_found')
      expect(result.id).toBe('claude-code')
    })

    it('returns needs_setup when merged content is null', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      const result = configureClaudeCode(NULL_MERGED, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('needs_setup')
      expect(result.details).toContain('не сгенерированы')

      // MCP should still be written
      const claudeJsonPath = join(homeDir, '.claude.json')
      expect(existsSync(claudeJsonPath)).toBe(true)
      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('returns needs_setup when only one of merged contents is null', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const result = configureClaudeCode(
        { executor: EXECUTOR_BODY, vizir: null },
        ctx.duetDataDir,
        TEST_PORT
      )
      expect(result.status).toBe('needs_setup')
    })

    it('writes output-style + 2 custom agents + settings + MCP when content present', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      const result = configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')

      // Output style with frontmatter and Executor body
      const stylePath = join(homeDir, '.claude', 'output-styles', 'duet-executor.md')
      expect(existsSync(stylePath)).toBe(true)
      const styleContent = readFileSync(stylePath, 'utf-8')
      expect(styleContent).toMatch(/^---\nname: duet-executor\n/)
      expect(styleContent).toContain('keep-coding-instructions: true')
      expect(styleContent).toContain(EXECUTOR_BODY)
      expect(styleContent).not.toContain(VIZIR_BODY)

      // Custom executor agent
      const executorAgentPath = join(homeDir, '.claude', 'agents', 'duet-executor.md')
      expect(existsSync(executorAgentPath)).toBe(true)
      const executorAgentContent = readFileSync(executorAgentPath, 'utf-8')
      expect(executorAgentContent).toMatch(/^---\nname: duet-executor\n/)
      expect(executorAgentContent).not.toContain('keep-coding-instructions')
      expect(executorAgentContent).toContain(EXECUTOR_BODY)

      // Custom vizir agent
      const vizirAgentPath = join(homeDir, '.claude', 'agents', 'duet-vizir.md')
      expect(existsSync(vizirAgentPath)).toBe(true)
      const vizirAgentContent = readFileSync(vizirAgentPath, 'utf-8')
      expect(vizirAgentContent).toMatch(/^---\nname: duet-vizir\n/)
      expect(vizirAgentContent).toContain(VIZIR_BODY)
      expect(vizirAgentContent).not.toContain(EXECUTOR_BODY)
    })

    // --- H6: outputStyle migrates from "Duet" to "duet-executor" ---
    it('migrates outputStyle from old "Duet" to "duet-executor"', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'Duet', permissions: { allow: ['Edit'] } })
      )

      configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      const config = JSON.parse(readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf-8'))
      expect(config.outputStyle).toBe('duet-executor')
      // Other keys preserved
      expect(config.permissions).toEqual({ allow: ['Edit'] })
    })

    it('writes outputStyle "duet-executor" to ~/.claude/settings.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      const settingsPath = join(homeDir, '.claude', 'settings.json')
      expect(existsSync(settingsPath)).toBe(true)
      const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(config.outputStyle).toBe('duet-executor')
    })

    it('preserves existing keys in ~/.claude/settings.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Edit'] } })
      )

      configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      const config = JSON.parse(readFileSync(join(homeDir, '.claude', 'settings.json'), 'utf-8'))
      expect(config.outputStyle).toBe('duet-executor')
      expect(config.permissions).toEqual({ allow: ['Edit'] })
    })

    it('writes HTTP MCP config to ~/.claude.json', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })

      configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

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

      configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
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

      configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      const config = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'))
      expect(config.existingKey).toBe('keep-me')
      expect(config.mcpServers.other).toBeDefined()
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('handles invalid JSON in ~/.claude.json gracefully', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(join(homeDir, '.claude.json'), 'not json {{{')

      const result = configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')
      const config = JSON.parse(readFileSync(join(homeDir, '.claude.json'), 'utf-8'))
      expect(config.mcpServers.duet).toBeDefined()
    })

    // --- Migration: configure auto-clears legacy artifacts after writing new files ---
    it('removes legacy duet.md files automatically after successful configure', () => {
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })

      const legacyStyle = join(homeDir, '.claude', 'output-styles', 'duet.md')
      const legacyAgent = join(homeDir, '.claude', 'agents', 'duet.md')
      const legacyMerged = join(ctx.duetDataDir, 'duet-instructions.md')

      writeFileSync(legacyStyle, '# legacy single output-style')
      writeFileSync(legacyAgent, '# legacy single subagent')
      writeFileSync(legacyMerged, '# legacy merged file')

      const result = configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)
      expect(result.status).toBe('configured')

      // Legacy gone
      expect(existsSync(legacyStyle)).toBe(false)
      expect(existsSync(legacyAgent)).toBe(false)
      expect(existsSync(legacyMerged)).toBe(false)
      // New present
      expect(existsSync(join(homeDir, '.claude', 'output-styles', 'duet-executor.md'))).toBe(true)
      expect(existsSync(join(homeDir, '.claude', 'agents', 'duet-executor.md'))).toBe(true)
      expect(existsSync(join(homeDir, '.claude', 'agents', 'duet-vizir.md'))).toBe(true)
    })

    // --- Migration: legacy uborka does NOT run when configure fails (no merged content) ---
    it('does NOT remove legacy files if merged content is null (configure not configured)', () => {
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })

      const legacyStyle = join(homeDir, '.claude', 'output-styles', 'duet.md')
      writeFileSync(legacyStyle, '# legacy')

      const result = configureClaudeCode(NULL_MERGED, ctx.duetDataDir, TEST_PORT)
      expect(result.status).toBe('needs_setup')
      // Legacy preserved — uborka must not run on partial migration
      expect(existsSync(legacyStyle)).toBe(true)
    })

    // --- Migration: does NOT touch user's personal vizir.md during configure ---
    it('preserves user-personal ~/.claude/agents/vizir.md during configure', () => {
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })
      const userVizir = join(homeDir, '.claude', 'agents', 'vizir.md')
      writeFileSync(userVizir, '# user content — keep me')

      configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      expect(existsSync(userVizir)).toBe(true)
      expect(readFileSync(userVizir, 'utf-8')).toBe('# user content — keep me')
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

    it('returns needs_setup when executor content is null', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      const result = configureCodex(null, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('needs_setup')
      expect(result.details).toContain('не сгенерированы')

      const configPath = join(homeDir, '.codex', 'config.toml')
      expect(existsSync(configPath)).toBe(true)
      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).not.toContain('model_instructions_file')
    })

    it('configures config.toml and writes instructions when ~/.codex exists', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      const result = configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')

      const configPath = join(homeDir, '.codex', 'config.toml')
      expect(existsSync(configPath)).toBe(true)

      const content = readFileSync(configPath, 'utf-8')
      expect(content).toContain('model_instructions_file')
      expect(content).toContain('duet_instructions.md')

      const instructionsPath = join(homeDir, '.codex', 'duet_instructions.md')
      expect(existsSync(instructionsPath)).toBe(true)
      expect(readFileSync(instructionsPath, 'utf-8')).toBe(EXECUTOR_BODY)
    })

    it('adds HTTP MCP section to config.toml', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(homeDir, '.codex', 'config.toml'), 'utf-8')
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).toContain(`url = "${MCP_URL}"`)
    })

    it('preserves existing config.toml content', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'), 'model = "o3"\n')

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).toContain('model = "o3"')
      expect(content).toContain('model_instructions_file')
      expect(content).toContain('[mcp_servers.duet]')
    })

    it('updates existing model_instructions_file value', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'), 'model_instructions_file = "/old/path"\n')

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).not.toContain('/old/path')
      expect(content).toContain('duet_instructions.md')
    })

    it('updates existing [mcp_servers.duet] section', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(
        join(codexDir, 'config.toml'),
        '[mcp_servers.duet]\ncommand = "old-command"\nargs = ["old"]\n'
      )

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

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

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).not.toContain('[mcp.duet]')
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).toContain(`url = "${MCP_URL}"`)
      expect(content).toContain('model = "o3"')
    })

    it('handles config starting with a section (no root keys)', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(join(codexDir, 'config.toml'), '[mcp_servers.other]\ncommand = "other-cmd"\n')

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).toContain('[mcp_servers.duet]')
      expect(content).toContain('[mcp_servers.other]')
      expect(content).toContain('command = "other-cmd"')
      expect(content).toContain('model_instructions_file')
    })

    it('handles args with square brackets correctly', () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })
      writeFileSync(
        join(codexDir, 'config.toml'),
        '[mcp_servers.duet]\ncommand = "old"\nargs = ["old-server.js", "--data-dir", "/old/path"]\n\n[mcp_servers.other]\ncommand = "keep-me"\n'
      )

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      expect(content).not.toContain('old-server.js')
      expect(content).toContain(`url = "${MCP_URL}"`)
      expect(content).toContain('[mcp_servers.other]')
      expect(content).toContain('command = "keep-me"')
    })

    it('produces valid TOML parseable by smol-toml', async () => {
      const codexDir = join(homeDir, '.codex')
      mkdirSync(codexDir, { recursive: true })

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8')
      const { parse } = await import('smol-toml')
      const parsed = parse(content)
      expect(parsed.mcp_servers).toBeDefined()
      expect((parsed.mcp_servers as Record<string, Record<string, string>>).duet.url).toBe(MCP_URL)
      expect(parsed.model_instructions_file).toContain('duet_instructions.md')
    })

    it('respects CODEX_HOME env variable', () => {
      const customCodexDir = join(ctx.tmpDir, 'custom-codex')
      mkdirSync(customCodexDir, { recursive: true })
      process.env.CODEX_HOME = customCodexDir

      const result = configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')
      expect(existsSync(join(customCodexDir, 'config.toml'))).toBe(true)
    })

    // --- H8: no codex/agents/ directory created ---
    it('does NOT write any custom agent files in ~/.codex/agents/', () => {
      mkdirSync(join(homeDir, '.codex'), { recursive: true })

      configureCodex(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const codexAgentsDir = join(homeDir, '.codex', 'agents')
      expect(existsSync(codexAgentsDir)).toBe(false)
    })
  })

  // ===========================================================================
  // configureAntigravity
  // ===========================================================================

  describe('configureAntigravity', () => {
    it('returns not_found when ~/.gemini does not exist', () => {
      const result = configureAntigravity(null, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('not_found')
      expect(result.id).toBe('antigravity')
    })

    it('returns needs_setup when executor content is null', () => {
      mkdirSync(join(homeDir, '.gemini'), { recursive: true })

      const result = configureAntigravity(null, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('needs_setup')
      expect(result.details).toContain('не сгенерированы')

      const mcpPath = join(homeDir, '.gemini', 'antigravity', 'mcp_config.json')
      expect(existsSync(mcpPath)).toBe(true)
      const config = JSON.parse(readFileSync(mcpPath, 'utf-8'))
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('configures GEMINI.md and MCP when ~/.gemini exists', () => {
      mkdirSync(join(homeDir, '.gemini'), { recursive: true })

      const result = configureAntigravity(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')

      const instructionsPath = join(homeDir, '.gemini', 'GEMINI.md')
      expect(existsSync(instructionsPath)).toBe(true)
      expect(readFileSync(instructionsPath, 'utf-8')).toBe(EXECUTOR_BODY)

      const mcpPath = join(homeDir, '.gemini', 'antigravity', 'mcp_config.json')
      expect(existsSync(mcpPath)).toBe(true)
      const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'))
      expect(mcpConfig.mcpServers.duet.type).toBe('http')
      expect(mcpConfig.mcpServers.duet.serverURL).toBe(MCP_URL)
    })

    it('preserves existing keys in mcp_config.json', () => {
      const geminiDir = join(homeDir, '.gemini')
      mkdirSync(join(geminiDir, 'antigravity'), { recursive: true })
      writeFileSync(
        join(geminiDir, 'antigravity', 'mcp_config.json'),
        JSON.stringify({
          existingKey: 'keep',
          mcpServers: { other: { command: 'other' } }
        })
      )

      configureAntigravity(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const config = JSON.parse(
        readFileSync(join(geminiDir, 'antigravity', 'mcp_config.json'), 'utf-8')
      )
      expect(config.existingKey).toBe('keep')
      expect(config.mcpServers.other).toBeDefined()
      expect(config.mcpServers.duet).toBeDefined()
    })

    it('respects GEMINI_HOME env variable', () => {
      const customGeminiDir = join(ctx.tmpDir, 'custom-gemini')
      mkdirSync(customGeminiDir, { recursive: true })
      process.env.GEMINI_HOME = customGeminiDir

      const result = configureAntigravity(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')
      expect(existsSync(join(customGeminiDir, 'GEMINI.md'))).toBe(true)
    })

    // --- H9: no gemini/agents/ directory created ---
    it('does NOT write any custom agent files in ~/.gemini/', () => {
      mkdirSync(join(homeDir, '.gemini'), { recursive: true })

      configureAntigravity(EXECUTOR_BODY, ctx.duetDataDir, TEST_PORT)

      const geminiAgentsDir = join(homeDir, '.gemini', 'agents')
      expect(existsSync(geminiAgentsDir)).toBe(false)
    })
  })

  // ===========================================================================
  // additionalDirectories check
  // ===========================================================================

  describe('additionalDirectories detection', () => {
    it('detects additionalDirectories in Claude Code settings', () => {
      writeMergedAgents(ctx.duetDataDir)

      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({
          outputStyle: 'duet-executor',
          additionalDirectories: ['/tmp', '/some/path']
        })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[0].issues).toBeDefined()
      expect(agents[0].issues).toHaveLength(1)
      expect(agents[0].issues![0].reason_code).toBe('additional_directories')
      expect(agents[0].issues![0].fixable).toBe(true)
      expect(agents[0].status).toBe('needs_setup')
    })

    it('no issue when additionalDirectories is absent', () => {
      writeMergedAgents(ctx.duetDataDir)

      const stylesDir = join(homeDir, '.claude', 'output-styles')
      const agentsDir = join(homeDir, '.claude', 'agents')
      mkdirSync(stylesDir, { recursive: true })
      mkdirSync(agentsDir, { recursive: true })

      writeFileSync(
        join(stylesDir, 'duet-executor.md'),
        expectedOutputStyleFrontmatter() + EXECUTOR_BODY
      )
      writeFileSync(
        join(agentsDir, 'duet-executor.md'),
        expectedExecutorAgentFrontmatter() + EXECUTOR_BODY
      )
      writeFileSync(
        join(agentsDir, 'duet-vizir.md'),
        expectedVizirAgentFrontmatter() + VIZIR_BODY
      )
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'duet-executor' })
      )
      writeFileSync(
        join(homeDir, '.claude.json'),
        JSON.stringify({ mcpServers: { duet: { type: 'http', url: MCP_URL } } })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)

      expect(agents[0].status).toBe('configured')
      expect(agents[0].issues).toBeUndefined()
    })

    it('no issue when additionalDirectories is empty array', () => {
      writeMergedAgents(ctx.duetDataDir)

      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'duet-executor', additionalDirectories: [] })
      )

      const agents = detectAgents(ctx.duetDataDir, TEST_PORT)
      expect(agents[0].issues).toBeUndefined()
    })
  })

  // ===========================================================================
  // fixAgentIssue
  // ===========================================================================

  describe('fixAgentIssue', () => {
    it('removes additionalDirectories from Claude Code settings', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      const settingsPath = join(homeDir, '.claude', 'settings.json')
      writeFileSync(
        settingsPath,
        JSON.stringify({
          outputStyle: 'duet-executor',
          additionalDirectories: ['/tmp'],
          permissions: { allow: ['Edit'] }
        })
      )

      const result = fixAgentIssue('claude-code', 'additional_directories')

      expect(result).toBe(true)

      const config = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(config.additionalDirectories).toBeUndefined()
      expect(config.outputStyle).toBe('duet-executor')
      expect(config.permissions).toEqual({ allow: ['Edit'] })
    })

    it('returns true when additionalDirectories already absent', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      writeFileSync(
        join(homeDir, '.claude', 'settings.json'),
        JSON.stringify({ outputStyle: 'duet-executor' })
      )

      const result = fixAgentIssue('claude-code', 'additional_directories')
      expect(result).toBe(true)
    })

    it('returns false for unknown agent/reason combination', () => {
      const result = fixAgentIssue('unknown', 'unknown_code')
      expect(result).toBe(false)
    })
  })

  // ===========================================================================
  // configureAllAgents
  // ===========================================================================

  describe('configureAllAgents', () => {
    it('returns results for all agents', () => {
      const results = configureAllAgents(ctx.duetDataDir, TEST_PORT)

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe('claude-code')
      expect(results[1].id).toBe('codex')
      expect(results[2].id).toBe('antigravity')
    })

    it('configures all found agents using merged content from disk', () => {
      writeMergedAgents(ctx.duetDataDir)

      mkdirSync(join(homeDir, '.claude'), { recursive: true })
      mkdirSync(join(homeDir, '.codex'), { recursive: true })
      mkdirSync(join(homeDir, '.gemini'), { recursive: true })

      const results = configureAllAgents(ctx.duetDataDir, TEST_PORT)

      expect(results[0].status).toBe('configured')
      expect(results[1].status).toBe('configured')
      expect(results[2].status).toBe('configured')
    })
  })

  // ===========================================================================
  // cleanupLegacyClaudeFiles
  // ===========================================================================

  describe('cleanupLegacyClaudeFiles', () => {
    // --- H10: removes all 3 legacy files when present ---
    it('removes legacy output-style + agent + DuetData merged file', () => {
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })

      const legacyStyle = join(homeDir, '.claude', 'output-styles', 'duet.md')
      const legacyAgent = join(homeDir, '.claude', 'agents', 'duet.md')
      const legacyMerged = join(ctx.duetDataDir, 'duet-instructions.md')

      writeFileSync(legacyStyle, '# old')
      writeFileSync(legacyAgent, '# old')
      writeFileSync(legacyMerged, '# old')

      const result = cleanupLegacyClaudeFiles(ctx.duetDataDir)

      expect(result.removed).toContain(legacyStyle)
      expect(result.removed).toContain(legacyAgent)
      expect(result.removed).toContain(legacyMerged)
      expect(result.failed).toEqual([])
      expect(existsSync(legacyStyle)).toBe(false)
      expect(existsSync(legacyAgent)).toBe(false)
      expect(existsSync(legacyMerged)).toBe(false)
    })

    // --- H11: idempotent ---
    it('is idempotent — second call is a no-op', () => {
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      const legacyStyle = join(homeDir, '.claude', 'output-styles', 'duet.md')
      writeFileSync(legacyStyle, '# old')

      const r1 = cleanupLegacyClaudeFiles(ctx.duetDataDir)
      expect(r1.removed).toContain(legacyStyle)
      expect(r1.failed).toEqual([])

      const r2 = cleanupLegacyClaudeFiles(ctx.duetDataDir)
      expect(r2.removed).toEqual([])
      expect(r2.failed).toEqual([])
    })

    // --- H12: does NOT touch user's personal vizir.md ---
    it('does NOT delete user personal ~/.claude/agents/vizir.md', () => {
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })
      const userVizir = join(homeDir, '.claude', 'agents', 'vizir.md')
      const legacyDuet = join(homeDir, '.claude', 'agents', 'duet.md')

      writeFileSync(userVizir, '# user content')
      writeFileSync(legacyDuet, '# legacy content')

      cleanupLegacyClaudeFiles(ctx.duetDataDir)

      expect(existsSync(userVizir)).toBe(true)
      expect(readFileSync(userVizir, 'utf-8')).toBe('# user content')
      expect(existsSync(legacyDuet)).toBe(false)
    })

    it('also leaves new duet-vizir.md and duet-executor.md alone', () => {
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })
      const newExecutor = join(homeDir, '.claude', 'agents', 'duet-executor.md')
      const newVizir = join(homeDir, '.claude', 'agents', 'duet-vizir.md')
      writeFileSync(newExecutor, '# new')
      writeFileSync(newVizir, '# new')

      cleanupLegacyClaudeFiles(ctx.duetDataDir)

      expect(existsSync(newExecutor)).toBe(true)
      expect(existsSync(newVizir)).toBe(true)
    })

    it('does not touch DuetData/duet-executor.md or duet-vizir.md', () => {
      writeMergedAgents(ctx.duetDataDir)

      cleanupLegacyClaudeFiles(ctx.duetDataDir)

      expect(existsSync(join(ctx.duetDataDir, 'duet-executor.md'))).toBe(true)
      expect(existsSync(join(ctx.duetDataDir, 'duet-vizir.md'))).toBe(true)
    })

    // --- Failure surfaces in `failed`, does not throw, does not block other deletes ---
    it('reports failure when filesystem refuses unlink, continues other targets', () => {
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })

      const legacyStyle = join(homeDir, '.claude', 'output-styles', 'duet.md')
      const legacyAgent = join(homeDir, '.claude', 'agents', 'duet.md')
      const legacyMerged = join(ctx.duetDataDir, 'duet-instructions.md')

      writeFileSync(legacyStyle, '# old')
      writeFileSync(legacyMerged, '# old')
      // Make legacyAgent a *directory* (existsSync(path) is true, but unlinkSync
      // throws EISDIR/EPERM — natural failure, no mocking needed).
      mkdirSync(legacyAgent, { recursive: true })

      const result = cleanupLegacyClaudeFiles(ctx.duetDataDir)

      expect(result.removed).toContain(legacyStyle)
      expect(result.removed).toContain(legacyMerged)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].path).toBe(legacyAgent)
      expect(result.failed[0].error.length).toBeGreaterThan(0)

      // Other deletes succeeded; the unmovable target stays
      expect(existsSync(legacyStyle)).toBe(false)
      expect(existsSync(legacyMerged)).toBe(false)
      expect(existsSync(legacyAgent)).toBe(true)
    })

    // --- configureClaudeCode propagates cleanup failures into `details` ---
    it('configureClaudeCode includes legacy-cleanup failures in agent details', () => {
      mkdirSync(join(homeDir, '.claude', 'output-styles'), { recursive: true })
      mkdirSync(join(homeDir, '.claude', 'agents'), { recursive: true })

      const legacyAgent = join(homeDir, '.claude', 'agents', 'duet.md')
      // Directory at the legacy path triggers a real unlink failure
      mkdirSync(legacyAgent, { recursive: true })

      const result = configureClaudeCode(FRESH_MERGED, ctx.duetDataDir, TEST_PORT)

      expect(result.status).toBe('configured')
      expect(result.details).toContain('Не удалось удалить legacy')
      expect(result.details).toContain(legacyAgent)
    })
  })
})
