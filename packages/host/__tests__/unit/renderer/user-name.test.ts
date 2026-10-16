import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DuetPathsPage } from '../../../src/renderer/src/pages/wizard/DuetPathsPage'
import { createInitialState } from '../../../src/core/app-state'

// Render the real page and controls without mounting Electron or touching live config.
describe('user name in Duet paths', () => {
  it('renders the default after Machine and before root contexts', () => {
    const html = renderToStaticMarkup(
      createElement(DuetPathsPage, { appState: createInitialState(), onStatusChange: () => {} })
    )
    expect(html).toContain('value="Human"')
    expect(html.indexOf('Машина')).toBeLessThan(html.indexOf('Пользователь'))
    expect(html.indexOf('Пользователь')).toBeLessThan(html.indexOf('Корневые контексты'))
    expect(html).toMatch(/id="duet-user-name"[^>]*disabled=""/)
  })

  it('shows the stored-value error so the person can repair it (UN1)', () => {
    const html = renderToStaticMarkup(
      createElement(DuetPathsPage, {
        appState: {
          ...createInitialState(),
          duetDataPath: '/data',
          duetConfigPath: '/config',
          machine: 'test',
          userName: 'Human',
          userNameError: 'User name must be a string.'
        },
        onStatusChange: () => {}
      })
    )
    expect(html).toMatch(/id="duet-user-name"[^>]*aria-invalid="true"/)
    expect(html).toContain('Имя в settings.json недопустимо: User name must be a string.')
  })

  it('renders a configured name as an enabled, labelled input', () => {
    const html = renderToStaticMarkup(
      createElement(DuetPathsPage, {
        appState: {
          ...createInitialState(),
          duetDataPath: '/data',
          duetConfigPath: '/config',
          machine: 'test',
          userName: 'Andrei'
        },
        onStatusChange: () => {}
      })
    )
    expect(html).toContain('for="duet-user-name"')
    const input = html.match(/<input id="duet-user-name"[^>]*>/)?.[0]
    expect(input).toContain('value="Andrei"')
    expect(input).not.toContain('disabled')
  })
})
