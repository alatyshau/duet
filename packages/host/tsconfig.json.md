# tsconfig.json

ЧТО: Корневой конфиг TypeScript — project references.
ЗАЧЕМ: Объединяет отдельные tsconfig для разных частей приложения.
КТО ИСПОЛЬЗУЕТ: TypeScript, IDE для навигации по проекту.

---

## Структура

```
tsconfig.json (этот файл)
├── tsconfig.node.json  → main + preload (Node.js код)
└── tsconfig.web.json   → renderer (браузерный код)
```

## Поля

| Поле | Описание |
|------|----------|
| `files: []` | Сам по себе не компилирует файлы |
| `references` | Ссылки на дочерние конфиги |

## Зачем разделение?

Electron имеет три контекста с разными API:
- **main** — Node.js (полный доступ к ОС)
- **preload** — ограниченный Node.js (мост)
- **renderer** — браузер (DOM, React)

Каждому нужны свои типы и настройки компиляции.