# Декомпозиция Генератора (TASK-004)

Задача: TASK-004
- **TASK-004 Status:** In Progress
***

## 🎯 СУТЬ И МОТИВАЦИЯ
**Суть:** Разделить монолитный файл генератора (`src/generator_ts/generator.ts`) на логические модули и привести структуру папок к новой схеме (`src/runtime_ts`, `src/generator_ts` вместо `src/templates`, `src/ts`).
**Мотивация:** Текущий генераторный файл выполняет слишком много функций (валидация, сборка, копирование, генерация). Это затрудняет чтение и поддержку кода. Разделение ответственности улучшит архитектуру и DX.

## 📋 ПЛАН
### STEP-01: [FS Rename] Переименование директорий
- **STEP-01 Status:** Verified
- **Описание:** Переименовать папки `src/templates` в `src/runtime_ts`, а `src/ts` в `src/generator_ts`, обновить пути в `tsconfig*.json`, импортах и других местах, где используются старые пути.
> **Report:** 
> - Файлы генератора перенесены из `src/ts` в `src/generator_ts` (включая поддиректорию `templates/*`), при этом относительные импорты внутри модулей сохранены.
> - Файлы runtime перенесены из `src/templates` в `src/runtime_ts`, а `tsconfig.runtime.json` обновлён: `rootDir` и `include` теперь указывают на новую папку.
> - Обновлены пути в `package.json` и `package.json.md` (`npm start` теперь запускает `ts-node src/generator_ts/generator.ts`), а также ссылки в `README.md`, `docs/ARCHITECTURE.md` и `docs/FAQ.md`.
> - В `src/generator_ts/generator.ts` константа `TEMPLATE_DIR` теперь указывает на `src/runtime_ts`, чтобы копирование runtime использовало новую структуру.

### STEP-02: [Rename] Переименование Entry Point
- **STEP-02 Status:** Verified
- **Описание:** Переименовать файл точки входа `main.ts` в `generator.ts` (в новой структуре `src/generator_ts`) и обновить ссылки в `package.json`, `README.md`, `docs/*` и других артефактах, где упоминается старое имя.
> **Report:**
> - Файл генератора переименован: `src/generator_ts/main.ts` → `src/generator_ts/generator.ts`, внутри файла обновлена шапка-комментарий.
> - Скрипт запуска в `package.json` и пояснение в `package.json.md` теперь используют `ts-node src/generator_ts/generator.ts`.
> - Обновлена документация: `README.md` (все упоминания entry point переведены на `generator.ts`), `docs/ARCHITECTURE.md` (главный скрипт теперь `generator.ts`, data flow указывает на `src/generator_ts/generator.ts`), комментарии в `tsconfig.runtime.json`.
> - Драфты, зависящие от имени файла, синхронизированы: `drafts/task_user_manual_generation.md` и `drafts/reflex_spec_draft.md` указывают на `generator.ts`; отчёт по STEP-01 в этом драфте обновлён до `ts-node src/generator_ts/generator.ts`.

### STEP-03: [Analysis] Анализ зависимостей и структуры
- **STEP-03 Status:** In Review
- **Описание:** Проанализировать текущий `generator.ts` и выделить группы функций (Validator, Builder, Copier), а также зафиксировать текущую файловую структуру (`src/generator_ts`, `src/runtime_ts`), точки входа и основные импорты после переименования.
> **Analysis Notes:**
> - **Входные данные:** `generator.ts` принимает путь к JSON (либо из аргументов CLI, либо перечисляя все файлы в `src/kreator/`) и загружает модель `KreatorAppDefinition`.
> - **Validator (зона ответственности):**
>   - Проверка имени файла (регулярка на латиницу/цифры/`-_`).
>   - Загрузка и компиляция JSON Schema (`src/schemas/schema.json`) через AJV.
>   - Валидация `appData`, логирование ошибок, `process.exit(1)` при невалидных данных.
> - **Builder (зона ответственности):**
>   - Подготовка файловой системы для `out/<appName>`: `fs.removeSync` для набора путей, создание `src/` и `data/`, инициализация `data/db.json` (пустой объект).
>   - Копирование runtime: `runtime.js` из `out/runtime-build` → `out/<app>/src/extension.js`.
>   - Копирование ресурсов: `src/resources` → `out/<app>/resources` (если есть).
>   - Генерация `app_config.json` из `model.app` (id/title/objects).
>   - Генерация артефактов через шаблоны: `package.json`, `README.md`, `LICENSE.md`, `.vscodeignore`.
>   - Обновление корневого `.vscode/launch.json` через `generateLaunchConfig`.
> - **Copier / Packaging (зона ответственности):**
>   - Упаковка расширения в `.vsix` через `execSync('npx -y @vscode/vsce package --no-yarn', { cwd: targetDir })`.
> - **FS/Paths & Orchestrator:**
>   - Константы путей `ROOT`, `TEMPLATE_DIR` (`src/runtime_ts`), `RUNTIME_BUILD_DIR`, `OUT_DIR`.
>   - Цикл по всем JSON-моделям в `src/kreator` при отсутствии аргументов.
>   - Обёртка `buildApp` как оркестратор поверх всех шагов.
> **Report:** Проведён срез текущего `generator.ts`, функции разнесены по смысловым ролям (Validator, подготовка FS, генерация артефактов, копирование runtime, упаковка), на основе чего в разделе DESIGN DOC зафиксирована целевая модульная структура (`generator.ts`, `paths.ts`, `modelLoader.ts`, `validator.ts`, `workspace.ts`, `runtimeAssets.ts`, `artifacts.ts`, `launchConfigManager.ts`, `packager.ts`).

