/*
 * Unit-тесты для renderer/src/navigation.ts — типизированный роутинг.
 */
import { describe, it, expect } from 'vitest'
import {
  WIZARD_STEPS,
  APP_ITEMS,
  DEFAULT_PAGE,
  tabForPage,
  type WizardPage,
  type AppPage
} from '../../../src/renderer/src/navigation'

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
})
