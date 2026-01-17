# 📋 План разработки Kreator (Этап 1: Bootstrap)

Этот документ отслеживает ближайшие шаги по превращению прототипа в работающую систему генерации САПР.

---

## 🧠 Active Tasks

**Counter:** TASK-010


## ⏳ Pending / Planned


### TASK-004: Декомпозиция Генератора (Refactor main.ts)
- **TASK-004 Status:** In Progress
- **Draft:** [251207_plan_generator_refactor.md](251207_plan_generator_refactor.md) (Создам этот файл)
- **Motivation:** Файл `generator.ts` стал слишком большим ("God Object"). Это усложняет поддержку и чтение кода.
- **Essence:** Разделить `generator.ts` на логические модули.

### TASK-009: Пересмотреть ещё раз 251210_PHILOSOPHY.md
- там много полезного, но решил оставить пока в черновиках
- возможно на вторую итерацию
- надо также прочитать сначала главу "Библиотека моделей"

---

## 🛠 Фаза 3: Отсроченные улучшения (не ближайшие дни)

- [ ] **Настройка Git:**
    - [x] Создать `.gitignore` (скрыть `node_modules` и `out`).
    - [ ] **ВРУЧНУЮ:** Инициализировать репозиторий (`git init`, `git add .`, `git commit`).


---

## 🧩 Фаза 4: Расширение функционала (очень не скоро)
Цель: Добавить поддержку графов и улучшить списки.

- [ ] **Улучшение LIST:**
    - [ ] Добавить поддержку `id` для элементов (сейчас удаление по индексу, это ненадежно).
    - [ ] Добавить персистентность (сохранение данных в файл на диске, а не в памяти).
    - [ ] **Configurable Observability:** Добавить опции `showCardinality`, `showList` в конфиг.
    - [ ] **Single Item View:** Добавить режим "Потоковая обработка" (Показать один -> Обработать).
    - [ ] Обновить `ocheredniki.json`: добавить пример графа.


---

## 📜 Архив

### 2025-12-12

#### ✅ Архивация задач
- [x] **TASK-008: Методика Работы (структура и сборка дока):** *(Status: Done, Archived)*
    - **Draft:** [251210_Методика_работы_с_созвона.md](251210_Методика_работы_с_созвона.md)
    - **Motivation:** Зафиксировать согласованную методику работы (роли, артефакты, структуру итераций) в виде единого поддерживаемого документа.
    - **Essence:** Скомпилированы METHOD.md, ARCHITECTURE.md, ROADMAP.md, DESIGN.md, REQUIREMENTS.md. Все 6 шагов выполнены.

### 2025-12-10

#### ✅ Архивация задач
- [x] **TASK-007: Входные артефакты ИС (input/):** *(Status: Done, Archived)*
    - **Motivation:** Зафиксировать исходные артефакты ИС ("Задача на ИС (от Клиента)" и модель JSON) рядом с сгенерированным плагином для каждой конкретной ИС.
    - **Essence:** При генерации для каждой модели (`ocheredniki`, `library`) создавать в `out/<app>/input/` папку с копиями исходного JSON (`src/kreator/<app>.json`) и соответствующего `.md` файла (`src/kreator/<app>.md`).
- [x] **TASK-002: Генерация Компетенции (User Manual):** *(Status: Done, Archived)*
    - **Motivation:** Пользователю нужна документация, как пользоваться созданным инструментом.
    - **Essence:** Генерировать `USER_MANUAL.md` на основе описаний объектов из JSON-модели и интегрировать его в UI (команда и пункт боковой панели).
- [x] **TASK-001: Переход Runtime на TypeScript:** *(Status: Done, Archived)*
    - **Motivation:** Логика runtime становится сложной. Необходимо статическое типизирование для надежности и удобства разработки (DX).
    - **Essence:** Переименовать `runtime.js` в `.ts`, настроить отдельную компиляцию (`tsconfig.runtime.json`), интегрировать сборку в `npm start`.

### 2025-12-07

#### ✅ Meta-Calibration
- [x] **TASK-006: Уточнение протокола отчетности:** *(Status: Done)*
    - **Essence:** Добавить в `AI_INSTRUCTIONS.md` правило о "шапке" с задачами в каждом ответе и определить исключения, когда новая задача не нужна.
