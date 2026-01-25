# Ревью качества системных инструкций

**Статус:** В работе

---

## МОТИВАЦИЯ

### Зачем этот документ

Вынесено из topic_base_instructions.md (шаг 13). Объём работы требует отдельного топика.

### Проблема

Инструкции в `.ai/INSTRUCTIONS.md` собраны, но не отревьюированы как целое. Нужно:
1. Проверить структуру (разбиение на файлы/секции)
2. Проверить содержание (полнота, непротиворечивость, эффективность)

---

## ССЫЛКИ

- [topic_base_instructions.md](topic_base_instructions.md) — родительский топик
- [.ai/INSTRUCTIONS.md](../../.ai/INSTRUCTIONS.md) — generated output (канон)
- [packages/ai-kit/templates/](../../packages/ai-kit/templates/) — source of truth

---

## НАРРАТИВ

### @turn(260115_123732M) — Два уровня качества

АЛ + Сократ сформулировали два уровня ревью:

**Исходная рамка (4 аспекта):**
1. Форма — структура, лаконичность, ясность
2. Содержание — полнота, непротиворечивость, приоритизация
3. Эффективность — усвояемость, применимость, тестируемость
4. Архитектура — модульность, расширяемость, переносимость

**Упрощение до двух шагов:**

| Шаг | Что включает | Фокус |
|-----|--------------|-------|
| **Шаг 1: Структура** | Форма + Архитектура | Где что лежит (файлы, секции) |
| **Шаг 2: Содержание** | Содержание + Эффективность | Что написано (текст, правила) |

**Порядок важен:** нет смысла шлифовать текст, который потом переедет.

### @turn(260120) — Модульная архитектура

**Проблема:** Один файл ~1200 строк, плоская структура → когнитивная перегрузка агента, расфокусировка.

**Решение:** Разделить на файлы. Агент загружает только релевантное.

**Целевые клиенты:** VS Code extensions (Claude Code, Copilot, Cursor, Antigravity, Codex, Gemini CodeAssist) — все имеют доступ к файлам.

**Принятые решения:**

| Контент | Куда |
|---------|------|
| Decision tree (выбор режима) | core |
| DIALOGUE | core (это default режим) |
| Принципы дискуссий, диалектика | core (в секции DIALOGUE) |
| Базовые правила, красные линии | core (чистка позже) |
| Тезаурус | core (полировка позже) |
| Формат ответов, timestamp, старт сессии | core |
| Структура topic-файлов (5 секций) | modes/planning.md |
| PLANNING алгоритм | modes/planning.md |
| EXECUTE алгоритм | modes/execute.md |
| State machine шагов | modes/execute.md + modes/review.md |
| SECRETARY алгоритм | modes/secretary.md |
| REVIEW алгоритм | modes/review.md |
| Формат комментариев | modes/commentary.md |

**Терминология:** "чат-папка" → "проектная папка" (обновить везде).

---

## ВЫХОДЫ

### Выход 1: Новая структура файлов

**Цель:** Модульная архитектура — агент загружает только нужное.

**Структура:**

```
packages/ai-kit/templates/
├── INSTRUCTIONS.md.j2          ← старый (не трогаем)
├── CORE_INSTRUCTIONS.md.j2     ← новый core (базовые инструкции)
└── modes/
    ├── planning.md.j2
    ├── execute.md.j2
    ├── secretary.md.j2
    ├── review.md.j2
    └── commentary.md.j2

        ↓ build.py ↓

.ai/
├── INSTRUCTIONS.md             ← старый (не трогаем)
├── CORE_INSTRUCTIONS.md        ← новый, для проверки
└── modes/
    ├── planning.md
    ├── execute.md
    ├── secretary.md
    ├── review.md
    └── commentary.md

После проверки: CORE_INSTRUCTIONS.md → заменяет CLAUDE.md
```

