# VS Code Extension "Duet"

**Статус:** черновик

---

## МОТИВАЦИЯ

Расширение для VS Code, реализующее концепцию "ОС Жизни":

- **Переносимость** — сесть за любой компьютер, указать папку, и вся структура развернётся
- **Безопасность** — секреты (.env) и структура бизнесов в Google Drive (монтируется как локальная FS)
- **Скорость** — Git и Node.js на нативном железе без тормозов облачной FS

**Ключевая идея:** Google Drive = Registry + Config, Локальный диск = Runtime.

---

## ССЫЛКИ

- [input/summary.md](input/summary.md) — исходный черновик спецификации

---

## НАРРАТИВ

### Решения предыдущей сессии

- **projects/ detection** — проект = папка непосредственно внутри `/projects/`
- **Multi-window sync** — не нужен, re-scan по кнопке 🔄
- **Git auth** — полагаемся на системный git (ssh-agent, credential helper)
- **Orphan/Stale** — единая логика: ⚠️ в breadcrumb → Editor Tab с инструкцией
- **mtime-оптимизация** — убрали, парсить JSON при старте ок
- **Emoji** — из поля `icon` в манифестах
- **Формат манифестов** — определён (business.json, stream.json, product.json)

### Решения текущей сессии

- **Отказ от симлинков** — Windows требует Developer Mode для симлинков (99% пользователей не смогут). Решение: multi-root workspace + ручное копирование конфигов. Спасибо Codex за находку.
- **Суффикс .git для repos** — папка клонируется как `Duet.git`, чтобы отличать от `Duet` на Drive в multi-root workspace
- **Multi-root workspace** — workspace-файл в `~/DuetData/workspaces/`, генерируется при первом клике на продукт
- **hydrate[] убран** — пользователь копирует .env и конфиги вручную (one-time). Автоматизация (import) — в nice to have.
- **Конфигурация** — VS Code settings только `data_folder`, остальное в `~/DuetData/config.json`
- **Cursor/VS Code** — общая DuetData, настройки в каждом IDE отдельно (только путь)
- **Sidebar структура** — три секции: Breadcrumb, Бизнес-Структура, Проекты
- **Кнопка добавления бизнеса** — ВСЕГДА в шапке, независимо от контекста
- **Дерево бизнесов** — всегда строится от корня, не зависит от текущего окна
- **Папка вне структуры** — два подсценария:
  - git-repo → Orphan (ошибка в breadcrumb)
  - просто папка → аналогично (ошибка в breadcrumb → Editor Tab)
