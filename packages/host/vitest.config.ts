import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Unit + Integration тесты
    include: ['__tests__/**/*.test.ts'],
    // Исключаем E2E (они в e2e/)
    exclude: ['e2e/**', 'node_modules/**'],
    // Окружение Node.js (не jsdom — тестируем core/, не React)
    environment: 'node',
    // Глобальные expect, describe, it
    globals: true
  }
})