**Содержание core (INSTRUCTIONS.md):**
- Обзор режимов (таблица)
- Decision tree (алгоритм выбора режима → какой файл читать)
- Режим DIALOGUE (полностью, включая принципы дискуссий)
- Базовые правила
- Красные линии
- Тезаурус
- Формат ответов (@turn)
- Timestamp
- Старт сессии

**Содержание modes/planning.md:**
- Когда входить в PLANNING
- Алгоритм работы
- Структура topic-файла (5 секций)
- Формат ПЛАН ВНЕДРЕНИЯ
- Переход PLANNING → EXECUTE

**Содержание modes/execute.md:**
- Алгоритм работы
- State machine шагов (TODO → WIP → IN_REVIEW → DONE)
- Команды (/next, /done, /done-next)
- Формат шага
- Правила репортинга
- Запрет автопродолжения

**Содержание modes/secretary.md:**
- Главная задача
- Когда вызывать
- Алгоритм (7 шагов)
- Формат отчёта
- Checkpoint

**Содержание modes/review.md:**
- Когда входить
- Что делает ревьювер
- State machine (IN_REVIEW статус)
- Формат отчёта ревью
- Разные персоны — разный фокус

**Содержание modes/commentary.md:**
- Когда входить
- Формат комментариев (::: АВТОР :::)
- Правила редактирования

### Выход 2: Decision tree

**Цель:** Алгоритм выбора режима с явной инструкцией какой файл читать.

```
СТАРТ СЕССИИ
    │
    ▼
Режим = DIALOGUE (инструкции в этом файле)
    │
    ▼
ОЖИДАНИЕ СОБЫТИЯ
    │
    ├── /secretary
    │   └─→ Прочитай .ai/modes/secretary.md, следуй инструкциям
    │
    ├── /next (или "да, выполняй")
    │   └─→ Прочитай .ai/modes/execute.md, следуй инструкциям
    │
    ├── Запрос изменений ВНЕ проектной папки
    │   └─→ Прочитай .ai/modes/planning.md, следуй инструкциям
    │
    ├── "Сделай ревью X"
    │   └─→ Прочитай .ai/modes/review.md, следуй инструкциям
    │
    ├── "Прокомментируй файл X"
    │   └─→ Прочитай .ai/modes/commentary.md, следуй инструкциям
    │
    └── Всё остальное
        └─→ Остаёмся в DIALOGUE
```

### Выход 3: Чистка содержания

**Цель:** Убрать лишнее, устаревшее, очевидное.

**Чеклист для каждой секции:**
- [ ] Нужно ли это правило?
- [ ] Не дублируется ли?
- [ ] Актуальна ли терминология?
- [ ] Можно ли сократить?

**Известные проблемы:**
- "чат-папка" → "проектная папка"
- Дубли: "Формат ответов" дважды, "Типы файлов" дважды
- 9 правил — пересмотреть на лишнее/очевидное
- Красные линии — пересмотреть

---

## ПЛАН ВНЕДРЕНИЯ

**Статус:** планирование

**Критерии завершённости топика:**
- [ ] Новая структура файлов создана и работает
- [ ] Содержание почищено
- [ ] Терминология актуализирована
- [ ] Инструкции стабильны для production use

---

