# instructions

**Платформенный слой инструкций Duet** — системный промпт-каркас и ядра агентов, которые получает
каждый AI-агент. Это не пользовательский, а продуктовый артефакт: живёт внутри `Duet.git`, бандлится
рядом с backend.

## Что здесь

| Файл | Что |
|------|-----|
| `bootstrapper.md` | Ориентация, Duet MCP-тулы, **онтология «контекста»** и **единый ритуал работы в контексте**. Несёт маркер-вставку `<!-- INSERT USER CORE INSTRUCTIONS -->`. |
| `executor.md`, `vizir.md` | Ядра агентов — поведенческий слой (L7-принципы и т.п.), подставляемый в маркер. |
| `index.json` | Список агентов: `{ "agents": { "executor": "executor.md", "vizir": "vizir.md" } }`. |

## Как используется

Backend (`packages/backend/instructions.py`) читает `bootstrapper.md` + `index.json` + ядра агентов
**из этой папки** (бандл рядом с backend) и пишет merged-файлы:
- `DuetData/duet.md` — тонкий сессионный промпт (bootstrapper без ядра);
- `DuetData/duet-{agent}.md` — bootstrapper + ядро агента.

Host разливает их по AI-клиентам в рамках конфигурации агентов (мёрж — внутренний пролог
`configureAllAgents`).

**Runtime-путь.** Источник лежит здесь. **PROD** — `electron-builder` копирует `*.md` + `index.json`
рядом с backend (`packages/instructions/ → backend/`), `server.py` находит их как siblings
(`Path(__file__).parent`). **DEV** — деплой копирует эту папку в `DuetData/backend/` (`deploy.ts`
→ `copyPlatformInstructions`), потому что dev-backend запускается из задеплоенной копии.

> Внешнего пользовательского репозитория инструкций (`instructionsPath` / `Duet-Instructions.git`)
> больше нет — всё нужное здесь. Скиллы — отдельная машинерия (нативные `SKILL.md`, деплой в
> контексты через `skills`-декларации `context.json`).
