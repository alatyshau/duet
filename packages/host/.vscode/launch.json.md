# .vscode/launch.json

ЧТО: Конфигурации отладки VS Code для Electron.
ЗАЧЕМ: Позволяет отлаживать main и renderer процессы с брейкпоинтами.
КТО ИСПОЛЬЗУЕТ: VS Code при нажатии F5 или запуске Debug.

---

## Архитектура Electron (для понимания)

Electron-приложение состоит из двух типов процессов:

| Процесс | Что делает | Среда выполнения |
|---------|------------|------------------|
| **Main** | Управляет окнами, системными API, жизненным циклом приложения | Node.js |
| **Renderer** | Отрисовывает UI (React/HTML/CSS), по одному на каждое окно | Chromium (браузер) |

Для отладки каждого процесса нужен свой debugger — поэтому здесь две конфигурации.

---

## Конфигурации

| Имя | Описание |
|-----|----------|
| `Debug Main Process` | Запускает Electron через electron-vite и подключает Node.js debugger |
| `Debug Renderer Process` | Подключается к уже запущенному Chromium через Chrome DevTools Protocol |
| `Debug All` | Compound — запускает Main, затем автоматически подключает Renderer |

### Детали конфигураций

**Debug Main Process:**
- `runtimeExecutable: electron-vite` — запускает dev-сервер с hot reload
- `--sourcemap` — генерирует source maps для маппинга TypeScript → JavaScript при отладке

**Debug Renderer Process:**
- `port: 9222` — стандартный порт Chrome DevTools Protocol (задаётся через `REMOTE_DEBUGGING_PORT`)
- `timeout: 60000` — ждёт 60 сек пока приложение запустится (Electron стартует не мгновенно)
- `hidden: true` — не показывает эту конфигурацию отдельно в списке (используется только через Debug All)

## Как использовать

1. Открыть Run and Debug (Ctrl+Shift+D)
2. Выбрать "Debug All" из списка
3. Нажать F5
4. Ставить брейкпоинты в main и renderer коде

