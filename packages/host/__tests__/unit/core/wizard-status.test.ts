/*
 * Unit тесты для src/core/wizard-status.ts
 */
import { describe, it, expect } from 'vitest'
import {
  computePageStatuses,
  maxSeverity,
  pageStatusToSeverity,
  processStateToSeverity,
  getSettingsSeverity,
  type PageStatusInput
} from '../../../src/core/wizard-status'
import type { AppState, AgentInfo } from '../../../src/shared/types'

// =============================================================================
// HELPERS
// =============================================================================

const baseAppState: AppState = {
  status: 'ready',
  duetDataPath: '/data',
  duetConfigPath: '/config',
  machine: 'test',
  pathExists: true,
  deployChannel: 'prod',
  pythonPath: '/usr/bin/python3',
  instructionsPath: '/instructions',
  hasDevBackendPath: false
}

const baseInput: PageStatusInput = {
  appState: baseAppState,
  deployStatus: { state: 'up_to_date', version: '1.0.0' },
  cachedScan: null,
  cachedInstructionsErrors: null,
  agents: null
}

function makeAgent(id: string, status: 'configured' | 'needs_setup' | 'not_found'): AgentInfo {
  return { id, name: id, status, details: '' }
}

// =============================================================================
// TESTS
// =============================================================================

