/*
 * ЧТО: Конфигурация Tailwind CSS v4 — utility-first CSS-фреймворка.
 * ЗАЧЕМ: Указывает где искать Tailwind-классы для генерации CSS.
 * КТО ИСПОЛЬЗУЕТ: @tailwindcss/postcss при сборке через Vite.
 *
 * КАК РАБОТАЕТ TAILWIND?
 * Tailwind сканирует указанные файлы (content), находит классы типа "bg-blue-500",
 * и генерирует ТОЛЬКО используемый CSS. Неиспользуемые классы не попадают в бандл.
 *
 * TAILWIND V4 — ВАЖНЫЕ ОТЛИЧИЯ:
 * - Тема (цвета, шрифты, отступы) определяется в CSS через @theme, а НЕ здесь
 * - Смотри: src/renderer/src/assets/main.css — там @theme с кастомными цветами
 * - Этот файл остаётся только для content paths
 *
 * ДОКУМЕНТАЦИЯ: https://tailwindcss.com/docs/v4-beta
 */

/** @type {import('tailwindcss').Config} */
export default {
  // Пути к файлам, где Tailwind будет искать классы.
  // Glob-паттерны: **/* = все подпапки, {js,ts,jsx,tsx} = эти расширения
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}']
}
