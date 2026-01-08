# components.json — Конфигурация shadcn/ui

ЧТО: Конфигурация CLI-инструмента shadcn/ui для генерации компонентов.
ЗАЧЕМ: Позволяет автоматически добавлять UI-компоненты командой `npx shadcn@latest add`.
КТО ИСПОЛЬЗУЕТ: shadcn CLI, разработчик при добавлении новых компонентов.

---

## Поля

| Поле | Значение | Описание |
|------|----------|----------|
| `$schema` | URL схемы | Валидация конфига |
| `style` | `default` | Стиль компонентов (default/new-york) |
| `rsc` | `false` | React Server Components отключены (Electron не поддерживает) |
| `tsx` | `true` | Использовать TypeScript |
| `tailwind.config` | путь к конфигу | Где искать tailwind.config.js |
| `tailwind.css` | путь к CSS | Главный CSS-файл для инъекции стилей |
| `tailwind.baseColor` | `neutral` | Базовая цветовая палитра |
| `tailwind.cssVariables` | `true` | Использовать CSS-переменные для тем |
| `aliases.*` | алиасы путей | Куда генерировать компоненты и утилиты |
| `iconLibrary` | `lucide` | Библиотека иконок |

## Использование

```bash
# Добавить компонент Button
npx shadcn@latest add button

# Добавить несколько компонентов
npx shadcn@latest add dialog card input
```

Компоненты генерируются в `src/renderer/src/components/ui/`.