- **Multi-root workspace** — не особый кейс, Explorer нас не касается
- **Расширением можно не пользоваться** — честно показываем "вне иерархии", пользователь решает
- **Секция "Проекты"** — только проекты текущего продукта (не глобальный список)
- **Режимы обзорный/прицельный** — убраны, разница описана в алгоритме старта
- **UI секции** — названия КОНТЕКСТ, ДЕЛА, ПРОЕКТЫ; чёткие шапки с кнопками
- **Кнопки collapse/expand** — [−] сворачивает до бизнесов (они всегда видны), [+] разворачивает всё
- **Multi-root workspace** — файл `~/DuetData/all-businesses.code-workspace`, генерируется автоматически
- **Git-repo вне repos/** — показать инструкцию, перемещать вручную (одноразовый фикс)
- **business.json** — если нет при добавлении папки, создаём автоматически (name=папка, icon=📁)
- **ДЕЛА: визуальный корень (костыль)** — элемент `[МОИ ДЕЛА]` в начале списка с `collapsibleState: None` (без стрелки, без детей). Бизнесы — тоже top-level элементы (со стрелками). Все на одном уровне, но визуально `[МОИ ДЕЛА]` выглядит как заголовок. При CollapseAll видны все top-level: и `[МОИ ДЕЛА]`, и свёрнутые бизнесы. **План Б:** если костыль не сработает — убрать `[МОИ ДЕЛА]`, кнопку [→] для multi-root workspace вынести в шапку секции ДЕЛА
- **Atomic write: `write-file-atomic`** — вместо ручной реализации temp+rename используем библиотеку. Причина: Windows `fs.rename()` не перезаписывает существующий файл (в отличие от Unix). Библиотека инкапсулирует платформенные различия. Критерий: код должен быть понятен через 30 лет без археологии.
- **Async I/O везде** — используем `fs/promises` для всех файловых операций (config.json, index.db, scan). Даже для маленьких файлов — консистентность важнее микрооптимизаций. Event Loop свободен всегда.
- **camelCase/snake_case mapping** — JSON-контракт использует snake_case (`business_folders`), TypeScript-интерфейс camelCase (`businessFolders`). Маппинг на границе сериализации: в `validate()` при чтении, в `write()` при записи. `eslint-disable` только на JSON-литерале в write().

---

## ВЫХОДЫ

### 1. Модель данных

#### Тезаурус

| Термин | EN | Значение | Пример |
|--------|----|----------|--------|
| **Бизнес** | business | Корневая сущность, верхний уровень | `МетаЛаб`, `Семья`, `База` |
| **Дело** | stream | Отдел/поток работы внутри бизнеса | `ТехноЛаб`, `ДомоДел` |
| **Продукт** | product | Конкретный deliverable с репо/папкой | `Duet`, `Kreator` |
| **Компонент** | component | Часть продукта (пакет в монорепе) | `packages/ai-kit` |
| **Проект** | project | GTD-проект: задачи с критерием конца | `projects/260110_ai_talks` |

> **Иерархия:** Бизнес → Дело → Продукт → (Компонент) → Проект

#### Манифесты

Файлы на Google Drive, определяющие сущности:

```jsonc
// business.json
{ "name": "МетаЛаб", "icon": "🔬" }

// stream.json
{ "name": "ТехноЛаб", "icon": "💻" }

// product.json
{
  "name": "Duet",
  "icon": "🎭",
  "git_url": "git@github.com:user/duet.git"
}
```

#### Схема index.db

SQLite кэш иерархии для быстрого доступа:

```sql
CREATE TABLE entities (
  id INTEGER PRIMARY KEY,
  type TEXT,              -- business | stream | product | project
  name TEXT,
  icon TEXT,
  drive_path TEXT UNIQUE, -- используется как TreeItem.id для стабильности UI
  parent_id INTEGER REFERENCES entities(id)
);
```

> **TreeItem.id:** Используем `drive_path` (не autoincrement id) как идентификатор для TreeView. Это гарантирует стабильность состояния UI (развёрнутые/свёрнутые узлы) между пересканированиями.

#### Распознавание проектов

**Правило:** проект = папка внутри `/projects/` (непосредственный родитель).

```
product/
├── projects/           ← маркер
│   ├── 260110_ai_talks ← проект ✓
│   └── 260115_refactor ← проект ✓
└── src/
    └── some_folder     ← НЕ проект
```

---

### 2. Конфигурация

#### VS Code User Settings

| Ключ | Тип | Описание |
|------|-----|----------|
| `duet.data_folder` | string | Путь к `~/DuetData` |

> Единственная настройка в VS Code. Задаётся при первом запуске.
> В Cursor — отдельно, но указывает на ту же DuetData.

#### ~/DuetData/config.json

```jsonc
{
  "business_folders": [
    "/Users/.../GoogleDrive/МетаЛаб",
    "/Users/.../GoogleDrive/Семья"
  ]
}
```

> Бизнес-папки добавляются через UI (кнопка ➕ в шапке sidebar).
> Общий для VS Code и Cursor — оба читают один файл.

#### ~/DuetData/all-businesses.code-workspace

Multi-root workspace файл, генерируемый автоматически:

```jsonc
{
  "folders": [
    { "path": "/Users/.../GoogleDrive/МетаЛаб" },
    { "path": "/Users/.../GoogleDrive/Семья" }
  ]
}
```

- Создаётся/обновляется при добавлении бизнес-папки
- Открывается по клику [→] на `[МОИ ДЕЛА]` в секции ДЕЛА

#### Локальный диск

```
~/DuetData/
├── config.json           ← бизнес-папки
├── all-businesses.code-workspace
├── data/
│   └── index.db          ← SQLite кэш
├── repos/
│   └── Duet.git/         ← клонированные git-репо (суффикс .git)
└── workspaces/
    └── Duet.code-workspace  ← multi-root workspace файлы
```

---

### 3. Архитектура кода

#### Структура пакета (core/vscode)

**Принцип:** Отделить чистую логику от VS Code API для тестируемости.

```
packages/extension/src/
├── core/                  ← Чистая логика, БЕЗ import * from 'vscode'
│   ├── config.ts          ← Чтение/запись config.json
│   ├── paths.ts           ← Резолвинг путей
│   ├── workspace.ts       ← Генерация .code-workspace, multi-root логика
│   ├── db/                ← SQLite операции
│   │   └── index.ts
│   ├── scanner.ts         ← Сканирование Drive
│   └── tree/              ← Построение структур данных для UI
│       ├── businessTree.ts
│       ├── contextBreadcrumb.ts
│       └── projectsList.ts
│
├── vscode/                ← VS Code glue code
│   ├── extension.ts       ← Точка входа
│   ├── providers/         ← TreeDataProvider обёртки
│   │   ├── OnboardingProvider.ts
│   │   ├── BusinessTreeProvider.ts
│   │   ├── ContextProvider.ts
│   │   └── ProjectsProvider.ts
│   ├── commands/          ← Команды расширения
│   │   ├── openFolder.ts
│   │   ├── addBusiness.ts
│   │   └── refresh.ts
│   └── webviews/          ← Editor Tabs (для edge cases)
│
└── test/
    ├── unit/              ← Тесты core/ (vitest)
    └── integration/       ← Тесты vscode/ (@vscode/test-electron)
```

**Правило:** `core/` не импортирует `vscode`. Только стандартные Node.js модули и зависимости.

#### Стратегия тестирования

| Слой | Инструмент | Покрытие |
|------|------------|----------|
| `core/` | vitest | ~80%, unit tests |
| `vscode/` | @vscode/test-electron | glue code only |

---

### 4. Поведение расширения

#### Алгоритм старта

```
СТАРТ
  │
  ▼
duet.data_folder задан? ─НЕТ→ Onboarding: выбрать/создать DuetData
  │
  ДА
  ▼
Загрузить config.json
  │
  ▼
business_folders пуст? ─ДА→ Sidebar: "Нет бизнесов, нажмите ➕"
  │
  НЕТ
  ▼
index.db есть? ─НЕТ→ Сканировать Drive → создать
  │
  ДА
  ▼
Построить sidebar (три секции)
  │
  ▼
Определить контекст текущего окна:
  │
  ├─ Нет открытой папки → Breadcrumb пуст
  │
  ├─ Папка в business_folders → Breadcrumb: путь в иерархии
  │
  ├─ git-repo в repos/ (или workspace) → Найти product
  │     │
  │     ├─ найден → Breadcrumb: путь в иерархии
  │     └─ не найден → Breadcrumb: ⚠️ Orphan
  │
  └─ Другая папка → Breadcrumb: ℹ️ Вне иерархии
```

#### Сканирование и индексация

1. Расширение сканирует Google Drive (по путям из `business_folders`)
2. Находит все файлы `business.json`, `stream.json`, `product.json`
3. Распознаёт **проектные папки** внутри продуктов (папка `projects/` с подпапками)
4. Сохраняет в `index.db` для быстрого доступа
5. Строит в боковой панели иерархическое дерево на основе `index.db`

#### Multi-root Workspace

**Клик на продукт с git_url:**

```
Клик на продукт в ДЕЛА
        │
        ▼
Есть ~/DuetData/repos/Duet.git/?
        │
   НЕТ──┴──ДА
    │       │
    ▼       │
git clone   │
    │       │
    └───────┤
            ▼
Есть ~/DuetData/workspaces/Duet.code-workspace?
        │
   НЕТ──┴──ДА
    │       │
    ▼       │
генерировать│
    │       │
    └───────┤
            ▼
Открыть workspace-файл
```

**Workspace-файл (`~/DuetData/workspaces/Duet.code-workspace`):**
```jsonc
{
  "folders": [
    { "path": "../repos/Duet.git" },           // относительный путь к git-repo
    { "path": "/Users/.../Drive/.../Duet" }    // абсолютный путь к Drive (генерируется локально)
  ]
}
```

> Файл не переносим между машинами — генерируется при первом клике на продукт.

**Результат в Explorer:**
```
DUET.GIT (workspace)
├── src/
├── package.json
└── ...

DUET (Drive)
├── .env           ← секреты
├── secrets/
└── product.json
```

**Зачем:**
- Файлы на Drive видны рядом с кодом
- Легко скопировать .env в git-repo (one-time)
- Нет симлинков, нет проблем с Windows

> Полный re-scan дерева — только по кнопке 🔄.

#### Логика в каждом окне

Расширение работает в каждом окне VS Code. Дерево показывается везде одинаково.

**Любое окно:**
- Показывает полное дерево из `index.db`
- Выделяет текущий контекст в breadcrumb и TreeView
- Может обновить дерево, открыть настройки

**Окно workspace (git-repo + Drive):**
- Открыто через `.code-workspace` файл
- Обе папки уже в workspace (git-repo + Drive)
- Breadcrumb показывает путь в иерархии

#### Flow добавления бизнес-папки

```
Клик ➕ в шапке
        │
        ▼
Picker: выбрать папку
        │
        ▼
┌─ business.json есть? ─┐
│                       │
НЕТ                    ДА
│                       │
▼                       │
Создать business.json   │
  name = имя папки      │
  icon = 📁             │
│                       │
└───────────┬───────────┘
            │
            ▼
Добавить путь в config.json
            │
            ▼
Сканировать папку
            │
            ▼
Обновить index.db и sidebar
```

---

### 5. UI

#### Sidebar (три секции TreeView)

Три секции всегда присутствуют (кроме состояния Onboarding):

```
┌─────────────────────────────────────┐
│ КОНТЕКСТ                      [⚙️] │  ← Секция 1: шапка
├─────────────────────────────────────┤
│   🔬 МетаЛаб                       │  ← содержимое
│     💻 ТехноЛаб                    │
│       ● Duet [local ✓]             │
├─────────────────────────────────────┤
│ ДЕЛА                  🔄 ➕ [−][+] │  ← Секция 2: шапка с кнопками
├─────────────────────────────────────┤
│   [МОИ ДЕЛА]                   [→] │  ← костыль: None, без стрелки
│   ▼ 🔬 МетаЛаб              [↵][→] │  ← top-level, со стрелкой
│     ▼ 💻 ТехноЛаб           [↵][→] │
│       ● Duet ← выделен      [↵][→] │
│       ○ Kreator             [↵][→] │
│   ▶ 👨‍👩‍👧 Семья                [↵][→] │  ← top-level, со стрелкой
├─────────────────────────────────────┤
│ ПРОЕКТЫ                            │  ← Секция 3: шапка
├─────────────────────────────────────┤
│   ○ 260117_extension_design        │
│   ○ 260110_ai_talks                │
└─────────────────────────────────────┘
```

#### Взаимодействие с элементами

**Секция КОНТЕКСТ:**
- Показывает путь к текущему окну в иерархии
- Или ошибку/информацию (кликабельно → Editor Tab)
- [⚙️] → QuickPick:
  - "Открыть папку DuetData" → Finder/Explorer
  - "Изменить расположение DuetData" → folder picker → обновить setting

**Секция ДЕЛА:**
- 🔄 — re-scan всех бизнес-папок
- ➕ — добавить бизнес-папку
- [−] — свернуть всё (до уровня бизнесов — они всегда видны)
- [+] — развернуть всё
- [↵] у элемента — открыть в текущем окне
- [→] у элемента — открыть в новом окне
- Клик по элементу — выделить, обновить секцию ПРОЕКТЫ

**Логика открытия (для [↵] и [→]):**
- Бизнес/Дело → открыть папку на Drive
- Продукт с `git_url`:
  - Есть локально → открыть из `repos/`
  - Нет локально → `git clone` + открыть
- Продукт без `git_url` → открыть папку на Drive
- `[МОИ ДЕЛА]` → открыть multi-root workspace (all-businesses.code-workspace)

**Секция ПРОЕКТЫ:**
- Показывает проекты выбранного в ДЕЛА продукта
- Пуста если выбран не продукт
- Клик по проекту → открыть папку проекта

#### Состояния UI

**Onboarding (нет DuetData):**
```
┌─────────────────────────────────────┐
│ DUET                           [⚙️] │
├─────────────────────────────────────┤
│                                     │
│   Укажите папку для данных:         │
│                                     │
│   [📁 Выбрать папку...]             │
│                                     │
│   [✨ Создать ~/DuetData]           │
│                                     │
└─────────────────────────────────────┘
```

**DuetData есть, бизнесов нет:**
```
┌─────────────────────────────────────┐
│ КОНТЕКСТ                           │
├─────────────────────────────────────┤
│   (текущая папка или ошибка)        │
├─────────────────────────────────────┤
│ ДЕЛА                        ➕     │
├─────────────────────────────────────┤
│   Нет бизнесов.                     │
│   Нажмите ➕ чтобы добавить.        │
├─────────────────────────────────────┤
│ ПРОЕКТЫ                            │
├─────────────────────────────────────┤
│   —                                 │
└─────────────────────────────────────┘
```

**Папка вне структуры:**
```
│ КОНТЕКСТ                           │
├─────────────────────────────────────┤
│   ⚠️ Репозиторий не связан          │  ← orphan repo
│   ⚠️ Репозиторий вне DuetData       │  ← git-repo вне repos/
│   ℹ️ Папка вне иерархии             │  ← обычная папка
```

> Во всех случаях секции ДЕЛА и ПРОЕКТЫ работают как обычно.

---

### 6. Edge Cases

#### Orphan Repo

Папка в `~/DuetData/repos/` не найдена в `index.db`.

**Breadcrumb:** `⚠️ Репозиторий не связан` → Editor Tab:
- Кнопка "Связать с существующим продуктом" → QuickPick
- Кнопка "Создать новый продукт на Drive"
- Кнопка "Игнорировать"

#### Git-repo вне DuetData/repos

**Breadcrumb:** `⚠️ Репозиторий вне DuetData` → Editor Tab:
- Инструкция: переместить вручную + связать с продуктом
- Кнопка "Понятно"

> Автоматическое перемещение не делаем — это одноразовые фиксы.

#### Обычная папка вне структуры

**Breadcrumb:** `ℹ️ Папка вне иерархии` → Editor Tab:
- Объяснение что это за расширение
- Как добавить бизнес-папку (кнопка ➕)

#### Сводная таблица

| Ситуация | Поведение |
|----------|-----------|
| Orphan repo (в repos/) | Breadcrumb: ⚠️ → Editor Tab с QuickPick |
| Git-repo вне repos/ | Breadcrumb: ⚠️ → Editor Tab с инструкцией |
| Папка вне иерархии | Breadcrumb: ℹ️ → Editor Tab с инструкцией |
| Product удалён на Drive | Breadcrumb: ⚠️ (та же логика что Orphan) |
| Ошибки FS при чтении | try-catch → работаем с кэшем `index.db` |
| Git auth | Полагаемся на системный git (ssh-agent, credential helper) |
| Multi-window sync | Не нужен. Re-scan только по 🔄. SQLite parallel reads |
| Cursor + VS Code | Общая DuetData, настройки (только путь) в каждом IDE |
| Бизнес-папка без business.json | Создаём автоматически (name=папка, icon=📁) |

---

## ПЛАН ВНЕДРЕНИЯ

**Статус:** планирование

**Критерии завершённости:**
- [ ] Расширение устанавливается и активируется в VS Code
- [ ] Sidebar показывает три секции (КОНТЕКСТ, ДЕЛА, ПРОЕКТЫ)
- [ ] Дерево бизнесов строится из манифестов на Drive
- [ ] Клик на продукт открывает/клонирует репо (в папку `Имя.git`)
- [ ] Multi-root workspace: Drive-папка автоматически добавляется при открытии git-repo
- [ ] Orphan repos детектируются и показываются в UI

---

### Шаг 1: Scaffolding
**Статус:** DONE
**Выход:** [Структура пакета](#структура-пакета-corevscode)

Создать структуру пакета расширения в `packages/extension/`.

**Ход работы:**
- [x] Создать `packages/extension/package.json` (имя: `duet`, publisher, activationEvents)
- [x] Настроить TypeScript (`tsconfig.json`)
- [x] Создать структуру папок: `src/core/`, `src/vscode/`, `src/test/`
- [x] Создать точку входа `src/vscode/extension.ts` с activate/deactivate
- [x] Добавить esbuild для сборки
- [x] Настроить vitest для unit-тестов (`src/test/unit/`)
- [x] Проверить: расширение активируется, показывает "Hello" в Output

---

### Шаг 2: Settings & Config
**Статус:** DONE
**Выход:** [Конфигурация](#2-конфигурация)

Реализовать чтение/запись конфигурации.

**Ход работы:**
- [x] Добавить setting `duet.data_folder` в `package.json` (contributes.configuration)
- [x] Создать `src/core/config.ts` — чтение/запись `~/DuetData/config.json`
- [x] Создать `src/core/paths.ts` — резолвинг путей (data_folder, repos/, config.json)
- [x] Unit-тесты для config.ts и paths.ts
- [x] **Рефакторинг:** config.ts → async (`fs/promises`) — см. решение "Async I/O везде"
- [x] Проверить: setting читается, config.json создаётся/обновляется

> Config перечитывается при 🔄 (re-scan). Отдельный watcher не нужен.

---

### Шаг 3: Onboarding
**Статус:** DONE
**Выход:** [Состояния UI](#состояния-ui)

UI для первого запуска (нет data_folder). Секция DUET (в боковой панели) вместо трёх обычных.

**Ход работы:**
- [x] Создать `src/vscode/providers/OnboardingProvider.ts` (TreeDataProvider)
- [x] Кнопка "Выбрать папку" → folder picker → сохранить в settings
- [x] Кнопка "Создать ~/DuetData" → создать папку + сохранить
- [x] После выбора → переход к обычному sidebar
- [x] Проверить: Onboarding показывается при пустом setting

---

### Шаг 4: Scanner & Database
**Статус:** TODO
**Выход:** [Схема index.db](#схема-indexdb)

Сканирование Drive и построение SQLite индекса.

**Persist-стратегия (sql.js):**
- sql.js работает in-memory (WASM), WAL не применим (WAL требует файловую БД)
- Load: `fs.readFile` → `new SQL.Database(data)`
- Save: `db.export()` → `write-file-atomic` (библиотека, кроссплатформенный atomic write)
- Защита от двойного клика: флаг `scanInProgress` в памяти окна, кнопка 🔄 disabled

**Конкурентная запись (два окна нажали 🔄 одновременно):**
- Окно A и B читают index.db, сканируют Drive параллельно
- Окно A заканчивает, пишет через `write-file-atomic`
- Окно B заканчивает, пишет через `write-file-atomic` (перезаписывает)
- Результат: last-write-wins — файл содержит данные от окна B
- **Почему это ок:** оба сканировали одни и те же business_folders, результат идентичен. Если Drive изменился между сканами — нажать 🔄 ещё раз

**Ход работы:**
- [ ] Добавить зависимости: `sql.js` (WASM), `write-file-atomic`
- [ ] Создать `src/core/db/index.ts` — инициализация БД, схема
- [ ] Persist: load from file, save via `write-file-atomic`
- [ ] Создать `src/core/scanner.ts` — рекурсивный обход business_folders
- [ ] Флаг `scanInProgress` — блокировка повторного запуска в том же окне
- [ ] Парсить `business.json`, `stream.json`, `product.json`
- [ ] Детектировать проекты (папки внутри `projects/`)
- [ ] Сохранять в `entities` таблицу
- [ ] **Debug output:** команда `Duet: Dump Index` → JSON в Output channel
- [ ] Unit-тесты: scanner с test fixtures, db с in-memory SQLite
- [ ] Проверить: после scan в БД есть записи, dump читаем

---

### Шаг 5: TreeView — Секция ДЕЛА
**Статус:** TODO
**Выход:** [UI](#5-ui)

Sidebar с деревом бизнесов.

**Костыль "визуальный корень":**
- `[МОИ ДЕЛА]` — первый top-level элемент, `collapsibleState: None` (без стрелки)
- Бизнесы — тоже top-level, `collapsibleState: Collapsed/Expanded` (со стрелками)
- При CollapseAll видны все: `[МОИ ДЕЛА]` + свёрнутые бизнесы

**План Б (если костыль не сработает):**
- Убрать `[МОИ ДЕЛА]` из дерева
- Кнопку [→] для all-businesses.code-workspace вынести в шапку секции

**Ход работы:**
- [ ] Зарегистрировать ViewContainer в `package.json` (activitybar icon)
- [ ] Создать `src/core/tree/businessTree.ts` — логика построения дерева (данные)
- [ ] Создать `src/vscode/providers/BusinessTreeProvider.ts` — TreeDataProvider обёртка
- [ ] Костыль: `[МОИ ДЕЛА]` с `collapsibleState: None`, кнопка [→]
- [ ] Иерархия: Business → Stream → Product (из index.db)
- [ ] Иконки из поля `icon` манифестов
- [ ] Кнопки в шапке: 🔄, ➕, [−], [+]
- [ ] Кнопки у элементов: [↵], [→]
- [ ] Unit-тесты для core/tree/businessTree.ts
- [ ] Проверить: дерево отображается, CollapseAll показывает `[МОИ ДЕЛА]` + бизнесы

---

### Шаг 6: TreeView — Секция КОНТЕКСТ
**Статус:** TODO
**Выход:** [UI](#5-ui)

Секция breadcrumb с контекстом текущего окна.

**Ход работы:**
- [ ] Создать `src/core/tree/contextBreadcrumb.ts` — логика определения контекста
- [ ] Создать `src/vscode/providers/ContextProvider.ts` — TreeDataProvider
- [ ] Определение контекста: путь в иерархии / orphan / вне иерархии
- [ ] Кнопка [⚙️] → QuickPick (открыть/изменить DuetData)
- [ ] Unit-тесты для core/tree/contextBreadcrumb.ts
- [ ] Проверить: контекст показывается корректно

---

### Шаг 7: TreeView — Секция ПРОЕКТЫ
**Статус:** TODO
**Выход:** [UI](#5-ui)

Список проектов выбранного продукта.

**Ход работы:**
- [ ] Создать `src/core/tree/projectsList.ts` — логика списка проектов
- [ ] Создать `src/vscode/providers/ProjectsProvider.ts` — TreeDataProvider
- [ ] Связать выбор в ДЕЛА → обновление ПРОЕКТЫ
- [ ] Пустой список если выбран не продукт
- [ ] Unit-тесты для core/tree/projectsList.ts
- [ ] Проверить: проекты обновляются при выборе в ДЕЛА

---

### Шаг 8: Launcher — Открытие окон
**Статус:** TODO
**Выход:** [Взаимодействие с элементами](#взаимодействие-с-элементами)

Логика открытия папок/репо по клику.

**Ход работы:**
- [ ] Создать `src/vscode/commands/openFolder.ts` — команды открытия
- [ ] Команда `duet.openInCurrentWindow` (кнопка [↵])
- [ ] Команда `duet.openInNewWindow` (кнопка [→])
- [ ] Логика: бизнес/дело → открыть Drive-папку
- [ ] Логика: продукт с git_url → проверить repos/, clone если нет
- [ ] **Git clone UX:** `withProgress` (cancellable) + вывод в Output Channel
- [ ] Создать `src/core/workspace.ts` — генерация .code-workspace
- [ ] Команда "Все дела" → открыть multi-root workspace
- [ ] Unit-тесты для workspace.ts
- [ ] Проверить: открытие работает для всех случаев

---

### Шаг 9: Multi-root Workspace
**Статус:** TODO
**Выход:** [Multi-root Workspace](#multi-root-workspace)

Генерация и открытие workspace-файлов.

**Ход работы:**
- [ ] Создать папку `~/DuetData/workspaces/` при первом использовании
- [ ] При клике на продукт: проверить есть ли `workspaces/Duet.code-workspace`
- [ ] Если нет → сгенерировать (относительный путь к repos/, абсолютный к Drive)
- [ ] Открыть workspace-файл через `vscode.commands.executeCommand('vscode.openFolder', uri)`
- [ ] Проверить: workspace открывается с обеими папками в Explorer

---

### Шаг 10: Edge Cases
**Статус:** TODO
**Выход:** [Edge Cases](#6-edge-cases)

Обработка ошибок и особых случаев.

**Ход работы:**
- [ ] Orphan repo: показать ⚠️ в КОНТЕКСТ, Editor Tab с QuickPick
- [ ] Git-repo вне repos/: показать ⚠️, Editor Tab с инструкцией
- [ ] Папка вне иерархии: показать ℹ️, Editor Tab
- [ ] Ошибки FS: показать сообщение, работать с кэшем
- [ ] Добавление бизнес-папки: создать business.json если нет
- [ ] Проверить: все edge cases обрабатываются корректно

---

### Шаг 11: Polish & Release
**Статус:** TODO
**Выход:** —

Финальная доработка.

**Ход работы:**
- [ ] README.md для расширения
- [ ] Иконка расширения
- [ ] Тестирование на чистой установке
- [ ] Проверка в Cursor (общая DuetData)
- [ ] Публикация (или локальная установка .vsix)
