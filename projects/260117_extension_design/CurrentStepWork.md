# Ход работы: TreeView — Секция КОНТЕКСТ
> Временный файл. Чистится после закрытия шага.

**Проект:** [topic_vscode_extension.md](topic_vscode_extension.md)
**Шаг:** 6
**Статус:** WIP

---

## Чеклист

- [ ] Создать `src/core/tree/contextBreadcrumb.ts` — логика определения контекста
- [ ] Создать `src/vscode/providers/ContextProvider.ts` — TreeDataProvider
- [ ] Определение контекста: путь в иерархии / orphan / вне иерархии
- [ ] Кнопка [⚙️] → QuickPick (открыть/изменить DuetData)
- [ ] Unit-тесты для core/tree/contextBreadcrumb.ts
- [ ] Проверить: контекст показывается корректно

---

## Контекст

### Что такое секция КОНТЕКСТ

Секция КОНТЕКСТ показывает **путь текущего окна VS Code в бизнес-иерархии**. Источник данных — `vscode.workspace.workspaceFolders` (НЕ активный файл!).

```
┌─────────────────────────────────────┐
│ КОНТЕКСТ                      [⚙️] │  ← шапка с кнопкой настроек
├─────────────────────────────────────┤
│   🔬 МетаЛаб                       │  ← цепочка-breadcrumb
│     💻 ТехноЛаб                    │
│       ● Duet [local ✓]             │
└─────────────────────────────────────┘
```

### Взаимодействие с элементами

**Кнопка [⚙️]** → QuickPick:
- "Открыть папку DuetData" → Finder/Explorer
- "Изменить расположение DuetData" → folder picker → обновить setting

### Когда перерисовывать

- После сканирования бизнес-директорий
- При открытии/закрытии папок в окне VS Code (`vscode.workspace.onDidChangeWorkspaceFolders`)
- File watchers на метаданные не нужны — ждём кнопку 🔄

### Источник данных

Анализируем `vscode.workspace.workspaceFolders` — список открытых папок в текущем окне.

Если ничего не открыто → секция КОНТЕКСТ пуста.

### Структура отображения

Каждая открытая папка превращается в **цепочку-breadcrumb**:

```
бизнес → [дело [→ дело]] → продукт → git-папка
```

Цепочка может быть короче (только бизнес, или бизнес → дело).

**Корень дерева** — всегда бизнес (для сущностей из БД) или внешняя папка.

**Git-папка** отображается как **ребёнок** продукта (иконка `$(git-branch)` — ThemeIcon), не как отдельный корень.

### Алгоритм построения

```
ПАПКИ := vscode.workspace.workspaceFolders

1. Папки из DuetData/repos/ (с суффиксом .git):
   │
   ├─ Отрезаем .git → ищем в БД WHERE name = ?
   │   │
   │   ├─ Не нашли → orphan (корень дерева + ошибка)
   │   │
   │   ├─ Нашли, type ≠ product → ошибка "Имя занято {type}"
   │   │
   │   └─ Нашли product → цепочка бизнес/дело/продукт/git
   │
   └─ Удаляем из ПАПКИ (обработаны)

2. Папки из DuetData/repos/ (без суффикса .git):
   │
   └─ Внешняя папка (без ошибки — возможна миграция)

3. Остальные ПАПКИ:
   │
   ├─ Есть в БД → цепочка по иерархии (бизнес/дело/продукт)
   │
   └─ Нет в БД → внешняя папка (иконка 📁 серая)
```

**Отображение ошибок:** ошибки вкладываются под проблемный узел. Клик по ошибке открывает Editor Tab (WebView) с md-инструкцией.

### Сортировка корней

По типу листового узла цепочки, затем по алфавиту:

1. Бизнесы (цепочка заканчивается на бизнес)
2. Дела (цепочка заканчивается на дело)
3. Продукты (цепочка заканчивается на продукт; git-папка внутри)
4. Внешние папки

### Связь repo → product

Поиск по **имени** (не по git_url):
- Имя папки `Duet.git` → отрезаем `.git` → ищем `WHERE name = 'Duet'`
- Имя = идентификатор, git_url = свойство (может быть ошибочным)

