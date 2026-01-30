# Duet Host — Architecture

## Purpose

Electron tray application — центральный хаб экосистемы Duet.

## Current State (v0.1.0)

| Функция | Реализовано |
|---------|-------------|
| Tray app (Menu Bar / System Tray) | ✅ |
| Конфиг DuetData path | ✅ |
| Статусы (no_config → path_lost → ready) | ✅ |
| Onboarding UI | ✅ |
| Autostart | ✅ |

## Target State (after Python core migration)

| Функция | Статус |
|---------|--------|
| Проверка Python 3.10+ | TODO |
| Создание venv, установка зависимостей | TODO |
| Spawn Python ядра | TODO |
| Lifecycle management (restart, graceful shutdown) | TODO |
| Health check Python процесса | TODO |

---

## Architecture

### Current

```
┌─────────────────────────────────────────┐
│  Duet-host (Electron)                   │
│  - Main process (tray, config, IPC)     │
│  - Renderer (React UI)                  │
│  - better-sqlite3 (не используется)     │
└─────────────────────────────────────────┘
```

### Target

```
┌─────────────────────────────────────────┐
│  Duet-host (Electron)                   │
│  - Управляет lifecycle Python           │
│  - UI для настроек                      │
│  - Проверяет Python при старте          │
└─────────────────────────────────────────┘
              ↓ spawn
┌─────────────────────────────────────────┐
│  Python ядро (localhost:PORT)           │
│  - sqlite3 (нативный)                   │
│  - Сканер иерархии                      │
│  - HTTP API + MCP server                │
│  - Единственный владелец БД             │
└─────────────────────────────────────────┘
```

---

## Layers

| Layer | Responsibility | Files |
|-------|----------------|-------|
| Main | Tray, window, IPC, Python spawn | `src/main/index.ts` |
| Preload | Bridge main ↔ renderer | `src/preload/index.ts` |
| Renderer | React UI | `src/renderer/` |

---

## Config

| File | Purpose |
|------|---------|
| `~/.org.ve68.duet/config.json` | User config (duetDataPath) |
| `~/DuetData/.venv/` | Python virtual environment (future) |

---

## AppState Machine

```
┌──────────────┐
│  no_config   │ ← первый запуск
└──────┬───────┘
       │ user selects folder
       ▼
┌──────────────┐
│    ready     │ ← нормальная работа
└──────┬───────┘
       │ folder deleted/moved
       ▼
┌──────────────┐
│  path_lost   │ ← требует внимания
└──────────────┘
```

---

## Behavioral Contracts

| Behavior | Contract |
|----------|----------|
| Window close | Скрывает окно, НЕ завершает приложение |
| First run | Показывает окно для onboarding |
| Status ready | Молча в tray, окно НЕ показывается |
| macOS Dock | Скрыт когда окно скрыто, виден когда окно открыто |
| Tray icon | Warning (желтый) когда status ≠ ready |

---

## IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `app:get-state` | renderer → main | Получить текущий AppState |
| `app-state-changed` | main → renderer | Push обновлений состояния |
| `dialog:select-folder` | renderer → main | Открыть системный диалог выбора папки |
| `config:set-duet-path` | renderer → main | Сохранить путь в конфиг |
| `shell:open-path` | renderer → main | Открыть путь в Finder/Explorer |

---

## Dependencies to Remove

| Dependency | Reason |
|------------|--------|
| `better-sqlite3` | БД переезжает в Python ядро |

## Dependencies to Add (future)

| Dependency | Purpose |
|------------|---------|
| — | Python spawn через Node.js child_process (встроенный) |
