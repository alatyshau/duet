/*
 * ЧТО: E2E тест запуска приложения.
 * ЗАЧЕМ: Проверить что Electron приложение запускается и renderer работает.
 * КТО ИСПОЛЬЗУЕТ: npm run test:e2e
 *
 * ТРЕБОВАНИЯ:
 * - Перед запуском нужно собрать приложение: npm run build (или electron-vite build)
 * - Тест использует WebdriverIO с wdio-electron-service
 */
import { browser } from '@wdio/globals'

describe('App Launch', () => {
  it('should start and create a window', async () => {
    // WebdriverIO автоматически запускает Electron
    // Проверяем что окно существует
    const windowHandles = await browser.getWindowHandles()
    expect(windowHandles.length).toBeGreaterThan(0)
  })

  it('should load renderer content', async () => {
    // Ждём загрузки React (root элемент должен иметь контент)
    const root = await $('#root')
    await root.waitForExist({ timeout: 10000 })

    // Проверяем что React отрендерил контент
    const html = await root.getHTML()
    expect(html.length).toBeGreaterThan(10)
  })

  it('should have correct window title', async () => {
    const title = await browser.getTitle()
    expect(title).toBe('Duet')
  })

  it('should show setup page on first run', async () => {
    // На первом запуске (без конфига) должна показаться SetupPage
    // Ждём загрузки
    const root = await $('#root')
    await root.waitForExist({ timeout: 10000 })

    // Проверяем наличие характерных элементов SetupPage
    const pageSource = await browser.getPageSource()
    const hasSetupContent =
      pageSource.includes('DuetData') ||
      pageSource.includes('Выберите') ||
      pageSource.includes('папку')
    expect(hasSetupContent).toBe(true)
  })
})

describe('Window Behavior', () => {
  it('should have correct viewport size', async () => {
    // Проверяем что окно имеет разумные размеры
    const windowSize = await browser.getWindowSize()
    expect(windowSize.width).toBeGreaterThan(100)
    expect(windowSize.height).toBeGreaterThan(100)
  })

  it('should be able to interact with page', async () => {
    // Проверяем что страница интерактивна
    const body = await $('body')
    const isDisplayed = await body.isDisplayed()
    expect(isDisplayed).toBe(true)
  })
})
