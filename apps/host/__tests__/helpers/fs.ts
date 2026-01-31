/*
 * ЧТО: Хелперы для работы с файловой системой в тестах.
 * ЗАЧЕМ: Изоляция тестов через tmp директории.
 * КТО ИСПОЛЬЗУЕТ: Unit и integration тесты.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export interface TestContext {
  /** Корневая tmp директория теста */
  tmpDir: string
  /** Путь к config директории (эмулирует ~/.org.ve68.duet) */
  configDir: string
  /** Путь к DuetData директории */
  duetDataDir: string
  /** Очистка после теста */
  cleanup: () => void
}

/**
 * Создаёт изолированный контекст для теста.
 * Устанавливает DUET_CONFIG_DIR для переопределения пути к конфигу.
 */
export const createTestContext = (): TestContext => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'duet-test-'))
  const configDir = join(tmpDir, 'config')
  const duetDataDir = join(tmpDir, 'DuetData')

  // Создаём директории
  mkdirSync(configDir, { recursive: true })
  mkdirSync(duetDataDir, { recursive: true })

  // Устанавливаем env для core/config.ts
  process.env.DUET_CONFIG_DIR = configDir

  const cleanup = (): void => {
    delete process.env.DUET_CONFIG_DIR
    rmSync(tmpDir, { recursive: true, force: true })
  }

  return { tmpDir, configDir, duetDataDir, cleanup }
}

/**
 * Записывает config.json в configDir.
 */
export const writeTestConfig = (configDir: string, config: Record<string, unknown>): void => {
  writeFileSync(join(configDir, 'config.json'), JSON.stringify(config, null, 2))
}
