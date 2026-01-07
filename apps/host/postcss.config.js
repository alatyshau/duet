/*
 * ЧТО: Конфигурация PostCSS.
 * ЗАЧЕМ: Подключает Tailwind CSS и Autoprefixer к процессу сборки.
 * КТО ИСПОЛЬЗУЕТ: Vite при обработке CSS файлов.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {}
  }
}
