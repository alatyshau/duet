# Git Worktree Support

**Статус:** backlog

---

## МОТИВАЦИЯ

Git worktrees позволяют работать с несколькими ветками одного репозитория одновременно. Это полезно когда нужно:
- Быстро переключиться на hotfix не стэшая текущую работу
- Сравнивать код двух веток side-by-side
- Параллельно работать над несколькими фичами

Duet должен понимать worktrees и связывать их с продуктом.

---

## ССЫЛКИ

- [260202_topic_vscode_extension.md](../260117_extension_design/260202_topic_vscode_extension.md) — основная спецификация (архив)

---

## НАРРАТИВ

### Структура на диске

```
~/DuetData/repos/
├── Duet.git      ← основной клон
├── Duet.wt-1     ← worktree #1
├── Duet.wt-2     ← worktree #2
└── Kreator.git
```

**Формат имени:** `{ProductName}.wt-{N}` где N — автоинкремент (1, 2, 3...).

### Связь worktree → product

Аналогично основному репо:
- `Duet.wt-1` → отрезаем `.wt-1` → `Duet` → ищем product в БД

### Создание worktree

**Команда:** `duet.addWorktree` (доступна из КОНТЕКСТ на git-репо)

**Алгоритм:**
1. Определить следующий номер: найти все `{Product}.wt-*` в `repos/`, взять max + 1
2. `git worktree add ../Duet.wt-N` (создаёт detached HEAD)
3. Открыть QuickPick: "Какую ветку checkout?" (список веток из основного репо)
4. `git checkout <branch>` в новом worktree

**Удаление:** Пользователь удаляет папку руками. `git worktree prune` почистит ссылки.

### Отображение в КОНТЕКСТ

Worktrees — на одном уровне с основным репо, под продуктом:

```
$(organization) МетаЛаб
  $(briefcase) ТехноЛаб
    $(package) Duet
      $(git-branch) Duet.git
      $(git-branch) Duet.wt-1
      $(git-branch) Duet.wt-2
```

### Открытие worktree

**Из секции ДЕЛА:**
- Клик по продукту → открывает основной `.git`
- Inline button или контекстное меню → QuickPick со списком worktrees

**Из секции КОНТЕКСТ:**
- QuickPick на git-репо: "Add worktree...", "Open worktree..."

---

## ОТКРЫТЫЕ ВОПРОСЫ

Нет открытых вопросов.

---

## ВЫХОДЫ

### Команды

- `duet.addWorktree` — создание нового worktree
- QuickPick для выбора ветки при создании
- QuickPick на git-репо: "Add worktree...", "Open worktree..."

### UI

- Worktrees отображаются в КОНТЕКСТ под продуктом
- Inline button или контекстное меню в ДЕЛА для открытия worktree

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

**Scope:** Git worktree support в расширении Duet.

**Контекст:**
- `contextBreadcrumb.ts` уже распознаёт `.wt-N` суффикс (не протестировано)
- Зависит от завершения MVP расширения

### Критерии завершённости

- [ ] Worktree создаётся командой `duet.addWorktree`
- [ ] QuickPick позволяет выбрать ветку
- [ ] Worktrees отображаются в КОНТЕКСТ
- [ ] Worktree открывается из UI

### Шаг 1: Worktree Support

**Статус:** TODO

**Ход работы:**
- [ ] Обновить `contextBreadcrumb.ts`: протестировать `.wt-N` суффикс
- [ ] Команда `duet.addWorktree`: создание нового worktree
- [ ] QuickPick для выбора ветки при создании
- [ ] Отображение worktrees в КОНТЕКСТ под продуктом
- [ ] QuickPick на git-репо в КОНТЕКСТ: "Add worktree...", "Open worktree..."
- [ ] Inline button или контекстное меню в ДЕЛА для открытия worktree
- [ ] Проверить: worktree создаётся, отображается, открывается
