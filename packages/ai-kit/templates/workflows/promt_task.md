Персона: Сократ
Чат-папка: (укажи свою)

---

Задача: реализовать workflow SDDG в инструкциях.

## Контекст

В worktree Duet.git (проект 260117_extension_design) мы обсудили spec-driven development:

1. **Spec/** — source of truth для AI, EN, обновляется каждый коммит
2. **docs/** — materialized view для людей, RU, refresh on demand  
3. **Топик-файл** — план + история, RU, временный
4. **Приоритет:** spec > топик для DONE шагов

Черновик workflow: `packages/ai-kit/templates/workflows/draft_sddg.md`

## Задача

1. Создать `packages/ai-kit/templates/workflows/draft_sddg.md.j2` на основе черновика
2. Интегрировать с рефакторингом инструкций (4 файла: core, personas, modes, workflows)
3. Убедиться что новый агент сможет загрузить workflow и понять как работать

## Архитектура инструкций (обсуждённая)

```
.ai/
├── core_instructions.md    ← базовые правила
├── personas/xxx.md         ← кто я
├── modes/xxx.md            ← что делаю
└── workflows/xxx.md        ← как работаем (SDDG, Solo, ...)
```

Каждый агент на старте загружает 4 файла.
