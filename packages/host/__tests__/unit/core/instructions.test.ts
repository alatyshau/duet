/*
 * Unit тесты для src/core/instructions.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, type TestContext } from '../../helpers'

import { readMergedAgent, readMergedAgents, readCachedErrors } from '../../../src/core/instructions'

describe('core/instructions', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ===========================================================================
  // readMergedAgent / readMergedAgents
  // ===========================================================================

  describe('readMergedAgent', () => {
    it('returns null when an agent merged file does not exist', () => {
      expect(readMergedAgent(ctx.duetDataDir, 'executor')).toBeNull()
      expect(readMergedAgent(ctx.duetDataDir, 'vizir')).toBeNull()
    })

    it('returns content when the agent merged file exists', () => {
      writeFileSync(join(ctx.duetDataDir, 'duet-executor.md'), '# Exec\n', 'utf-8')
      writeFileSync(join(ctx.duetDataDir, 'duet-vizir.md'), '# Vizir\n', 'utf-8')

      expect(readMergedAgent(ctx.duetDataDir, 'executor')).toBe('# Exec\n')
      expect(readMergedAgent(ctx.duetDataDir, 'vizir')).toBe('# Vizir\n')
    })
  })

  describe('readMergedAgents', () => {
    it('returns all nulls when no merged files', () => {
      expect(readMergedAgents(ctx.duetDataDir)).toEqual({
        sessionPrompt: null,
        executor: null,
        vizir: null
      })
    })

    it('returns mixed values when only one is present', () => {
      writeFileSync(join(ctx.duetDataDir, 'duet-executor.md'), '# Exec\n', 'utf-8')
      expect(readMergedAgents(ctx.duetDataDir)).toEqual({
        sessionPrompt: null,
        executor: '# Exec\n',
        vizir: null
      })
    })

    it('returns all bodies when all files exist (incl. thin session prompt duet.md)', () => {
      writeFileSync(join(ctx.duetDataDir, 'duet.md'), '# Duet\n', 'utf-8')
      writeFileSync(join(ctx.duetDataDir, 'duet-executor.md'), '# Exec\n', 'utf-8')
      writeFileSync(join(ctx.duetDataDir, 'duet-vizir.md'), '# Vizir\n', 'utf-8')
      expect(readMergedAgents(ctx.duetDataDir)).toEqual({
        sessionPrompt: '# Duet\n',
        executor: '# Exec\n',
        vizir: '# Vizir\n'
      })
    })
  })

  // ===========================================================================
  // readCachedErrors
  // ===========================================================================

  describe('readCachedErrors', () => {
    it('returns null when file does not exist (merge never ran)', () => {
      const result = readCachedErrors(ctx.duetDataDir)
      expect(result).toBeNull()
    })

    it('returns errors when file exists', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      const errors = [
        { path: 'test.md', reason_code: 'no_frontmatter', description: 'No frontmatter' }
      ]
      writeFileSync(join(dataDir, 'duet-instructions-errors.json'), JSON.stringify(errors), 'utf-8')

      const result = readCachedErrors(ctx.duetDataDir)
      expect(result).toEqual(errors)
    })

    it('returns null on invalid JSON', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'duet-instructions-errors.json'), 'not json', 'utf-8')

      const result = readCachedErrors(ctx.duetDataDir)
      expect(result).toBeNull()
    })

    it('returns null when file contains non-array JSON', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(
        join(dataDir, 'duet-instructions-errors.json'),
        JSON.stringify({ not: 'array' }),
        'utf-8'
      )

      const result = readCachedErrors(ctx.duetDataDir)
      expect(result).toBeNull()
    })

    it('returns empty array when cache exists with 0 errors', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'duet-instructions-errors.json'), '[]', 'utf-8')

      const result = readCachedErrors(ctx.duetDataDir)
      expect(result).toEqual([])
    })
  })
})
