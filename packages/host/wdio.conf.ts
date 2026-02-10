/*
 * ЧТО: Конфигурация WebdriverIO для E2E тестов (dev режим).
 * ЗАЧЕМ: Тестирование Electron приложения локально.
 * КТО ИСПОЛЬЗУЕТ: npm run test:e2e
 *
 * ТРЕБОВАНИЯ:
 * - Перед запуском: npm run build (создаёт out/)
 *
 * РЕЖИМЫ:
 * - Dev (этот файл): appEntryPoint → быстро, из out/
 * - CI (wdio.ci.conf.ts): appBinaryPath → packaged app
 *
 * ДОКУМЕНТАЦИЯ: https://webdriver.io/docs/desktop-testing/electron
 */
import type { Options } from '@wdio/types'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Путь к entry point (создаётся через npm run build)
const appEntryPoint = join(__dirname, 'out/main/index.cjs')

export const config: Options.Testrunner = {
  // ====================
  // Runner Configuration
  // ====================
  runner: 'local',
  autoCompileOpts: {
    tsNodeOpts: {
      project: './tsconfig.node.json'
    }
  },

  // ==================
  // Specify Test Files
  // ==================
  specs: ['./e2e/**/*.e2e.ts'],
  exclude: [],

  // ============
  // Capabilities
  // ============
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        // Dev режим: запуск из out/ (быстрее, не нужен packaging)
        appEntryPoint: appEntryPoint
      }
    }
  ],

  // ===================
  // Test Configurations
  // ===================
  logLevel: 'debug',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  // ============
  // Services
  // ============
  services: ['electron'],

  // ==============
  // Framework
  // ==============
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000
  },

}
