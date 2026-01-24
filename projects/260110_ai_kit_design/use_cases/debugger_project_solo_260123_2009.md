# Use Case: debugger_project_solo

**Timestamp:** 260123_2009
**Client:** Claude Code (VS Code)
**Persona:** не использовалась (работа вне чат-папки)
**Project folder:** apps/host (Duet Host Electron app)
**Topic files:** нет (работа напрямую с кодом)

## Classification

| Parameter | Value |
|-----------|-------|
| **Role** | debugger |
| **Scope** | project |
| **Workflow** | solo |
| **Task type** | bug-fixing, configuration |
| **Result** | success |
| **Duration** | long >50 msgs (с учётом compaction summary) |

## Context Used

### Modes (what activities happened)

- **EXECUTE** — исправление кода и конфигов
- **DIAGNOSTIC** (новый) — анализ ошибок, поиск root cause по stack traces и консоли

### Skills (domain expertise used)

- typescript
- electron (main/preload/renderer architecture)
- electron-vite (build configuration, output formats)
- electron-builder (packaging, extraResources, asarUnpack, entitlements)
- debugging (console errors, path resolution)
- macos (entitlements, code signing, Template images)
- react (error boundaries, conditional rendering)

### Stances (thinking styles used)

- **diagnostic** — анализ stack trace, проверка гипотез по очереди
- **systematic** — проверка путей, файлов, структуры билда
- **pragmatic** — быстрые фиксы когда причина ясна

### Other Context (what else was loaded or referenced)

- electron-builder.yml — конфиг упаковки
- electron.vite.config.ts — конфиг сборки
- main/index.ts — main process
- preload/index.ts — preload скрипт
- App.tsx — React корень
- /Applications/Duet.app/Contents/Resources/ — структура установленного app
- Compaction summary из предыдущей сессии (история работы над Step 1)

## Reflection

**What context was MISSING that would have helped?**

- WORKSPACE_MAP с описанием Electron архитектуры проекта
- Документация по electron-vite: какие форматы генерирует (.mjs vs .js vs .cjs) и когда
- Чеклист "что проверить при белом экране в Electron"

**What could have gone better?**

- Preload формат менялся трижды (.js → .mjs → .cjs) — нужно было сразу понять что electron-vite в ESM-проекте генерирует .mjs, а для Windows нужен .cjs
- extraResources нужно было добавить сразу при создании tray иконок — очевидно что ресурсы должны быть доступны в production
- Слишком много итераций на поиск проблемы — можно было сразу попросить скриншот DevTools консоли

**What new patterns or insights emerged?**

- **extraResources vs asarUnpack**: asarUnpack распаковывает из архива, extraResources копирует рядом — для tray иконок нужен extraResources
- **Template images macOS**: суффикс `Template` + `setTemplateImage(true)` = автоадаптация под светлую/тёмную тему menu bar
- **Defensive preload check**: проверка `if (!window.api)` в renderer как защита от cryptic белого экрана
- **electron-vite preload format**: в ESM проекте preload компилируется в .mjs, но для Windows Electron может требовать .cjs — нужно явно указывать format в конфиге

## Summary

Отладка Duet Host Electron app: исправлен белый экран (preload .js→.mjs→.cjs), добавлен extraResources для tray иконок в production билде, настроен electron-builder для macOS (identity: null, entitlements).
