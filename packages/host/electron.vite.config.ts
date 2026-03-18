/*
 * ЧТО: Конфигурация сборки electron-vite для Electron приложения.
 * ЗАЧЕМ: Настраивает Vite для трёх процессов Electron-архитектуры.
 * КТО ИСПОЛЬЗУЕТ: electron-vite при `npm run dev` и `npm run build`.
 *
 * АРХИТЕКТУРА ELECTRON (для новичков):
 * ┌─────────────────────────────────────────────────────────────┐
 * │  MAIN PROCESS (Node.js)                                     │
 * │  - Точка входа приложения (src/main/index.ts)              │
 * │  - Полный доступ к ОС: файлы, сеть, системный трей         │
 * │  - Создаёт окна (BrowserWindow)                            │
 * └─────────────────────────────────────────────────────────────┘
 *          │ IPC (межпроцессное общение)
 *          ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │  PRELOAD SCRIPT (мост)                                      │
 * │  - Выполняется ДО загрузки страницы в окне                 │
 * │  - Ограниченный доступ к Node.js API                       │
 * │  - Безопасно "пробрасывает" функции в renderer             │
 * └─────────────────────────────────────────────────────────────┘
 *          │ contextBridge.exposeInMainWorld()
 *          ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │  RENDERER PROCESS (браузер)                                 │
 * │  - Обычный веб: HTML, CSS, JS (React в нашем случае)       │
 * │  - НЕТ доступа к Node.js (безопасность!)                   │
 * │  - Общается с main через preload-функции                   │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ДОКУМЕНТАЦИЯ: https://electron-vite.org/config/
 */
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Main process — собираем как CommonJS для совместимости с Electron
  main: {
    plugins: [
      // electron-vite по умолчанию externalizes все dependencies (оставляет require()).
      // В монорепо hoisted-зависимости не попадают в packaged app.
      // Чистые JS-модули (без нативного кода) безопасно бандлить в output.
      externalizeDepsPlugin({ exclude: ['smol-toml'] })
    ],
    build: {
      rollupOptions: {
        output: {
          // CommonJS формат. Electron + ESM ("type": "module") имеет проблемы совместимости.
          // Исходный код пишем на ESM (import/export), Vite конвертирует в CJS при сборке.
          // Расширение .cjs явно указывает Node.js что это CommonJS (важно с "type": "module").
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },

  // Preload — особые требования к формату модулей
  preload: {
    build: {
      rollupOptions: {
        output: {
          // CommonJS (require/module.exports) вместо ESM (import/export).
          // Windows Electron требует CJS для preload. Без этого — белый экран.
          // Расширение .cjs для совместимости с "type": "module".
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },

  // Renderer — обычное Vite-приложение (React)
  renderer: {
    resolve: {
      alias: {
        // @renderer/components → src/renderer/src/components
        // Позволяет писать короткие импорты вместо длинных относительных путей
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
