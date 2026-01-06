/*
 * ЧТО: Конфигурация ESLint для линтинга кода.
 * ЗАЧЕМ: Проверяет код на ошибки и стилистические проблемы.
 * КТО ИСПОЛЬЗУЕТ: ESLint при `npm run lint`, IDE в реальном времени.
 *
 * ПРАВИЛА:
 * - Базовые: @electron-toolkit/eslint-config-ts (TypeScript)
 * - React: eslint-plugin-react + react-hooks + react-refresh
 * - Prettier: отключает конфликтующие правила форматирования
 */
import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  eslintConfigPrettier
)
