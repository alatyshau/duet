# Schema: CurrentReview.md

**What:** Temporary file for review coordination in multi-agent workflows.
**Why:** Transfer review feedback between agents (reviewers → synthesizer → implementer).
**Used by:** Daedalus-reviewers (write), Socrates (synthesize), Hephaestus (read), Human (test, approval).
**Creator:** First agent who needs it. In SDDG: Socrates (see workflows/sddg.md).
**Deleter:** Human after successful test.

---

## When Used

- **SDDG workflow** — multiple reviewers, synthesis, implementation cycle
- **Any multi-agent review** — when reviewers are in different sessions

**NOT used:**
- Solo workflow (single agent)
- Pair workflow in same session (review in chat)

---

## Canonical Structure

```markdown
# CurrentReview

**Шаг:** [Step N — Title](topic_xxx.md#шаг-n)
**Статус:** REVIEWING | NEEDS_FIXES | APPROVED

---

## Ревью: Дедал-1 (Cursor)

**Артефакты проверены:**
- `path/to/file.ts`

**Замечания:**
1. ...
2. ...

---

## Ревью: Дедал-2 (Copilot)

**Артефакты проверены:**
- `path/to/file.ts`

**Замечания:**
1. ...
2. ...

---

## Синтез (Сократ)

> Компиляция замечаний для Гефеста. All issues must be fixed.

1. ...
2. ...

---

## Тест-план

> Для человека (АЛ)

- [ ] Тест 1
- [ ] Тест 2

---

## Ответ исполнителя

> Заполняется Гефестом после фиксов

**Исправлено:**
- [x] Замечание 1 — fixed in commit abc123
- [x] Замечание 2 — fixed in commit def456

**Не исправлено (с обоснованием):**
- Замечание 3 — причина
```

---

## Lifecycle

```
1. Step → IN_REVIEW in topic
   → First agent who needs it creates CurrentReview.md
   → Status: REVIEWING

2. Daedalus-1, Daedalus-2: independent reviews
   → Fill their "Ревью" sections

3. Socrates: synthesis
   → Compile "Синтез" section
   → Add "Тест-план" for human
   → Status: NEEDS_FIXES (if issues) or APPROVED

4. Hephaestus: fixes
   → Fill "Ответ исполнителя"
   → Status: REVIEWING (back to reviewers)

5. Repeat 2-4 until APPROVED

6. Human: run test plan
   → If OK: step → DONE, Human deletes file
   → If not OK: feedback via chat, back to step 4
```

---

## Rules

1. **One file per project** — don't create CurrentReview_1.md, _2.md
2. **Delete after DONE** — don't accumulate history
3. **Reference topic** — step details in topic, only review here
4. **Independent reviews** — convention: each reviewer writes to their section without reading others' sections before Socrates synthesizes

---

## Statuses

| Status | Meaning | Owner |
|--------|---------|-------|
| `REVIEWING` | Reviewers working | Daedalus-N |
| `NEEDS_FIXES` | Synthesis done, awaiting fixes | Hephaestus |
| `APPROVED` | Ready for human test | Human |

---

## Difference from CurrentStepWork.md (deprecated)

| Aspect | CurrentStepWork (old) | CurrentReview (new) |
|--------|----------------------|---------------------|
| Purpose | Task assignment + review | Review only |
| Context duplication | Yes (copied from topic) | No (link to topic) |
| Sections | 6 (assignment, context, checklist, result, review) | 5 (reviews, synthesis, test-plan, response) |
| Focus | Implementer-centric | Review-centric |
