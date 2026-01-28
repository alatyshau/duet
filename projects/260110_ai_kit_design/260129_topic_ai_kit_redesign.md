# Перепроектирование AI Kit

**Статус:** Выполнено @turn(260129)

---

## МОТИВАЦИЯ

### Проблема

AI Kit вырос спонтанно. Инструкции для агентов, режимы работы, форматы файлов — всё накопилось без единого плана. Результат: непоследовательность, дублирование, путаница между понятиями (mode vs stance vs skill).

### Цель

Перепроектировать AI Kit системно:
- Чёткие определения каждого компонента (mode, stance, skill, workflow, persona)
- Эргономичный синтаксис для переключения (`!поза=ДИАЛ` вместо громоздких конструкций)
- Инструкции без лишних слов — каждая строка оправдывает своё место в контексте

---

## ССЫЛКИ

- [Anthropic Skills](https://github.com/anthropics/skills) — источник принципов проектирования инструкций
- [topic_instructions_quality.md](topic_instructions_quality.md) — параллельный проект (технический рефакторинг)
- [core_instructions.md](../../packages/ai-kit/templates/core_instructions.md) — главный файл инструкций
- [spec/DOMAIN.md](../../packages/ai-kit/spec/DOMAIN.md) — определения понятий

---

## НАРРАТИВ

### @turn(260124) — Ключевые решения

**Проблема:** Нужен ли вообще "каркас" (modes/stances/skills)? Или для простых задач это overhead?

**Решение АЛ после анализа 40 use cases:** Каркас нужен всегда. Но он должен быть:

| Принцип | Что это значит |
|---------|----------------|
| **Чёткое различение** | Mode отвечает "что делаю", stance — "как думаю", skill — "что знаю". Не путать! |
| **Богатое разнообразие** | Много вариантов каждого типа, чтобы всегда был подходящий |
| **Запоминаемость** | Короткие коды, мнемоника — чтобы пользователь помнил без шпаргалки |
| **Эргономичный синтаксис** | `!поза=ДИАЛ` — работает в RU раскладке, не тригерит IDE autocomplete |

### @turn(260126) — Текущий статус

**Что сделано:**
- Проанализировано 40 реальных сессий (24 в IDE, 16 в web) — понятно какие режимы и stances реально используются
- В core_instructions.md добавлен шаг "Component spec" — теперь агент в начале сессии читает spec/ папку компонента над которым работает
- Закрыты ложные следы: IMPORT mode не нужен (SECRETARY справится), CURATOR mode не нужен (это обычный EXECUTE)

**Следующий шаг:** Закрыть findings из ОТКРЫТЫЕ ВОПРОСЫ по порядку.

### @turn(260127) — Finding #9 и ревью инструкций

**Что сделано:**
- Finding #9 закрыт: 9 Rules → 3 Axioms с примерами
- Red Lines удалены (устарели, не используются)
- Session Start перемещён в APPENDIX (progressive disclosure)
- Timestamp интегрирован в @turn() Parameters
- socrates.md: убраны дубликаты, Method переписан на сократический

**Итоговая структура core_instructions.md:** 9 секций + APPENDIX
1. Modes, 2. Decision Tree, 3. Spec-Driven Development, 4. Thesaurus, 5. Base Rules (3 Axioms), 6. Response Format, 7. DIALOGUE Mode Philosophy, 8. Zone Separation, 9. Execute Only With Plan, APPENDIX: Session

**Следующий шаг:** Фаза 3 — Документация (Шаг 12-14).

---

## ОТКРЫТЫЕ ВОПРОСЫ

### Findings: что нужно доделать

Это конкретные улучшения, выявленные при анализе 40 use cases и ревью core_instructions.md. Каждый пункт содержит проблему и конкретное действие.

**Из анализа use cases:**

- [x] **1. Defensive prompting** → закрыт
  В инструкциях уже есть явные запреты и примеры "так нельзя / так можно" — этого достаточно.

- [x] **2. Оценочные формулировки в REVIEW** → закрыт
  В modes/review.md добавлен запрет на "в целом хорошо", "рекомендую" и правило "No evaluations — just list issues".

- [x] **3. "Шаг назад" после правок** → закрыт
  Уже реализовано в modes/execute.md:186-199 ("Step Back Rule").

- [x] **4. Batch size влияет на качество** → закрыт
  Специфика режима Keeper, не общая проблема. В .ai/roles/keeper.md:155-162 уже реализовано.

- [x] **5. Нарушения state machine** → закрыт
  Правила уже есть в modes/execute.md:49-70. Когда сломается — тогда усилим.

- [x] **6. CurrentStepWork.md → CurrentReview.md** → закрыт
  Заменён на CurrentReview.md — только для ревью (замечания → синтез → тест-план).
  См. schemas/current_review.md, workflows/sddg.md.

- [x] **7. "Зачем?" как фильтр** → закрыт (Claude already knows this)

**Из ревью core_instructions.md:**

- [x] **8. Thesaurus занимает много места** → закрыт
  Ревью: убрана колонка "Has Name", остальное обосновано и оставлено.
  Rationale зафиксирован в spec/DOMAIN.md "Design Decisions".

- [ ] **9. "9 Rules" избыточны**
  **Проблема:** Многие правила очевидны или дублируются. 9 правил — много для запоминания.
  **Решение:** Сократить до 3-4 самых важных.

### Принципы из Anthropic Skills

При доработке core_instructions применять:
- **Progressive Disclosure** — не грузить всё сразу, а слоями по необходимости
- **Token efficiency** — каждая строка должна оправдывать своё место
- **Flat references** — максимум один переход до нужной информации

---

## ВЫХОДЫ

### Выход 1: Структура skills и stances

Созданы файлы в `packages/ai-kit/templates/`:

```
skills/
├── python.md           — экспертиза Python
├── typescript.md       — экспертиза TypeScript
└── instructions-architect.md — проектирование инструкций

stances/
├── dialectic.md    — исследование, вопрошание (DEFAULT)
├── pragmatic.md    — быстрые решения, минимум церемоний
├── briefing.md     — глубокий анализ → компактный вывод
├── critical.md     — поиск проблем
└── facilitator.md  — извлечение знаний через вопросы
```

**Статус:** Создано ✅

### Выход 2: Гайд по выбору stance

Файл `packages/ai-kit/docs/STANCE_GUIDE.md` — помогает пользователю выбрать подходящую позу для задачи.

**Статус:** Создано ✅

### Выход 3: Результаты анализа 40 use cases

Какие режимы и stances реально используются (по частоте):

**Режимы:**

| Режим | Частота | Для чего |
|-------|---------|----------|
| DIALOGUE | 24 | Обсуждение, принятие решений |
| EXECUTE | 20 | Написание кода, правки файлов |
| REVIEW | 12 | Проверка работы |
| PLANNING | 8 | Составление планов |
| SECRETARY | 5 | Архивация чата в файлы |
| COMMENTARY | 5 | Комментирование файлов |
| DIAGNOSTIC | 4 | Анализ ошибок (новый) |
| AUDIT | 2 | Проверка соответствия (новый) |

**Stances:** systematic (14), pragmatic (12), dialectic (10), self-correcting (6), constructive (4), adversarial (3), coordinator (3)

**Workflows:** solo (15), pair (10), sddg (4), multi (3)

**Статус:** Создано ✅

### Выход 4: Обновлённая архитектура AI Kit

Финальный результат перепроектирования — все компоненты согласованы, инструкции оптимизированы.

**Статус:** TODO

---

## ПЛАН ВНЕДРЕНИЯ

**Статус:** in progress

### Постановка задачи

#### Scope
Перепроектирование AI Kit — системы инструкций для AI агентов. Включает: modes, stances, skills, workflows, personas. Не включает: UI extension, MCP tools.

#### Фундаментальный вопрос
Как сделать систему инструкций одновременно мощной (покрывает все use cases) и простой (агент понимает без длинного контекста)?

#### Контекст
- Проанализировано 40 реальных сессий — понятно что используется
- spec/DOMAIN.md уже содержит базовые определения
- Findings #1-2 закрыты, #3-9 открыты

### Критерии завершённости

- [ ] Findings #3-9 закрыты (7 штук)
- [ ] spec/DOMAIN.md: полные определения mode/stance/skill/workflow/persona
- [ ] Quick Reference: шпаргалка ≤30 строк
- [ ] Синтаксис `!режим=`, `!поза=`, `!опыт=` описан
- [ ] Тест: новый агент без истории понимает что делать
- [ ] АЛ подтверждает: "пазл сложился"

---

### Фаза 1: Исследование ✅

- [x] Шаг 1-4: Создать skills/stances, собрать 40 use cases, проанализировать

**Выход:** [Результаты анализа](#выход-3-результаты-анализа-40-use-cases)

---

### Фаза 2: Findings

**Цель:** Закрыть все открытые вопросы из анализа.

#### Шаг 5: Finding #3 — "Шаг назад"
**Статус:** DONE
**Выход:** modes/execute.md:186-199

Уже реализовано ("Step Back Rule").

#### Шаг 6: Finding #4 — Batch size
**Статус:** DONE
**Выход:** .ai/roles/keeper.md:155-162

Специфика Keeper, не общая проблема.

#### Шаг 7: Finding #5 — State machine
**Статус:** DONE
**Выход:** modes/execute.md:49-70

Правила есть. Когда сломается — усилим.

#### Шаг 8: Finding #6 — CurrentStepWork → CurrentReview
**Статус:** DONE @turn(260127_034300M)
**Выход:** schemas/current_review.md, workflows/sddg.md

Ревью пройден. Deprecated файлы удалены.

#### Шаг 9: Finding #7 — "Зачем?" как фильтр
**Статус:** DONE @turn(260127_035130M)

Закрыт без изменений — Claude already knows this (anti-pattern ИА: "Explaining what Claude already knows").

#### Шаг 10: Finding #8 — Thesaurus
**Статус:** DONE @turn(260127_040944M)
**Выход:** spec/DOMAIN.md (Design Decisions), core_instructions.md (убран "Has Name")

Ревью каждой секции. Убрана неиспользуемая колонка. Rationale зафиксирован.

#### Шаг 11: Finding #9 — "9 Rules"
**Статус:** DONE @turn(260127_045200M)
**Выход:** core_instructions.md

- 9 Rules полностью удалены
- Добавлены 3 Axioms с примерами ❌/✅:
  1. AI agents write all code (no time estimates)
  2. Operate at expert level (L7)
  3. Honesty over comfort
- Red Lines удалены (устарели)
- Timestamp интегрирован в @turn() Parameters
- Session Start перемещён в APPENDIX

#### Шаг 11b: Ревью socrates.md
**Статус:** DONE @turn(260127_045200M)
**Выход:** personas/socrates.md

- Decision Format удалён (покрыт briefing stance)
- Forbidden Arguments удалён (дублирует Axiom)
- Expertise access удалён (дублирует Axiom L7)
- With other agents — упрощён
- Method переписан на сократический метод

---

### Фаза 3: Документация

**Цель:** Формализовать и сделать запоминаемым.

#### Шаг 12: Формальные определения
**Статус:** DONE @turn(260127_114601M)
**Выход:** spec/DOMAIN.md

Уже содержит: Core Concepts (Question, Duration, Example), Key Distinctions (Mode vs Stance, Skill vs Stance, Persona vs Mode).

#### Шаги 13-14: Quick Reference (объединены)
**Статус:** DONE @turn(260127_114601M)
**Выход:** docs/QUICK_REFERENCE.md

Объединено: синтаксис `!поза=`, `!опыт=` + таблицы modes/stances/skills. STANCE_GUIDE.md удалён (контент включён в QUICK_REFERENCE).

---

### Фаза 4: Валидация

#### Шаг 15: Комплексный ревью инструкций
**Статус:** DONE @turn(260129_003107M)
**Скилл:** instructions-architect

Ревью всех файлов ai-kit. Legacy изолирован в `_legacy/`, документация обновлена.
