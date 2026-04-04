/*
 * Unit тесты для src/core/wizard-status.ts
 */
import { describe, it, expect } from 'vitest'
import {
  computeStepStatuses,
  hasWizardWarning,
  type WizardStatusInput
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

const baseInput: WizardStatusInput = {
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
  describe('computeStepStatuses', () => {
    it('marks steps 1-4 as done when all configured and deployed', () => {
      const s = computeStepStatuses(baseInput)
      expect(s['duet-data']).toBe('done')
      expect(s['duet-config']).toBe('done')
      expect(s['python']).toBe('done')
      expect(s['backend']).toBe('done')
    })

    it('marks step 1 as null when duetDataPath missing', () => {
      const s = computeStepStatuses({
        ...baseInput,
        appState: { ...baseAppState, duetDataPath: null }
      })
      expect(s['duet-data']).toBeNull()
    })

    it('marks step 2 as null when machine missing', () => {
      const s = computeStepStatuses({
        ...baseInput,
        appState: { ...baseAppState, machine: null }
      })
      expect(s['duet-config']).toBeNull()
    })

    it('marks step 2 as null when duetConfigPath missing', () => {
      const s = computeStepStatuses({
        ...baseInput,
        appState: { ...baseAppState, duetConfigPath: null }
      })
      expect(s['duet-config']).toBeNull()
    })

    it('marks step 3 as null when pythonPath missing', () => {
      const s = computeStepStatuses({
        ...baseInput,
        appState: { ...baseAppState, pythonPath: null }
      })
      expect(s['python']).toBeNull()
    })

    it('marks step 4 as null when not deployed', () => {
      const s = computeStepStatuses({
        ...baseInput,
        deployStatus: { state: 'idle' }
      })
      expect(s['backend']).toBeNull()
    })

    it('marks step 4 as done for deployed state', () => {
      const s = computeStepStatuses({
        ...baseInput,
        deployStatus: { state: 'deployed', version: '1.0.0' }
      })
      expect(s['backend']).toBe('done')
    })

    it('marks step 5 as done when scan has no errors', () => {
      const s = computeStepStatuses({
        ...baseInput,
        cachedScan: { status: 'ok', entities_count: 5, errors: [] }
      })
      expect(s['business-folders']).toBe('done')
    })

    it('marks step 5 as error when scan has errors', () => {
      const s = computeStepStatuses({
        ...baseInput,
        cachedScan: {
          status: 'ok',
          entities_count: 3,
          errors: [{ path: '/foo', reason_code: 'name_collision', description: 'collision' }]
        }
      })
      expect(s['business-folders']).toBe('error')
    })

    it('leaves step 5 undefined when no scan performed', () => {
      const s = computeStepStatuses(baseInput)
      expect(s['business-folders']).toBeUndefined()
    })

    it('marks step 6 as done when no instruction errors', () => {
      const s = computeStepStatuses({
        ...baseInput,
        cachedInstructionsErrors: []
      })
      expect(s['instructions']).toBe('done')
    })

    it('marks step 6 as error when instruction errors exist', () => {
      const s = computeStepStatuses({
        ...baseInput,
        cachedInstructionsErrors: [
          { path: 'test.md', reason_code: 'invalid_yaml', description: 'bad yaml' }
        ]
      })
      expect(s['instructions']).toBe('error')
    })

    it('marks step 7 as done when all found agents configured', () => {
      const s = computeStepStatuses({
        ...baseInput,
        agents: [
          makeAgent('claude', 'configured'),
          makeAgent('codex', 'configured'),
          makeAgent('antigravity', 'not_found')
        ]
      })
      expect(s['agents']).toBe('done')
    })

    it('marks step 7 as error when any found agent needs setup', () => {
      const s = computeStepStatuses({
        ...baseInput,
        agents: [makeAgent('claude', 'configured'), makeAgent('codex', 'needs_setup')]
      })
      expect(s['agents']).toBe('error')
    })

    it('marks step 7 as done when no agents found at all', () => {
      const s = computeStepStatuses({
        ...baseInput,
        agents: [makeAgent('claude', 'not_found'), makeAgent('codex', 'not_found')]
      })
      expect(s['agents']).toBe('done')
    })
  })

  describe('hasWizardWarning', () => {
    it('returns false when no errors', () => {
      expect(hasWizardWarning({ 'duet-data': 'done', 'duet-config': 'done' })).toBe(false)
    })

    it('returns true when any step has error', () => {
      expect(hasWizardWarning({ 'duet-data': 'done', 'business-folders': 'error' })).toBe(true)
    })

    it('returns false for skipped steps', () => {
      expect(hasWizardWarning({ agents: 'skipped' })).toBe(false)
    })

    it('returns false for empty statuses', () => {
      expect(hasWizardWarning({})).toBe(false)
    })
  })
})
