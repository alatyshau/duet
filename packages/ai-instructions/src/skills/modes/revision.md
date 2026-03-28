# REVISION Mode

> Read this file when entering REVISION mode.
> After completion — return to DIALOGUE.

---

## When to Enter

- Many topics accumulated (10+)
- Mission seems outdated
- After major milestone
- Before starting new phase

---

## What Revision Does

Audit the entire project folder:
- Evaluate each topic: fits mission?
- Categorize: ЯДРО / ОРБИТА / АРХИВ
- Propose mission evolution if needed
- Update roadmap
- Archive completed topics

---

## Algorithm

```
1. Load context
   → Read index.md (mission, participants, roadmap)
   → List all topic files

2. Audit topics
   → For each topic: status, essence, fits mission?
   → Assign category: ЯДРО | ОРБИТА | АРХИВ
   → Build summary table

3. Analyze mission
   → Is current formulation accurate?
   → Does it cover all ЯДРО topics?
   → If not — propose evolution

4. Generate report (to chat, not file)
   → Summary by topics
   → Mission proposals
   → Roadmap proposals
   → Topics for archiving

5. Apply changes (ONLY after user approval)
   → Update index.md (mission, roadmap, sections)
   → Rename archived files (YYMMDD_ prefix)
   → Update links if needed
```

---

## Topic Categories

| Category | Criterion | In index.md |
|----------|-----------|-------------|
| **ЯДРО** | Directly related to mission | Status, key decisions, product |
| **ОРБИТА** | Not related to mission | Reason, Fate (what to do) |
| **АРХИВ** | Completed or decision made | Итог, file renamed with YYMMDD_ |

---

## Archiving a Topic

When topic is complete (all steps DONE, criteria met):

1. **Rename file:** `topic_xxx.md` → `YYMMDD_topic_xxx.md`
2. **Move in index.md:** from ЯДРО to АРХИВ section
3. **Add итог:** brief summary of what was achieved
4. **Update links** if other files reference it

Example in index.md:
```markdown
## АРХИВ

### 260127_topic_instructions_quality.md
> Модульная архитектура инструкций

**Статус**: Выполнено @turn(260127).

**Итог**: Создана модульная структура: core_instructions.md + modes/*.md + workflows/*.md. Шаги 6-7 перенесены в topic_ai_kit_redesign.md.
```

---

## Rules

1. **Don't change files without approval** — first report, then actions
2. **Mission evolves** — don't force topics into mission, adjust mission to topics
3. **ОРБИТА ≠ trash** — topics there are legitimate, just waiting for their own project folder
4. **Archive ≠ delete** — history preserved, files renamed

---

## Report Template (short)

```markdown
## Ревизия: {folder_name}

**Тем:** N (ЯДРО: X, ОРБИТА: Y, АРХИВ: Z)

### Для архивации
| Тема | Итог |
|------|------|
| topic_xxx.md | Завершено, продукт готов |

### ОРБИТА (не вписывается в миссию)
| Тема | Причина | Судьба |
|------|---------|--------|
| topic_yyy.md | Исследование | → Отдельная папка |

### Предложения
- Миссия: {если нужно обновить}
- Roadmap: {если нужно обновить}

Одобряешь изменения?
```

---

## Difference from Other Modes

| Mode | Focus | What it does |
|------|-------|--------------|
| SECRETARY | Chat → files | Archive chat messages |
| REVIEW | One topic + artifacts | Review agent's work |
| **REVISION** | **Entire project folder** | Audit structure, mission, topics |

---

## Completion

After user approves changes:
1. Apply changes to index.md
2. Rename archived files
3. Return to DIALOGUE