- [x] **TASK-005: Настройка операционных процессов:** *(Status: Done)*
    - **Essence:** Калибровка поведения агента, анализ инструкций и приведение артефактов в соответствие.


#### ✅ Tech Debt / Refactoring
- [x] **[AI] Рефакторинг генератора (вынос шаблонов):** *(Status: Done)*
    - [x] Создана папка `src/ts/templates` с типизированными функциями-генераторами.
    - [x] `main.ts` очищен от строковых литералов.
    - [x] См. `refactor_templates.md` и `comparison_templating_engines.md`.

#### ✅ Meta-Improvements
- [x] **[AI] Оптимизация Инструкций:** *(Status: Done)*
    - [x] Проанализировать и улучшить `AI_INSTRUCTIONS.md` (разрешить валидацию, добавить Review Protocol).
    - [x] См. анализ: `analysis_ai_instructions_improvements.md`.

#### ✅ Фаза 1: Финализация сборки
- [x] **[AI] Идемпотентность и чистота сборки:** *(Status: Done)*
    - [x] **Smart Clean**: Реализована "умная очистка" (сохранение `data`).
    - [x] **Persistence**: Данные сохраняются в `data/db.json` в рабочей папке пользователя.
- [x] **[AI] Дистрибуция и DX:** *(Status: Done)*
    - [x] **VSIX Package**: Автоматическая упаковка через `vsce`.
    - [x] **Launch Config**: Авто-конфигурация корневого `launch.json` для отладки плагинов.
    - [x] **Instructions**: Обновленные README для пользователя и разработчика.

#### ✅ Фаза 1: Валидация и Технический Долг
- [x] **[AI] Анализ Архитектуры (Backlog):** *(Status: Processed)*
    - [x] Ознакомиться с `plan_architectural_improvements.md`.
- [x] **[AI] Валидация данных (JSON Schema):** *(Status: Done)*
    - [x] **Спроектировать JSON Schema** для файлов моделей (`src/kreator/*.json`).
    - [x] **Настроить DX**: Обеспечить подхват схемы в VS Code (через `$schema` или настройки), чтобы работал автокомплит и валидация "на лету".
    - [x] **Валидация в Runtime**: Добавить проверку входного JSON в `main.ts` (AJV Implementation).

#### ✅ Фаза 1: Завершение Анализа и Инвентаризация
- [x] **Реализация требований Анализа (из `analysis_plan_new_inputs.md`):**
    > *Контекст: Этот раздел синхронизирован с файлом анализа `analysis_plan_new_inputs.md`. Задача закрыта, решения приняты.*
    - [x] **(Задача 32) Архитектура Two Boxes:** Интегрирована в `ARCHITECTURE.md`.
    - [x] **(Задачи 19, 20) Реализация подсистемы Reflex & Ontology:** Проанализировано. Принято решение о реализации.
    - [x] **(Задача 16) Уточнение Модели:** Отложено (Separate Project).
    - [x] **(Задачи 21, 22) Runtime Reliability:** **Отменено** (Apophatic Manifesto).
    - [x] **(Задача 25) Концепция "Конструкция":** Внесено в `PHILOSOPHY.md`.
    - [x] **(Задача 18) List-less UI:** **Отменено** (Premature).
    - [x] **(Задача 33) User Manual Generation:** Вынесено в Фазу 2.
    - [x] **(Задача 34) Сетевые графики (Graph):** **Отменено** (Visionary).
    - [x] Финальная проверка инсайтов.
    - [x] Очистка черновиков (выполнено).

- [x] **Изучение стратегии дистрибуции:**
    - [x] Прочитать `strategy_vscodium.md` (VSCodium, VSIX distribution, Profiles).
- [x] **Архитектурное видение:**
    - [x] Прочитать `architecture_evolution.md` (Bootstrap -> Self-Hosting -> Lean4).
    - [x] Прочитать `vscode_philosophy.md` (VS Code as Browser).
    - [x] Прочитать `technical_notes.md` (Custom Editor API, UI Toolkit).

