# Python Apps Lifecycle Management

**Миссия:** Запуск и управление произвольными Python-приложениями из Duet Host — трейдинг-роботы, анализаторы, генераторы отчётов и т.п.

**Участники:** @starship

---

## Видение

Duet Host уже управляет жизненным циклом одного Python-процесса (Backend). Следующий шаг — обобщить это на произвольные пользовательские Python-приложения. Host становится центром управления всеми Python-процессами пользователя.

**Что уже есть:**
- Типы `AppInfo`, `ProcessInfo`, `ProcessStatus` в `shared/types.ts`
- `BUILTIN_APPS` реестр в `core/apps.ts` (с комментарием "В будущем — из DuetConfig/apps.json")
- `AppPage` с process cards (Start/Stop/Restart)
- Backend lifecycle в `core/backend.ts` (spawn venv Python, health poll, stop по PID)

**Что нужно:**
- UI перестройка: разделение Настройки / Приложения
- Регистрация пользовательских Python-приложений
- Обобщённый lifecycle manager (не привязанный к конкретному backend)
- Tray-интеграция для быстрого управления

---

## Roadmap

### Фаза 1: UI Restructure
Переделать UI — табки Настройки / Приложения в боковой панели.

### Фаза 2: App Registry
Регистрация приложений через конфиг (apps.json или подобный).

### Фаза 3: Generic Python Lifecycle
Обобщённый менеджер жизненного цикла Python-процессов.

---

## ЯДРО

| Топик | Статус | Суть |
|-------|--------|------|
| [topic_ui_tabs.md](topic_ui_tabs.md) | бэклог | Фаза 1: UI рефакторинг — табки Настройки / Приложения |
| [topic_python_apps_lfc.md](topic_python_apps_lfc.md) | бэклог | Фаза 2-3: регистрация + lifecycle Python-приложений |

---

## Ключевые решения

| Дата | Решение |
|------|---------|
| 2602 | Идея зафиксирована. Scope — после MVP. |
