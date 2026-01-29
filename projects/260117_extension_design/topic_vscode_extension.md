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
- **Emoji в манифестах, ThemeIcon в UI** — emoji хранится в `icon` поле манифестов и БД, но в TreeView отображаем серые ThemeIcon: `$(organization)` для business, `$(briefcase)` для stream, `$(package)` для product, `$(folder)` для external
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
- **Дерево бизнесов** — всегда строится от корня, не зависит от текущего окна VS Code
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
- **Папки вне структуры** — любая папка вне `DuetData/repos/*.git` показывается как "📁 Папка вне иерархии". Без детекции `.git/` внутри — только анализ пути. Пользователь сам разберётся
- **business.json** — если нет при добавлении папки, создаём автоматически (name=папка, icon=📁)
- **ДЕЛА: визуальный корень (костыль)** — элемент `[МОИ ДЕЛА]` в начале списка с `collapsibleState: None` (без стрелки, без детей). Бизнесы — тоже top-level элементы (со стрелками). Все на одном уровне, но визуально `[МОИ ДЕЛА]` выглядит как заголовок. При CollapseAll видны все top-level: и `[МОИ ДЕЛА]`, и свёрнутые бизнесы. **План Б:** если костыль не сработает — убрать `[МОИ ДЕЛА]`, кнопку [→] для multi-root workspace вынести в шапку секции ДЕЛА
- **ThemeIcon вместо emoji в UI** — визуально лучше (серые, в стиле VS Code). Emoji остаётся в манифестах/БД для кастомизации. В UI: `$(organization)` для business, `$(briefcase)` для stream, `$(package)` для product, `$(git-branch)` для git, `$(folder)` для external. Error-узлы: только emoji в label (⚠️/ℹ️), без ThemeIcon.
- **Atomic write: `write-file-atomic`** — вместо ручной реализации temp+rename используем библиотеку. Причина: Windows `fs.rename()` не перезаписывает существующий файл (в отличие от Unix). Библиотека инкапсулирует платформенные различия. Критерий: код должен быть понятен через 30 лет без археологии.
- **Async I/O везде** — используем `fs/promises` для всех файловых операций (config.json, index.db, scan). Даже для маленьких файлов — консистентность важнее микрооптимизаций. Event Loop свободен всегда.
- **camelCase/snake_case mapping** — JSON-контракт использует snake_case (`business_folders`), TypeScript-интерфейс camelCase (`businessFolders`). Маппинг на границе сериализации: в `validate()` при чтении, в `write()` при записи. `eslint-disable` только на JSON-литерале в write().

---

## ВЫХОДЫ

### 1. Модель данных

#### Тезаурус

| Термин | EN | Значение | Пример |
|--------|----|----------|--------|
| **Бизнес** | business | Дело корневого уровня | `МетаЛаб`, `Семья`, `База` |
| **Дело** | stream | Промежуточный уровень (0..N вложенности) | `ТехноЛаб`, `ДомоДел` |
| **Продукт** | product | Дело-лист с git-репо | `Duet`, `Kreator` |
| **Компонент** | component | Часть продукта (пакет в монорепе) | `packages/ai-kit` |
| **Проект** | project | GTD-проект: задачи с критерием конца | `projects/260110_ai_talks` |

> **Иерархия:** Бизнес → Дело* → Продукт → (Компонент) → Проект
>
> *Дела могут быть вложенными (0..N уровней). По сути: бизнес = корневое дело, продукт = терминальное дело.

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
  parent_id INTEGER REFERENCES entities(id),
  git_url TEXT            -- только для product (из product.json)
);

