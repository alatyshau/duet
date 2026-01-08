/*
 * ЧТО: Конфигурация сборки electron-vite для Electron приложения.
 * ЗАЧЕМ: Настраивает Vite для трёх процессов: main, preload, renderer.
 * КТО ИСПОЛЬЗУЕТ: electron-vite при `npm run dev` и `npm run build`.
 *
 * СЕКЦИИ:
 * - main: настройки для главного процесса Electron (Node.js)
 * - preload: настройки для preload-скриптов (мост main↔renderer)
 * - renderer: настройки для UI (React + Vite), включая алиасы путей
 */
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: {
          // Windows требует CommonJS для preload скриптов
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
