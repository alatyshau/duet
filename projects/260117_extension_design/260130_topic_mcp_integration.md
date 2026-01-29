# Топик: Поддержка MCP в расширении Duet

**Статус:** Черновик
**Контекст:** [Проект: 260117_extension_design](index.md)

---

## МОТИВАЦИЯ

В данный момент Duet использует внешний MCP сервер на Python (`ai-kit/mcp-server`), который требует ручной настройки `github.copilot.mcpServers` в пользовательских настройках или `.vscode/mcp.json`. Это хрупкое и неудобное для пользователя решение ("костыль").

Мы хотим "нативную" интеграцию, чтобы расширение Duet автоматически регистрировало MCP сервер в VS Code / GitHub Copilot, улучшая опыт установки (onboarding).

### Цели

1.  **Бесшовная интеграция:** MCP сервер работает "из коробки" сразу после установки расширения.
2.  **Без ручной настройки:** Пользователю не нужно править `settings.json`.
3.  **Архитектурное соответствие:** Использование штатной точки расширения `mcpServerDefinitionProviders` (VS Code API).
4.  **Полная автономность:** Отказ от внешнего Python-процесса. Сервер переписывается на TypeScript и упаковывается внутрь расширения.

---

## ССЫЛКИ

- [MCP Developer Guide (VS Code)](https://code.visualstudio.com/api/extension-guides/ai/mcp)

---


## ВЫХОДЫ

### Справка: Нативный способ интеграции (VS Code API)

1.  **Объявление в `package.json`**
    Вместо правки `settings.json`, объявляем провайдер через `contributes`:

    ```json
    "contributes": {
        "mcpServerDefinitionProviders": [
            {
                "id": "duet-ai-kit",
                "label": "Duet AI Kit"
            }
        ]
    }
    ```

2.  **Регистрация в коде (`extension.ts`)**
    Используем API `vscode.lm`, чтобы зарегистрировать провайдер, который говорит VS Code, как запустить сервер:

    ```typescript
    import * as vscode from 'vscode';

    export function activate(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.lm.registerMcpServerDefinitionProvider('duet-ai-kit', {
                provideMcpServerDefinitions: async () => {
                    return [{
                        name: 'duet-ai-kit',
                        version: '1.0.0',
                        type: 'stdio',
                        command: 'node', // Запуск бандла внутри расширения
                        args: [
                            context.asAbsolutePath('dist/mcp-server.js'),
                            '--data-dir', '/path/to/data'
                        ]
                    }];
                }
            })
        );
    }
    ```


---


## ПЛАН РЕАЛИЗАЦИИ

### Шаг 1: Реализация нативного MCP сервера

Выполнить полный цикл интеграции в одном коммите:

1.  **Зависимости:** Добавить `@modelcontextprotocol/sdk`.
2.  **Конфигурация:** В `package.json` добавить `mcpServerDefinitionProviders`.
3.  **Сервер:** Реализовать `src/mcp-server/index.ts` (порт `timestamp` и `get_instruction_location` с Python на TS). Путь к папке DuetData известен расширению — использовать именно его.
4.  **Сборка:** Настроить `esbuild.js` для бандлинга сервера в `dist/mcp-server.js`.
5.  **Регистрация:** В `extension.ts` зарегистрировать провайдер `duet-ai-kit`, запускающий `dist/mcp-server.js`.

### Контекст и Решения

- **Технологический стек:** TypeScript (Node.js). Полный отказ от Python-зависимостей (`ai-kit/mcp-server`).
- **Архитектура:** Сервер является частью расширения. Код компилируется в `dist/mcp-server.js`.
- **Изоляция процесса:** MCP сервер работает в отдельном Node.js процессе и НЕ имеет доступа к `vscode` API. Весь код сервера должен быть self-contained.
- **Изоляция от ai-kit:** Расширение не зависит от внутренней структуры `ai-kit`. Единственный контракт — путь к данным (`DuetData`), который передается серверу при запуске.
- **Минимальная версия:** MCP support GA с VS Code 1.102. Указать `"engines": { "vscode": "^1.102.0" }`.
- **Референс:** VS Code [MCP Developer Guide](https://code.visualstudio.com/api/extension-guides/ai/mcp).

---
