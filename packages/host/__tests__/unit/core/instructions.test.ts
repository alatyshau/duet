/*
 * Unit тесты для src/core/instructions.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, type TestContext } from '../../helpers'

import { readSessionPrompt, readCachedErrors } from '../../../src/core/instructions'

describe('core/instructions', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('readSessionPrompt', () => {
    it('returns null when no platform prompt exists', () => {
      expect(readSessionPrompt(ctx.duetDataDir)).toBeNull()
    })

    it('reads only the platform prompt', () => {
      writeFileSync(join(ctx.duetDataDir, 'duet.md'), '# Duet\n')
      expect(readSessionPrompt(ctx.duetDataDir)).toBe('# Duet\n')
    })

    it('does not fall back to retired role files', () => {
      writeFileSync(join(ctx.duetDataDir, 'duet-executor.md'), '# Old role')
      expect(readSessionPrompt(ctx.duetDataDir)).toBeNull()
    })
  })

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
