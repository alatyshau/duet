/*
 * ЧТО: Конфигурация PostCSS — препроцессора CSS.
 * ЗАЧЕМ: Трансформирует CSS перед отправкой в браузер.
 * КТО ИСПОЛЬЗУЕТ: Vite автоматически при сборке и dev-режиме.
 *
 * ЧТО ТАКОЕ PostCSS?
 * PostCSS — это "конвейер" для CSS. Ваш CSS проходит через цепочку плагинов,
 * каждый из которых что-то добавляет или преобразует.
 *
 * ПЛАГИНЫ:
 *
 * @tailwindcss/postcss
 *   - Обрабатывает директивы Tailwind (@theme, @apply, классы типа "bg-blue-500")
 *   - Генерирует финальный CSS из utility-классов
 *
 * autoprefixer
 *   - Автоматически добавляет вендорные префиксы для кроссбраузерности
 *   - Пример: `display: flex` → `display: -webkit-flex; display: flex`
 *   - Без него старые браузеры/WebView могут некорректно отображать стили
 *
 * ДОКУМЕНТАЦИЯ: https://postcss.org/
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {}
  }
}
