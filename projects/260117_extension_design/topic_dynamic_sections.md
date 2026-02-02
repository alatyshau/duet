# Динамические секции для бизнесов

**Статус:** IN_REVIEW

---

## МОТИВАЦИЯ

Каждый бизнес — отдельная секция sidebar. Независимое сворачивание, нативный look & feel VS Code.

---

## ССЫЛКИ

- [260202_topic_vscode_extension.md](260202_topic_vscode_extension.md) — основная спецификация (архив)

---

## НАРРАТИВ

### Подход

Views объявляются статически в `package.json`. Решение: объявить 10 секций `duet.business0`...`duet.business9`, скрывать неиспользуемые через `when` clause.

### Структура sidebar

```
┌─────────────────────────────────────┐
│ КОНТЕКСТ              [🔄][➕][⚙️] │  ← refresh, add business, settings
├─────────────────────────────────────┤
│   ...breadcrumb...                  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 🔬 МетаЛаб        [📂][🔗][▼]     │  ← open here, open new window, collapse
├─────────────────────────────────────┤
│   ▼ 💻 ТехноЛаб                    │
│       ● Duet                        │
│       ● Kreator                     │
│   ▶ 🎓 База                         │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 👨‍👩‍👧 Семья           [📂][🔗][▼]     │
├─────────────────────────────────────┤
│   ...                               │
└─────────────────────────────────────┘
```

### Изменения

| Компонент | Было | Станет |
|-----------|------|--------|
| Секция ДЕЛА | Одна, все бизнесы внутри | Удаляется |
| Секции бизнесов | — | 10 секций `duet.business0`...`duet.business9` |
| Ссылка [МОИ ДЕЛА] | В КОНТЕКСТ | Удаляется |
| Refresh + Add business | В секции ДЕЛА | В секции КОНТЕКСТ |
| Collapse/expand | На секцию ДЕЛА | На каждую секцию бизнеса |
| Open workspace | — | Кнопки в header каждого бизнеса |
| Пропорции секций | Кастомные (ДЕЛА больше) | Одинаковые (по умолчанию) |

### Технические детали

**package.json:**
```jsonc
"views": {
  "duet-sidebar": [
    { "id": "duet.context", "name": "КОНТЕКСТ" },
    { "id": "duet.business0", "name": "Бизнес", "when": "duet.businessCount > 0" },
    { "id": "duet.business1", "name": "Бизнес", "when": "duet.businessCount > 1" },
    // ...до 9
    { "id": "duet.projects", "name": "ПРОЕКТЫ" }
  ]
}
```

**Динамические title:**
```typescript
const view = vscode.window.createTreeView('duet.business0', { treeDataProvider });
view.title = businesses[0]?.name;        // "МетаЛаб"
view.description = businesses[0]?.icon;  // "🔬"
```

**Context для when:**
```typescript
vscode.commands.executeCommand('setContext', 'duet.businessCount', businesses.length);
```

**Один provider с индексом:**
```typescript
class BusinessTreeProvider {
  constructor(private index: number) {}
  getChildren() {
    return this.getBusinessChildren(this.businesses[this.index]);
  }
}
```

---

## ВЫХОДЫ

### Новая структура sidebar

- КОНТЕКСТ (с кнопками refresh, add business)
- Секции бизнесов (0-9, динамически)
- ПРОЕКТЫ

### Кнопки в header бизнеса

- Open in current window
- Open in new window
- Collapse/expand

---

## ПЛАН ВНЕДРЕНИЯ

### Критерии завершённости

- [ ] 10 секций бизнесов в package.json
- [ ] Секции скрываются через `when` clause
- [ ] Title и description обновляются динамически
- [ ] Кнопки refresh/add в КОНТЕКСТ
- [ ] Кнопки open workspace в каждом бизнесе
- [ ] Секция ДЕЛА удалена
- [ ] Ссылка [МОИ ДЕЛА] удалена

### Шаг 1: Реализация

**Статус:** IN_REVIEW

Всё что нужно для работы фичи. После этого шага — ревью.

**Ход работы:**
- [x] package.json: 10 views `duet.business0`...`duet.business9` с `when` clause
- [x] package.json: удалить view `duet.businesses`
- [x] Создать `BusinessSectionProvider` с индексом
- [x] Регистрация 10 providers через `createTreeView` в extension.ts
- [x] Обновлять `duet.businessCount` context при scan
- [x] Обновлять `view.title` и `view.description` при scan
- [x] Команды `duet.openBusinessWorkspace`, `duet.openBusinessWorkspaceNewWindow`
- [x] `menus.view/title` для кнопок в header бизнесов
- [x] Перенести кнопки refresh, addBusiness в header КОНТЕКСТ
- [x] Удалить ссылку [МОИ ДЕЛА] (была в старом BusinessTreeProvider, теперь не нужна)
- [x] Пропорции секций по умолчанию (убраны initialSize)

### Шаг 2: Cleanup (после принятия)

**Статус:** TODO

Выполняется только если Шаг 1 принят.

**Ход работы:**
- [ ] Удалить старый `BusinessesProvider`
- [ ] Удалить старые команды и меню
- [ ] Обновить тесты
