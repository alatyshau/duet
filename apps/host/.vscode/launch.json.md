# .vscode/launch.json

ЧТО: Конфигурации отладки VS Code для Electron.
ЗАЧЕМ: Позволяет отлаживать main и renderer процессы с брейкпоинтами.
КТО ИСПОЛЬЗУЕТ: VS Code при нажатии F5 или запуске Debug.

---

## Конфигурации

| Имя | Описание |
|-----|----------|
| `Debug Main Process` | Отладка главного процесса (Node.js) |
| `Debug Renderer Process` | Отладка UI (Chrome DevTools Protocol) |
| `Debug All` | Compound: запускает обе конфигурации |

## Как использовать

1. Открыть Run and Debug (Ctrl+Shift+D)
2. Выбрать "Debug All" из списка
3. Нажать F5
4. Ставить брейкпоинты в main и renderer коде

## Порты

- `9222` — Chrome DevTools Protocol для renderer