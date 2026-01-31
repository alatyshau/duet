/*
 * Unit тест: config + app-state flow
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeConfig, readConfig } from '../../../src/core/config'
import { checkAppState } from '../../../src/core/app-state'
import { createTestContext, type TestContext } from '../../helpers'
import { rmSync } from 'fs'

describe('core flow: config → app-state', () => {
  let ctx: TestContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('full lifecycle: no_config → ready → path_lost', () => {
    // 1. Начало: нет конфига
    let state = checkAppState()
    expect(state.status).toBe('no_config')

    // 2. Пользователь выбирает папку
    writeConfig({ duetDataPath: ctx.duetDataDir })

    // 3. Проверяем что конфиг записан
    const config = readConfig()
    expect(config.duetDataPath).toBe(ctx.duetDataDir)

    // 4. Состояние должно быть ready
    state = checkAppState()
    expect(state.status).toBe('ready')
    expect(state.duetDataPath).toBe(ctx.duetDataDir)
    expect(state.pathExists).toBe(true)

    // 5. Папка удалена (симуляция отключения диска)
    rmSync(ctx.duetDataDir, { recursive: true })

    // 6. Состояние должно быть path_lost
    state = checkAppState()
    expect(state.status).toBe('path_lost')
    expect(state.duetDataPath).toBe(ctx.duetDataDir)
    expect(state.pathExists).toBe(false)
  })

  it('changing duetDataPath updates state correctly', () => {
    // Первая папка
    writeConfig({ duetDataPath: ctx.duetDataDir })
    let state = checkAppState()
    expect(state.status).toBe('ready')

    // Меняем на несуществующую
    writeConfig({ duetDataPath: '/does/not/exist' })
    state = checkAppState()
    expect(state.status).toBe('path_lost')

    // Возвращаем обратно
    writeConfig({ duetDataPath: ctx.duetDataDir })
    state = checkAppState()
    expect(state.status).toBe('ready')
  })
})
