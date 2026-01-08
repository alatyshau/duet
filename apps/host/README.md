# Duet Host — Desktop-приложение

ЧТО: Electron-приложение Duet — desktop-клиент системы управления знаниями.
ЗАЧЕМ: Обеспечивает нативный доступ к Duet через системный трей и UI.
КТО ИСПОЛЬЗУЕТ: Конечные пользователи Duet на macOS/Windows/Linux.

---

## Стек

- **Electron** — кроссплатформенный desktop
- **React + TypeScript** — UI в renderer-процессе
- **Tailwind CSS v4** — стилизация
- **shadcn/ui** — компоненты

## Быстрый старт

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки
npm run dev
```

## Сборка дистрибутивов

```bash
npm run build:mac    # → dist/Duet-{version}.dmg
npm run build:win    # → dist/Duet-{version}-setup.exe
npm run build:linux  # → dist/Duet-{version}.AppImage
```

Подробнее о генерации иконок и code signing — см. [BUILD.md](BUILD.md).

## Рекомендуемые расширения IDE

- [VSCode](https://code.visualstudio.com/)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
