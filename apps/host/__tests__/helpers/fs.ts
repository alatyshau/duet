/*
 * ЧТО: Хелперы для работы с файловой системой в тестах.
 * ЗАЧЕМ: Изоляция тестов через tmp директории.
 * КТО ИСПОЛЬЗУЕТ: Unit и integration тесты.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export interface TestContext {
  /** Корневая tmp директория теста */
  tmpDir: string
  /** Путь к config файлу (эмулирует ~/.org.ve68.duet) */
  configFile: string
  /** Путь к DuetData директории */
  duetDataDir: string
  /** Очистка после теста */
  cleanup: () => void
}

/**
 * Создаёт изолированный контекст для теста.
 * Устанавливает DUET_CONFIG_FILE для переопределения пути к конфигу.
 */
export const createTestContext = (): TestContext => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'duet-test-'))
  const configFile = join(tmpDir, '.org.ve68.duet')
  const duetDataDir = join(tmpDir, 'DuetData')

  // Создаём директорию DuetData
  mkdirSync(duetDataDir, { recursive: true })

  // Устанавливаем env для core/config.ts
  process.env.DUET_CONFIG_FILE = configFile

  const cleanup = (): void => {
    delete process.env.DUET_CONFIG_FILE
    rmSync(tmpDir, { recursive: true, force: true })
  }

  return { tmpDir, configFile, duetDataDir, cleanup }
}

/**
 * Записывает config в configFile.
 */
export const writeTestConfig = (configFile: string, config: Record<string, unknown>): void => {
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
}
