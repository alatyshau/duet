/*
 * Unit тесты для src/core/instructions.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, type TestContext } from '../../helpers'

import {
  readMergedInstructions,
  readCachedErrors,
  fixInstructionsError,
  isFixableError
} from '../../../src/core/instructions'

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

  // ===========================================================================
  // isFixableError
  // ===========================================================================

  describe('isFixableError', () => {
    it('returns true for fixable codes', () => {
      expect(isFixableError('no_frontmatter')).toBe(true)
      expect(isFixableError('invalid_yaml')).toBe(true)
      expect(isFixableError('missing_fields')).toBe(true)
    })

    it('returns false for non-fixable codes', () => {
      expect(isFixableError('frontmatter_too_large')).toBe(false)
      expect(isFixableError('content_between_h1_h2')).toBe(false)
      expect(isFixableError('unknown')).toBe(false)
    })
  })

  // ===========================================================================
  // fixInstructionsError
  // ===========================================================================

  describe('fixInstructionsError', () => {
    it('adds frontmatter for no_frontmatter', () => {
      const instrDir = join(ctx.duetDataDir, 'instructions')
      mkdirSync(join(instrDir, 'personas'), { recursive: true })
      writeFileSync(join(instrDir, 'personas', 'test.md'), '# Test\nContent here\n', 'utf-8')

      const result = fixInstructionsError(instrDir, 'personas/test.md', 'no_frontmatter')
      expect(result).toBe(true)

      const fixed = readFileSync(join(instrDir, 'personas', 'test.md'), 'utf-8')
      expect(fixed).toContain('---\nname: test\ndescription: \n---\n')
      expect(fixed).toContain('# Test\nContent here\n')
    })

    it('replaces broken frontmatter for invalid_yaml', () => {
      const instrDir = join(ctx.duetDataDir, 'instructions')
      mkdirSync(instrDir, { recursive: true })
      writeFileSync(
        join(instrDir, 'broken.md'),
        '---\n{invalid yaml\n---\n# Content\n',
        'utf-8'
      )

      const result = fixInstructionsError(instrDir, 'broken.md', 'invalid_yaml')
      expect(result).toBe(true)

      const fixed = readFileSync(join(instrDir, 'broken.md'), 'utf-8')
      expect(fixed).toContain('name: broken')
      expect(fixed).toContain('description: ')
      expect(fixed).toContain('# Content\n')
      expect(fixed).not.toContain('{invalid yaml')
    })

    it('adds missing fields for missing_fields', () => {
      const instrDir = join(ctx.duetDataDir, 'instructions')
      mkdirSync(instrDir, { recursive: true })
      writeFileSync(
        join(instrDir, 'partial.md'),
        '---\ncategory: tools\n---\n# Partial\n',
        'utf-8'
      )

      const result = fixInstructionsError(instrDir, 'partial.md', 'missing_fields')
      expect(result).toBe(true)

      const fixed = readFileSync(join(instrDir, 'partial.md'), 'utf-8')
      expect(fixed).toContain('category: tools')
      expect(fixed).toContain('name: partial')
      expect(fixed).toContain('description: ')
    })

    it('preserves existing name when adding missing description', () => {
      const instrDir = join(ctx.duetDataDir, 'instructions')
      mkdirSync(instrDir, { recursive: true })
      writeFileSync(
        join(instrDir, 'named.md'),
        '---\nname: my-skill\n---\n# Named\n',
        'utf-8'
      )

      const result = fixInstructionsError(instrDir, 'named.md', 'missing_fields')
      expect(result).toBe(true)

      const fixed = readFileSync(join(instrDir, 'named.md'), 'utf-8')
      expect(fixed).toContain('name: my-skill')
      expect(fixed).toContain('description: ')
      // Should NOT add a second name
      expect(fixed.match(/name:/g)?.length).toBe(1)
    })

    it('returns false for non-fixable reason code', () => {
      const result = fixInstructionsError('/fake', 'test.md', 'frontmatter_too_large')
      expect(result).toBe(false)
    })

    it('returns false when file does not exist', () => {
      const result = fixInstructionsError(ctx.duetDataDir, 'nonexistent.md', 'no_frontmatter')
      expect(result).toBe(false)
    })
  })
})