### STEP-04: [Refactor] Создание модулей
- **STEP-04 Status:** TODO
- **Описание:** Создать файлы модулей (например, `generator.ts` как оркестратор, `validator.ts`, `builder.ts`, `utils.ts`) и логически разнести туда код из `main.ts` без изменения внешнего поведения генератора.

## 📐 DESIGN DOC
### Цели декомпозиции
- Явно отделить "чистую" бизнес-логику генератора (что именно нужно сделать) от инфраструктуры (fs, execSync, пути).
- Сделать так, чтобы `generator.ts` оставался тонким оркестратором пайплайна, без деталей реализации шагов.
- Сгруппировать код по стадиям жизненного цикла: загрузка модели → валидация → подготовка окружения → генерация артефактов → упаковка и интеграция с VS Code.

### Предлагаемая структура модулей генератора
- `generator.ts` — **Оркестратор и CLI-вход.**
    - Разбирает аргументы командной строки.
    - Находит список JSON-файлов в `src/kreator/`.
    - Для каждого файла последовательно вызывает стадии пайплайна (load → validate → prepare → build → package).

- `paths.ts` — **Контекст путей и константы.**
    - Содержит `ROOT`, `OUT_DIR`, `RUNTIME_BUILD_DIR`, `KREATOR_DIR` и т.п.
    - Не выполняет операций с файловой системой, только вычисляет и экспортирует пути.

- `modelLoader.ts` — **Загрузка модели.**
    - Функции: `loadAppModel(jsonPath): { appName, model }`.
    - Отвечает за чтение файла, `JSON.parse` и выделение `appName` из пути.

- `validator.ts` — **Validator в терминах задачи.**
    - Инкапсулирует всю работу с AJV и JSON Schema.
    - Проверяет имя файла, наличие/загрузку схемы и корректность модели.
    - Возвращает результат проверки/ошибки наружу, не делает `process.exit` внутри себя.

- `workspace.ts` — **Подготовка целевой папки (Builder: FS часть).**
    - Функции типа `prepareTargetDir(appName)`:
        - Удаление и пересоздание нужных путей в `out/<appName>`.
        - Создание `src/`, `data/`, инициализация `data/db.json`.
    - Содержит логику "умной очистки", чтобы не трогать лишние данные.

- `runtimeAssets.ts` — **Копирование runtime и ресурсов (Copier).**
    - Копирование `runtime.js` из `out/runtime-build` в `out/<app>/src/extension.js`.
    - Копирование `src/resources` в `out/<app>/resources` (если есть).

- `artifacts.ts` — **Генерация артефактов (Builder: шаблоны).**
    - Формирование `app_config.json` на основе `model`.
    - Вызов шаблонов `generatePackageJson`, `generateReadme`, `generateLicense`, `generateVscodeIgnore`.
    - Запись этих артефактов в `out/<app>`.

- `launchConfigManager.ts` — **Интеграция с корневым `.vscode/launch.json`.**
    - Функция `updateRootLaunchConfig(appName)` (фактически вынесенная из текущего `generator.ts`).
    - Работает поверх `generateLaunchConfig` из шаблонов.

- `packager.ts` — **Упаковка VSIX (Packaging).**
    - Обёртка вокруг вызова `vsce package` через `execSync`.
    - Отделяет команду и обработку ошибок от остального кода генератора.

> Соответствие исходным ролям `(Validator, Builder, Copier)`:
> - **Validator** → модуль `validator.ts`.
> - **Builder** → связка `workspace.ts` + `artifacts.ts` (+ обновление launch.json).
> - **Copier** → модуль `runtimeAssets.ts` (копирование runtime и ресурсов).
> - `packager.ts` и `paths.ts`/`launchConfigManager.ts` служат инфраструктурными "утилитами" вокруг основного пайплайна.