CREATE UNIQUE INDEX idx_name ON entities(name);
```

> **Уникальность name:** Глобальная — бизнес, дело, продукт и проект не могут иметь одинаковое имя. При дубликате сканер добавляет суффикс (1), (2) к более глубокой сущности.

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
Определить контекст текущего окна VS Code:
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

#### Самоисцеление при сканировании

При обходе дерева папок сканер исправляет ошибки в структуре:

| Ситуация | Действие |
|----------|----------|
| Корень без манифеста | Создать `business.json` (name = имя папки, icon = 📁) |
| Корень с `stream.json` | Переименовать в `business.json` |
| `business.json` внутри цепочки | Переименовать в `stream.json` (бизнес → дело) |
| Манифест глубже `product.json` | Игнорировать (не сканировать глубже продукта) |

> **Принцип:** корень = бизнес, лист с git_url = продукт, всё между ними = дела.

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
│   ⛭ МетаЛаб                        │  ← $(organization) — business
│     ⚃ ТехноЛаб                     │  ← $(briefcase) — stream
│       ⬡ Duet [local ✓]             │  ← $(package) — product
├─────────────────────────────────────┤
│ ДЕЛА                  🔄 ➕ [−][+] │  ← Секция 2: шапка с кнопками
├─────────────────────────────────────┤
│   [МОИ ДЕЛА]                   [→] │  ← костыль: None, без стрелки
│   ▼ ⛭ МетаЛаб              [↵][→] │  ← $(organization) — business
│     ▼ ⚃ ТехноЛаб           [↵][→] │  ← $(briefcase) — stream
│       ⬡ Duet ← выделен     [↵][→] │  ← $(package) — product
│       ⬡ Kreator            [↵][→] │
│   ▶ ⛭ Семья                [↵][→] │  ← business
├─────────────────────────────────────┤
│ ПРОЕКТЫ                            │  ← Секция 3: шапка
├─────────────────────────────────────┤
│   ○ 260117_extension_design        │
│   ○ 260110_ai_talks                │
└─────────────────────────────────────┘
```

> **Иконки:** В ASCII используем приближения. Реальные ThemeIcon: `$(organization)`, `$(briefcase)`, `$(package)`, `$(git-branch)`, `$(folder)`.

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
  - Нет локально → `git clone` в `repos/{Name}.git`
  - Сгенерировать/обновить `workspaces/{Name}.code-workspace`
  - Открыть workspace (multi-root: repo + Drive folder)
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
│   $(git-branch) Duet.git            │  ← orphan repo (в repos/, но не в БД)
│     └─ ⚠️ Репозиторий не связан     │
│   $(folder) my-project              │  ← любая папка вне структуры
│     └─ ℹ️ Папка вне иерархии        │
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

#### Папка вне структуры

Любая папка вне `DuetData/repos/*.git` (включая git-репозитории).

**Breadcrumb:** `$(folder) folder-name` → `ℹ️ Папка вне иерархии` (child) → Editor Tab:
- Объяснение что это за расширение
- Как добавить бизнес-папку (кнопка ➕)

> Не детектируем `.git/` внутри — только анализ пути. Упрощает логику, пользователь сам разберётся.

#### Сводная таблица

