/*
 * Unit тесты для src/core/instructions.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, type TestContext } from '../../helpers'

import { readMergedInstructions, readCachedErrors } from '../../../src/core/instructions'

describe('core/instructions', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ===========================================================================
  // readMergedInstructions
  // ===========================================================================

  describe('readMergedInstructions', () => {
    it('returns null when file does not exist', () => {
      const result = readMergedInstructions(ctx.duetDataDir)
      expect(result).toBeNull()
    })

    it('returns content when file exists', () => {
      writeFileSync(join(ctx.duetDataDir, 'duet-instructions.md'), '# Instructions\n', 'utf-8')

      const result = readMergedInstructions(ctx.duetDataDir)
      expect(result).toBe('# Instructions\n')
    })
  })

  // ===========================================================================
  // readCachedErrors
  // ===========================================================================

  describe('readCachedErrors', () => {
    it('returns empty array when file does not exist', () => {
      const result = readCachedErrors(ctx.duetDataDir)
      expect(result).toEqual([])
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

    it('returns empty array on invalid JSON', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'duet-instructions-errors.json'), 'not json', 'utf-8')

      const result = readCachedErrors(ctx.duetDataDir)
      expect(result).toEqual([])
    })

    it('returns empty array when file contains non-array JSON', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(
        join(dataDir, 'duet-instructions-errors.json'),
        JSON.stringify({ not: 'array' }),
        'utf-8'
      )

      const result = readCachedErrors(ctx.duetDataDir)
      expect(result).toEqual([])
    })
  })
})
