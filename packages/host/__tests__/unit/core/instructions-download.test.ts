/*
 * Unit тесты для src/core/instructions-download.ts
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { isFolderEmpty } from '../../../src/core/instructions-download'

describe('core/instructions-download', () => {
  const dirs: string[] = []

  const makeTmpDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'duet-test-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  // ===========================================================================
  // isFolderEmpty
  // ===========================================================================

  describe('isFolderEmpty', () => {
    it('returns true for non-existent folder', () => {
      expect(isFolderEmpty('/tmp/does-not-exist-' + Date.now())).toBe(true)
    })

    it('returns true for empty folder', () => {
      const dir = makeTmpDir()
      expect(isFolderEmpty(dir)).toBe(true)
    })

    it('returns true for folder with only .DS_Store', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, '.DS_Store'), '')
      expect(isFolderEmpty(dir)).toBe(true)
    })

    it('returns true for folder with only ignored files', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, '.DS_Store'), '')
      writeFileSync(join(dir, 'Thumbs.db'), '')
      writeFileSync(join(dir, 'desktop.ini'), '')
      writeFileSync(join(dir, '.gitkeep'), '')
      expect(isFolderEmpty(dir)).toBe(true)
    })

    it('returns false for folder with real files', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, 'index.json'), '{}')
      expect(isFolderEmpty(dir)).toBe(false)
    })

    it('returns false for folder with subdirectory', () => {
      const dir = makeTmpDir()
      mkdirSync(join(dir, 'skills'))
      expect(isFolderEmpty(dir)).toBe(false)
    })

    it('returns false when real file mixed with ignored', () => {
      const dir = makeTmpDir()
      writeFileSync(join(dir, '.DS_Store'), '')
      writeFileSync(join(dir, 'core_instructions.md'), '# Core')
      expect(isFolderEmpty(dir)).toBe(false)
    })
  })
})
