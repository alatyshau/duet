# Review: Step 8 — UX Improvements

## Задачи для Гефеста

---

### Задача 1: Удалить старые команды из Command Palette

**Проблема:** `duet.expandAll` и `duet.collapseAll` остались в `contributes.commands`. Пользователь видит их в Command Palette рядом с новым `toggleExpand`. Три команды делают похожее — путаница.

**Что сделать:**

1. В `packages/extension/package.json` удалить из `contributes.commands`:
   - `duet.expandAll`
   - `duet.collapseAll`

2. В `packages/extension/src/vscode/extension.ts` удалить регистрацию этих команд (если есть отдельная регистрация помимо contributes).

3. Проверить что `toggleExpand` работает корректно после удаления.

4. Запустить `npm run check-types` и `npm test`.

---

### Задача 2: Robust path comparison для repos/

**Проблема:** Текущая реализация проверки "папка внутри repos/" использует `startsWith(normalizedReposPath + path.sep)`. Это ненадёжно:

1. `path.normalize()` может сохранить trailing separator (`/repos/` → `/repos/`)
2. Конкатенация даёт `/repos//` — двойной separator
3. `startsWith('/repos//')` не срабатывает для `/repos/Duet.git`
4. Результат: папка в repos не распознаётся как repos-папка, маркер `●` не показывается

**Что сделать:**

Использовать `path.relative()` вместо `startsWith()`. Это стандартный подход для проверки "путь внутри директории":

```typescript
/**
 * Check if childPath is inside parentPath.
 * Works correctly on all platforms (Windows case-insensitivity, trailing separators, etc.)
 */
function isPathInside(childPath: string, parentPath: string): boolean {
    // Normalize both paths
    let normalizedChild = path.normalize(childPath);
    let normalizedParent = path.normalize(parentPath);

    // On Windows, paths are case-insensitive
    if (process.platform === 'win32') {
        normalizedChild = normalizedChild.toLowerCase();
        normalizedParent = normalizedParent.toLowerCase();
    }

    // Get relative path from parent to child
    const relative = path.relative(normalizedParent, normalizedChild);

    // If relative path:
    // - starts with '..' → child is outside parent
    // - is absolute → different drives on Windows
    // - is empty string → paths are equal
    // - otherwise → child is inside parent
    return relative !== '' &&
           !relative.startsWith('..') &&
           !path.isAbsolute(relative);
}
```

**Файлы для изменения:**

1. **`packages/extension/src/vscode/providers/BusinessTreeProvider.ts`**
   - Добавить функцию `isPathInside()` (или вынести в shared utils)
   - Заменить в `updateCurrentContext()`:
     ```typescript
     // Было:
     if (normalizedReposPath && normalizedFsPath.startsWith(normalizedReposPath + path.sep))

     // Стало:
     if (this.reposPath && isPathInside(fsPath, this.reposPath))
     ```

2. **`packages/extension/src/core/tree/contextBreadcrumb.ts`**
   - Заменить метод `isInsideRepos()` на использование `isPathInside()`:
     ```typescript
     private isInsideRepos(folderPath: string): boolean {
         return isPathInside(folderPath, this.reposPath);
     }
     ```
   - Либо inline если функция в shared utils

3. **Вынести в shared utils** (рекомендуется):
   - Создать `packages/extension/src/core/pathUtils.ts`
   - Экспортировать `isPathInside()` и `normalizePath()`
   - Импортировать в оба файла

**Тесты:**

Добавить unit-тесты в `packages/extension/src/test/unit/` для `isPathInside()`:

```typescript
describe('isPathInside', () => {
    it('should return true for direct child', () => {
        expect(isPathInside('/repos/Duet.git', '/repos')).toBe(true);
        expect(isPathInside('/repos/Duet.git', '/repos/')).toBe(true);
    });

    it('should return true for nested child', () => {
        expect(isPathInside('/repos/sub/Duet.git', '/repos')).toBe(true);
    });

    it('should return false for sibling', () => {
        expect(isPathInside('/other/Duet.git', '/repos')).toBe(false);
    });

    it('should return false for parent', () => {
        expect(isPathInside('/repos', '/repos/Duet.git')).toBe(false);
    });

    it('should return false for equal paths', () => {
        expect(isPathInside('/repos', '/repos')).toBe(false);
        expect(isPathInside('/repos/', '/repos')).toBe(false);
    });

    it('should handle trailing separators', () => {
        expect(isPathInside('/repos/Duet.git', '/repos/')).toBe(true);
        expect(isPathInside('/repos/Duet.git/', '/repos')).toBe(true);
    });

    // Windows-specific (run on Windows or mock process.platform)
    it('should be case-insensitive on Windows', () => {
        // Mock process.platform = 'win32'
        expect(isPathInside('C:\\Repos\\Duet.git', 'c:\\repos')).toBe(true);
    });
});
```

**Проверка:**

1. `npm run check-types`
2. `npm run lint`
3. `npm test`
4. Визуально: открыть папку из repos/, убедиться что маркер `●` появляется

---

## Не делать в Step 8

- **Hover-action на [МОИ ДЕЛА]** — генерация `all-businesses.code-workspace` это Step 10
- **Toggle sync с ручным раскрытием** — ограничение VS Code API, принято как есть