### Состояния ошибок/информации

| Ситуация | Отображение в breadcrumb |
|----------|--------------------------|
| Orphan repo (в repos/) | `⚠️ Репозиторий не связан` |
| Имя repo занято другим типом | `⚠️ Имя занято {type}` |
| Git-repo вне repos/ | `⚠️ Репозиторий вне DuetData` |
| Папка вне иерархии | `ℹ️ Папка вне иерархии` |

### Схема БД (для запросов)

```sql
CREATE TABLE entities (
  id INTEGER PRIMARY KEY,
  type TEXT,              -- business | stream | product | project
  name TEXT,
  icon TEXT,
  drive_path TEXT UNIQUE, -- используется как TreeItem.id
  parent_id INTEGER REFERENCES entities(id),
  git_url TEXT            -- только для product
);

CREATE UNIQUE INDEX idx_name ON entities(name);
```

### Архитектура кода

```
packages/extension/src/
├── core/
│   └── tree/
│       └── contextBreadcrumb.ts  ← логика (чистая, без vscode)
└── vscode/
    └── providers/
        └── ContextProvider.ts    ← TreeDataProvider обёртка
```

**Правило:** `core/` не импортирует `vscode`. Только стандартные Node.js модули.

### Зависимости для ContextBreadcrumb

Для определения контекста нужны:
1. `DatabaseManager` — запросы к index.db
2. `Paths` (или `reposPath`) — для определения Orphan (папка в repos/, но не в БД)

---

## Задание для Гефеста

### 1. Рефакторинг существующего contextBreadcrumb.ts

**ВАЖНО:** Файл уже существует, но использует неправильный подход.

Текущий баг: контекст определяется через `activeTextEditor` (активный файл).
По спеке: контекст = `vscode.workspace.workspaceFolders` (открытые папки в окне).

**Исправить:**
- `ContextBreadcrumb` должен принимать массив путей (папок), не путь к файлу
- Добавить `Paths` (или `reposPath: string`) в зависимости для Orphan-детекции

### 2. Логика определения контекста

Реализовать алгоритм построения из секции "Алгоритм построения" выше.

Каждая папка из workspaceFolders должна превращаться в один из вариантов:
- Цепочка breadcrumb (бизнес → дело* → продукт → git)
- Ошибка Orphan / Имя занято / Вне repos
- Внешняя папка (ℹ️)

### 3. Структура данных

Результат `ContextBreadcrumb.build()` — массив деревьев для TreeDataProvider:

```typescript
interface ContextNode {
  type: 'business' | 'stream' | 'product' | 'git' | 'external' | 'error';
  name: string;
  icon: string;  // emoji или ThemeIcon id
  children: ContextNode[];
  errorCode?: 'orphan' | 'name_conflict' | 'outside_repos' | 'outside_hierarchy';
}
```

### 4. ContextProvider.ts

TreeDataProvider, который:
- Подписан на `vscode.workspace.onDidChangeWorkspaceFolders`
- При изменении — вызывает `contextBreadcrumb.build(paths)` и `fire()`
- Кнопка [⚙️] в шапке → QuickPick с опциями

Команды для package.json:
- `duet.openDataFolder` — открыть DuetData в файловом менеджере
- `duet.changeDataFolder` — folder picker → обновить setting

### 5. Unit-тесты

Создать `src/test/unit/contextBreadcrumb.test.ts`:

Покрыть сценарии:
- Пустой workspaceFolders → пустой результат
- Папка из repos/ с суффиксом .git → найден product → цепочка
- Папка из repos/ с суффиксом .git → не найден → orphan
- Папка из repos/ с суффиксом .git → найден, но type ≠ product → ошибка
- Папка из Drive → найдена в БД → цепочка
- Папка из Drive → не найдена → external
- Сортировка: бизнесы > дела > продукты > external

### 6. Интеграция

- Зарегистрировать ContextProvider в extension.ts
- Добавить view в package.json (если ещё нет)
- Связать с refresh (после scan — перерисовать контекст)

---

## Гефест — отчёт


---

## Дедал@Copilot — ревью


---

## Дедал@Codex — ревью


---

## Сократ — синтез


---