| Ситуация | Поведение |
|----------|-----------|
| Orphan repo (в repos/*.git) | Breadcrumb: $(git-branch) → ⚠️ (child) → Editor Tab с QuickPick |
| Имя repo занято другим типом | Breadcrumb: $(git-branch) → ⚠️ "Имя занято {type}" (child) → Editor Tab |
| Папка вне структуры | Breadcrumb: $(folder) → ℹ️ (child) → Editor Tab с инструкцией |
| Product удалён на Drive | Breadcrumb: ⚠️ (та же логика что Orphan) |
| Ошибки FS при чтении | try-catch → работаем с кэшем `index.db` |
| Git auth | Полагаемся на системный git (ssh-agent, credential helper) |
| Multi-window sync | Не нужен. Re-scan только по 🔄. SQLite parallel reads |
| Cursor + VS Code | Общая DuetData, настройки (только путь) в каждом IDE |
| Бизнес-папка без business.json | Создаём автоматически (name=папка, icon=📁) |

---

### 7. Что отображать в секции КОНТЕКСТ

#### Когда перерисовывать

- После сканирования бизнес-директорий
- При открытии/закрытии папок в окне VS Code (`vscode.workspace.onDidChangeWorkspaceFolders`)
- File watchers на метаданные не нужны — ждём кнопку 🔄

#### Источник данных

Анализируем `vscode.workspace.workspaceFolders` — список открытых папок в текущем окне.

Если ничего не открыто → секция КОНТЕКСТ пуста.

#### Структура отображения

**Реализация:** TreeView с `collapsibleState.Expanded` (настоящее дерево, не плоский список с отступами в label).

Каждая открытая папка превращается в **цепочку-breadcrumb**:

```
бизнес → [дело [→ дело]] → продукт → git-папка
```

Цепочка может быть короче (только бизнес, или бизнес → дело).

**Корень дерева** — всегда бизнес (для сущностей из БД) или внешняя папка.

**Git-папка** отображается как **ребёнок** продукта (иконка `$(git-branch)` — ThemeIcon), не как отдельный корень.

#### Merge общих предков

Если несколько папок из workspaceFolders принадлежат одному бизнесу/делу — **объединять общих предков** в одно дерево.

**Пример:** открыты `Duet.git` и `Kreator.git` (оба МетаЛаб/ТехноЛаб):

```
$(organization) МетаЛаб
  $(briefcase) ТехноЛаб
    $(package) Duet
    $(package) Kreator
```

Не два отдельных дерева, а одно с общим корнем. Разные корни — только для папок из разных бизнесов.

#### Алгоритм построения

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
   └─ Нет в БД → внешняя папка (ThemeIcon $(folder))
```

**Отображение ошибок:** ошибки вкладываются под проблемный узел. Клик по ошибке открывает Editor Tab (WebView) с md-инструкцией.

#### Сортировка корней

По типу листового узла цепочки, затем по алфавиту:

1. Бизнесы (цепочка заканчивается на бизнес)
2. Дела (цепочка заканчивается на дело)
3. Продукты (цепочка заканчивается на продукт; git-папка внутри)
4. Внешние папки

#### Связь repo → product

Поиск по **имени** (не по git_url):
- Имя папки `Duet.git` → отрезаем `.git` → ищем `WHERE name = 'Duet'`
- Имя = идентификатор, git_url = свойство (может быть ошибочным)

#### Уникальность имён (при сканировании)

- Глобальный уникальный индекс: `CREATE UNIQUE INDEX idx_name ON entities(name)`
- При дубликате имени — добавляем суффикс (1), (2) к тому, что глубже в иерархии
- Приоритет: бизнес > дело > продукт > проект

**Алгоритм присвоения суффиксов (real-time, single-pass):**

```
При вставке сущности с именем X:

1. Проверить: есть ли X в БД?
   │
   НЕТ → вставить с именем X, выйти
   │
   ДА ↓

2. Сравнить приоритеты:
   - priorities = { business: 1, stream: 2, product: 3, project: 4 }
   - newPriority = priorities[new.type]
   - existingPriority = priorities[existing.type]

3. Если newPriority < existingPriority (новая выше):
   │
   ├─ Найти свободное имя для existing: X (1), X (2), ...
   ├─ UPDATE existing SET name = 'X (1)'
   └─ INSERT new с именем X

4. Если newPriority >= existingPriority (новая ниже или равна):
   │
   ├─ Найти свободное имя для new: X (1), X (2), ...
   └─ INSERT new с именем 'X (1)'
```

**Пример:**
- Сканер встретил product "Duet", вставил
- Позже встретил business "Duet" → business приоритетнее → product становится "Duet (1)", business остаётся "Duet"
- Результат детерминирован независимо от порядка обхода readdir

---

### 8. Worktree Support

Git worktrees позволяют работать с несколькими ветками одного репозитория одновременно.

#### Структура на диске

```
~/DuetData/repos/
├── Duet.git      ← основной клон
├── Duet.wt-1     ← worktree #1
├── Duet.wt-2     ← worktree #2
└── Kreator.git
```

**Формат имени:** `{ProductName}.wt-{N}` где N — автоинкремент (1, 2, 3...).

#### Связь worktree → product

Аналогично основному репо:
- `Duet.wt-1` → отрезаем `.wt-1` → `Duet` → ищем product в БД

#### Создание worktree

**Команда:** `duet.addWorktree` (доступна из КОНТЕКСТ на git-репо)

**Алгоритм:**
1. Определить следующий номер: найти все `{Product}.wt-*` в `repos/`, взять max + 1
2. `git worktree add ../Duet.wt-N` (создаёт detached HEAD)
3. Открыть QuickPick: "Какую ветку checkout?" (список веток из основного репо)
4. `git checkout <branch>` в новом worktree

**Удаление:** Пользователь удаляет папку руками. `git worktree prune` почистит ссылки.

#### Отображение в КОНТЕКСТ

Worktrees — на одном уровне с основным репо, под продуктом:

```
$(organization) МетаЛаб
  $(briefcase) ТехноЛаб
    $(package) Duet
      $(git-branch) Duet.git
      $(git-branch) Duet.wt-1
      $(git-branch) Duet.wt-2
```

#### Открытие worktree

**Из секции ДЕЛА:**
- Клик по продукту → открывает основной `.git`
- Inline button или контекстное меню → QuickPick со списком worktrees

**Из секции КОНТЕКСТ:**
- QuickPick на git-репо: "Add worktree...", "Open worktree..."

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
- [x] После выбора → переход к обычному sidebar
- [x] Проверить: Onboarding показывается при пустом setting

---

### Шаг 4: Scanner & Database
**Статус:** DONE
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
- [x] Добавить зависимости: `sql.js` (WASM), `write-file-atomic`
- [x] Создать `src/core/db/index.ts` — инициализация БД, схема
- [x] Persist: load from file, save via `write-file-atomic`
- [x] Создать `src/core/scanner.ts` — рекурсивный обход business_folders
- [x] Флаг `scanInProgress` — блокировка повторного запуска в том же окне
- [x] Парсить `business.json`, `stream.json`, `product.json`
- [x] Детектировать проекты (папки внутри `projects/`)
- [x] Сохранять в `entities` таблицу
- [x] **Debug output:** команда `Duet: Dump Index` → JSON в Output channel
- [x] Unit-тесты: scanner с test fixtures, db с in-memory SQLite
- [x] Проверить: после scan в БД есть записи, dump читаем

---

### Шаг 5: TreeView — Секция ДЕЛА
**Статус:** DONE
**Выход:** [UI](#5-ui)

Sidebar с деревом бизнесов.

**Костыль "визуальный корень":**
- `[МОИ ДЕЛА]` — первый top-level элемент, `collapsibleState: None` (без стрелки)
- Бизнесы — тоже top-level, `collapsibleState: Collapsed/Expanded` (со стрелками)
- При CollapseAll видны все: `[МОИ ДЕЛА]` + свёрнутые бизнесы

**Ход работы:**
- [x] Зарегистрировать ViewContainer в `package.json` (activitybar icon)
- [x] Создать `src/core/tree/businessTree.ts` — логика построения дерева (данные)
- [x] Создать `src/vscode/providers/BusinessTreeProvider.ts` — TreeDataProvider обёртка
- [x] Костыль: `[МОИ ДЕЛА]` с `collapsibleState: None`
- [x] Кнопки действий (Open in New Window и т.д.) в `package.json` и команды
- [x] Иерархия: Business → Stream → Product (из index.db)
- [x] Иконки из поля `icon` манифестов
- [x] Кнопки в шапке: 🔄, ➕, [−], [+]
- [x] Кнопки у элементов: [↵], [→]
- [x] Unit-тесты для core/tree/businessTree.ts
- [x] Проверить: дерево отображается, CollapseAll показывает `[МОИ ДЕЛА]` + бизнесы

---

### Шаг 5b: Scanner & DB Enhancements
**Статус:** DONE
**Выход:** [Схема index.db](#схема-indexdb), [Самоисцеление при сканировании](#самоисцеление-при-сканировании)

Доработка сканера и БД: уникальность имён, самоисцеление манифестов.

**Ход работы:**
- [x] Добавить `CREATE UNIQUE INDEX idx_name ON entities(name)` в `db/index.ts`
- [x] Scanner: обработка дубликатов имён — суффикс (1), (2) к более глубокой сущности
- [x] Scanner: самоисцеление манифестов (корень без business.json, business.json внутри цепочки, и т.д.)
- [x] Unit-тесты для дубликатов имён
- [x] Unit-тесты для самоисцеления
- [x] Проверить: дубликаты получают суффикс, манифесты исправляются
- [x] **Рефакторинг:** Scanner → DI для fs операций (см. ниже)
- [x] **Рефакторинг:** scanner.test.ts → mock-объект вместо `vi.mock()` (см. ниже)


---

### Шаг 6: TreeView — Секция КОНТЕКСТ
**Статус:** DONE
**Выход:** [UI](#5-ui), [Что отображать в секции КОНТЕКСТ](#7-что-отображать-в-секции-контекст)

Секция breadcrumb с контекстом текущего окна VS Code.

**Ход работы:**
- [x] Создать `src/core/tree/contextBreadcrumb.ts` — логика определения контекста
- [x] Создать `src/vscode/providers/ContextProvider.ts` — TreeDataProvider
- [x] Определение контекста: путь в иерархии / orphan / вне иерархии
- [x] Кнопка [⚙️] → QuickPick (открыть/изменить DuetData)
- [x] Unit-тесты для core/tree/contextBreadcrumb.ts
- [x] Проверить: контекст показывается корректно

---

### Шаг 7: Create spec/
**Статус:** DONE
**Выход:** `packages/extension/spec/`

Создать `packages/extension/spec/` как source of truth.

> **Уточнение:** Использован @skill(spec-architect), не instructions-architect. Причина: spec описывает ЧТО ЕСТЬ (для разработчиков), а не КАК ДЕЙСТВОВАТЬ (для агентов). См. `skills/spec-architect.md`.

**Ход работы:**
- [x] Создать `spec/DOMAIN.md` — entity types, hierarchy, manifests, name uniqueness
- [x] Создать `spec/DATA_MODEL.md` — DuetData structure, config.json, index.db schema
- [x] Создать `spec/ARCHITECTURE.md` — package structure, core/vscode separation, DI, testing
- [x] Создать `spec/UI.md` — views, commands, visibility conditions
- [x] Проверить: спека покрывает всё что реализовано в шагах 1-6

---

### Шаг 8: UX Improvements
**Статус:** DONE
**Выход:** [UI](#5-ui)

UX-улучшения по результатам визуального тестирования Step 6.

**Ход работы:**
- [x] Кнопка "Open folder" в пустом КОНТЕКСТ (welcome view)
- [x] Toggle Collapse/Expand в секции ДЕЛА (вместо двух кнопок)
- [x] Tooltips для всех иконок в title bar
- [x] Выделение текущего открытого узла (маркер `●`) в секции ДЕЛА
- [x] Подписи типов через `TreeItem.description` (бизнес/дело/продукт) или ThemeIcon
- [x] Hover-иконки для [МОИ ДЕЛА] → открыть multi-root workspace
- [x] Git-иконка справа, folder emoji слева для git-папок
  - Git-иконка справа невозможно в VS Code API. Реализовано: `[git]` в description для продуктов с git_url
- [x] Submenu вместо QuickPick для кнопки ⚙️

---

### Шаг 9: TreeView — Секция ПРОЕКТЫ
**Статус:** DONE
**Выход:** [UI](#5-ui)

Список проектов выбранной сущности (любой: бизнес, дело, продукт).

**Ход работы:**
- [x] Создать `src/core/tree/projectsList.ts` — логика списка проектов
- [x] Создать `src/vscode/providers/ProjectsProvider.ts` — TreeDataProvider
- [x] Связать выбор в ДЕЛА → обновление ПРОЕКТЫ (onDidChangeSelection)
- [x] Пустой список если нет проектов
- [x] Unit-тесты для core/tree/projectsList.ts (8 тестов)
- [x] Проверить: проекты обновляются при выборе в ДЕЛА

---

### Шаг 10: Launcher — Открытие окон
**Статус:** DONE
**Выход:** [Взаимодействие с элементами](#взаимодействие-с-элементами)

Логика открытия папок/репо по клику.

**Ход работы:**
- [x] Создать `src/vscode/commands/openFolder.ts` — команды открытия
- [x] Команда `duet.openInCurrentWindow` (кнопка [↵])
- [x] Команда `duet.openInNewWindow` (кнопка [→])
- [x] Логика: бизнес/дело → открыть Drive-папку
- [x] Логика: продукт с git_url → проверить repos/, clone если нет
- [x] **Git clone UX:** `withProgress` (cancellable) + вывод в Output Channel
- [x] Создать `src/core/workspace.ts` — генерация .code-workspace
- [x] Команда "Все дела" → открыть multi-root workspace (уже было)
- [x] Unit-тесты для workspace.ts (10 тестов)
- [x] Проверить: открытие работает для всех случаев

---

### Шаг 11: Multi-root Workspace
**Статус:** DONE
**Выход:** [Multi-root Workspace](#multi-root-workspace)

Генерация и открытие workspace-файлов.

**Ход работы:**
- [x] Создать папку `~/DuetData/workspaces/` при первом использовании — `WorkspaceManager.ensureDir()` в [workspace.ts](packages/extension/src/core/workspace.ts#L56)
- [x] При клике на продукт: проверить есть ли `workspaces/Duet.code-workspace` — `writeProductWorkspace()` создаёт/перезаписывает
- [x] Если нет → сгенерировать (относительный путь к repos/, абсолютный к Drive) — строки 84-86 в workspace.ts
- [x] Открыть workspace-файл через `vscode.commands.executeCommand('vscode.openFolder', uri)` — [openFolder.ts:175](packages/extension/src/vscode/commands/openFolder.ts#L175)
- [x] `.vscodeignore`: добавить `out/**` и `spec/**` — исключены из VSIX (сборка в `dist/`)
- [x] Проверить: workspace открывается с обеими папками в Explorer

---

### Шаг 11b: Worktree Support
**Статус:** TODO
**Выход:** [Worktree Support](#8-worktree-support)

Поддержка git worktrees для работы с несколькими ветками одновременно.

**Ход работы:**
- [ ] Обновить `contextBreadcrumb.ts`: распознавать `.wt-N` суффикс
- [ ] Команда `duet.addWorktree`: создание нового worktree
- [ ] QuickPick для выбора ветки при создании
- [ ] Отображение worktrees в КОНТЕКСТ под продуктом
- [ ] QuickPick на git-репо в КОНТЕКСТ: "Add worktree...", "Open worktree..."
- [ ] Inline button или контекстное меню в ДЕЛА для открытия worktree
- [ ] Проверить: worktree создаётся, отображается, открывается

---

### Шаг 12: Edge Cases
**Статус:** TODO
**Выход:** [Edge Cases](#6-edge-cases)

Обработка ошибок и особых случаев.

**Ход работы:**
- [ ] Orphan repo: Editor Tab с QuickPick (связать/создать/игнорировать)
- [ ] Папка вне структуры: Editor Tab с инструкцией
- [ ] Ошибки FS: показать сообщение, работать с кэшем
- [ ] Добавление бизнес-папки: создать business.json если нет
- [ ] Проверить: все edge cases обрабатываются корректно

---

### Шаг 13: Polish & Release
**Статус:** TODO
**Выход:** —

Финальная доработка.

**Ход работы:**
- [ ] Onboarding: добавить `reloadWindow` после сохранения папки
- [ ] Scanner: агрегировать ошибки парсинга манифестов в OutputChannel (не спамить попапами)
- [ ] README.md для расширения
- [ ] Комментарии по всему коду. Убедиться что топик-файл можно удалить, и в коде в комментариях останется вся документация!
- [ ] Иконка расширения
- [ ] Тестирование на чистой установке
- [ ] Проверка в Cursor (общая DuetData)
- [ ] Публикация (или локальная установка .vsix)
