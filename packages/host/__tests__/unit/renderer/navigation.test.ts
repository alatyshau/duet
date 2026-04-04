/*
 * Unit-тесты для renderer/src/navigation.ts — типизированный роутинг.
 */
import { describe, it, expect } from 'vitest'
import {
  WIZARD_STEPS,
  APP_ITEMS,
  DEFAULT_PAGE,
  tabForPage,
  isStepAvailable,
  getMissingDeps,
  type WizardPage,
  type AppPage
} from '../../../src/renderer/src/navigation'
import type { PageStatus } from '../../../src/core/wizard-status'

describe('navigation', () => {
  // =========================================================================
  // tabForPage
  // =========================================================================

  describe('tabForPage', () => {
    it('returns "settings" for wizard pages', () => {
      const wizardPages: WizardPage[] = [
        'duet-data',
        'duet-config',
        'python',
        'backend',
        'business-folders',
        'instructions',
        'agents'
      ]
      for (const page of wizardPages) {
        expect(tabForPage(page)).toBe('settings')
      }
    })

    it('returns "apps" for app pages', () => {
      const appPages: AppPage[] = ['app:duet-backend']
      for (const page of appPages) {
        expect(tabForPage(page)).toBe('apps')
      }
    })
  })

  // =========================================================================
  // WIZARD_STEPS
  // =========================================================================

  describe('WIZARD_STEPS', () => {
    it('has 7 steps', () => {
      expect(WIZARD_STEPS).toHaveLength(7)
    })

    it('has correct order', () => {
      const pages = WIZARD_STEPS.map((s) => s.page)
      expect(pages).toEqual([
        'duet-data',
        'duet-config',
        'python',
        'backend',
        'business-folders',
        'instructions',
        'agents'
      ])
    })

    it('first 3 steps have no dependencies', () => {
      for (const step of WIZARD_STEPS.slice(0, 3)) {
        expect(step.dependsOn).toEqual([])
      }
    })

    it('dependsOn references only earlier steps', () => {
      const pages = WIZARD_STEPS.map((s) => s.page)
      for (const step of WIZARD_STEPS) {
        for (const dep of step.dependsOn) {
          const depIndex = pages.indexOf(dep)
          const stepIndex = pages.indexOf(step.page)
          expect(depIndex).toBeGreaterThanOrEqual(0)
          expect(depIndex).toBeLessThan(stepIndex)
        }
      }
    })

    it('every step has a non-empty label', () => {
      for (const step of WIZARD_STEPS) {
        expect(step.label.length).toBeGreaterThan(0)
      }
    })
  })

  // =========================================================================
  // APP_ITEMS
  // =========================================================================

  describe('APP_ITEMS', () => {
    it('has at least one item', () => {
      expect(APP_ITEMS.length).toBeGreaterThanOrEqual(1)
    })

    it('all items have app: prefix', () => {
      for (const item of APP_ITEMS) {
        expect(item.page).toMatch(/^app:/)
      }
    })
  })

  // =========================================================================
  // DEFAULT_PAGE
  // =========================================================================

  describe('DEFAULT_PAGE', () => {
    it('is the first wizard step', () => {
      expect(DEFAULT_PAGE).toBe(WIZARD_STEPS[0].page)
    })
  })

  // =========================================================================
  // isStepAvailable
  // =========================================================================

  describe('isStepAvailable', () => {
    const allOk: Partial<Record<WizardPage, PageStatus>> = {
      'duet-data': 'ok',
      'duet-config': 'ok',
      python: 'ok',
      backend: 'ok',
      'business-folders': 'ok',
      instructions: 'ok',
      agents: 'ok'
    }

    it('returns true for steps with no dependencies', () => {
      expect(isStepAvailable('duet-data', {})).toBe(true)
      expect(isStepAvailable('duet-config', {})).toBe(true)
      expect(isStepAvailable('python', {})).toBe(true)
    })

    it('returns true when all dependencies are ok', () => {
      expect(isStepAvailable('backend', allOk)).toBe(true)
      expect(isStepAvailable('business-folders', allOk)).toBe(true)
      expect(isStepAvailable('instructions', allOk)).toBe(true)
      expect(isStepAvailable('agents', allOk)).toBe(true)
    })

    it('returns false when a dependency is missing', () => {
      expect(isStepAvailable('backend', { 'duet-data': 'ok' })).toBe(false) // missing python
      expect(isStepAvailable('backend', { python: 'ok' })).toBe(false) // missing duet-data
    })

    it('returns false when a dependency has error status', () => {
      expect(
        isStepAvailable('agents', { backend: 'ok', instructions: 'error' })
      ).toBe(false)
    })

    it('returns false when a dependency is null', () => {
      expect(
        isStepAvailable('agents', { backend: 'ok', instructions: null })
      ).toBe(false)
    })
  })

  // =========================================================================
  // getMissingDeps
  // =========================================================================

  describe('getMissingDeps', () => {
    it('returns empty for steps with no dependencies', () => {
      expect(getMissingDeps('duet-data', {})).toEqual([])
    })

    it('returns empty when all dependencies are ok', () => {
      expect(
        getMissingDeps('backend', { 'duet-data': 'ok', python: 'ok' })
      ).toEqual([])
    })

    it('returns labels of missing dependencies', () => {
      const missing = getMissingDeps('business-folders', {
        'duet-data': 'ok',
        'duet-config': null,
        backend: null
      })
      expect(missing).toContain('DuetConfig + машина')
      expect(missing).toContain('Backend')
      expect(missing).not.toContain('DuetData')
    })
  })
})
