/*
 * ЧТО: TypeScript типы для глобальных объектов window в renderer.
 * ЗАЧЕМ: Даёт автокомплит и типизацию для window.electron и window.api.
 * КТО ИСПОЛЬЗУЕТ: TypeScript при компиляции renderer-кода.
 */
import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
  }
}
