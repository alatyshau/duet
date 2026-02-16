/*
 * Unit тесты для src/core/backend.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createTestContext, type TestContext } from '../../helpers'

import {
  checkHealth,
  waitForHealth,
  getBackendStatus,
  isProcessAlive
} from '../../../src/core/backend'

// =============================================================================
// TESTS
// =============================================================================

describe('core/backend', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
    vi.clearAllMocks()
  })

  afterEach(() => {
    ctx.cleanup()
    vi.unstubAllGlobals()
  })

  // ===========================================================================
  // checkHealth
  // ===========================================================================

  describe('checkHealth', () => {
    it('returns health data when backend responds', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'ok', version: '1.0.0', uptime_seconds: 42 })
      })
      vi.stubGlobal('fetch', mockFetch)

      const result = await checkHealth(19680)

      expect(result).toEqual({ status: 'ok', version: '1.0.0', uptime_seconds: 42 })
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:19680/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    })

    it('returns null when fetch fails (backend not running)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const result = await checkHealth(19680)

      expect(result).toBeNull()
    })

    it('returns null when response is not ok', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

      const result = await checkHealth(19680)

      expect(result).toBeNull()
    })

    it('uses correct port in URL', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
      vi.stubGlobal('fetch', mockFetch)

      await checkHealth(12345)

      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:12345/health', expect.anything())
    })
  })

  // ===========================================================================
  // waitForHealth
  // ===========================================================================

  describe('waitForHealth', () => {
    it('returns health on first successful check', async () => {
      const healthData = { status: 'ok' as const, version: '1.0.0', uptime_seconds: 1 }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(healthData)
        })
      )

      const result = await waitForHealth(19680, 3, 0)

      expect(result).toEqual(healthData)
    })

    it('retries until health succeeds', async () => {
      const healthData = { status: 'ok' as const, version: '1.0.0', uptime_seconds: 1 }
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(healthData)
        })
      vi.stubGlobal('fetch', mockFetch)

      const result = await waitForHealth(19680, 5, 0)

      expect(result).toEqual(healthData)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('returns null after all retries exhausted', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const result = await waitForHealth(19680, 3, 0)

      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // getBackendStatus
  // ===========================================================================

  describe('getBackendStatus', () => {
    it('returns stopped when VERSION file does not exist', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const result = await getBackendStatus(ctx.duetDataDir, 19680)

      expect(result).toEqual({ state: 'stopped' })
    })

    it('returns running when health check succeeds', async () => {
      // Create VERSION file
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '1.0.0')

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({ status: 'ok', version: '1.0.0', uptime_seconds: 100 })
        })
      )

      const result = await getBackendStatus(ctx.duetDataDir, 19680)

      expect(result).toEqual({ state: 'running', version: '1.0.0', uptime: 100 })
    })

    it('returns stopped when VERSION exists but health fails', async () => {
      // Create VERSION file
      const backendDir = join(ctx.duetDataDir, 'backend')
      mkdirSync(backendDir, { recursive: true })
      writeFileSync(join(backendDir, 'VERSION'), '1.0.0')

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

      const result = await getBackendStatus(ctx.duetDataDir, 19680)

      expect(result).toEqual({ state: 'stopped' })
    })
  })

  // ===========================================================================
  // isProcessAlive
  // ===========================================================================

  describe('isProcessAlive', () => {
    it('returns true for current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true)
    })

    it('returns false for non-existent process', () => {
      expect(isProcessAlive(999999999)).toBe(false)
    })
  })
})
