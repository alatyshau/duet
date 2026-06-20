# instructions

Платформенный слой инструкций Duet — **`bootstrapper.md`**, системный промпт-каркас, который Duet
получает каждый AI-агент.

## Что здесь

| Файл | Что |
|------|-----|
| `bootstrapper.md` | Ориентация, Duet MCP-тулы, правила активации скиллов, **онтология «контекста»** (единая рекурсивная единица продуктивной жизни) и **единый ритуал работы в контексте**. Несёт два маркера-вставки: `<!-- INSERT SKILLS TABLE -->` и `<!-- INSERT USER CORE INSTRUCTIONS -->`. |

## Как используется

Backend (`packages/backend/instructions.py`) читает `bootstrapper.md`, подставляет в маркеры таблицу
скиллов и per-agent core (из пользовательского репозитория Duet-Instructions) и пишет merged-файлы
`DuetData/duet.md` (тонкий сессионный промпт) и `DuetData/duet-{agent}.md`.

**Runtime-путь.** Источник лежит здесь. В сборке `electron-builder` копирует `bootstrapper.md` рядом
с backend (`packages/instructions/ → backend/`), поэтому `server.py` находит его как sibling. В dev
`server.py` читает его отсюда напрямую (fallback `../instructions/bootstrapper.md`).

> Граница ответственности: **платформенный** слой (этот пакет) владеет каркасом и онтологией.
> **Пользовательский** слой (репозиторий Duet-Instructions) владеет per-agent core, персонами и
> скиллами. Подключение — `instructionsPath` в `DuetConfig/{machine}.json`.