### Шаг 1: Создать структуру файлов
**Статус:** DONE
**Выход:** [Выход 1: Новая структура файлов](#выход-1-новая-структура-файлов)

**Ход работы:**
- [x] Создать `packages/ai-kit/templates/CORE_INSTRUCTIONS.md.j2` (новый, не трогаем старый)
- [x] Создать `packages/ai-kit/templates/modes/` директорию
- [x] Создать файлы: planning.md.j2, execute.md.j2, secretary.md.j2, review.md.j2, commentary.md.j2
- [x] build.py уже поддерживает поддиректории — изменений не требуется

---

### Шаг 2: Распределить контент по файлам
**Статус:** DONE
**Выход:** [Выход 1: Новая структура файлов](#выход-1-новая-структура-файлов)

**Ход работы:**
- [x] Скопировать PLANNING секции из INSTRUCTIONS.md.j2 → modes/planning.md.j2
- [x] Скопировать EXECUTE секции → modes/execute.md.j2
- [x] Скопировать SECRETARY секции → modes/secretary.md.j2
- [x] Скопировать REVIEW секции → modes/review.md.j2
- [x] Создать modes/commentary.md.j2 (формат комментариев)
- [x] В CORE_INSTRUCTIONS.md.j2: DIALOGUE, базовые правила, тезаурус, форматы (без режимов)

**Примечание:** Использованы Jinja2 includes для DRY — mode-файлы ссылаются на существующие partials в `_instructions/`.

---

### Шаг 3: core_instructions.md (EN)
**Статус:** DONE
**Выход:** [Выход 2: Decision tree](#выход-2-decision-tree)

Создан новый core_instructions.md — standalone файл на английском (386 строк).

**Ключевые решения:**
- Standalone .md (без Jinja2 includes) — проще, понятнее
- `_instructions/` и `INSTRUCTIONS.md.j2` — legacy, не трогаем
- Язык инструкций — EN, чат — RU
- Тезаурус — EN с RU переводами (stream = дело, project = проект GTD)

**Ход работы:**
- [x] Modes overview + decision tree (какой файл загружать)
- [x] Session start (5 шагов идентификации)
- [x] Spec-driven development — NEW! (spec = source of truth)
- [x] Thesaurus EN↔RU
- [x] Base rules (9 правил), Red lines (3 запрета)
- [x] Response format (@turn, @topic), timestamp
- [x] DIALOGUE philosophy, zone separation

---

### Шаг 4: modes/*.md (EN, standalone)
**Статус:** DONE
**Выход:** [Выход 1: Новая структура файлов](#выход-1-новая-структура-файлов)

Переписать mode-файлы: убрать Jinja2 includes, сделать standalone на английском.
Каждый файл — самодостаточная инструкция для одного режима.

**Ход работы:**
- [x] planning.md — topic structure (5 sections), plan format, PLANNING→EXECUTE transition
- [x] execute.md — state machine (TODO→WIP→IN_REVIEW→DONE), step rules, proactivity limits
- [x] secretary.md — archiving algorithm, checkpoint format, what to preserve
- [x] review.md — review format, "all issues are equal", checklist
- [x] commentary.md — comment syntax `::: AUTHOR :::`, nesting rules

---

### Шаг 5: workflows/*.md (EN)
**Статус:** TODO
**Выход:** [Выход 2: Decision tree](#выход-2-decision-tree)

Создать workflow-файлы — описание ритма работы и правил коммитов.

**Ход работы:**
- [ ] sddg.md — multi-agent spec-driven flow (Socrates→Daedalus→Hephaestus), когда коммит, как обновлять spec
- [ ] solo.md — single agent flow, упрощённый ритм для работы одного агента

---

### Шаг 6: Smoke test
**Статус:** TODO
**Выход:** Подтверждение работоспособности

Проверить что файлы готовы к использованию.

**Решение:** Jinja2 не нужен для новых файлов — просто .md, копируются куда надо.
Deployment strategy (куда копировать) — отдельный вопрос, решим позже.

**Ход работы:**
- [ ] Проверить что все .md файлы созданы в templates/
- [ ] Протестировать загрузку в новой сессии (скопировать вручную в .ai/)
- [ ] Убедиться что агент понимает инструкции

---

### Шаг 7: Интеграция и миграция
**Статус:** TODO
**Выход:** Production-ready система

Переключить production на новые инструкции.

**Ход работы:**
- [ ] Обновить CLAUDE.md → ссылка на core_instructions.md
- [ ] Тест на реальной задаче (разные IDE: Cursor, Claude Code)
- [ ] После подтверждения: пометить legacy как deprecated

---