#### ✅ Фаза 1: UX и Навигация
- [x] **[AI] Боковая панель (Activity Bar):** *(Status: Done)*
    - [x] См. анализ: `feature_sidebar_navigation.md`.
    - [x] Добавить иконку и ViewContainer в `package.json`.
    - [x] Реализовать `TreeDataProvider` в runtime.
    - [x] Реализовать проверку Workspace и кнопку "Открыть проект".
    - [x] **[UX] Singleton Tabs:** Реализована логика "Один таб на один объект" (Singleton pattern).
    - [x] **[UX] Separate Windows:** Каждый объект открывается в своей webview панели.

#### ✅ Фаза 0: Настройка и "Hello World"
Цель: Убедиться, что пайплайн `JSON -> Генератор -> Плагин` работает на моем компьютере.
- [x] **Проверка окружения:**
    - [x] Убедиться, что установлен Node.js (`node -v`).
    - [x] Установить зависимости проекта: `npm install fs-extra xmlbuilder archiver typescript ts-node @types/node @types/fs-extra @types/archiver`.
- [x] **Первый запуск:**
    - [x] Запустить генератор (`npm start` или F5).
    - [x] Проверить, что в папке `out/ocheredniki` появились файлы.
    - [x] Запустить сгенерированный плагин в новом окне VS Code (F5 внутри `out/ocheredniki`).
- [x] **[AI] Исправление генератора:** *(Status: Выполнено)*
    - [x] Исправить `ocheredniki.json` (разделить name/displayName).
    - [x] Добавить генерацию `README.md` в `main.ts`.
    - [x] См. план: `fix_generator_issues.md`.
    - [x] **[AI] Генерация launch.json:** Автоматизировать создание `.vscode/launch.json`. См. `fix_missing_launch_json.md`.
- [x] **Устранение технических упущений (из omissions.md):**
    - [x] **package.json:** Добавить скрипт `"start": "ts-node src/ts/main.ts"`.
    - [x] **tsconfig.json:** Добавить базовую конфигурацию (target: ES2020, module: commonjs).
    - [x] **.vscode/launch.json:** Создать конфигурацию для отладки генератора.
    - [x] **Файловая система:** Переименовать `src/kreator/Очередники.json` в `src/kreator/ocheredniki.json` (или исправить путь в `main.ts`).
    - [x] **(можно удалить)** `omissions.md` — все пункты выполнены.
- [x] **Настройка взаимодействия с AI:**
    - [x] Создать `AI_INSTRUCTIONS.md` (правила команд, drafts, planner).
    - [x] Добавить ссылку на инструкции в `README.md`.

### 2025-12-06

#### ✅ Фаза 1: Улучшения Документации
- [x] **[AI] Улучшение документации (Реструктуризация):** *(Status: Выполнено / Done)*
    - [x] Создать папку `docs/` и разнести контент (`PHILOSOPHY.md`, `ARCHITECTURE.md`, `DSL_GUIDE.md`).
    - [x] Создать `docs/FAQ.md` с ответами на технические выборы (Senior/DevOps ответы).
    - [x] Переписать корневой `README.md` для новичков ("Витрина"). См. `improve_readme_onboarding.md`.
- [x] **[AI] Обогащение документации (Insights from Calls):** *(Status: Выполнено / Done)*
    - [x] Обновить `docs/PHILOSOPHY.md` (добавить разделы Генезис, Конструкты, Наблюдаемость).
    - [x] Обновить `docs/ARCHITECTURE.md` (Промежуточный слой, Command Processor, Библиотека моделей). См. план: `architecture_update_plan.md`.
    - [x] **[AI] Спецификация Reflex:** Разработать UX и JSON-структуру для промежуточного слоя ("Рентген"). (См. `reflex_spec_draft.md`)
    - [x] Обновить доки согласно анализу созвонов (`enrich_docs_from_calls.md`)
    - [x] **[AI] Анализ внешних файлов и Миграция задач:** *(Status: Выполнено / Done)*
        - [x] Все пункты из `analysis_plan_new_inputs.md` проанализированы.
        - [x] Открытые задачи (16, 18, 21, 22, 33, 34) перенесены в основной План как отдельные пункты.
