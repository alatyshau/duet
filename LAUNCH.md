# Duet — Quick Launch

Duet — система "Getting Products Done". Монорепо из 4 пакетов: десктопное Electron-приложение (Host), расширение для VSCode (Extension), Python-бэкенд с MCP и AI-инструкции.

## Структура монорепо

Каждый пакет — самостоятельный компонент со своим стеком и задачей:

```
packages/
  host/              Electron-приложение — установка, деплой компонентов, UI настроек
  extension/         VSCode-расширение — sidebar с деревом бизнесов, команды, навигация
  backend/           Python HTTP API + MCP сервер — сканер иерархии, база, алиасы
  ai-instructions/   Исходники AI-инструкций, которые Host деплоит в DuetData
```

## Разработка

Host — Electron-приложение с Vite HMR. Запускается одной командой из корня, открывает окно приложения с горячей перезагрузкой при изменениях:

```bash
npm run dev:host
```

Extension — VSCode-расширение. Открой корень монорепо в VSCode и нажми F5 (Run Extension). Запустится второе окно VSCode с загруженным расширением для отладки.

Backend — Python-сервер, который обычно деплоится автоматически из Host UI (кнопка "Установить"). Для ручной разработки и отладки:

```bash
cd packages/backend
pip install -r requirements-dev.txt
python server.py
```

## Сборка

Host собирается через electron-vite + electron-builder. Сначала проходит typecheck, потом бандлинг, потом упаковка в нативный инсталлятор под нужную платформу:

```bash
npm run build:host        # typecheck + electron-vite build (без упаковки)
```

Релиз — bump version + сборка инсталлятора. Одна команда на релиз (выбери свою платформу):

```bash
cd packages/host
npm run release                # bump + .dmg (macOS)
# ИЛИ
npm run release -- --win       # bump + .exe
# ИЛИ
npm run release -- --linux     # bump + .AppImage
```

Для отладки сборки без бампа версии:

```bash
cd packages/host
npm run build:mac              # .dmg без bump
npm run build:win              # .exe без bump
```

Extension собирается через esbuild в один бандл. Релиз:

```bash
cd packages/extension
npm run vsix              # bump + собрать .vsix файл
```

Для отладки сборки без бампа: `npm run package`

## Копирование артефактов в DuetData

После релиза оба артефакта обязательно копируются в корень `DuetData/` (плоско, рядом с предыдущими версиями) — оттуда пользователь ставит новые версии:

```bash
cp packages/extension/dist/duet-<version>.vsix ~/DuetData/
cp packages/host/dist/Duet-<version>.dmg ~/DuetData/
```

## Проверка перед коммитом

Одна команда запускает ВСЕ проверки по всем пакетам — typecheck, lint, тесты. Если что-то красное, коммитить нельзя:

```bash
npm run verify
```

Можно проверять пакеты по отдельности, если работаешь только с одним:

```bash
npm run verify:host         # typecheck + lint + vitest
npm run verify:extension    # check-types + lint + vitest
npm run verify:backend      # pytest
```

Важно: `electron-vite build` использует esbuild, который пропускает проверки TypeScript (`noUnusedLocals` и т.д.). Команда `verify` включает отдельный `typecheck` — это ловит ошибки, которые esbuild пропускает.
