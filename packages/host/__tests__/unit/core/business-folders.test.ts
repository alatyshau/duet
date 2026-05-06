/*
 * Unit тесты для src/core/business-folders.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'

import {
  addBusinessFolder,
  getBusinessFolders,
  normalizePath,
  resolveAliasForPath,
  saveBusinessFolders,
  setRootBusiness,
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
  // normalizePath
  // ===========================================================================

  describe('normalizePath', () => {
    it('strips trailing forward slash', () => {
      expect(normalizePath('/foo/bar/')).toBe('/foo/bar')
    })

    it('strips trailing backslash (Windows)', () => {
      expect(normalizePath('C:\\foo\\bar\\')).toBe('C:\\foo\\bar')
    })

    it('strips multiple trailing separators', () => {
      expect(normalizePath('/foo/bar///')).toBe('/foo/bar')
      expect(normalizePath('C:\\foo\\\\')).toBe('C:\\foo')
    })

    it('preserves path without trailing separator', () => {
      expect(normalizePath('/foo/bar')).toBe('/foo/bar')
    })

    it('NFC-normalizes NFD input (macOS dialog returns NFD)', () => {
      // U+0418 U+0306 (И + combining breve, NFD) → U+0419 (Й, NFC)
      const nfd = 'Й'.normalize('NFD')
      const nfc = 'Й'.normalize('NFC')
      expect(nfd).not.toBe(nfc) // sanity: they differ in codepoints
      expect(normalizePath(`/foo/${nfd}`)).toBe(`/foo/${nfc}`)
    })

    it('is idempotent', () => {
      const once = normalizePath('/foo/МетаЛаб/')
      const twice = normalizePath(once)
      expect(twice).toBe(once)
    })
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

    it('throws if settings.json does not exist (caller must run wizard step 1 first)', () => {
      // Was previously silent-recreate which lost timestampTZ etc — now fail loud
      expect(() => saveBusinessFolders(['/new/path'])).toThrow(/Settings file not found/)
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
  // resolveAliasForPath (pure)
  // ===========================================================================

  describe('resolveAliasForPath', () => {
    it('reuses existing alias when path is already aliased', () => {
      const aliases = { '@Existing': '/foo/bar' }
      const result = resolveAliasForPath('/foo/bar', aliases)
      expect(result).toEqual({ alias: '@Existing', isNew: false })
    })

    it('reuses alias even if its name does not match basename', () => {
      // User's manually-named aliases (e.g. transliteration) survive: same path → same alias
      const aliases = { '@MyBaza': '/foo/Baza' }
      const result = resolveAliasForPath('/foo/Baza', aliases)
      expect(result).toEqual({ alias: '@MyBaza', isNew: false })
    })

    it('reuses alias across NFD/NFC normalization (macOS Cyrillic)', () => {
      // {machine}.json has NFC, dialog gave us NFD → must reuse the same alias
      const aliasNFC = '/foo/МетаЛаб'.normalize('NFC')
      const inputNFD = '/foo/МетаЛаб'.normalize('NFD')
      const aliases = { '@МетаЛаб': aliasNFC }
      const result = resolveAliasForPath(inputNFD, aliases)
      expect(result).toEqual({ alias: '@МетаЛаб', isNew: false })
    })

    it('reuses alias when input has trailing separator', () => {
      const aliases = { '@Baza': '/foo/Baza' }
      expect(resolveAliasForPath('/foo/Baza/', aliases)).toEqual({
        alias: '@Baza',
        isNew: false
      })
    })

    it('reuses alias when stored alias has trailing separator', () => {
      const aliases = { '@Baza': '/foo/Baza/' }
      expect(resolveAliasForPath('/foo/Baza', aliases)).toEqual({
        alias: '@Baza',
        isNew: false
      })
    })

    it('generates @basename for fresh path', () => {
      const result = resolveAliasForPath('/foo/Baza', {})
      expect(result).toEqual({ alias: '@Baza', isNew: true })
    })

    it('handles unicode folder names', () => {
      const result = resolveAliasForPath('/foo/МетаЛаб', {})
      expect(result).toEqual({ alias: '@МетаЛаб', isNew: true })
    })

    it('appends _2 on collision with different path', () => {
      const aliases = { '@Baza': '/other/Baza' }
      const result = resolveAliasForPath('/foo/Baza', aliases)
      expect(result).toEqual({ alias: '@Baza_2', isNew: true })
    })

    it('skips taken suffixes until a free one is found', () => {
      const aliases = {
        '@Baza': '/a/Baza',
        '@Baza_2': '/b/Baza',
        '@Baza_3': '/c/Baza'
      }
      const result = resolveAliasForPath('/d/Baza', aliases)
      expect(result).toEqual({ alias: '@Baza_4', isNew: true })
    })

    it('throws on degenerate path with empty basename', () => {
      // Filesystem root or trailing-only path — should be rejected, not produce '@'
      expect(() => resolveAliasForPath('/', {})).toThrow(/empty basename/)
    })
  })

  // ===========================================================================
  // setRootBusiness
  // ===========================================================================

  describe('setRootBusiness', () => {
    /** Создаёт реальную папку с business.json. */
    const createBusiness = (
      name: string,
      manifest: Record<string, unknown> = { name, icon: '📁' }
    ): { path: string; manifestPath: string } => {
      const path = join(ctx.tmpDir, name)
      mkdirSync(path, { recursive: true })
      const manifestPath = join(path, 'business.json')
      writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8')
      return { path, manifestPath }
    }

    it('sets root: true on the chosen folder, removes from others', () => {
      const a = createBusiness('A', { name: 'A', icon: '📁', root: true })
      const b = createBusiness('B')
      const c = createBusiness('C')

      setRootBusiness(
        [
          { raw: '@A', resolved: a.path, isRoot: true },
          { raw: '@B', resolved: b.path, isRoot: false },
          { raw: '@C', resolved: c.path, isRoot: false }
        ],
        1
      )

      expect(JSON.parse(readFileSync(a.manifestPath, 'utf-8')).root).toBeUndefined()
      expect(JSON.parse(readFileSync(b.manifestPath, 'utf-8')).root).toBe(true)
      expect(JSON.parse(readFileSync(c.manifestPath, 'utf-8')).root).toBeUndefined()
    })

    it('self-heals: creates business.json if missing on root folder', () => {
      const folderPath = join(ctx.tmpDir, 'NoManifest')
      mkdirSync(folderPath, { recursive: true })
      const manifestPath = join(folderPath, 'business.json')
      expect(existsSync(manifestPath)).toBe(false)

      setRootBusiness([{ raw: '@NoManifest', resolved: folderPath, isRoot: false }], 0)

      expect(existsSync(manifestPath)).toBe(true)
      const data = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      expect(data.name).toBe('NoManifest')
      expect(data.icon).toBe('📁')
      expect(data.root).toBe(true)
    })

    it('self-heals: creates business.json with no root flag for non-root folders', () => {
      const folderPath = join(ctx.tmpDir, 'SecondBiz')
      mkdirSync(folderPath, { recursive: true })

      setRootBusiness([{ raw: '@SecondBiz', resolved: folderPath, isRoot: false }], -1)

      const data = JSON.parse(readFileSync(join(folderPath, 'business.json'), 'utf-8'))
      expect(data.name).toBe('SecondBiz')
      expect(data.root).toBeUndefined()
    })

    it('throws on invalid JSON in business.json (does not silently overwrite)', () => {
      const folderPath = join(ctx.tmpDir, 'Broken')
      mkdirSync(folderPath, { recursive: true })
      writeFileSync(join(folderPath, 'business.json'), '{ this is not json', 'utf-8')

      expect(() =>
        setRootBusiness([{ raw: '@Broken', resolved: folderPath, isRoot: false }], 0)
      ).toThrow(/Invalid JSON/)
    })

    it('preserves other manifest fields when toggling root', () => {
      const folderPath = join(ctx.tmpDir, 'WithMeta')
      mkdirSync(folderPath, { recursive: true })
      writeFileSync(
        join(folderPath, 'business.json'),
        JSON.stringify({ name: 'WithMeta', icon: '🏢', description: 'desc', custom: 42 }),
        'utf-8'
      )

      setRootBusiness([{ raw: '@WithMeta', resolved: folderPath, isRoot: false }], 0)

      const data = JSON.parse(readFileSync(join(folderPath, 'business.json'), 'utf-8'))
      expect(data).toEqual({
        name: 'WithMeta',
        icon: '🏢',
        description: 'desc',
        custom: 42,
        root: true
      })
    })
  })

  // ===========================================================================
  // addBusinessFolder
  // ===========================================================================

  describe('addBusinessFolder', () => {
    const writeMachineConfig = (config: Record<string, unknown>): void => {
      writeFileSync(join(ctx.duetConfigDir, 'test.json'), JSON.stringify(config), 'utf-8')
    }
    const readMachineFile = (): Record<string, unknown> =>
      JSON.parse(readFileSync(join(ctx.duetConfigDir, 'test.json'), 'utf-8'))
    const readSettingsFile = (): Record<string, unknown> =>
      JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
    /** Создаёт реальную папку (нужно потому что setRootBusiness пишет business.json). */
    const createFolder = (name: string): string => {
      const p = join(ctx.tmpDir, name)
      mkdirSync(p, { recursive: true })
      return p
    }

    beforeEach(() => {
      // Each test starts with empty machine config + settings present
      writeMachineConfig({ port: 19680 })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: [] }),
        'utf-8'
      )
    })

    it('creates @alias in machine config and adds to business_folders', () => {
      const bizPath = createFolder('Baza')
      const result = addBusinessFolder(bizPath)

      const mc = readMachineFile()
      expect(mc['@Baza']).toBe(bizPath)
      expect(mc.port).toBe(19680) // existing keys preserved

      const settings = readSettingsFile()
      expect(settings.business_folders).toEqual(['@Baza'])

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ raw: '@Baza', resolved: bizPath })
    })

    it('first folder added becomes root automatically (invariant: ≥1 folder ⇒ exactly one root)', () => {
      const bizPath = createFolder('FirstBiz')
      const result = addBusinessFolder(bizPath)

      expect(result).toHaveLength(1)
      expect(result[0].isRoot).toBe(true)

      const manifest = JSON.parse(readFileSync(join(bizPath, 'business.json'), 'utf-8'))
      expect(manifest.root).toBe(true)
      expect(manifest.name).toBe('FirstBiz')
    })

    it('subsequent folder does NOT become root (root stays on first)', () => {
      const first = createFolder('First')
      const second = createFolder('Second')

      addBusinessFolder(first)
      const result = addBusinessFolder(second)

      expect(result).toHaveLength(2)
      expect(result[0].isRoot).toBe(true)
      expect(result[1].isRoot).toBe(false)

      // Second folder: business.json was NOT created (no root invariant trigger)
      expect(existsSync(join(second, 'business.json'))).toBe(false)
    })

    it('reuses existing alias for same path (idempotent)', () => {
      const bizPath = createFolder('Baza')
      writeMachineConfig({ port: 19680, '@Baza': bizPath })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: ['@Baza'] }),
        'utf-8'
      )
      // Existing root setup so the invariant doesn't trigger setRootBusiness on add
      writeFileSync(
        join(bizPath, 'business.json'),
        JSON.stringify({ name: 'Baza', root: true }),
        'utf-8'
      )

      const result = addBusinessFolder(bizPath)

      const mc = readMachineFile()
      expect(Object.keys(mc).filter((k) => k.startsWith('@'))).toEqual(['@Baza'])
      const settings = readSettingsFile()
      expect(settings.business_folders).toEqual(['@Baza'])
      expect(result).toHaveLength(1)
    })

    it('reuses alias across NFD/NFC (macOS): adding NFD when {machine}.json has NFC', () => {
      // Simulate state where alias was originally written in NFC (e.g. from another platform)
      const nfcName = 'МетаЛаб'.normalize('NFC')
      const nfdName = 'МетаЛаб'.normalize('NFD')
      const folderNFC = createFolder(nfcName)
      writeMachineConfig({ port: 19680, '@МетаЛаб': folderNFC })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: ['@МетаЛаб'] }),
        'utf-8'
      )
      writeFileSync(
        join(folderNFC, 'business.json'),
        JSON.stringify({ name: nfcName, root: true }),
        'utf-8'
      )

      // User picks the same folder — but on macOS dialog returns NFD form
      const dialogPath = join(ctx.tmpDir, nfdName)
      const result = addBusinessFolder(dialogPath)

      // No new alias created, no duplicate in business_folders
      const mc = readMachineFile()
      expect(Object.keys(mc).filter((k) => k.startsWith('@'))).toEqual(['@МетаЛаб'])
      const settings = readSettingsFile()
      expect(settings.business_folders).toEqual(['@МетаЛаб'])
      expect(result).toHaveLength(1)
    })

    it('stores normalized path (NFC, no trailing separator) in {machine}.json', () => {
      const bizPath = createFolder('MyBiz')
      // Pass with trailing separator and NFD form intentionally
      const ugly = (bizPath + '/').normalize('NFD')

      addBusinessFolder(ugly)

      const mc = readMachineFile()
      expect(mc['@MyBiz']).toBe(bizPath) // = NFC, no trailing /
    })

    it('generates suffixed alias on basename collision', () => {
      const oldBaza = createFolder('OldBaza')
      writeMachineConfig({ port: 19680, '@Baza': oldBaza })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: ['@Baza'] }),
        'utf-8'
      )
      // Existing root so addBusinessFolder doesn't try to set root on already-root folder
      writeFileSync(
        join(oldBaza, 'business.json'),
        JSON.stringify({ name: 'OldBaza', root: true }),
        'utf-8'
      )

      const newBaza = join(ctx.tmpDir, 'newer', 'Baza')
      mkdirSync(newBaza, { recursive: true })
      const result = addBusinessFolder(newBaza)

      const mc = readMachineFile()
      expect(mc['@Baza']).toBe(oldBaza)
      expect(mc['@Baza_2']).toBe(newBaza)

      const settings = readSettingsFile()
      expect(settings.business_folders).toEqual(['@Baza', '@Baza_2'])
      expect(result).toHaveLength(2)
    })

    it('writes business_folders into existing settings.json without other keys present', () => {
      // settings.json exists but is just `{}` — no business_folders key, no other fields
      writeFileSync(join(ctx.duetConfigDir, 'settings.json'), JSON.stringify({}), 'utf-8')

      const bizPath = createFolder('Baza')
      addBusinessFolder(bizPath)

      const settings = readSettingsFile()
      expect(settings.business_folders).toEqual(['@Baza'])
    })

    it('throws when duetConfigPath is missing in pointer config', () => {
      // Re-write pointer config without duetConfigPath
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        machine: 'test'
      })

      expect(() => addBusinessFolder('/some/path')).toThrow(/duetConfigPath/)
    })

    it('throws when machine name is missing in pointer config', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir
      })

      expect(() => addBusinessFolder('/some/path')).toThrow(/machine/)
    })

    it('throws when machine name is invalid (path-traversal protection)', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: '../evil'
      })

      expect(() => addBusinessFolder('/some/path')).toThrow(/machine/)
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
