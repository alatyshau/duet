/*
 * Unit тесты для src/core/business-folders.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'

import {
  getBusinessFolders,
  saveBusinessFolders,
  readCachedScan,
  readCachedStreams
} from '../../../src/core/business-folders'

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

      const settings = JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
      expect(settings.business_folders).toEqual(folders)
      // Other keys preserved
      expect(settings.timestampTZ).toEqual({ id: 'Z', value: 'UTC' })
    })

    it('creates settings.json if it does not exist', () => {
      const folders = ['/new/path']
      saveBusinessFolders(folders)

      const settings = JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
      expect(settings.business_folders).toEqual(folders)
    })

    it('replaces existing business_folders entirely', () => {
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: ['/old/path'] }),
        'utf-8'
      )

      saveBusinessFolders(['/new/path1', '/new/path2'])

      const settings = JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
      expect(settings.business_folders).toEqual(['/new/path1', '/new/path2'])
    })
  })

  // ===========================================================================
  // readCachedScan
  // ===========================================================================

  describe('readCachedScan', () => {
    it('returns null when scan.json does not exist', () => {
      expect(readCachedScan(ctx.duetDataDir)).toBeNull()
    })

    it('returns parsed scan result from cache', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      const scanData = { status: 'ok', entities_count: 5, errors: [] }
      writeFileSync(join(dataDir, 'scan.json'), JSON.stringify(scanData), 'utf-8')

      const result = readCachedScan(ctx.duetDataDir)
      expect(result).toEqual(scanData)
    })

    it('returns null for invalid JSON', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'scan.json'), 'not json', 'utf-8')

      expect(readCachedScan(ctx.duetDataDir)).toBeNull()
    })
  })

  // ===========================================================================
  // readCachedStreams
  // ===========================================================================

  describe('readCachedStreams', () => {
    it('returns null when streams.json does not exist', () => {
      expect(readCachedStreams(ctx.duetDataDir)).toBeNull()
    })

    it('returns parsed streams from cache', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      const streamsData = {
        streams: [
          {
            id: '1',
            type: 'business',
            name: 'TestBiz',
            icon: '\u{1F4C1}',
            path: 'TestBiz',
            absolute_path: '/path/to/TestBiz',
            parent_id: null,
            git_url: null,
            status: null
          }
        ]
      }
      writeFileSync(join(dataDir, 'streams.json'), JSON.stringify(streamsData), 'utf-8')

      const result = readCachedStreams(ctx.duetDataDir)
      expect(result).toEqual(streamsData)
      expect(result!.streams).toHaveLength(1)
      expect(result!.streams[0].name).toBe('TestBiz')
    })

    it('returns null for invalid JSON', () => {
      const dataDir = join(ctx.duetDataDir, 'data')
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(join(dataDir, 'streams.json'), 'not json', 'utf-8')

      expect(readCachedStreams(ctx.duetDataDir)).toBeNull()
    })
  })
})
