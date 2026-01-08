# Схемы файлов AI-экосистемы

ЧТО: Каталог схем (форматов) служебных файлов.
ЗАЧЕМ: Единое место для спецификаций, без дублирования в ролях.
КТО ИСПОЛЬЗУЕТ: Principal, Keeper, скрипты автоматизации.

---

## Схемы

| Файл | Схема | Владелец |
|------|-------|----------|
| `workspace_map.json` | [workspace_map.json.md](workspace_map.json.md) | Principal |
| `section.json` | [section.json.md](section.json.md) | Keeper |
| `keeper_state.json` | [keeper_state.json.md](keeper_state.json.md) | Keeper |
| `WORKSPACE_MAP.md` | [WORKSPACE_MAP.md.md](WORKSPACE_MAP.md.md) | Keeper (генерирует) |

---

## Принципы

- **Роли** описывают КТО и ЗАЧЕМ
- **Схемы** описывают КАК устроен файл
- Роли **ссылаются** на схемы, не дублируют их
