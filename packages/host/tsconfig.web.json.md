# tsconfig.web.json

ЧТО: TypeScript конфиг для браузерной части Electron (renderer).
ЗАЧЕМ: Настраивает компиляцию для React UI с JSX.
КТО ИСПОЛЬЗУЕТ: TypeScript при компиляции renderer, IDE.

---

## Поля

| Поле | Описание |
|------|----------|
| `extends` | Базовый конфиг из `@electron-toolkit/tsconfig` |
| `include` | Файлы renderer + типы из preload |
| `jsx: "react-jsx"` | Новый JSX transform (без import React) |
| `paths` | Алиас `@renderer/*` → `src/renderer/src/*` |

## Include

- `src/renderer/src/**/*` — React компоненты и UI
- `src/renderer/src/env.d.ts` — Vite типы
- `src/preload/*.d.ts` — типы window.electron/api