import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, writeTestConfig, type TestContext } from '../../helpers'
import { ensureConfigDefaults, readUserName } from '../../../src/core/config'
import { checkAppState, type AppState } from '../../../src/core/app-state'
import { setupIpcHandlers, type IpcHandlersContext } from '../../../src/main/ipc-handlers'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn)
  },
  app: {},
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] }
}))

describe('user-name IPC', () => {
  let ctx: TestContext
  let context: IpcHandlersContext
  beforeEach(() => {
    ctx = createTestContext()
    writeTestConfig(ctx.configFile, {
      duetDataPath: ctx.duetDataDir,
      duetConfigPath: ctx.duetConfigDir,
      machine: 'test'
    })
    ensureConfigDefaults(ctx.duetConfigDir, 'test')
    context = {
      getAppState: checkAppState,
      updateAppState: vi.fn(),
      setDeployStatus: vi.fn(),
      runMigrations: vi.fn(),
      getMigrationStatus: () => ({ critical: null, contextErrors: [], migratedCount: 0 })
    }
    handlers.clear()
    setupIpcHandlers(context)
  })
  afterEach(() => ctx.cleanup())

  it('persists and returns the refreshed name through the real handler', () => {
    const state = handlers.get('config:set-user-name')!(null, ' Andrei ')
    expect(state).toMatchObject({ userName: 'Andrei' })
    expect(readUserName()).toBe('Andrei')
    expect(context.updateAppState).toHaveBeenCalledOnce()
  })

  it('propagates validation failures without publishing state', () => {
    expect(() => handlers.get('config:set-user-name')!(null, '')).toThrow(/User name/)
    expect(readUserName()).toBe('Human')
    expect(context.updateAppState).not.toHaveBeenCalled()
  })

  it('repairs a stored invalid value by saving the shown Human (UN1)', () => {
    const path = join(ctx.duetConfigDir, 'settings.json')
    const settings = JSON.parse(readFileSync(path, 'utf-8'))
    writeFileSync(path, JSON.stringify({ ...settings, user_name: null }))
    const broken = checkAppState()
    expect(broken.userName).toBe('Human')
    expect(broken.userNameError).toMatch(/User name must be a string/)
    // The page saves the shown value; the error must make the save go through.
    const state = handlers.get('config:set-user-name')!(null, broken.userName) as AppState
    expect(state.userName).toBe('Human')
    expect(state.userNameError).toBeNull()
    const saved = JSON.parse(readFileSync(path, 'utf-8'))
    expect(saved.user_name).toBe('Human')
    expect(saved.root_context_folders).toEqual(settings.root_context_folders)
    expect(saved.timestampTZ).toEqual(settings.timestampTZ)
  })

  it('does not write when schema migration is critically blocked', () => {
    context.getMigrationStatus = () => ({
      critical: {
        description: 'Future version',
        file: 'settings',
        path: '/settings.json',
        reason_code: 'future_version'
      },
      contextErrors: [],
      migratedCount: 0
    })
    const path = join(ctx.duetConfigDir, 'settings.json')
    const before = readFileSync(path, 'utf-8')
    expect(() => handlers.get('config:set-user-name')!(null, 'Andrei')).toThrow(/Future version/)
    expect(readFileSync(path, 'utf-8')).toBe(before)
    expect(context.updateAppState).not.toHaveBeenCalled()
  })
})
