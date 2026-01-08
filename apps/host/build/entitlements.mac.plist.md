# entitlements.mac.plist

ЧТО: Файл разрешений (entitlements) для подписи macOS-приложения.
ЗАЧЕМ: Даёт приложению права на JIT-компиляцию и доступ к памяти без подписи.
КТО ИСПОЛЬЗУЕТ: electron-builder при подписи `.app` бандла.

---

## Что такое Entitlements?

При подписи macOS-приложения нужно указать, какие системные возможности ему разрешены.
Apple требует это для:
- Прохождения Gatekeeper (запуск скачанных приложений)
- Публикации в App Store
- Нотаризации (notarization)

## Используемые права

| Ключ | Значение | Зачем |
|------|----------|-------|
| `com.apple.security.cs.allow-jit` | `true` | Разрешает JIT-компиляцию JavaScript (нужно для V8 в Chromium) |
| `com.apple.security.cs.allow-unsigned-executable-memory` | `true` | Разрешает выполнять неподписанный код в памяти (нужно V8 для оптимизаций) |

## Почему именно эти права?

Electron (Chromium) использует V8 JavaScript engine, который:
1. Компилирует JS в машинный код "на лету" (JIT)
2. Хранит скомпилированный код в памяти без подписи

Без этих разрешений приложение:
- Не запустится на macOS (ошибка code signature)
- Или будет работать в режиме интерпретатора (очень медленно)

## Связанные файлы

| Файл | Описание |
|------|----------|
| `electron-builder.yml` | Ссылается на этот файл: `mac.entitlements` |
| `entitlements.mac.inherit.plist` | Для дочерних процессов (deprecated, обычно не нужен) |

## Подробнее

- [Apple: Entitlements](https://developer.apple.com/documentation/bundleresources/entitlements)
- [Electron Hardened Runtime](https://www.electronjs.org/docs/latest/tutorial/code-signing#hardened-runtime)
