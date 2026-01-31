/*
 * Unit тесты для src/core/config.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readConfig, writeConfig, getConfigDir, getConfigFile } from '../../../src/core/config'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'

describe('core/config', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('getConfigDir', () => {
    it('returns DUET_CONFIG_DIR when set', () => {
      expect(getConfigDir()).toBe(ctx.configDir)
    })
  })

  describe('getConfigFile', () => {
    it('returns path to config.json in configDir', () => {
      expect(getConfigFile()).toBe(join(ctx.configDir, 'config.json'))
    })
  })

  describe('readConfig', () => {
    it('returns {} when config file does not exist', () => {
      const config = readConfig()
      expect(config).toEqual({})
    })

    it('returns parsed object when config file exists with valid JSON', () => {
      writeTestConfig(ctx.configDir, { duetDataPath: '/some/path' })

      const config = readConfig()
      expect(config).toEqual({ duetDataPath: '/some/path' })
    })

    it('returns {} when config file contains invalid JSON', () => {
      writeFileSync(join(ctx.configDir, 'config.json'), 'not valid json {{{')

      const config = readConfig()
      expect(config).toEqual({})
    })
  })

  describe('writeConfig', () => {
    it('creates config directory and file', () => {
      // Удаляем директорию чтобы проверить что writeConfig её создаст
      ctx.cleanup()
      ctx = createTestContext()
      // configDir уже создан createTestContext, но config.json нет

      writeConfig({ duetDataPath: '/new/path' })

      expect(existsSync(getConfigFile())).toBe(true)
      const config = readConfig()
      expect(config).toEqual({ duetDataPath: '/new/path' })
    })

    it('overwrites existing config', () => {
      writeTestConfig(ctx.configDir, { duetDataPath: '/old/path' })

      writeConfig({ duetDataPath: '/new/path' })

      const config = readConfig()
      expect(config).toEqual({ duetDataPath: '/new/path' })
    })
  })
})
