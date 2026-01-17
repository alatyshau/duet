В этом файле мы переходим от ручной работы к автоматизации. Цель — сделать переключение режимов (**R2**) мгновенным, снизив когнитивную нагрузку (**R5**).

Мы рассмотрим два пути:

1. **VS Code + Extension "Continue"** (Максимальная кастомизация).
2. **Cursor** (Нативный подход).

---

## Вариант 1: VS Code + Continue (Рекомендуемый)

Расширение [Continue](https://continue.dev/) идеально подходит для нашей задачи, так как позволяет создавать кастомные слэш-команды (`/command`), которые под капотом собирают нужные файлы и инструкции.

### 1. Настройка `config.json`

Откройте настройки плагина Continue (файл `config.json` в папке `~/.continue/` или через шестеренку в UI) и добавьте секцию `customCommands`.

Мы настроим команды так, чтобы они автоматически подтягивали текст режима и активную задачу.

```json
{
  "customCommands": [
    {
      "name": "clarify",
      "description": "Режим анализа задачи (No Code)",
      "prompt": "Внимательно прочитай приложенные файлы. \n\n{{{ .ai/modes/01_clarify.md }}}\n\nАктуальная задача: {{{ .ai/active_task.md }}}"
    },
    {
      "name": "plan",
      "description": "Режим архитектора (Создание плана)",
      "prompt": "Прочитай контекст. \n\n{{{ .ai/modes/02_architect.md }}}\n\nОбнови план в: {{{ .ai/active_task.md }}}"
    },
    {
      "name": "code",
      "description": "Режим написания кода",
      "prompt": "Действуем строго по плану. \n\n{{{ .ai/modes/03_execute.md }}}\n\nТекущий статус: {{{ .ai/active_task.md }}}"
    },
    {
      "name": "save",
      "description": "Синтез и сохранение контекста",
      "prompt": "Подведи итоги сессии. \n\n{{{ .ai/modes/04_synthesize.md }}}"
    }
  ]
}

```

*Примечание: Синтаксис `{{{ filename }}}` в Continue указывает на необходимость прочитать содержимое файла и вставить в промпт.*

### 2. Как это выглядит в работе

1. Вы открываете чат (Cmd+L / Ctrl+L).
2. Пишете `/clarify`.
3. Нажимаете Enter.
4. **Магия:** Плагин сам находит файлы в папке `.ai`, склеивает их в один промпт и отправляет модели. Вам не нужно искать файлы в дереве проекта.

---

## Вариант 2: Cursor (Native Power User)

Cursor пока не позволяет создавать сложные макросы одной кнопкой так гибко, как Continue, но у него есть мощная система индексации.

### 1. Глобальные правила (`.cursorrules`)

В корне проекта создайте файл `.cursorrules`. Cursor читает его *всегда*. Используйте это для базовой "гигиены" (**R8 - Ясность**).

**Содержимое `.cursorrules`:**

```markdown
# Global AI Rules

ALWAYS:
1. Check `.ai/context.md` for domain terminology.
2. Check `.ai/decisions.md` before suggesting architectural changes.
3. If I use the keyword "MODE: <Name>", look for the corresponding file in `.ai/modes/`.

```

### 2. Быстрый вызов режимов через `@`

В Cursor символ `@` — это суперсила. Чтобы активировать режим:

1. Нажмите `Cmd+L`.
2. Наберите `@01` (Cursor сразу подскажет файл `01_clarify.md`).
3. Наберите `@active` (подскажет `active_task.md`).
4. Enter.

**Лайфхак для Cursor:**
Переименуйте файлы режимов, чтобы они были короче и уникальнее для поиска:

* `modes/01_clarify.md` -> `modes/mode-clarify.md`
* `modes/02_architect.md` -> `modes/mode-plan.md`

Тогда в чате вы просто пишете: `@mode-plan` и получаете контекст.

---

## Вариант 3: Shell Scripting (Для гиков)

Если вы хотите работать через веб-интерфейс (ChatGPT, Claude.ai), но не хотите копировать файлы руками.

Создайте Makefile или скрипт `ctx.sh` в корне:

```bash
#!/bin/bash
# Использование: ./ctx.sh clarify

MODE=$1
case $MODE in
  clarify)
    cat .ai/context.md .ai/active_task.md .ai/modes/01_clarify.md | pbcopy
    echo "Context + Clarify Mode copied to clipboard!"
    ;;
  plan)
    cat .ai/context.md .ai/active_task.md .ai/modes/02_architect.md | pbcopy
    echo "Context + Architect Mode copied to clipboard!"
    ;;
  *)
    echo "Usage: ./ctx.sh [clarify|plan|exec|save]"
    ;;
esac

```

Теперь в терминале IDE:

1. `./ctx.sh plan`
2. `Cmd+V` в окно чата.

---

## Сравнение подходов

| Подход | Скорость | Удобство | Контроль |
| --- | --- | --- | --- |
| **VS Code + Continue** | ⚡⚡⚡ | ⭐⭐⭐ | Полный контроль промпта через JSON |
| **Cursor (@File)** | ⚡⚡ | ⭐⭐⭐ | Нативно, но нужно выбирать файлы руками |
| **Shell Script** | ⚡ | ⭐⭐ | Работает с любым клиентом (Web, API) |

## Что дальше?

Теперь у вас есть:

1. **Архитектура:** Понимание проблемы.
2. **Структура:** Папка `.ai` с файлами.
3. **Процесс:** Сценарий смены режимов.
4. **Инструмент:** Автоматизация через шорткаты.

Эта система **самодостаточна**. Вы можете начать применять её прямо сейчас на небольшом модуле вашего текущего проекта.

**Нужна ли помощь с чем-то конкретным? Например, написать содержимое файла `.cursorrules` для специфического языка (Python/JS/Go)?**