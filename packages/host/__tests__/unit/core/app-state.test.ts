/*
 * Unit тесты для src/core/app-state.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { checkAppState, createInitialState } from '../../../src/core/app-state'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'
import { readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

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
        duetConfigPath: null,
        machine: null,
        userName: 'Human',
        userNameError: null,
        pathExists: false,
        deployChannel: 'prod',
        pythonPath: null,
        hasDevBackendPath: false
      })
    })
  })

  describe('checkAppState', () => {
    it('returns no_config when config file does not exist', () => {
      const state = checkAppState()
      expect(state.status).toBe('no_config')
      expect(state.duetDataPath).toBeNull()
      expect(state.duetConfigPath).toBeNull()
      expect(state.machine).toBeNull()
      expect(state.pathExists).toBe(false)
    })

    it('returns no_config when config exists but fields are empty', () => {
      writeTestConfig(ctx.configFile, {})

      const state = checkAppState()
      expect(state.status).toBe('no_config')
    })

    it('returns no_config when only duetDataPath is set (incomplete pointer)', () => {
      writeTestConfig(ctx.configFile, { duetDataPath: ctx.duetDataDir })

      const state = checkAppState()
      expect(state.status).toBe('no_config')
    })

    it('returns ready when all 3 fields set and paths exist', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test_machine'
      })

      const state = checkAppState()
      expect(state.status).toBe('ready')
      expect(state.duetDataPath).toBe(ctx.duetDataDir)
      expect(state.duetConfigPath).toBe(ctx.duetConfigDir)
      expect(state.machine).toBe('test_machine')
      expect(state.pathExists).toBe(true)
    })

    it.each(['3', 'true', '"text"', '[]', 'null'])(
      'stays available when the settings root is the JSON primitive %s (UN2)',
      (contents) => {
        writeTestConfig(ctx.configFile, {
          duetDataPath: ctx.duetDataDir,
          duetConfigPath: ctx.duetConfigDir,
          machine: 'test'
        })
        const path = join(ctx.duetConfigDir, 'settings.json')
        writeFileSync(path, contents)
        // The critical-migration banner owns this file's repair; state reading must not throw.
        const state = checkAppState()
        expect(state.status).toBe('ready')
        expect(state.userName).toBe('Human')
        expect(state.userNameError).toBeNull()
        expect(readFileSync(path, 'utf-8')).toBe(contents)
      }
    )

    it('returns path_lost when paths do not exist', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: '/non/existent/data',
        duetConfigPath: '/non/existent/config',
        machine: 'test_machine'
      })

      const state = checkAppState()
      expect(state.status).toBe('path_lost')
      expect(state.pathExists).toBe(false)
    })

    it('returns path_lost when DuetData is deleted after config was written', () => {
      writeTestConfig(ctx.configFile, {
        duetDataPath: ctx.duetDataDir,
        duetConfigPath: ctx.duetConfigDir,
        machine: 'test_machine'
      })

      let state = checkAppState()
      expect(state.status).toBe('ready')

      // Удаляем DuetData
      rmSync(ctx.duetDataDir, { recursive: true })

      state = checkAppState()
      expect(state.status).toBe('path_lost')
    })
  })
})
