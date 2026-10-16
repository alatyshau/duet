/*
 * Unit тесты для src/core/config.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  readUserName,
  readUserNameState,
  saveUserName,
  normalizeUserName,
  readConfig,
  readPointerStrict,
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

    it('writes atomically (no .tmp leftover)', () => {
      writeConfig({ duetDataPath: '/new/path' })
      expect(existsSync(`${getConfigFile()}.tmp`)).toBe(false)
    })
  })

  // === Review #2 — Issue 3: pointer validation must distinguish missing vs corrupt ===
  describe('readPointerStrict', () => {
    it('returns kind=missing when file does not exist', () => {
      const result = readPointerStrict()
      expect(result.kind).toBe('missing')
    })

    it('returns kind=ok with parsed config for valid JSON object', () => {
      writeTestConfig(ctx.configFile, { duetDataPath: '/data', machine: 'test' })
      const result = readPointerStrict()
      expect(result.kind).toBe('ok')
      if (result.kind === 'ok') {
        expect(result.config.duetDataPath).toBe('/data')
        expect(result.config.machine).toBe('test')
      }
    })

    it('returns kind=invalid_json for corrupt pointer (review issue 3 — must NOT silently first-run)', () => {
      writeFileSync(ctx.configFile, '{ corrupted', 'utf-8')
      const result = readPointerStrict()
      expect(result.kind).toBe('invalid_json')
      if (result.kind === 'invalid_json') {
        expect(result.path).toBe(ctx.configFile)
        expect(result.error).toBeTruthy()
      }
    })

    it('returns kind=invalid_json for non-object payload (e.g. JSON array or scalar)', () => {
      writeFileSync(ctx.configFile, '[]', 'utf-8')
      const result = readPointerStrict()
      expect(result.kind).toBe('invalid_json')
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
        version: 2,
        user_name: 'Human',
        root_context_folders: [],
        timestampTZ: { id: 'Z', value: 'UTC' }
      })
    })

    it('creates {machine}.json with defaults when missing', () => {
      ensureConfigDefaults(ctx.duetConfigDir, 'mypc')

      const machinePath = join(ctx.duetConfigDir, 'mypc.json')
      expect(existsSync(machinePath)).toBe(true)

      const machineConfig = JSON.parse(readFileSync(machinePath, 'utf-8'))
      expect(machineConfig).toEqual({ version: 2, port: 19680 })
    })

    it('does not overwrite existing settings.json', () => {
      const settingsPath = join(ctx.duetConfigDir, 'settings.json')
      const custom = {
        root_context_folders: ['@MyCtx'],
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
        JSON.stringify({ root_context_folders: ['/path'] })
      )

      const result = readSettingsConfig()
      expect(result).toEqual({ root_context_folders: ['/path'] })
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
        JSON.stringify({ root_context_folders: [], timestampTZ: { id: 'Z', value: 'UTC' } })
      )

      setSettingsConfigKey('root_context_folders', ['/new/path'])

      const settings = JSON.parse(readFileSync(join(ctx.duetConfigDir, 'settings.json'), 'utf-8'))
      expect(settings.root_context_folders).toEqual(['/new/path'])
      expect(settings.timestampTZ).toEqual({ id: 'Z', value: 'UTC' })
    })

    it('throws if settings.json is missing (fail-loud, not silent recreate)', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })

      expect(() => setSettingsConfigKey('root_context_folders', ['/path'])).toThrow(
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

      expect(() => setSettingsConfigKey('root_context_folders', ['/path'])).toThrow(/Invalid JSON/)
    })

    it('throws when pointer is not configured', () => {
      // No writeTestConfig — pointer not set
      expect(() => setSettingsConfigKey('root_context_folders', ['/path'])).toThrow(
        /duetConfigPath/
      )
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
        JSON.stringify({ port: 19680, pythonPath: '/some/python' })
      )

      setMachineConfigKey('@MyBiz', '/foo/MyBiz')

      const mc = JSON.parse(readFileSync(machineConfigPath(), 'utf-8'))
      expect(mc.port).toBe(19680)
      expect(mc.pythonPath).toBe('/some/python')
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
  describe('shared user name', () => {
    beforeEach(() => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test'
      })
      ensureConfigDefaults(ctx.duetConfigDir, 'test')
    })

    it('creates Human by default and defaults older settings without rewriting', () => {
      expect(readSettingsConfig()?.user_name).toBe('Human')
      const path = join(ctx.duetConfigDir, 'settings.json')
      writeFileSync(path, JSON.stringify({ version: 2, root_context_folders: [] }))
      const before = readFileSync(path, 'utf-8')
      expect(readUserName()).toBe('Human')
      expect(readFileSync(path, 'utf-8')).toBe(before)
    })

    it('saves a trimmed name in shared settings and preserves other fields', () => {
      const before = readSettingsConfig()
      saveUserName(' Андрей Латышев ')
      expect(readUserName()).toBe('Андрей Латышев')
      expect(readSettingsConfig()).toEqual({ ...before, user_name: 'Андрей Латышев' })
      expect(
        JSON.parse(readFileSync(join(ctx.duetConfigDir, 'test.json'), 'utf-8'))
      ).not.toHaveProperty('user_name')
      saveUserName('Andrei')
      expect(readUserName()).toBe('Andrei')
    })

    it.each([
      ['Andrei', 'Andrei'],
      ['  Андрей Латышев  ', 'Андрей Латышев'],
      ['\tAndrei\n', 'Andrei'],
      ['Human', 'Human'],
      ['я'.repeat(100), 'я'.repeat(100)],
      ['\u00a0Andrei', '\u00a0Andrei']
    ])('accepts %j from the shared table as %j', (value, expected) => {
      expect(normalizeUserName(value)).toBe(expected)
    })

    it.each([
      null,
      3,
      [],
      {},
      '',
      '  ',
      'я'.repeat(101),
      'User',
      '  User ',
      'A\nB',
      'A\tB',
      'A\x7fB',
      '\u0085Andrei',
      '\u001cAndrei',
      '\ufeffAndrei',
      'An\u200bdrei',
      'A`B',
      'A <!-- message-roll:'
    ])('rejects %j from the shared table without changing settings', (value) => {
      const before = readSettingsConfig()
      expect(() => saveUserName(value)).toThrow(/User name/)
      expect(readSettingsConfig()).toEqual(before)
    })

    it.each(['[]', 'null', '3', '"text"'])(
      'rejects non-object settings %s without writing',
      (contents) => {
        const path = join(ctx.duetConfigDir, 'settings.json')
        writeFileSync(path, contents)
        expect(() => saveUserName('Andrei')).toThrow(/settings must be an object/)
        expect(readFileSync(path, 'utf-8')).toBe(contents)
      }
    )

    it('distinguishes an absent field from a stored invalid value', () => {
      const path = join(ctx.duetConfigDir, 'settings.json')
      writeFileSync(path, JSON.stringify({ version: 2, root_context_folders: [] }))
      expect(readUserNameState()).toEqual({ name: 'Human', error: null })
      for (const invalid of [null, 3, 'User', ' ', 'A`B']) {
        writeFileSync(path, JSON.stringify({ version: 2, user_name: invalid }))
        const state = readUserNameState()
        expect(state.name).toBe('Human')
        expect(state.error).toMatch(/User name/)
      }
      writeFileSync(path, JSON.stringify({ version: 2, user_name: '  Andrei ' }))
      expect(readUserNameState()).toEqual({ name: 'Andrei', error: null })
    })

    it.each(['3', 'true', '"text"', '[]', 'null', '{ broken'])(
      'does not throw and does not write when the settings root is %s (UN2)',
      (contents) => {
        const path = join(ctx.duetConfigDir, 'settings.json')
        writeFileSync(path, contents)
        expect(readSettingsConfig()).toBeNull()
        expect(readUserNameState()).toEqual({ name: 'Human', error: null })
        expect(readFileSync(path, 'utf-8')).toBe(contents)
      }
    )

    it('counts Unicode code points consistently with the backend', () => {
      expect(normalizeUserName('😀'.repeat(100))).toBe('😀'.repeat(100))
      expect(() => normalizeUserName('😀'.repeat(101))).toThrow()
    })

    it('does not replace corrupt settings with defaults when saving', () => {
      const path = join(ctx.duetConfigDir, 'settings.json')
      writeFileSync(path, '{ broken')
      expect(() => saveUserName('Andrei')).toThrow(/Invalid JSON/)
      expect(readFileSync(path, 'utf-8')).toBe('{ broken')
    })
  })
})
