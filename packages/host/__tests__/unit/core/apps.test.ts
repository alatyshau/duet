/*
 * Unit тесты для src/core/apps.ts
 */
import { describe, it, expect } from 'vitest'
import { BUILTIN_APPS } from '../../../src/core/apps'

describe('core/apps', () => {
  it('has exactly one builtin app', () => {
    expect(BUILTIN_APPS).toHaveLength(1)
  })

  it('duet-backend has correct shape', () => {
    const app = BUILTIN_APPS[0]
    expect(app.id).toBe('duet-backend')
    expect(app.name).toBe('Duet Backend')
    expect(app.builtin).toBe(true)
    expect(app.processes).toHaveLength(1)
  })

  it('duet-backend process is http on port 19680', () => {
    const proc = BUILTIN_APPS[0].processes[0]
    expect(proc.id).toBe('http')
    expect(proc.type).toBe('http')
    expect(proc.port).toBe(19680)
  })
})
