# tsconfig.node.json

ЧТО: TypeScript конфиг для Node.js частей Electron (main + preload).
ЗАЧЕМ: Настраивает компиляцию для кода с доступом к Node.js API.
КТО ИСПОЛЬЗУЕТ: TypeScript при компиляции main/preload, IDE.

---

## Поля

| Поле | Описание |
|------|----------|
| `extends` | Базовый конфиг из `@electron-toolkit/tsconfig` |
| `include` | Какие файлы компилировать |
| `composite: true` | Включает project references |
| `types` | Дополнительные типы (`electron-vite/node`) |

## Include

- `electron.vite.config.*` — конфиг сборки
- `src/main/**/*` — главный процесс Electron
- `src/preload/**/*` — preload-скрипты