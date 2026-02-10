/*
 * Unit тесты для src/core/config.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readConfig, writeConfig, getConfigFile } from '../../../src/core/config'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'
import { existsSync, writeFileSync } from 'fs'

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
})