describe('core/wizard-status', () => {
  describe('computePageStatuses', () => {
    it('marks pages 1-3 as ok when all configured and deployed', () => {
      const s = computePageStatuses(baseInput)
      expect(s['duet-paths']).toBe('ok')
      expect(s['python']).toBe('ok')
      expect(s['backend']).toBe('ok')
    })

    it('marks duet-paths as null when duetDataPath missing', () => {
      const s = computePageStatuses({
        ...baseInput,
        appState: { ...baseAppState, duetDataPath: null }
      })
      expect(s['duet-paths']).toBeNull()
    })

    it('marks duet-paths as null when machine missing', () => {
      const s = computePageStatuses({
        ...baseInput,
        appState: { ...baseAppState, machine: null }
      })
      expect(s['duet-paths']).toBeNull()
    })

    it('marks duet-paths as null when duetConfigPath missing', () => {
      const s = computePageStatuses({
        ...baseInput,
        appState: { ...baseAppState, duetConfigPath: null }
      })
      expect(s['duet-paths']).toBeNull()
    })

    it('marks python as null when pythonPath missing', () => {
      const s = computePageStatuses({
        ...baseInput,
        appState: { ...baseAppState, pythonPath: null }
      })
      expect(s['python']).toBeNull()
    })

    it('marks backend as null when not deployed', () => {
      const s = computePageStatuses({
        ...baseInput,
        deployStatus: { state: 'idle' }
      })
      expect(s['backend']).toBeNull()
    })

    it('marks backend as warning when deployed with deploy warning', () => {
      const s = computePageStatuses({
        ...baseInput,
        deployStatus: { state: 'deployed', version: '1.0.0' },
        hasDeployWarning: true
      })
      expect(s['backend']).toBe('warning')
    })

    it('marks backend as ok for deployed state', () => {
      const s = computePageStatuses({
        ...baseInput,
        deployStatus: { state: 'deployed', version: '1.0.0' }
      })
      expect(s['backend']).toBe('ok')
    })

    it('marks business-folders as ok when scan has no errors', () => {
      const s = computePageStatuses({
        ...baseInput,
        cachedScan: { status: 'ok', entities_count: 5, errors: [] }
      })
      expect(s['workspaces']).toBe('ok')
    })

    it('marks business-folders as warning when scan has only collisions', () => {
      const s = computePageStatuses({
        ...baseInput,
        cachedScan: {
          status: 'ok',
          entities_count: 3,
          errors: [{ path: '/foo', reason_code: 'name_collision', description: 'collision' }]
        }
      })
      expect(s['workspaces']).toBe('warning')
    })

    it('marks business-folders as error when scan has real errors', () => {
      const s = computePageStatuses({
        ...baseInput,
        cachedScan: {
          status: 'ok',
          entities_count: 3,
          errors: [{ path: '/foo', reason_code: 'invalid_manifest', description: 'broken' }]
        }
      })
      expect(s['workspaces']).toBe('error')
    })

    it('leaves business-folders undefined when no scan performed', () => {
      const s = computePageStatuses(baseInput)
      expect(s['workspaces']).toBeUndefined()
    })

    it('marks instructions as ok when no instruction errors', () => {
      const s = computePageStatuses({
        ...baseInput,
        cachedInstructionsErrors: []
      })
      expect(s['instructions']).toBe('ok')
    })

    it('marks instructions as error when instruction errors exist', () => {
      const s = computePageStatuses({
        ...baseInput,
        cachedInstructionsErrors: [
          { path: 'test.md', reason_code: 'invalid_yaml', description: 'bad yaml' }
        ]
      })
      expect(s['instructions']).toBe('error')
    })

    it('marks agents as ok when all found agents configured', () => {
      const s = computePageStatuses({
        ...baseInput,
        agents: [
          makeAgent('claude', 'configured'),
          makeAgent('codex', 'configured'),
          makeAgent('antigravity', 'not_found')
        ]
      })
      expect(s['agents']).toBe('ok')
    })

    it('marks agents as warning when any found agent needs setup', () => {
      const s = computePageStatuses({
        ...baseInput,
        agents: [makeAgent('claude', 'configured'), makeAgent('codex', 'needs_setup')]
      })
      expect(s['agents']).toBe('warning')
    })

    it('marks agents as skipped when no agents found at all', () => {
      const s = computePageStatuses({
        ...baseInput,
        agents: [makeAgent('claude', 'not_found'), makeAgent('codex', 'not_found')]
      })
      expect(s['agents']).toBe('skipped')
    })
  })

  describe('maxSeverity', () => {
    it('returns null for empty array', () => {
      expect(maxSeverity([])).toBeNull()
    })

    it('returns null when all null/undefined', () => {
      expect(maxSeverity([null, undefined, null])).toBeNull()
    })

    it('returns warning when only warnings', () => {
      expect(maxSeverity([null, 'warning', null])).toBe('warning')
    })

    it('returns error when only errors', () => {
      expect(maxSeverity([null, 'error'])).toBe('error')
    })

    it('returns error when mixed (error > warning)', () => {
      expect(maxSeverity(['warning', 'error', null])).toBe('error')
    })
  })

  describe('pageStatusToSeverity', () => {
    it('maps error → error', () => {
      expect(pageStatusToSeverity('error')).toBe('error')
    })

    it('maps warning → warning', () => {
      expect(pageStatusToSeverity('warning')).toBe('warning')
    })

    it('maps ok → null', () => {
      expect(pageStatusToSeverity('ok')).toBeNull()
    })

    it('maps skipped → null', () => {
      expect(pageStatusToSeverity('skipped')).toBeNull()
    })

    it('maps null → error (not configured = blocks user)', () => {
      expect(pageStatusToSeverity(null)).toBe('error')
    })
  })

  describe('processStateToSeverity', () => {
    it('maps error → error', () => {
      expect(processStateToSeverity('error')).toBe('error')
    })

    it('maps running → null', () => {
      expect(processStateToSeverity('running')).toBeNull()
    })

    it('maps stopped → null', () => {
      expect(processStateToSeverity('stopped')).toBeNull()
    })

    it('maps starting → null', () => {
      expect(processStateToSeverity('starting')).toBeNull()
    })

    it('maps stopping → null', () => {
      expect(processStateToSeverity('stopping')).toBeNull()
    })
  })

  describe('getSettingsSeverity', () => {
    const allOk = {
      'duet-paths': 'ok' as const,
      python: 'ok' as const,
      backend: 'ok' as const,
      'workspaces': 'ok' as const,
      instructions: 'ok' as const,
      agents: 'ok' as const
    }

    it('returns null when all pages ok', () => {
      expect(getSettingsSeverity(allOk)).toBeNull()
    })

    it('returns error when any page has error', () => {
      expect(
        getSettingsSeverity({ ...allOk, 'workspaces': 'error' })
      ).toBe('error')
    })

    it('returns warning when page has warning but no errors', () => {
      expect(
        getSettingsSeverity({ ...allOk, agents: 'warning' })
      ).toBe('warning')
    })

    it('returns error when mixed error and warning', () => {
      expect(
        getSettingsSeverity({ ...allOk, agents: 'warning', 'workspaces': 'error' })
      ).toBe('error')
    })

    it('returns error for null status (not configured = error severity)', () => {
      expect(getSettingsSeverity({ ...allOk, 'duet-paths': null })).toBe('error')
    })

    it('returns error for missing pages (undefined = error severity)', () => {
      expect(getSettingsSeverity({})).toBe('error')
    })

    it('returns null for all skipped pages', () => {
      expect(getSettingsSeverity({
        ...allOk,
        agents: 'skipped',
      })).toBeNull()
    })

    it('returns error when some pages missing from partial statuses', () => {
      // Only 1 of 6 pages present — missing 5 are undefined → error
      expect(getSettingsSeverity({ 'duet-paths': 'ok' })).toBe('error')
    })
  })
})
