# Ручная установка AI Kit

Инструкция для установки AI Kit до появления автоматической настройки через Duet-расширение.

## Требования

| Компонент | Версия | Проверка |
|-----------|--------|----------|
| Python | >= 3.10 | `python3 --version` |
| Claude Code | установлен | `claude --version` |
| Codex (опционально) | установлен | `codex --version` |

## Установка Codex CLI (опционально)

> Нужен только для шага “Codex MCP” (tools). Entrypoint инструкций для Codex пишется в `~/.codex/config.toml`, когда `codex` CLI установлен или `~/.codex` уже существует.

### Вариант A: npm

```bash
npm i -g @openai/codex
codex --version
```

### Вариант B: Homebrew

```bash
brew install codex
codex --version
```

## Шаг 1: Проверка Python

```bash
python3 --version
```

Должно показать `Python 3.10` или выше.

Если версия ниже — попросите AI-агента помочь:
```
My 'python3' points to Python 3.9
I need it to point to Python 3.10+
Help me fix my PATH or shell config
```

## Шаг 2: Запуск установщика

```bash
cd /путь/к/Duet.wt-1/packages/ai-kit
python3 install.py -o ~/DuetData/ai-kit
```

### Что делает установщик

1. **Проверяет Python 3.10+** — если ниже, показывает промпт для AI
2. **Создаёт venv** в `~/DuetData/.venv` и устанавливает `mcp`
3. **Копирует файлы AI Kit** в `~/DuetData/ai-kit/`
4. **Настраивает Claude Code** (если установлен):
   - `~/.claude/CLAUDE.md` — добавляет импорт инструкций
   - `~/.claude/settings.json` — добавляет MCP сервер
5. **Настраивает Codex**:
   - `~/.codex/config.toml` — выставляет `model_instructions_file` на `~/DuetData/ai-kit/core_instructions.md` (always-on entrypoint)
   - `codex mcp add ai-kit -- <venv_python> <server.py>` — добавляет MCP сервер (если `codex` CLI установлен)

## Шаг 3: Перезапуск Claude Code

```bash
# В VS Code: Cmd+Shift+P → "Developer: Reload Window"
```

## Проверка

### Инструкции

В Claude Code:
```
Какая твоя текущая персона?
```

### MCP сервер

В Claude Code:
```
Используй timestamp tool
```

Должен вернуть timestamp в формате `260126_231500M`.

## Настройка таймзоны

Отредактируйте `~/DuetData/ai-kit/settings.json`:

```json
{
    "timestampTZ": {
        "id": "M",
        "value": "Europe/Moscow"
    }
}
```

## Обновление AI Kit

При изменениях в `packages/ai-kit/templates/`:

```bash
python3 packages/ai-kit/install.py -o ~/DuetData/ai-kit
```

Установщик идемпотентен — сохраняет `settings.json`, обновляет остальное.

## Структура после установки

```
~/DuetData/
├── .venv/                  # Python venv с mcp
│   └── bin/python3
└── ai-kit/
    ├── core_instructions.md
    ├── settings.json       # Сохраняется при обновлении
    ├── personas/
    ├── stances/
    ├── skills/
    ├── modes/
    └── mcp-server/
        └── server.py
```

## Troubleshooting

### Python < 3.10

Установщик покажет промпт — скопируйте его AI-агенту.

### MCP сервер не работает

Проверьте `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "ai-kit": {
      "command": "/Users/.../DuetData/.venv/bin/python3",
      "args": ["/Users/.../ai-kit/mcp-server/server.py"]
    }
  }
}
```

`command` должен указывать на venv Python, не на системный.

### Claude Code не установлен

Установщик пропустит шаг конфигурации. Установите Claude Code и запустите скрипт повторно.
