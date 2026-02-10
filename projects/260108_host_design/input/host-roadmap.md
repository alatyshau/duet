# Duet Host — План разработки

ЧТО: Дорожная карта развития Electron Menu Bar приложения.
ЗАЧЕМ: Ориентир для планирования спринтов.
КТО ИСПОЛЬЗУЕТ: Разработчик при планировании.

---

## Текущее состояние (v0.1.0)

**Готово:**
- Electron boilerplate (React + TypeScript + Vite)
- System tray иконка (macOS Menu Bar / Windows System Tray)
- Показ/скрытие окна по клику
- Автозапуск при старте системы
- Сборка под macOS, Windows, Linux (DMG, EXE, AppImage)
- GitHub Actions CI/CD
- SQLite (better-sqlite3) готов к использованию
- **UI дизайн-система**: Tailwind CSS v4 + shadcn/ui
- **Шаг 1 (завершён)**: Выбор папки DuetData с проверкой

**Не готово:**
- Tray иконки warning/syncing (пока используется одна иконка)
- Интеграция с rclone
- Синхронизация данных

---

## Шаг 1: Выбор папки DuetData ✅

### Задачи
- [x] UI: экран первого запуска (onboarding) — `SetupPage.tsx`
- [x] Выбор папки через native dialog (`dialog.showOpenDialog`)
- [x] Сохранение пути в конфиг: `~/.org.ve68.duet/config.json`
- [x] Проверка папки при каждом запуске (существует ли?)
- [x] Если папка не найдена — показать страницу Установка с warning
- [x] AppState архитектура: main process владеет состоянием
- [x] UI дизайн-система:
  - [x] Tailwind CSS v4 + shadcn/ui
  - [x] Стиль Google Drive (светлая тема, мягкие тени)
  - [x] Sidebar: Логотип, Открыть DuetData, Синхронизация, Настройки, Установка
  - [x] SetupPage: чеклист с состоянием папки
- [x] Кнопка "Открыть в Finder" — `shell.openPath()`
- [x] Молчаливый старт: при status=ready → только tray, без окна

### Архитектура

```
~/.org.ve68.duet/
└── config.json    ← { "duetDataPath": "/path/to/DuetData" }
```

**AppState (main process):**
```typescript
type AppStatus = 'no_config' | 'path_lost' | 'ready'
interface AppState {
  status: AppStatus
  duetDataPath: string | null
  pathExists: boolean
}
```

### Реализованные файлы
- `src/main/index.ts` — AppState, IPC handlers, tray логика
- `src/preload/index.ts` — Duet API (getAppState, onAppStateChanged, etc.)
- `src/preload/index.d.ts` — TypeScript типы для window.api
- `src/renderer/src/App.tsx` — подписка на AppState
- `src/renderer/src/pages/SetupPage.tsx` — чеклист установки
- `src/renderer/src/components/layout/Sidebar.tsx` — навигация
- `src/renderer/src/components/layout/Layout.tsx` — обёртка
- `src/renderer/src/assets/main.css` — Tailwind v4 + тема

### Интеграция с VS Code
- [x] **Решено**: Глобальный конфиг `~/.org.ve68.duet/config.json`
- VS Code расширение читает тот же файл для получения пути к DuetData

### Deliverable
Пользователь может выбрать папку DuetData, приложение проверяет её при каждом запуске.

---

## Шаг 2: Установка rclone

### Задачи
- [ ] Проверка наличия rclone в PATH (`which rclone` / `where rclone`)
- [ ] UI: страница "Настройка синхронизации"
- [ ] Инструкции по установке для каждой платформы:
  - **macOS**: `brew install rclone`
  - **Windows**: `winget install Rclone.Rclone` или скачать с сайта
  - **Linux**: `sudo apt install rclone` / snap / etc.
- [ ] Кнопка "Проверить установку"
- [ ] Статус: установлен / не установлен

### Deliverable
Пользователь видит инструкции, устанавливает rclone, приложение подтверждает установку.

---

## Шаг 3: Конфигурация rclone и авторизация

### Задачи
- [ ] Запуск `rclone config` в embedded terminal или через UI-wizard
- [ ] OAuth flow для Google Drive / Dropbox
- [ ] Безопасное хранение конфига rclone (`~/.config/rclone/rclone.conf`)
- [ ] UI: список подключённых облачных хранилищ
- [ ] Выбор корневых папок для синхронизации

### UI страницы
- [ ] Список remote'ов (Google Drive, Dropbox, etc.)
- [ ] Кнопка "Добавить хранилище"
- [ ] Для каждого remote — список папок с чекбоксами

