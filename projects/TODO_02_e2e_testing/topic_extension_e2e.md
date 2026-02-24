# Extension E2E Testing

**Статус:** бэклог

---

## МОТИВАЦИЯ

Unit-тесты (vitest) не ловят проблемы, которые возникают в реальном VS Code: WASM-файл не найден в VSIX, TreeView не рендерится, команда не зарегистрирована. Нужны smoke-тесты, запускающие реальный VS Code с расширением.

**Контекст:**
- Unit-тесты есть (vitest)
- E2E инфраструктуры нет
- Были реальные баги, которые ловятся только E2E (WASM в VSIX)

---

## ССЫЛКИ

- [topic_host_e2e.md](topic_host_e2e.md) — E2E для Host (WebdriverIO, другой стек)
- [@vscode/test-electron docs](https://code.visualstudio.com/api/working-with-extensions/testing-extension)

---

## НАРРАТИВ

### Зачем именно E2E, а не больше unit-тестов

Примеры багов, которые ловятся **только** E2E:

| Баг | Почему только E2E |
|-----|-------------------|
| Welcome view не показывает кнопку "Open folder" | Рендеринг welcome content |
| QuickPick появляется в неправильном месте | Позиционирование VS Code UI |
| Tooltips не отображаются при наведении | Hover state |
| Текущий узел не выделен (bold/green) | TreeItem decoration rendering |
| Hover-иконки не появляются | Inline actions visibility |
| WASM-файл не найден в VSIX | Упаковка assets |

### Выбор фреймворка

| Фреймворк | Плюсы | Минусы |
|-----------|-------|--------|
| `@vscode/test-electron` | Официальный, простой setup | Ограниченный API |
| `vscode-extension-tester` | Полноценный Selenium, богатый API | Медленный, flaky |
| Playwright + VS Code | Быстрый, современный | Сложная настройка |

**Предварительный выбор:** `@vscode/test-electron` — официальный, достаточный для smoke-тестов.

### Пример теста (vscode-extension-tester, для справки)

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

## ОТКРЫТЫЕ ВОПРОСЫ

### 1. Какой фреймворк?

`@vscode/test-electron` vs `vscode-extension-tester` vs Playwright. Нужно попробовать `@vscode/test-electron` и оценить, хватает ли API для наших сценариев.

### 2. Что тестировать в smoke?

Минимальный набор:
- [ ] Расширение активируется без ошибок
- [ ] TreeView (ДЕЛА, КОНТЕКСТ) рендерится
- [ ] Основные команды зарегистрированы
- [ ] WASM backend загружается

---

## ВЫХОДЫ

### Целевое состояние

**E2E smoke-тесты для Extension на CI:**
- Расширение упаковывается в VSIX
- VSIX устанавливается в тестовый VS Code
- Smoke-тесты проходят (активация, TreeView, команды)
- CI на 3 платформах (macOS, Windows, Linux)

---

## ПЛАН ВНЕДРЕНИЯ

### Постановка задачи

#### Scope
E2E smoke-тесты для VS Code Extension. Не UI-тесты (не тестируем пиксели), а функциональные smoke (работает ли вообще).

#### Фундаментальный вопрос
Достаточно ли `@vscode/test-electron` или нужен более мощный фреймворк?

#### Контекст
- Unit-тесты есть и работают
- VSIX упаковка настроена
- CI pipeline для extension существует

### Критерии завершённости

- [ ] Smoke-тесты проходят на CI (3 платформы)
- [ ] Тестируется реальная VSIX (не dev-режим)
- [ ] 3+ smoke-теста (активация, TreeView, команды)

### Шаг 0: Документ
**Статус:** TODO

Фиксация решений: фреймворк, набор smoke-тестов, CI конфиг.

**Коммит:** `docs(topic): topic_extension_e2e — planning complete`
