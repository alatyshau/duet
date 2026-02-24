# Context Persistence — state machine шагов

**Статус:** Снято → `ai-instructions/modes/execute.md`
**Откуда:** `260110_ai_kit_design/topic_context_persistence.md`

---

## Суть

Механизм персистентности шагов — защита от compaction context (потеря задачи, галлюцинации планов, бесконечные циклы, "вылетание вперёд").

## Ключевые решения

**Одноуровневая state machine** (упрощение двухуровневой TASK/STEP из Kreator):

```
TODO ──/next──► WIP ──(agent)──► IN_REVIEW ──/done──► DONE
```

| Статус | Владелец | Агент может |
|--------|----------|-------------|
| TODO | User | Ждать /next |
| WIP | Agent | Работать (proactive) |
| IN_REVIEW | User | Только по запросу (reactive) |
| DONE | — | Закрыто |

**Explicit triggers:** `/next`, `/done`, `/done-next`. Междометия ("хорошо", "ок") — НЕ команда.

**Формат шага:** H3 + статус + "Ход работы" (универсальное название: план до начала, лог после).

**Обычно один WIP,** IN_REVIEW может быть много одновременно.

**Начало сессии = DIALOGUE.** WIP в файле ≠ автоматический EXECUTE. Агент сообщает "остался WIP-шаг, продолжить?" и ждёт явного "да".

**Терминология:** "Шаг" (не "задача"), "TODO items" — чеклист внутри шага.

**REVIEW vs IN_REVIEW:** REVIEW — режим агента, IN_REVIEW — статус шага в state machine.