### Deliverable
Пользователь авторизован в Google Drive/Dropbox, выбраны папки для синхронизации.

---

## Шаг 4: Синхронизация: облако → локально

### Задачи
- [ ] Команда `rclone sync remote:path local:path`
- [ ] Progress UI: прогресс-бар, текущий файл, скорость
- [ ] Фоновая синхронизация (child process)
- [ ] Логирование операций в SQLite
- [ ] Расписание: sync при запуске + периодически (настраиваемо)

### Обработка ошибок
- [ ] Нет интернета — показать статус, retry
- [ ] Файл занят — skip и показать в логах
- [ ] Превышение квоты — уведомление

### Deliverable
Файлы из облака скачиваются в локальную папку DuetData.

---

## Шаг 5: Синхронизация: локально → облако

### Задачи
- [ ] File watcher (chokidar) для отслеживания изменений
- [ ] Debounce: не загружать сразу, ждать паузу в редактировании
- [ ] Очередь загрузки (upload queue)
- [ ] Команда `rclone copy local:file remote:path`
- [ ] Важно: ещё поддержку исключений сделать правильно

### Конфликт-резолюшен
- [ ] Проверка: файл изменён в облаке пока мы его редактировали?
- [ ] Стратегии:
  - Last-write-wins (по умолчанию)
  - Создать `.conflict` копию
  - Спросить пользователя
- [ ] Блокировка: не скачивать пока идёт загрузка того же файла

### Lock-механизм
- [ ] Глобальный lock на время операций
- [ ] Или per-file locks в SQLite

### Deliverable
Локальные изменения автоматически загружаются в облако без конфликтов.

---

## Шаг 6: Индекс Дел

### Задачи
- [ ] Сканирование папок DuetData
- [ ] Парсинг структуры по GPD-онтологии:
  ```
  DuetData/
  ├── Предприятия/
  │   └── CompanyName/
  │       └── Дела/
  │           └── ProjectName/
  │               └── .deal.yaml  ← метаданные дела
  ```
- [ ] Индекс в SQLite: id, path, name, type, metadata
- [ ] Обновление индекса при изменении файлов (file watcher)
- [ ] важно ещё при первом сканировании выявить папки типа node_modules или dist которые есть в google drive — и скачав их, предложить пользователю их удалить на google drive

### API для VS Code
- [ ] IPC endpoint: `getDealsList()` → список дел
- [ ] IPC endpoint: `getDealDetails(id)` → метаданные дела
- [ ] WebSocket или named pipe для real-time updates

### Deliverable
SQLite содержит актуальный индекс всех Дел, доступный для VS Code.

---

## Шаг 7: VS Code расширение

### Задачи
- [ ] Создать `packages/extension` workspace
- [ ] Sidebar: Tree View с деревом Дел (как Project Manager)
- [ ] Команды:
  - Открыть дело (переключить workspace)
  - Создать новое дело
  - Обновить список
- [ ] Статус бар: текущее дело, статус синхронизации

### Интеграция с Host
- [ ] Подключение к Host через IPC/WebSocket
- [ ] Получение списка дел из индекса
- [ ] Получение статуса синхронизации

### Deliverable
VS Code расширение с боковой панелью списка Дел.

---

## Бэклог (после основных шагов)

### UI/UX
- [x] Дизайн-система (Tailwind CSS v4 + shadcn/ui) — реализовано
- [ ] Темная тема (светлая уже есть)
- [ ] Popover окно под tray-иконкой

### MCP интеграция
- [ ] Вынести в `packages/mcp-server`
- [ ] Tools: `search_notes`, `create_task`, `get_context`
- [ ] Запуск MCP как child process

### Поиск
- [ ] Full-text search по файлам
- [ ] Cmd/Ctrl+K глобальный поиск
- [ ] Фильтры: тип, дата, теги

### Уведомления
- [ ] Напоминания о задачах
- [ ] Daily digest

### Автоматизация
- [ ] URL schemes: `duet://open/path`
- [ ] Shortcuts интеграция (macOS)

### Безопасность
- [ ] Code signing (Apple Developer ID, EV cert)
- [ ] Auto-updater

---

## Технический стек

| Компонент | Технология |
|-----------|------------|
| Desktop app | Electron + React + TypeScript |
| Сборка | electron-vite + electron-builder |
| UI | Tailwind CSS v4 + shadcn/ui |
| База данных | SQLite (better-sqlite3) |
| Синхронизация | rclone (external) |
| File watching | chokidar |
| VS Code ext | VS Code Extension API |
| CI/CD | GitHub Actions |
