/*
 * Unit тесты для src/core/config.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  readConfig,
  writeConfig,
  getConfigFile,
  ensureConfigDefaults,
  isValidMachineName,
  readSettingsConfig,
  setMachineConfigKey,
  setSettingsConfigKey
} from '../../../src/core/config'
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
      const custom = {
        business_folders: ['@MyBiz'],
        timestampTZ: { id: 'M', value: 'Europe/Moscow' }
      }
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
      expect(() => ensureConfigDefaults(ctx.duetConfigDir, '../../etc/passwd')).toThrow(
        'Invalid machine name'
      )
    })

    it('rejects empty machine name', () => {
      expect(() => ensureConfigDefaults(ctx.duetConfigDir, '')).toThrow('Invalid machine name')
    })

    it('rejects machine name with slashes', () => {
      expect(() => ensureConfigDefaults(ctx.duetConfigDir, 'foo/bar')).toThrow(
        'Invalid machine name'
      )
    })
  })

  // ===========================================================================
  // readSettingsConfig
  // ===========================================================================

  describe('readSettingsConfig', () => {
    it('returns null when pointer is not configured', () => {
      const result = readSettingsConfig()
      expect(result).toBeNull()
    })

    it('returns null when settings.json does not exist', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })

      const result = readSettingsConfig()
      expect(result).toBeNull()
    })

    it('returns parsed settings when file exists', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: ['/path'] })
      )

      const result = readSettingsConfig()
      expect(result).toEqual({ business_folders: ['/path'] })
    })

    it('returns null on invalid JSON', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })
      writeFileSync(join(ctx.duetConfigDir, 'settings.json'), 'not json')

      const result = readSettingsConfig()
      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // setSettingsConfigKey
  // ===========================================================================

  describe('setSettingsConfigKey', () => {
    it('updates key in existing settings.json, preserves other fields', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })
      writeFileSync(
        join(ctx.duetConfigDir, 'settings.json'),
        JSON.stringify({ business_folders: [], timestampTZ: { id: 'Z', value: 'UTC' } })
      )

      setSettingsConfigKey('business_folders', ['/new/path'])

      const settings = JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
      expect(settings.business_folders).toEqual(['/new/path'])
      expect(settings.timestampTZ).toEqual({ id: 'Z', value: 'UTC' })
    })

    it('throws if settings.json is missing (fail-loud, not silent recreate)', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })

      expect(() => setSettingsConfigKey('business_folders', ['/path'])).toThrow(
        /Settings file not found/
      )
    })

    it('throws if settings.json contains invalid JSON', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })
      writeFileSync(join(ctx.duetConfigDir, 'settings.json'), '{ broken json', 'utf-8')

      expect(() => setSettingsConfigKey('business_folders', ['/path'])).toThrow(/Invalid JSON/)
    })

    it('throws when pointer is not configured', () => {
      // No writeTestConfig — pointer not set
      expect(() => setSettingsConfigKey('business_folders', ['/path'])).toThrow(/duetConfigPath/)
    })
  })

  // ===========================================================================
  // setMachineConfigKey
  // ===========================================================================

  describe('setMachineConfigKey', () => {
    const machineConfigPath = (): string => join(ctx.duetConfigDir, 'test.json')

    it('updates key in existing machine config, preserves other fields', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })
      writeFileSync(
        machineConfigPath(),
        JSON.stringify({ port: 19680, instructionsPath: '/some/path' })
      )

      setMachineConfigKey('@MyBiz', '/foo/MyBiz')

      const mc = JSON.parse(readFileSync(machineConfigPath(), 'utf-8'))
      expect(mc.port).toBe(19680)
      expect(mc.instructionsPath).toBe('/some/path')
      expect(mc['@MyBiz']).toBe('/foo/MyBiz')
    })

    it('throws if {machine}.json is missing (no silent recreate that would lose port etc.)', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })

      expect(() => setMachineConfigKey('@X', '/x')).toThrow(/Machine config not found/)
    })

    it('throws on invalid JSON in machine config', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })
      writeFileSync(machineConfigPath(), '{ broken', 'utf-8')

      expect(() => setMachineConfigKey('@X', '/x')).toThrow(/Invalid JSON/)
    })

    it('throws if pointer config lacks duetConfigPath or machine', () => {
      writeTestConfig(ctx.configFile, { duetDataPath: ctx.duetDataDir })

      expect(() => setMachineConfigKey('@X', '/x')).toThrow(/pointer not fully configured/)
    })

    it('throws on machine name with path traversal (e.g. ../evil)', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: '../evil'
      })

      expect(() => setMachineConfigKey('@X', '/x')).toThrow(/Invalid machine name/)
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
