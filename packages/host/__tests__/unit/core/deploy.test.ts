/*
 * Unit тесты для src/core/deploy.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, type TestContext } from '../../helpers'

// Mock child_process for findPython/setupVenv
vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

import {
  readDeployedVersion,
  isDeployNeeded,
  resolveDeployStatus,
  isDeployWarning,
  compareSemver,
  deployInstructions,
  deployBackend,
  writeVersion,
  findPython,
  validatePython,
  pythonInstallHint,
  runDeploy,
  type DeployPaths
} from '../../../src/core/deploy'
import { stopBackend, venvPythonPath, type StopOptions } from '../../../src/core/backend'

/** Instant sleep for tests — no real delay. */
const noSleep: StopOptions = { sleep: async () => {} }

import type { AppState, DeployStatus } from '../../../src/shared/types'

import { execFile } from 'child_process'

const mockedExecFile = vi.mocked(execFile)

// =============================================================================
// HELPERS
// =============================================================================

function createDeployContext(ctx: TestContext): { paths: DeployPaths; resourcesPath: string } {
  const resourcesPath = join(ctx.tmpDir, 'resources')
  const duetDataPath = ctx.duetDataDir

  // Create bundled resources structure
  const aiSrc = join(resourcesPath, 'ai-instructions')
  mkdirSync(aiSrc, { recursive: true })
  writeFileSync(join(aiSrc, 'core_instructions.md'), '# AI Kit Instructions')
  writeFileSync(join(aiSrc, 'extra.md'), '# Extra')

  const backendSrc = join(resourcesPath, 'backend')
  mkdirSync(backendSrc, { recursive: true })
  writeFileSync(join(backendSrc, 'main.py'), 'print("hello")')
  writeFileSync(join(backendSrc, 'requirements.txt'), 'fastapi\nuvicorn')

  const paths: DeployPaths = {
    resourcesPath,
    duetDataPath,
    appVersion: '1.2.3'
  }

  return { paths, resourcesPath }
}

function mockPythonFound(version = 'Python 3.12.0'): void {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    ;(callback as (err: Error | null, stdout: string, stderr: string) => void)(null, version, '')
    return undefined as ReturnType<typeof execFile>
  })
}

function mockPythonNotFound(): void {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    ;(callback as (err: Error | null, stdout: string, stderr: string) => void)(
      new Error('not found'),
      '',
      'command not found'
    )
    return undefined as ReturnType<typeof execFile>
  })
}

// =============================================================================
// TESTS
// =============================================================================

