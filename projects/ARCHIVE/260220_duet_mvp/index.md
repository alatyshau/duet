# Архив: Duet MVP

**Цель проекта:** У меня в трее висит Duet Host, он устанавливает обновления инструкций и MCP, и поддерживает MCP в рабочем состоянии.

**Статус:** Выполнено.

---

## Структура архива

Файлы разнесены по папкам исходных проектов:

| Папка | Файлов | Суть |
|-------|--------|------|
| `ARCHIVE/2510_ai-instructions/` | 7 | Старые черновики (окт 2025). Всё снято в модульную архитектуру ai-instructions. |
| `ARCHIVE/260110_ai_kit_design/` | 18 | Дизайн AI Kit. Режимы, персоны, стансы, скиллы, форматы. |
| `ARCHIVE/260108_host_design/` | 5 | Дизайн Host. Backend lifecycle, cleanup, testing, deploy, integrations (снятая часть). |
| `ARCHIVE/260210_duet_mvp/` | 4 | Duet MVP. AI Instructions → Host, Codex ревью, Apps UI, ход работы. |

---

## Содержимое по папкам

### 2510_ai-instructions (7 файлов)

| Файл | Итог |
|------|------|
| 260220_AI_MODES_DRAFT.md | Черновик двухрежимной системы PLAN/EXECUTE. Снято → 7 режимов (modes/). |
| 260220_Task_Plan.md | Историческая система задач (ноя 2025). Снято → projects/ + topic files. |
| 260220_Режим_Дуэта.md | Калибровка "личности" AI (Логик/Партнёр/Провокатор). Снято → система персон. |
| 260220_Протокол_Навигационного_Маяка.md | HUD-заголовок для привязки контекста. Снято → workspace_info MCP. |
| 260220_Варианты_реструктуризации.md | 6+ вариантов архитектуры инструкций (GPT/Gemini). Снято → модульная архитектура ai-instructions. |
| 260220_Переделка_на_режимы_работы.md | Gemini-диалог: State Machine, "Project First". Снято → режимы + алгоритм ориентации. |
| 260220_Gemini_VS_Code_AI_и_антихрупкие_знания.md | Философия local-first, Data Sovereignty, антихрупкие форматы. Снято → архитектура Duet. |

### 260110_ai_kit_design (18 файлов)

| Файл | Итог |
|------|------|
| 260129_topic_ai_kit_redesign.md | Системный редизайн AI Kit. Модульная архитектура (modes/stances/skills/personas/workflows). |
| 260127_topic_instructions_quality.md | Модульная архитектура инструкций: core_instructions.md + modes/*.md + workflows/*.md. |
| 260128_topic_codex_support.md | Codex-интеграция через config.toml + MCP. Поглощено Host. |
| 260125_topic_base_instructions.md | Фундамент: 12 шагов, режимы, state machine, шаблоны, build.py. |
| 260112_topic_instructions_vs_role.md | Различение: инструкции = КАК, персона = КТО. |
| 260112_topic_migration_from_roles.md | Миграция контекста из 260109_roles. 5 тем перенесены. |
| 260112_role_tl.md | TL упразднён. Функции → Review Mode. |
| 260113_role_to_persona_refactoring.md | Role → Persona. Файлы персон созданы, roles удалены. |
| 260220_topic_secretary.md | Спецификация режима SECRETARY. Снято → modes/secretary.md. |
| 260220_topic_context_persistence.md | State machine шагов (TODO→WIP→IN_REVIEW→DONE). Снято → modes/execute.md. |
| 260220_topic_document_structure.md | Структура topic-файлов (5 секций). Снято → schemas/topic_file.md (→ 6 секций). |
| 260220_topic_review_mode.md | Спецификация режима REVIEW. Снято → modes/review.md. |
| 260220_topic_revision_mode.md | Спецификация режима REVISION. Снято → modes/revision.md. |
| 260220_topic_ai_kit_requirements.md | Требования R1-R9. Продукт построен, требования были неявным фундаментом. |
| 260220_topic_meta_discussion_format.md | Философия дискуссий с AI. Снято → personas/socrates.md и методология. |
| 260220_topic_ai_kit_package.md | Организация пакета ai-kit. Решения реализованы, пакет эволюционировал. |
| 260220_topic_principal_feedback.md | Фидбек для Principal. Снято → personas/socrates.md. |
| 260220_topic_softeng.md | Улучшение роли SoftEng. Obsolete: roles → personas + skills. |

### 260108_host_design (5 файлов)

| Файл | Итог |
|------|------|
| 260220_topic_host_core.md | Backend lifecycle, deploy, AI clients, UI — всё реализовано. Без state.json — Extension через MCP. |
| 260220_topic_host_testing.md | Cleanup + модуляризация + 15+ unit-тестов. Platform/ проверен вручную. |
| 260220_topic_host_integrations.md | AI Clients (Claude Code + Codex) + Deploy service. Живое (другие клиенты) осталось в оригинале. |
| 260220_draft.md | Фрагменты чата о конфиге. Pointer file реализован. |
| 260220_host-roadmap.md | Старый роудмап с rclone. Шаг 1 реализован, остальное отменено/переделано. |

### 260210_duet_mvp (4 файла)

| Файл | Итог |
|------|------|
| 260220_ход_работы.md | Журнал хода работы над MVP. Шаги 1-3 (Host install, Extension MCP, Backend HTTP). |
| 260212_topic_ai_instructions_to_host.md | Host деплоит AI Instructions + Backend. Python path selector, atomic swap, venv + pip, VERSION check. 115 тестов. |
| 260212_review_ai_instructions_to_host.md | Ревью Codex (17 пунктов): 14 исправлены, 3 LATER. Критическая находка: `[mcp.duet]` → `[mcp_servers.duet]`. smol-toml, DI. |
| 260220_topic_apps_ui.md | Host Apps UI — менеджер Python-процессов. Типы ProcessStatus/AppInfo, Sidebar секции, AppPage, StatusDot. Масштабируемая архитектура на 10-20 приложений. |

### 260210_duet_mvp — удалённое (work_extension_to_http/)

Рабочая подпапка миграции Extension SQLite → Backend HTTP API. Содержала plan, progress, два ревью (Opus + Codex) и feedback. Миграция закоммичена (424bb7f). Подпапка удалена — детали в коммитах и spec.
