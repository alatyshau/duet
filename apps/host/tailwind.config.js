/*
 * ЧТО: Конфигурация Tailwind CSS v4.
 * ЗАЧЕМ: Указывает пути к файлам для сканирования классов.
 * КТО ИСПОЛЬЗУЕТ: @tailwindcss/postcss при сборке CSS.
 *
 * ПРИМЕЧАНИЕ: В Tailwind v4 тема определяется в CSS через @theme.
 * Этот файл нужен только для content paths.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}']
}