describe('core/deploy', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
    vi.clearAllMocks()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ===========================================================================
  // compareSemver
  // ===========================================================================

  describe('compareSemver', () => {
    it('returns 0 for equal versions', () => {
      expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
    })

    it('compares major version', () => {
      expect(compareSemver('2.0.0', '1.0.0')).toBe(1)
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1)
    })

    it('compares minor version', () => {
      expect(compareSemver('1.3.0', '1.2.0')).toBe(1)
      expect(compareSemver('1.2.0', '1.3.0')).toBe(-1)
    })

    it('compares patch version', () => {
      expect(compareSemver('1.2.4', '1.2.3')).toBe(1)
      expect(compareSemver('1.2.3', '1.2.4')).toBe(-1)
    })

    it('handles missing parts as 0', () => {
      expect(compareSemver('1', '1.0.0')).toBe(0)
      expect(compareSemver('1.2', '1.2.0')).toBe(0)
    })

    it('handles invalid input as 0.0.0', () => {
      expect(compareSemver('invalid', '0.0.0')).toBe(0)
      expect(compareSemver('invalid', '0.0.1')).toBe(-1)
    })
  })

  // ===========================================================================
  // readDeployedVersion
  // ===========================================================================

  describe('readDeployedVersion', () => {
    it('returns null when VERSION file does not exist', () => {
      expect(readDeployedVersion(ctx.duetDataDir)).toBeNull()
    })

    it('returns version string when VERSION exists', () => {
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '1.0.0')

      expect(readDeployedVersion(ctx.duetDataDir)).toBe('1.0.0')
    })

    it('trims whitespace from VERSION', () => {
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '  1.0.0\n ')

      expect(readDeployedVersion(ctx.duetDataDir)).toBe('1.0.0')
    })
  })

  // ===========================================================================
  // isDeployNeeded
  // ===========================================================================

  describe('isDeployNeeded', () => {
    it('returns true when no VERSION file', () => {
      const { paths } = createDeployContext(ctx)
      expect(isDeployNeeded(paths)).toBe(true)
    })

    it('returns true when version mismatch', () => {
      const { paths } = createDeployContext(ctx)
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '0.9.0')

      expect(isDeployNeeded(paths)).toBe(true)
    })

    it('returns false when version matches', () => {
      const { paths } = createDeployContext(ctx)
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '1.2.3')

      expect(isDeployNeeded(paths)).toBe(false)
    })

    it('returns false on downgrade (deployed newer than app)', () => {
      const { paths } = createDeployContext(ctx)
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '2.0.0')

      expect(isDeployNeeded(paths)).toBe(false)
    })
  })

  // ===========================================================================
  // resolveDeployStatus
  // ===========================================================================

  describe('resolveDeployStatus', () => {
    const readyState: AppState = {
      status: 'ready',
      duetDataPath: '', // will be set per test
      duetConfigPath: '/config',
      machine: 'test',
      pathExists: true
    }

    it('returns idle when app not ready', () => {
      const state: AppState = { ...readyState, status: 'no_config', duetDataPath: null }
      const result = resolveDeployStatus(state, '1.0.0', { state: 'idle' })
      expect(result).toEqual({ state: 'idle' })
    })

    it('returns idle when duetDataPath is null', () => {
      const state: AppState = { ...readyState, duetDataPath: null }
      const result = resolveDeployStatus(state, '1.0.0', { state: 'idle' })
      expect(result).toEqual({ state: 'idle' })
    })

    it('returns up_to_date when version matches', () => {
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '1.0.0')

      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      const result = resolveDeployStatus(state, '1.0.0', { state: 'idle' })
      expect(result).toEqual({ state: 'up_to_date', version: '1.0.0' })
    })

    it('returns up_to_date on downgrade (deployed newer than app)', () => {
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '2.0.0')

      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      const result = resolveDeployStatus(state, '1.0.0', { state: 'idle' })
      expect(result).toEqual({ state: 'up_to_date', version: '2.0.0' })
    })

    it('returns idle when mismatch and not deploying', () => {
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '0.9.0')

      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      const result = resolveDeployStatus(state, '1.0.0', { state: 'idle' })
      expect(result).toEqual({ state: 'idle' })
    })

    it('returns idle when no VERSION file and not deploying', () => {
      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      const result = resolveDeployStatus(state, '1.0.0', { state: 'idle' })
      expect(result).toEqual({ state: 'idle' })
    })

    it('returns active status when deploying and version mismatch', () => {
      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      const active: DeployStatus = { state: 'deploying', message: 'Working...' }
      const result = resolveDeployStatus(state, '1.0.0', active)
      expect(result).toEqual({ state: 'deploying', message: 'Working...' })
    })

    it('returns active error status when version mismatch', () => {
      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      const active: DeployStatus = { state: 'error', error: 'Python not found' }
      const result = resolveDeployStatus(state, '1.0.0', active)
      expect(result).toEqual({ state: 'error', error: 'Python not found' })
    })
  })

  // ===========================================================================
  // isDeployWarning
  // ===========================================================================

  describe('isDeployWarning', () => {
    const readyState: AppState = {
      status: 'ready',
      duetDataPath: '', // will be set per test
      duetConfigPath: '/config',
      machine: 'test',
      pathExists: true
    }

    it('returns false when app not ready', () => {
      const state: AppState = { ...readyState, status: 'no_config', duetDataPath: null }
      expect(isDeployWarning(state, '1.0.0')).toBe(false)
    })

    it('returns false when version matches', () => {
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '1.0.0')

      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      expect(isDeployWarning(state, '1.0.0')).toBe(false)
    })

    it('returns true when version mismatch', () => {
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '0.9.0')

      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      expect(isDeployWarning(state, '1.0.0')).toBe(true)
    })

    it('returns false on downgrade (deployed newer than app)', () => {
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '2.0.0')

      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      expect(isDeployWarning(state, '1.0.0')).toBe(false)
    })

    it('returns true when no VERSION file (never deployed)', () => {
      const state: AppState = { ...readyState, duetDataPath: ctx.duetDataDir }
      expect(isDeployWarning(state, '1.0.0')).toBe(true)
    })

    it('returns false when duetDataPath is null', () => {
      const state: AppState = { ...readyState, duetDataPath: null }
      expect(isDeployWarning(state, '1.0.0')).toBe(false)
    })
  })

  // ===========================================================================
  // stopBackend
  // ===========================================================================

  describe('stopBackend', () => {
    const TEST_PORT = 19680

    it('does nothing when backend not running (fetch fails)', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
      vi.stubGlobal('fetch', mockFetch)

      await stopBackend(TEST_PORT, null, noSleep)

      expect(mockFetch).toHaveBeenCalledOnce()

      vi.unstubAllGlobals()
    })

    it('calls POST /stop and waits when backend responds', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      await stopBackend(TEST_PORT, null, noSleep)

      expect(mockFetch).toHaveBeenCalledWith(
        `http://127.0.0.1:${TEST_PORT}/stop`,
        expect.objectContaining({ method: 'POST' })
      )

      vi.unstubAllGlobals()
    })

    it('uses correct port in API URL', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
      vi.stubGlobal('fetch', mockFetch)

      await stopBackend(12345, null, noSleep)

      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:12345/stop', expect.anything())

      vi.unstubAllGlobals()
    })
  })

  // ===========================================================================
  // deployInstructions
  // ===========================================================================

  describe('deployInstructions', () => {
    it('copies ai-instructions to DuetData', () => {
      const { paths } = createDeployContext(ctx)

      deployInstructions(paths)

      const dest = join(ctx.duetDataDir, 'ai-instructions')
      expect(existsSync(join(dest, 'core_instructions.md'))).toBe(true)
      expect(existsSync(join(dest, 'extra.md'))).toBe(true)
      expect(readFileSync(join(dest, 'core_instructions.md'), 'utf-8')).toBe(
        '# AI Kit Instructions'
      )
    })

    it('returns file count', () => {
      const { paths } = createDeployContext(ctx)

      const count = deployInstructions(paths)

      expect(count).toBe(2) // core_instructions.md + extra.md
    })

    it('overwrites existing files on re-deploy', () => {
      const { paths } = createDeployContext(ctx)

      deployInstructions(paths)

      // Modify source
      writeFileSync(
        join(paths.resourcesPath, 'ai-instructions', 'core_instructions.md'),
        '# Updated'
      )

      deployInstructions(paths)

      const content = readFileSync(
        join(ctx.duetDataDir, 'ai-instructions', 'core_instructions.md'),
        'utf-8'
      )
      expect(content).toBe('# Updated')
    })

    it('throws when source not found', () => {
      const paths: DeployPaths = {
        resourcesPath: join(ctx.tmpDir, 'nonexistent'),
        duetDataPath: ctx.duetDataDir,
        appVersion: '1.0.0'
      }

      expect(() => deployInstructions(paths)).toThrow('AI instructions source not found')
    })

    it('uses instructionsSourcePath override when provided', () => {
      const devInstructions = join(ctx.tmpDir, 'dev-instructions')
      mkdirSync(devInstructions, { recursive: true })
      writeFileSync(join(devInstructions, 'dev_file.md'), '# Dev Instructions')

      const paths: DeployPaths = {
        resourcesPath: join(ctx.tmpDir, 'nonexistent'), // would fail without override
        duetDataPath: ctx.duetDataDir,
        appVersion: '1.0.0',
        instructionsSourcePath: devInstructions
      }

      deployInstructions(paths)

      expect(existsSync(join(ctx.duetDataDir, 'ai-instructions', 'dev_file.md'))).toBe(true)
      expect(readFileSync(join(ctx.duetDataDir, 'ai-instructions', 'dev_file.md'), 'utf-8')).toBe(
        '# Dev Instructions'
      )
    })
  })

  // ===========================================================================
  // deployBackend
  // ===========================================================================

  describe('deployBackend', () => {
    it('copies backend to DuetData', () => {
      const { paths } = createDeployContext(ctx)

      deployBackend(paths)

      const dest = join(ctx.duetDataDir, 'backend')
      expect(existsSync(join(dest, 'main.py'))).toBe(true)
      expect(existsSync(join(dest, 'requirements.txt'))).toBe(true)
    })

    it('returns file count', () => {
      const { paths } = createDeployContext(ctx)

      const count = deployBackend(paths)

      expect(count).toBe(2) // main.py + requirements.txt
    })

    it('performs atomic swap (no .new or .old left)', () => {
      const { paths } = createDeployContext(ctx)

      deployBackend(paths)

      expect(existsSync(join(ctx.duetDataDir, 'backend.new'))).toBe(false)
      expect(existsSync(join(ctx.duetDataDir, 'backend.old'))).toBe(false)
      expect(existsSync(join(ctx.duetDataDir, 'backend'))).toBe(true)
    })

    it('replaces existing backend directory', () => {
      const { paths } = createDeployContext(ctx)

      // Create existing backend with old file
      const existingBackend = join(ctx.duetDataDir, 'backend')
      mkdirSync(existingBackend, { recursive: true })
      writeFileSync(join(existingBackend, 'old_file.py'), 'old')

      deployBackend(paths)

      // Old file should be gone, new files present
      expect(existsSync(join(existingBackend, 'old_file.py'))).toBe(false)
      expect(existsSync(join(existingBackend, 'main.py'))).toBe(true)
    })

    it('cleans up stale .new/.old from previous failed deploy', () => {
      const { paths } = createDeployContext(ctx)

      // Create stale directories
      mkdirSync(join(ctx.duetDataDir, 'backend.new'), { recursive: true })
      mkdirSync(join(ctx.duetDataDir, 'backend.old'), { recursive: true })

      deployBackend(paths)

      expect(existsSync(join(ctx.duetDataDir, 'backend.new'))).toBe(false)
      expect(existsSync(join(ctx.duetDataDir, 'backend.old'))).toBe(false)
    })

    it('throws when source not found', () => {
      const paths: DeployPaths = {
        resourcesPath: join(ctx.tmpDir, 'nonexistent'),
        duetDataPath: ctx.duetDataDir,
        appVersion: '1.0.0'
      }

      expect(() => deployBackend(paths)).toThrow('Backend source not found')
    })

    it('uses backendSourcePath override when provided', () => {
      const devBackend = join(ctx.tmpDir, 'dev-backend')
      mkdirSync(devBackend, { recursive: true })
      writeFileSync(join(devBackend, 'app.py'), 'print("dev")')

      const paths: DeployPaths = {
        resourcesPath: join(ctx.tmpDir, 'nonexistent'), // would fail without override
        duetDataPath: ctx.duetDataDir,
        appVersion: '1.0.0',
        backendSourcePath: devBackend
      }

      deployBackend(paths)

      expect(existsSync(join(ctx.duetDataDir, 'backend', 'app.py'))).toBe(true)
      expect(readFileSync(join(ctx.duetDataDir, 'backend', 'app.py'), 'utf-8')).toBe('print("dev")')
    })
  })

  // ===========================================================================
  // writeVersion
  // ===========================================================================

  describe('writeVersion', () => {
    it('writes VERSION file to backend directory', () => {
      const { paths } = createDeployContext(ctx)

      writeVersion(paths)

      const versionPath = join(ctx.duetDataDir, 'backend', 'VERSION')
      expect(existsSync(versionPath)).toBe(true)
      expect(readFileSync(versionPath, 'utf-8')).toBe('1.2.3')
    })

    it('creates backend directory if it does not exist', () => {
      const paths: DeployPaths = {
        resourcesPath: ctx.tmpDir,
        duetDataPath: ctx.duetDataDir,
        appVersion: '2.0.0'
      }

      writeVersion(paths)

      expect(existsSync(join(ctx.duetDataDir, 'backend', 'VERSION'))).toBe(true)
    })
  })

  // ===========================================================================
  // findPython
  // ===========================================================================

  describe('findPython', () => {
    it('returns python3 on Unix when Python 3.12 found', async () => {
      mockPythonFound('Python 3.12.0')
      const result = await findPython('darwin')
      expect(result).toBe('python3')
    })

    it('returns python on Windows when Python 3.12 found', async () => {
      mockPythonFound('Python 3.12.0')
      const result = await findPython('win32')
      expect(result).toBe('python')
    })

    it('returns python3 on Unix when Python 3.10 found (minimum)', async () => {
      mockPythonFound('Python 3.10.0')
      const result = await findPython('darwin')
      expect(result).toBe('python3')
    })

    it('returns null when Python too old', async () => {
      mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
        ;(callback as (err: Error | null, stdout: string, stderr: string) => void)(
          null,
          'Python 3.9.1',
          ''
        )
        return undefined as ReturnType<typeof execFile>
      })
      const result = await findPython('darwin')
      expect(result).toBeNull()
    })

    it('returns null when Python not installed', async () => {
      mockPythonNotFound()
      const result = await findPython('darwin')
      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // validatePython
  // ===========================================================================

  describe('validatePython', () => {
    it('returns found for valid Python 3.12', async () => {
      mockPythonFound('Python 3.12.4')
      const result = await validatePython('/usr/bin/python3')
      expect(result).toEqual({ state: 'found', path: '/usr/bin/python3', version: '3.12.4' })
    })

    it('returns found for minimum Python 3.10', async () => {
      mockPythonFound('Python 3.10.0')
      const result = await validatePython('/usr/bin/python3')
      expect(result).toEqual({ state: 'found', path: '/usr/bin/python3', version: '3.10.0' })
    })

    it('returns invalid for Python too old', async () => {
      mockPythonFound('Python 3.9.1')
      const result = await validatePython('/usr/bin/python3')
      expect(result.state).toBe('invalid')
      expect(result).toHaveProperty('error')
    })

    it('returns invalid when file not found', async () => {
      mockPythonNotFound()
      const result = await validatePython('/nonexistent/python3')
      expect(result.state).toBe('invalid')
      expect(result).toHaveProperty('path', '/nonexistent/python3')
    })

    it('returns found for Python 4.x (future-proof)', async () => {
      mockPythonFound('Python 4.0.0')
      const result = await validatePython('/usr/bin/python4')
      expect(result.state).toBe('found')
    })
  })

  // ===========================================================================
  // venvPythonPath
  // ===========================================================================

  describe('venvPythonPath', () => {
    it('returns bin/python3 on macOS', () => {
      expect(venvPythonPath('/tmp/venv', 'darwin')).toBe(join('/tmp/venv', 'bin', 'python3'))
    })

    it('returns bin/python3 on Linux', () => {
      expect(venvPythonPath('/tmp/venv', 'linux')).toBe(join('/tmp/venv', 'bin', 'python3'))
    })

    it('returns Scripts/python.exe on Windows', () => {
      expect(venvPythonPath('/tmp/venv', 'win32')).toBe(join('/tmp/venv', 'Scripts', 'python.exe'))
    })
  })

  // ===========================================================================
  // pythonInstallHint
  // ===========================================================================

  describe('pythonInstallHint', () => {
    it('returns brew hint on macOS', () => {
      expect(pythonInstallHint('darwin')).toBe('brew install python@3.12')
    })

    it('returns python.org hint on Windows', () => {
      expect(pythonInstallHint('win32')).toBe('Скачайте с python.org')
    })

    it('returns package manager hint on Linux', () => {
      expect(pythonInstallHint('linux')).toContain('apt/dnf')
    })
  })

  // ===========================================================================
  // runDeploy
  // ===========================================================================

  describe('runDeploy', () => {
    const TEST_PORT = 19680

    beforeEach(() => {
      // Mock fetch for stopBackend (no backend running in tests)
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('deploys everything with given pythonCmd', async () => {
      const { paths } = createDeployContext(ctx)
      const log = vi.fn()
      mockPythonFound()

      await runDeploy(paths, TEST_PORT, 'python3', log, noSleep)

      // AI instructions deployed
      expect(existsSync(join(ctx.duetDataDir, 'ai-instructions', 'core_instructions.md'))).toBe(
        true
      )

      // Backend deployed
      expect(existsSync(join(ctx.duetDataDir, 'backend', 'main.py'))).toBe(true)

      // VERSION written (full success)
      expect(readFileSync(join(ctx.duetDataDir, 'backend', 'VERSION'), 'utf-8')).toBe('1.2.3')
    })

    it('logs deploy progress', async () => {
      const { paths } = createDeployContext(ctx)
      const log = vi.fn()
      mockPythonFound()

      await runDeploy(paths, TEST_PORT, 'python3', log, noSleep)

      expect(log).toHaveBeenCalledWith('Деплой v1.2.3...')
      expect(log).toHaveBeenCalledWith(expect.stringContaining('завершён'))
    })

    it('logs pythonCmd used', async () => {
      const { paths } = createDeployContext(ctx)
      const log = vi.fn()
      mockPythonFound()

      await runDeploy(paths, TEST_PORT, '/opt/homebrew/bin/python3', log, noSleep)

      expect(log).toHaveBeenCalledWith('Python: /opt/homebrew/bin/python3')
    })

    it('calls stopBackend before deploying files', async () => {
      const { paths } = createDeployContext(ctx)
      const log = vi.fn()
      mockPythonFound()

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      await runDeploy(paths, TEST_PORT, 'python3', log, noSleep)

      // stopBackend was called (fetch was invoked)
      expect(mockFetch).toHaveBeenCalledWith(
        `http://127.0.0.1:${TEST_PORT}/stop`,
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})
