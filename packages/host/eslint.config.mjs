/*
 * ЧТО: Конфигурация ESLint — статического анализатора кода.
 * ЗАЧЕМ: Находит баги и плохие практики ДО запуска кода. Ошибки подсвечиваются в IDE.
 * КТО ИСПОЛЬЗУЕТ: ESLint при `npm run lint`, IDE в реальном времени.
 *
 * ИСПОЛЬЗУЕМЫЕ ПЛАГИНЫ:
 *
 * @electron-toolkit/eslint-config-ts
 *   - Правила для TypeScript: неиспользуемые переменные, any-типы, и т.д.
 *
 * eslint-plugin-react
 *   - Правила для React: корректность JSX, пропсы, key в списках
 *   - jsx-runtime — разрешает JSX без import React (React 17+)
 *
 * eslint-plugin-react-hooks
 *   - Проверяет правила хуков: нельзя вызывать условно, зависимости useEffect
 *   - Предотвращает баги с замыканиями и бесконечными ререндерами
 *
 * eslint-plugin-react-refresh
 *   - Правила для Vite HMR: компоненты должны быть экспортированы правильно
 *   - Без этого Hot Module Replacement может не работать
 *
 * @electron-toolkit/eslint-config-prettier
 *   - Отключает правила ESLint, конфликтующие с Prettier
 *   - Prettier занимается форматированием, ESLint — логикой
 *
 * ДОКУМЕНТАЦИЯ: https://eslint.org/docs/latest/use/configure/
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
