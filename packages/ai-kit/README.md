# AI Kit

Набор инструментов для работы с AI — инструкции, роли, схемы, workflows, скрипты.

## Структура

```
packages/ai-kit/
├── build.py              # Скрипт сборки ролей
├── section.json          # Мета-данные пакета
├── README.md
│
├── scripts/              # Скрипты автоматизации
│   ├── timestamp.py      # Генерация timestamp
│   └── ...
│
└── templates/            # Jinja2 шаблоны
    ├── INSTRUCTIONS.md.j2  # Базовые инструкции
    ├── roles/              # Шаблоны ролей
    │   ├── _keeper.md.j2
    │   ├── _principal.md.j2
    │   └── ...
    │
    └── _includes/        # Переиспользуемые части
        ├── header.md
        ├── red_lines.md
        ├── chat_doc.md
        └── dialectics.md
```

## Использование

### Сборка ролей

```bash
# Сборка в .ai/roles/ (default)
python packages/ai-kit/build.py

# Сборка в другую папку
python packages/ai-kit/build.py -o /path/to/output

# Dry run
python packages/ai-kit/build.py --dry-run
```

### Подключение как submodule

```bash
git submodule add <repo-url> packages/ai-kit
```

### Переменные окружения

- `AI_KIT_OUTPUT_DIR` — переопределить output directory

## Зависимости

```bash
pip install jinja2
```
