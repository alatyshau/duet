/*
 * Unit тесты для src/core/business-folders.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'

import { getBusinessFolders, saveBusinessFolders } from '../../../src/core/business-folders'

describe('core/business-folders', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
    // Write pointer config so readConfig/readSettingsConfig can find files
    writeTestConfig(ctx.configFile, {
      duetDataPath: ctx.duetDataDir,
      duetConfigPath: ctx.duetConfigDir,
      machine: 'test'
    })
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ===========================================================================
  // getBusinessFolders
  // ===========================================================================

  describe('getBusinessFolders', () => {
    it('returns empty array when settings.json does not exist', () => {
      const result = getBusinessFolders()
      expect(result).toEqual([])
    })

    it('returns business_folders from settings.json', () => {
      const folders = ['/path/to/business1', '/path/to/business2']
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: folders }),
        'utf-8'
      )

      const result = getBusinessFolders()
      expect(result).toEqual(folders)
    })

    it('returns empty array when business_folders is not an array', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: 'not-array' }),
        'utf-8'
      )

      const result = getBusinessFolders()
      expect(result).toEqual([])
    })

    it('returns empty array when business_folders key is missing', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ other_key: 'value' }),
        'utf-8'
      )

      const result = getBusinessFolders()
      expect(result).toEqual([])
    })
  })

  // ===========================================================================
  // saveBusinessFolders
  // ===========================================================================

  describe('saveBusinessFolders', () => {
    it('saves business_folders to settings.json', () => {
      // Create initial settings
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: [], timestampTZ: { id: 'Z', value: 'UTC' } }),
        'utf-8'
      )

      const folders = ['/path/to/business1']
      saveBusinessFolders(folders)

      const settings = JSON.parse(
        readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8')
      )
      expect(settings.business_folders).toEqual(folders)
      // Other keys preserved
      expect(settings.timestampTZ).toEqual({ id: 'Z', value: 'UTC' })
    })

    it('creates settings.json if it does not exist', () => {
      const folders = ['/new/path']
      saveBusinessFolders(folders)

      const settings = JSON.parse(
        readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8')
      )
      expect(settings.business_folders).toEqual(folders)
    })

    it('replaces existing business_folders entirely', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: ['/old/path'] }),
        'utf-8'
      )

      saveBusinessFolders(['/new/path1', '/new/path2'])

      const settings = JSON.parse(
        readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8')
      )
      expect(settings.business_folders).toEqual(['/new/path1', '/new/path2'])
    })
  })
})
