# Пакет packages/ai-roles/ — сборка ролей из шаблонов

**Статус:** Черновик

---

## МОТИВАЦИЯ

### Зачем

> [ALA] создай packages/ai-roles/ — туда templates (secretary.md.j2, principal.md.j2...), _includes (red_lines.md, chat_doc.md), build.py. Результат пуляется в .ai/roles.

Идея: модульность ролей. Вместо монолитных .md файлов — шаблоны Jinja2 с переиспользуемыми включениями. Это позволит:
- Общие секции (red lines, chat doc format) в одном месте
- Версионирование шаблонов
- Автоматическая сборка в .ai/roles/

### Что я понимаю

[Claude:Secretary] Jinja2 (.j2) — хороший выбор для шаблонизации. `_includes/` — конвенция из Jekyll/Hugo для partials.

---

## ССЫЛКИ

- [topic_document_structure.md](topic_document_structure.md) — структура чат-документов (может попасть в _includes)
- [topic_comments_format.md](topic_comments_format.md) — формат комментариев (может попасть в _includes)
- [role_secretary.md](role_secretary.md) — обсуждение роли Secretary (из него генерится secretary.md.j2)

---

## ПЛАН И СТАТУС ВНЕДРЕНИЯ

- **Статус:** в работе (структура создана)
- **Цель:** создать packages/ai-roles/ со сборкой ролей из шаблонов
- **Когда удалять:** когда структура принята и работает

**Открытые вопросы:**
- [x] ~~Что делать с текущими scripts/?~~ → Перенесены в packages/ai-roles/scripts/
- [x] ~~Куда положить build.py?~~ → В корне packages/ai-roles/
- [x] ~~Какие includes нужны?~~ → header.md, red_lines.md, chat_doc.md, dialectics.md
- [ ] Зависимость Jinja2 — добавлять в requirements.txt?
- [ ] Тестирование build.py — запустить и проверить output

---

## НАРРАТИВ

### Решение

> [ALA] packages/ai-roles/scripts — это личные скрипты ролей, поэтому логично туда их двинуть. ai-roles на втором этапе уедут в отдельный репо и будут дёргаться через submodule. У меня 10 проектов куда это всё надо внедрить.

[Claude:Secretary] Понял! Это переиспользуемый модуль для 10+ проектов. Скрипты keeper — это часть инфраструктуры AI-ролей, поэтому они едут вместе.

### Финальная структура (создана)

```
packages/ai-roles/
├── build.py              # Скрипт сборки ролей (Jinja2)
├── section.json          # Мета-данные пакета
├── README.md
│
├── scripts/              # Скрипты автоматизации
│   ├── ai_doc_updater.py
│   ├── ai_git_updater.py
│   ├── backlog_updater.py
│   └── keeper_utils.py
│
└── templates/            # Jinja2 шаблоны ролей
    ├── secretary.md.j2
    ├── principal.md.j2
    ├── keeper.md.j2
    ├── se.md.j2
    │
    └── _includes/        # Переиспользуемые части
        ├── header.md     # Общий header с версией
        ├── red_lines.md  # Красные линии для всех ролей
        ├── chat_doc.md   # Формат чат-документов
        └── dialectics.md # Принципы диалектического мышления
```

### Использование

```bash
# Сборка в .ai/roles/
python packages/ai-roles/build.py

# Или с параметрами
python packages/ai-roles/build.py -o /custom/output -p MyProject
```

---

## ВЫХОДЫ

**Создано:**

| Компонент | Статус |
|-----------|--------|
| `packages/ai-roles/` | ✓ создан |
| `scripts/` → `packages/ai-roles/scripts/` | ✓ перенесены |
| `build.py` | ✓ создан |
| Шаблоны `.md.j2` | ✓ secretary, principal, keeper, se |
| `_includes/` | ✓ header, red_lines, chat_doc, dialectics |

**Шаблоны ролей:**
- `secretary.md.j2` — Secretary (удержатель контекста)
- `principal.md.j2` — Principal (архитектор)
- `keeper.md.j2` — Keeper (хранитель документации)
- `se.md.j2` → `l6-engineer.md` — Software Engineer

**Includes:**
- `header.md` — версия, проект, дата генерации
- `red_lines.md` — красные линии (что AI никогда не делает)
- `chat_doc.md` — формат чат-документов
- `dialectics.md` — принципы диалектического мышления

**Следующие шаги:**
- [ ] Протестировать `build.py`
- [ ] Добавить jinja2 в requirements.txt
- [ ] Подготовить к выносу в отдельный репо

