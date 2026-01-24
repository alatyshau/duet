# Use Case: implementer_project_pair

**Timestamp:** 260123_2000
**Client:** Claude Code (VS Code)
**Persona:** нет (прямые инструкции из CLAUDE.md)
**Project folder:** projects/260117_extension_design (основная работа), .ai/roles/ (keeper документация)
**Topic files:** нет topic-файлов — работа по прямым запросам

## Classification

| Parameter | Value |
|-----------|-------|
| **Role** | implementer — реализация изменений на основе feedback |
| **Scope** | project — документация Keeper и связанные скрипты |
| **Workflow** | pair — пользователь тестирует Keeper в другом окне, сообщает ошибки сюда |
| **Task type** | iterative refinement — цикл "тест → ошибка → fix → тест" |
| **Result** | успех — keeper.md, README.md, ai_git_updater.py улучшены |
| **Duration** | long >50 msgs (с учётом compaction summary) |

## Context Used

### Modes (what activities happened)

- **DIALOGUE** — обсуждение проблем и решений
- **EXECUTE** — правки файлов (Edit tool)
- **REVIEW** — проверка целостности keeper.md после множества правок

### Skills (domain expertise used)

- **instructions-architect** — проектирование AI-инструкций
- **python** — правки в backlog_update.py, ai_git_updater.py
- **documentation-design** — структура keeper.md
- **defensive-prompting** — добавление ⚠️ предупреждений для предотвращения ошибок AI

### Stances (thinking styles used)

- **pragmatic** — быстрые точечные исправления по feedback
- **systematic** — проверка целостности файла после серии правок
- **empirical** — решения основаны на реальных ошибках Keeper, не теории

### Other Context (what else was loaded or referenced)

- `.ai/roles/keeper.md` — основной файл работы
- `.ai/roles/README.md` — шаблон для Principal
- `scripts/ai_git_updater.py` — добавление IGNORED_BASENAMES
- `scripts/backlog_update.py` — исправление обработки секций в --done
- Compaction summary — история предыдущих изменений
- Скриншоты ошибок Keeper — от пользователя

## Reflection

**What context was MISSING that would have helped?**

- Логи/транскрипты сессий Keeper — видел только скриншоты конкретных ошибок
- Метрики качества документации — как объективно оценить "достаточно ли глубоко"?

**What could have gone better?**

- Много мелких правок в keeper.md — можно было сначала собрать все проблемы, потом одним рефакторингом
- Некоторые предупреждения (⚠️) добавлялись реактивно после ошибок — можно было предвидеть
- Проверка целостности файла делалась по запросу пользователя — стоило делать проактивно

**What new patterns or insights emerged?**

- **"Defensive prompting"** — AI игнорирует мягкие инструкции, нужны явные ⚠️ запреты
- **"No bias" principle** — AI делает допущения о "важности" папок по названию (dist/, out/)
- **Batch size matters** — меньше батч = выше качество (5 файлов / 3 секции оптимум)
- **mtime-bug** — --done до approval создаёт race condition, важно документировать
- **"Шаг Назад" non-optional** — AI склонен оптимизировать, нужно явно запретить

## Summary

Итеративное улучшение документации Keeper на основе реальных ошибок при тестировании. Пользователь тестировал Keeper в параллельном окне, сообщал ошибки — я вносил исправления в keeper.md, README.md и скрипты (ai_git_updater.py, backlog_update.py). Ключевой паттерн: "defensive prompting" — добавление явных ⚠️ запретов для предотвращения типичных AI-ошибок (пропуск шагов, bias к "неважным" папкам, оптимизация вместо качества).
