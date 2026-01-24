# Use Case: auditor_repo_solo

**Timestamp:** 260123_2007
**Client:** Claude Code (VS Code)
**Persona:** не использовалась (прямой диалог)
**Project folder:** н/п (работа на уровне всего репозитория)
**Topic files:** н/п

## Classification

| Parameter | Value |
|-----------|-------|
| **Role** | auditor — проверка соответствия соглашениям |
| **Scope** | repo — весь репозиторий Duet |
| **Workflow** | solo |
| **Task type** | compliance check + terminology calibration |
| **Result** | успешно — отчёт с findings, часть исправлена пользователем |
| **Duration** | medium (~15 msgs) |

## Context Used

### Modes (what activities happened)

- **DIALOGUE** — обсуждение терминологии (проект vs репо/воркспейс), калибровка понимания
- **AUDIT** (новый) — систематическая проверка всех файлов на соответствие соглашениям

### Skills (domain expertise used)

- monorepo-structure — понимание структуры apps/packages
- typescript — проверка .ts/.tsx файлов на наличие шапок
- documentation-standards — формат ЧТО/ЗАЧЕМ/КТО ИСПОЛЬЗУЕТ
- file-organization — именование файлов, companion .json.md файлы
- git — проверка .gitignore, untracked files

### Stances (thinking styles used)

- **systematic** — методичный проход по категориям: структура → шапки → именование → конфиги → чистота
- **pragmatic** — конкретные findings с вариантами решения (A vs B)

### Other Context (what else was loaded or referenced)

- README.md — заявленная структура монорепо
- package.json (root + apps/host) — конфигурация workspaces
- .gitignore — правила игнорирования
- Все .ts/.tsx файлы в apps/host/src — проверка шапок
- Все .yaml файлы — проверка шапок
- theory/*.md — проверка формата документации

## Reflection

**What context was MISSING that would have helped?**

- Явный документ "Coding Standards" или "Conventions" — пришлось выводить соглашения из существующих файлов
- Не было ясно, является ли формат шапок ЧТО/ЗАЧЕМ/КТО обязательным для .md файлов или только для кода

**What could have gone better?**

- Пользователь параллельно исправлял файлы пока я делал отчёт — это создало рассинхрон (я видел старые версии, а потом получал system-reminder об изменениях)
- Можно было сначала спросить пользователя о приоритетах: что важнее — структура README или шапки файлов?

**What new patterns or insights emerged?**

- **Терминология важна для GTD-контекста**: пользователь осознанно отказывается от слова "проект" в значении "codebase", резервируя его для GTD-проектов. Это влияет на всю коммуникацию.
- **Compliance check как отдельный режим**: AUDIT отличается от REVIEW (который про код другого агента) — это проверка соответствия соглашениям, не code review.
- **Два типа задач на "уборку"**: (1) compliance — не меняет поведение, только форму; (2) refactoring — меняет код. Пользователь явно разделил их.

## Summary

Калибровка терминологии (проект → репо/воркспейс) и систематический compliance check всего репозитория на соответствие соглашениям: шапки файлов, структура vs README, конфигурации. Найдено 5 категорий несоответствий, часть исправлена пользователем в процессе.
