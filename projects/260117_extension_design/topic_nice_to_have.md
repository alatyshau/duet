# Nice to Have

**Статус:** backlog

---

## МОТИВАЦИЯ

Идеи для улучшений расширения, которые не входят в MVP.

---

## ССЫЛКИ

- [topic_vscode_extension.md](topic_vscode_extension.md) — основная спецификация

---

## НАРРАТИВ

Список ведётся по мере появления идей.

---

## ВЫХОДЫ

### Режим "Focus siblings"

**Идея:** Checkbox в секции ДЕЛА. Когда включён — при входе в дело все siblings автоматически свёртываются. Остаётся виден только один путь в иерархии.

**Зачем:** Когда много дел в иерархии — меньше визуального шума.

**UI:**
```
┌─────────────────────────────────────┐
│ ДЕЛА                    [−][+][👁] │  ← 👁 = focus mode toggle
├─────────────────────────────────────┤
│   ▼ 🔬 МетаЛаб                     │
│     ▼ 💻 ТехноЛаб                  │  ← остальные siblings свёрнуты
│       ● Duet                       │
│   ▶ 👨‍👩‍👧 Семья                       │  ← свёрнут
│   ▶ 🎓 База                         │  ← свёрнут
└─────────────────────────────────────┘
```

### Импорты (автоматизация копирования файлов)

**Контекст:** В MVP мы решили отказаться от симлинков (Windows требует Developer Mode). Вместо этого:
- Git-repo клонируется как `Duet.git`
- При открытии git-repo Drive-папка `Duet` автоматически добавляется в workspace
- Пользователь вручную копирует нужные файлы (.env) — это one-time операция

**Идея:** Автоматизировать копирование файлов из Drive в git-repo.

**Зачем:**
- Автоматизация вместо ручного копирования
- Кросс-продуктовые зависимости (файлы из других продуктов)
- Единый механизм для secrets и shared контента

**Формат в product.json:**
```jsonc
"import": {
  ".env": { "from": "./.env", "git": "ignore" },
  ".context/book.md": { "from": "База/books/ai.md", "git": "track" }
}
```

**Пути (from):**
- `./` — относительно папки продукта на Drive (например `./secrets/.env`)
- Без `./` — Duet-относительный путь от корня business_folders (например `База/books/ai.md`)

**Пути (to):**
- Ключ объекта — путь в git-repo относительно корня (например `.env`, `.context/book.md`)

**Конфликты (Source wins):**
- При изменении source → автоматически перезаписывается копия в git-repo
- Watcher на source-файлы

**Git-опции:**
| Опция | Поведение |
|-------|-----------|
| `"ignore"` | Добавляется в `.gitignore` (секреты) |
| `"track"` | Коммитится в репо, source wins при конфликте |

**UI при конфликте:**
```
⚠️ Файл .context/book.md изменён локально.
   Source (База/books/ai.md) был обновлён.
   [Перезаписать] [Показать diff]
```

### E2E тестирование с @vscode/test-electron

**Контекст:** Сейчас есть только unit-тесты (vitest). Они не ловят проблемы, которые возникают в реальном VS Code (например, WASM-файл не найден в VSIX).

**Идея:** Добавить e2e-тесты с `@vscode/test-electron`, которые запускают реальный VS Code с расширением.

**Зачем:**
- Ловить проблемы упаковки (WASM, assets)
- Проверять реальную активацию расширения
- CI может тестировать VSIX перед публикацией

**Что нужно:**
- Зависимость `@vscode/test-electron`
- Test runner конфиг
- Smoke-тесты: активация, команды, TreeView

**Примеры багов, которые ловятся только UI-тестами:**

| Баг | Почему только UI-тест |
|-----|----------------------|
| Welcome view не показывает кнопку "Open folder" | Рендеринг welcome content |
| QuickPick появляется в неправильном месте | Позиционирование VS Code UI |
| Tooltips не отображаются при наведении | Hover state |
| Текущий узел не выделен (bold/green) | TreeItem decoration rendering |
| Hover-иконки не появляются | Inline actions visibility |
| Иконка не там где ожидается | Layout/alignment |

**Альтернативные фреймворки:**

| Фреймворк | Плюсы | Минусы |
|-----------|-------|--------|
| `@vscode/test-electron` | Официальный, простой setup | Ограниченный API |
| `vscode-extension-tester` | Полноценный Selenium, богатый API | Медленный, flaky |
| Playwright + VS Code | Быстрый, современный | Сложная настройка |

**Пример теста (vscode-extension-tester):**

```typescript
import { TreeView, Workbench } from 'vscode-extension-tester';

describe('Context TreeView', () => {
  it('should show breadcrumb for git repo', async () => {
    const workbench = new Workbench();
    const sidebar = await workbench.getActivityBar().getViewControl('Duet');
    const view = await sidebar.openView();

    const tree = await view.getContent().getSection('КОНТЕКСТ') as TreeView;
    const items = await tree.getVisibleItems();

    expect(items.length).toBeGreaterThan(0);
    expect(await items[0].getLabel()).toContain('МетаЛаб');
  });
});
```

---

## ПЛАН ВНЕДРЕНИЯ

**Статус:** неясно

Реализовать после MVP, если будет потребность.
