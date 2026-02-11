/*
 * Unit тесты для src/core/config.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readConfig, writeConfig, getConfigFile, ensureConfigDefaults, isValidMachineName } from '../../../src/core/config'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'

describe('core/config', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('getConfigFile', () => {
    it('returns DUET_CONFIG_FILE when set', () => {
      expect(getConfigFile()).toBe(ctx.configFile)
    })
  })

  describe('readConfig', () => {
    it('returns {} when config file does not exist', () => {
      const config = readConfig()
      expect(config).toEqual({})
    })

    it('returns parsed object when config file exists with valid JSON', () => {
      writeTestConfig(ctx.configFile, { duetDataPath: '/some/path' })

      const config = readConfig()
      expect(config).toEqual({ duetDataPath: '/some/path' })
    })

    it('returns {} when config file contains invalid JSON', () => {
      writeFileSync(ctx.configFile, 'not valid json {{{')

      const config = readConfig()
      expect(config).toEqual({})
    })
  })

  describe('writeConfig', () => {
    it('creates config file', () => {
      writeConfig({ duetDataPath: '/new/path' })

      expect(existsSync(getConfigFile())).toBe(true)
      const config = readConfig()
      expect(config).toEqual({ duetDataPath: '/new/path' })
    })

    it('overwrites existing config', () => {
      writeTestConfig(ctx.configFile, { duetDataPath: '/old/path' })

      writeConfig({ duetDataPath: '/new/path' })

      const config = readConfig()
      expect(config).toEqual({ duetDataPath: '/new/path' })
    })
  })

  // ===========================================================================
  // ensureConfigDefaults
  // ===========================================================================

  describe('ensureConfigDefaults', () => {
    it('creates settings.json with defaults when missing', () => {
      ensureConfigDefaults(ctx.duetConfigDir, 'mypc')

      const settingsPath = join(ctx.duetConfigDir, 'settings.json')
      expect(existsSync(settingsPath)).toBe(true)

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(settings).toEqual({
        business_folders: [],
        timestampTZ: { id: 'Z', value: 'UTC' }
      })
    })

    it('creates {machine}.json with defaults when missing', () => {
      ensureConfigDefaults(ctx.duetConfigDir, 'mypc')

      const machinePath = join(ctx.duetConfigDir, 'mypc.json')
      expect(existsSync(machinePath)).toBe(true)

      const machineConfig = JSON.parse(readFileSync(machinePath, 'utf-8'))
      expect(machineConfig).toEqual({ port: 19680 })
    })

    it('does not overwrite existing settings.json', () => {
      const settingsPath = join(ctx.duetConfigDir, 'settings.json')
      const custom = { business_folders: ['@MyBiz'], timestampTZ: { id: 'M', value: 'Europe/Moscow' } }
      writeFileSync(settingsPath, JSON.stringify(custom))

      ensureConfigDefaults(ctx.duetConfigDir, 'mypc')

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      expect(settings).toEqual(custom)
    })

    it('does not overwrite existing {machine}.json', () => {
      const machinePath = join(ctx.duetConfigDir, 'mypc.json')
      const custom = { port: 9999, '@БАЗА': '/my/path' }
      writeFileSync(machinePath, JSON.stringify(custom))

      ensureConfigDefaults(ctx.duetConfigDir, 'mypc')

      const machineConfig = JSON.parse(readFileSync(machinePath, 'utf-8'))
      expect(machineConfig).toEqual(custom)
    })

    it('creates DuetConfig directory if missing', () => {
      const newConfigDir = join(ctx.tmpDir, 'new-config-dir')
      expect(existsSync(newConfigDir)).toBe(false)

      ensureConfigDefaults(newConfigDir, 'mypc')

      expect(existsSync(newConfigDir)).toBe(true)
      expect(existsSync(join(newConfigDir, 'settings.json'))).toBe(true)
      expect(existsSync(join(newConfigDir, 'mypc.json'))).toBe(true)
    })

    it('rejects path traversal in machine name', () => {
      expect(() => ensureConfigDefaults(ctx.duetConfigDir, '../../etc/passwd')).toThrow('Invalid machine name')
    })

    it('rejects empty machine name', () => {
      expect(() => ensureConfigDefaults(ctx.duetConfigDir, '')).toThrow('Invalid machine name')
    })

    it('rejects machine name with slashes', () => {
      expect(() => ensureConfigDefaults(ctx.duetConfigDir, 'foo/bar')).toThrow('Invalid machine name')
    })
  })

  // ===========================================================================
  // isValidMachineName
  // ===========================================================================

  describe('isValidMachineName', () => {
    it('accepts valid names', () => {
      expect(isValidMachineName('mypc')).toBe(true)
      expect(isValidMachineName('my-pc')).toBe(true)
      expect(isValidMachineName('my_pc')).toBe(true)
      expect(isValidMachineName('My.MacBook')).toBe(true)
      expect(isValidMachineName('pc01')).toBe(true)
    })

    it('rejects invalid names', () => {
      expect(isValidMachineName('')).toBe(false)
      expect(isValidMachineName('../etc')).toBe(false)
      expect(isValidMachineName('foo/bar')).toBe(false)
      expect(isValidMachineName('foo\\bar')).toBe(false)
      expect(isValidMachineName('.hidden')).toBe(false)
      expect(isValidMachineName('-dash')).toBe(false)
      expect(isValidMachineName('a'.repeat(65))).toBe(false)
    })
  })
})
