# Поддержка Codex в AI Kit

**Статус:** Выполнено (поглощено Host)

---

## МОТИВАЦИЯ

Сделать Codex first-class клиентом AI Kit: автоматическая настройка `~/.codex/config.toml` (model_instructions_file) + MCP, без копирования файлов.

---

## ИТОГ

Реализовано в два этапа:

1. **install.py** (@turn 260128) — добавлена настройка Codex: `model_instructions_file` в `config.toml`, MCP через `codex mcp add`, флаги `--no-codex` и др. Код написан, подзадачи выполнены.

2. **Host** (@turn 260212) — логика установки AI инструкций и конфигурации AI-клиентов (включая Codex) перенесена из install.py в Duet Host. См. `260212_topic_ai_instructions_to_host.md`.

Ручная валидация (шаг 5 оригинального плана) не была выполнена отдельно — проверялась в рамках Host E2E.

---

## ССЫЛКИ

- Исходный install.py: `packages/ai-kit/install.py`
- Host-реализация: `projects/260210_duet_mvp/260212_topic_ai_instructions_to_host.md`

---

## Примечание

Топик-файл не был корректно закрыт в момент выполнения — шаги остались в IN_REVIEW/TODO. Переформулирован при архивации @turn(260220).
