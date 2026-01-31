/*
 * Unit тесты для src/core/app-state.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkAppState, createInitialState } from '../../../src/core/app-state'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'
import { rmSync } from 'fs'

describe('core/app-state', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  describe('createInitialState', () => {
    it('returns state with status no_config', () => {
      const state = createInitialState()
      expect(state).toEqual({
        status: 'no_config',
        duetDataPath: null,
        pathExists: false
      })
    })
  })

  describe('checkAppState', () => {
    it('returns no_config when config file does not exist', () => {
      const state = checkAppState()
      expect(state.status).toBe('no_config')
      expect(state.duetDataPath).toBeNull()
      expect(state.pathExists).toBe(false)
    })

    it('returns no_config when config exists but duetDataPath is not set', () => {
      writeTestConfig(ctx.configDir, {})

      const state = checkAppState()
      expect(state.status).toBe('no_config')
    })

    it('returns ready when config exists and path exists', () => {
      writeTestConfig(ctx.configDir, { duetDataPath: ctx.duetDataDir })

      const state = checkAppState()
      expect(state.status).toBe('ready')
      expect(state.duetDataPath).toBe(ctx.duetDataDir)
      expect(state.pathExists).toBe(true)
    })

    it('returns path_lost when config exists but path does not exist', () => {
      const nonExistentPath = '/non/existent/path'
      writeTestConfig(ctx.configDir, { duetDataPath: nonExistentPath })

      const state = checkAppState()
      expect(state.status).toBe('path_lost')
      expect(state.duetDataPath).toBe(nonExistentPath)
      expect(state.pathExists).toBe(false)
    })

    it('returns path_lost when path is deleted after config was written', () => {
      writeTestConfig(ctx.configDir, { duetDataPath: ctx.duetDataDir })

      // Проверяем что сначала ready
      let state = checkAppState()
      expect(state.status).toBe('ready')

      // Удаляем директорию
      rmSync(ctx.duetDataDir, { recursive: true })

      // Теперь должен быть path_lost
      state = checkAppState()
      expect(state.status).toBe('path_lost')
    })
  })
})
