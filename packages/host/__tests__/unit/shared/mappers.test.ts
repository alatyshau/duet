/*
 * Unit тесты для src/shared/mappers.ts
 */
import { describe, it, expect } from 'vitest'
import { backendStatusToProcessStatus } from '../../../src/shared/mappers'
import type { BackendStatus } from '../../../src/shared/types'

describe('shared/mappers', () => {
  describe('backendStatusToProcessStatus', () => {
    it('maps stopped', () => {
      const result = backendStatusToProcessStatus({ state: 'stopped' })
      expect(result).toEqual({ state: 'stopped' })
    })

    it('maps starting with message', () => {
      const input: BackendStatus = { state: 'starting', message: 'Запуск...' }
      const result = backendStatusToProcessStatus(input)
      expect(result).toEqual({ state: 'starting', message: 'Запуск...' })
    })

    it('maps running with version and uptime', () => {
      const input: BackendStatus = { state: 'running', version: '0.1.3', uptime: 8100 }
      const result = backendStatusToProcessStatus(input)
      expect(result).toEqual({ state: 'running', version: '0.1.3', uptime: 8100 })
    })

    it('maps stopping', () => {
      const result = backendStatusToProcessStatus({ state: 'stopping' })
      expect(result).toEqual({ state: 'stopping', message: 'Остановка...' })
    })

    it('maps error with message', () => {
      const input: BackendStatus = { state: 'error', error: 'Connection refused' }
      const result = backendStatusToProcessStatus(input)
      expect(result).toEqual({ state: 'error', error: 'Connection refused' })
    })
  })
})
