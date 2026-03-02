# GitLab Dump — Десктопное приложение

## Обзор

Десктопное приложение на базе Electron для полного цикла работы с репозиториями GitLab: аутентификация, просмотр проектов, клонирование, обновление и миграция данных. Предоставляет графический интерфейс на базе Ant Design + Tailwind CSS. Использует общую Node.js-библиотеку (`lib/`) напрямую через IPC, без внешнего серверного процесса. Настройки сохраняются между сессиями через `electron-store`.

Поддерживаемые платформы: Windows (портативный .exe), macOS (app bundle), Linux (AppImage).

## Архитектура

### Компоненты

Приложение состоит из двух основных слоёв:

1. **Main Process** (`main.js`): основной процесс Electron — управляет окнами, IPC и напрямую вызывает модули `lib/`
2. **Renderer Process** (`src/`): React-приложение, работающее в окне Chromium

### Схема взаимодействия

```
Renderer (React UI)
        ↓ (IPC через preload.js)
Main Process (Electron)
        ↓ (прямые вызовы функций)
@gitlab-dump/core (lib/)
```

Renderer-процесс общается с main-процессом через IPC (Inter-Process Communication). Main-процесс импортирует и вызывает модули `lib/` напрямую — без HTTP-сервера и внешних процессов.

### Безопасность

Приложение использует preload-скрипт (`preload.js`) для создания безопасного моста между main- и renderer-процессами. Разрешены только IPC-каналы из белого списка, что предотвращает несанкционированный доступ к системным ресурсам.

## Структура директорий

```
electron/
├── main.js                 # Основной процесс Electron (IPC-обработчики → lib/)
├── preload.js             # Безопасный IPC-мост к renderer (белый список каналов)
├── env.js                 # Конфигурация окружения
├── webpack.config.js      # Конфигурация Webpack (Babel + PostCSS + Tailwind)
├── tailwind.config.js     # Конфигурация Tailwind CSS
├── postcss.config.js      # Конфигурация PostCSS
├── package.json           # Зависимости и npm-скрипты
├── electron-builder.config.js  # Конфигурация сборки дистрибутивов
├── src/                   # Исходники React-приложения
│   ├── index.js          # Точка входа
│   ├── App.js            # Главный компонент (навигация между видами)
│   ├── index.html        # HTML-шаблон
│   ├── components/       # React-компоненты (Ant Design)
│   │   ├── AppLayout.js         # Общий layout с боковым меню
│   │   ├── SettingsPage.js      # Настройки: URL, токен, OAuth, пути
│   │   ├── OAuthDeviceFlow.js   # OAuth Device Flow авторизация
│   │   ├── ProjectsPage.js      # Браузер проектов GitLab
│   │   ├── ClonePage.js         # Клонирование и обновление репозиториев
│   │   ├── RepoList.js          # Список локальных репозиториев
│   │   ├── MigrationWizard.js   # Пошаговый визард миграции
│   │   ├── AuthorMapper.js      # Маппинг авторов/коммитеров
│   │   └── ProgressIndicator.js # Индикатор прогресса миграции
│   └── styles/
│       └── globals.css   # Tailwind CSS директивы + Ant Design reset
├── __tests__/            # Jest-тесты
├── dist/                 # Результат сборки Webpack
├── dist_electron/        # Результат сборки electron-builder
└── node_modules/         # npm-зависимости
```

## Установка и разработка

### Требования

- **Node.js**: 16.x или выше (`node --version`)
- **npm**: 8.x или выше (`npm --version`)

### Установка

Из корня проекта:

```bash
# Установить все зависимости (lib, cli, electron)
make node-install
```

Или из директории `electron/`:

```bash
npm install
```

### Режим разработки

Запуск Webpack dev server и Electron одновременно:

```bash
npm run dev
```

Эта команда:
1. Запускает Webpack dev server на порту 8000 с горячей перезагрузкой
2. Ждёт готовности dev server
3. Запускает Electron с удалённой отладкой на порту 9222

#### Возможности при разработке

- **Горячая перезагрузка**: React-компоненты обновляются без перезапуска
- **Удалённая отладка**: Chrome DevTools доступны по адресу `localhost:9222`
- **Быстрая итерация**: Webpack и Electron отслеживают изменения файлов

### Раздельный запуск компонентов

```bash
# Терминал 1: Webpack dev server
npm run webpack-dev

# Терминал 2: Electron (после готовности Webpack)
npm run electron-dev
```

## Сборка

### Production-сборка

Создание оптимизированного бандла:

```bash
npm run build
```

Запускает Webpack в production-режиме, генерируя минифицированный код в `dist/`.

### Создание дистрибутивов

Приложение использует `electron-builder` для создания платформенно-специфичных бинарников. Внешний бэкенд не требуется — вся логика в `lib/`.

#### Сборка для конкретных платформ

**Все платформы:**
```bash
npm run dist
```

**Только Windows (портативный .exe):**
```bash
npm run dist-win
```
Результат: `GitLab Dump-X.Y.Z-win-x64.exe`

**Только macOS (.dmg и .zip):**
```bash
npm run dist-mac
```
Результат: `GitLab Dump-X.Y.Z.dmg` и `.zip`

**Только Linux (AppImage):**
```bash
npm run dist-linux
```
Результат: `GitLab Dump-X.Y.Z.AppImage`

### Подписание и нотаризация

Для production-релизов с подписью кода установите переменные окружения перед сборкой.

**Windows:**
```bash
export WIN_CERT_FILE=/path/to/certificate.pfx
export WIN_CERT_PASSWORD=password
npm run dist-win
```

**macOS:**
```bash
export MAC_CERT_FILE=/path/to/certificate.p12
export MAC_CERT_PASSWORD=password
export MAC_IDENTITY="Developer ID Application: Name"
npm run dist-mac
```

Для нотаризации macOS (обязательна для распространения вне App Store):
```bash
export MAC_NOTARIZE=true
export APPLE_TEAM_ID=your_team_id
export APPLE_ID=your_apple_id
export APPLE_ID_PASSWORD=your_app_password
npm run dist-mac
```

## UI-компоненты

Все компоненты используют Ant Design для UI-элементов и Tailwind CSS для утилитарных стилей.

### AppLayout
Общий layout приложения: Ant Design `Layout` + `Sider` с `Menu`. Боковое меню с 5 пунктами навигации: Settings, Projects, Clone, Repositories, Migration.

### SettingsPage
Страница настроек приложения (Ant Design `Form`):
- GitLab URL, метод авторизации (token / OAuth), токен или OAuth Client ID
- Путь клонирования (с диалогом выбора папки), лимит конкурентности, режим git-авторизации
- Кнопки "Test Connection" и "Save"
- Настройки сохраняются в `electron-store` между сессиями

### OAuthDeviceFlow
OAuth Device Flow авторизация:
- Отображает verification URL (ссылка) и user code (крупный текст для копирования)
- Ant Design `Spin` при ожидании подтверждения
- Автоматическое сохранение токена при успехе

### ProjectsPage
Браузер проектов GitLab:
- Загрузка проектов по группе или по членству пользователя
- Ant Design `Table` с колонками: имя, путь, URL, дата активности
- Выбор проектов чекбоксами, поиск по имени
- Кнопка "Clone Selected" для перехода к клонированию

### ClonePage
Клонирование и обновление репозиториев:
- Dry-run (предпросмотр) перед выполнением
- Переключатель "Update existing repositories"
- Ant Design `Table` с динамическим статусом (pending/cloning/success/updated/skipped/failed)
- Общий `Progress` bar, кнопка отмены с подтверждением
- Итоговая статистика (Ant Design `Statistic`)

### RepoList
Список локальных репозиториев (Ant Design `Table`):
- Колонки: имя, remote URL, локальный путь, дата обновления, действия
- Действия: Update (обновить), Migrate (перейти к миграции), Open folder (открыть в файловом менеджере)
- Поиск по имени, пустое состояние (Ant Design `Empty`)

### MigrationWizard
Пошаговый визард миграции (Ant Design `Steps`, 4 шага):
- Step 1: Author Mappings — настройка маппинга авторов/коммитеров
- Step 2: Review & Confirm — просмотр маппингов перед миграцией
- Step 3: Progress — отслеживание прогресса миграции в реальном времени
- Step 4: Complete — результат миграции

### AuthorMapper
Маппинг авторов/коммитеров (Ant Design `Form` + `Form.List`):
- Динамический список маппингов: тип (author/committer), оригинальное и новое имя/email
- Добавление/удаление маппингов, валидация полей

### ProgressIndicator
Индикатор прогресса миграции:
- Ant Design `Progress` (процентный или индетерминантный режим)
- Текущая задача, лог сообщений (`List`), кнопка отмены

## IPC-каналы

### Renderer → Main (через preload)

**Invoke-обработчики (запрос-ответ):**

Настройки и аутентификация:
- `load-settings`: загрузить настройки из electron-store
- `save-settings`: валидировать и сохранить настройки в electron-store
- `test-connection`: проверить подключение к GitLab (вызов `/api/v4/user`)
- `select-directory`: открыть диалог выбора папки (для пути клонирования)
- `start-oauth-device-flow`: запустить OAuth Device Flow авторизацию

Репозитории и миграция (legacy):
- `get-clone-path`: получить директорию хранения репозиториев
- `get-repos`: просканировать директорию и получить список git-репозиториев
- `get-author-mappings`: загрузить маппинг авторов/коммитеров из конфигурации
- `save-author-mappings`: сохранить маппинг авторов/коммитеров
- `get-config`: загрузить конфигурацию миграции из репозитория
- `save-config`: сохранить конфигурацию миграции в репозиторий
- `start-migration`: запустить асинхронную миграцию, возвращает migrationId
- `cancel-migration`: отменить запущенную миграцию по ID

Проекты и клонирование:
- `fetch-projects`: загрузить проекты из GitLab (по группе или пользователю)
- `cancel-fetch-projects`: отменить активную загрузку проектов
- `clone-repositories`: клонировать/обновить репозитории с прогрессом
- `cancel-clone`: отменить активное клонирование
- `dry-run-projects`: вычислить цели клонирования без выполнения

Системные:
- `open-path`: открыть путь в файловом менеджере (shell.openPath)
- `request-shutdown`: запросить корректное завершение приложения

### Main → Renderer (события)

- `migration-progress`: обновления прогресса миграции в реальном времени
- `oauth-progress`: обновления OAuth Device Flow (status, token, message)
- `clone-progress`: обновления прогресса клонирования (project, result, completed, total)

### Каналы управления окном

- `app-quit`: закрыть приложение
- `app-minimize`: свернуть окно
- `app-maximize`: переключить состояние максимизации

## Конфигурация окружения

Конфигурация через `env.js`:

```javascript
{
  isDev: boolean,           // Режим разработки
  LOG_LEVEL: 'debug',      // 'debug' в dev, 'info' в production
  DEBUG: boolean           // Отладочный режим
}
```

## Конфигурация сборки

### Настройки Electron Builder

См. `electron-builder.config.js` для платформенных конфигураций:

- **Windows**: портативный исполняемый файл для архитектур x64 и ia32
- **macOS**: app bundle с форматами DMG и ZIP
- **Linux**: AppImage для универсального распространения

### Конфигурация Webpack

`webpack.config.js` обрабатывает:
- Бандлинг React-компонентов через Babel
- CSS pipeline: style-loader → css-loader → postcss-loader (Tailwind CSS + autoprefixer)
- Генерация HTML-шаблонов через HtmlWebpackPlugin
- Конфигурация dev-сервера

## Устранение неполадок

### Частые проблемы

**Webpack dev server не запускается**
```bash
# Очистить кэш и переустановить
rm -rf node_modules package-lock.json
npm install
npm run webpack-dev
```

**Electron показывает пустую страницу**
- Убедитесь, что Webpack dev server запущен на порту 8000
- Проверьте вывод `npm run webpack-dev` на наличие ошибок
- Очистите кэш Electron: `rm -rf ~/.config/GitLab\ Dump/`

**IPC-обработчики не отвечают**
- Проверьте вывод консоли main.js на наличие ошибок
- Убедитесь, что модули `lib/` установлены: `cd ../lib && npm install`
- Используйте DevTools (F12) для инспекции IPC-вызовов в renderer

**Порт 8000 уже занят**
```bash
# Найти процесс на порту 8000
lsof -i :8000
# Завершить процесс при необходимости
kill -9 <PID>
```

### Режим отладки

Включить дополнительное логирование:
```bash
DEBUG=gitlab-dump* npm run dev
```

Удалённая отладка доступна по адресу `localhost:9222` при запуске через `npm run electron-dev`.

## Тестирование

Запуск тестов:
```bash
npm test
```

Или из корня проекта:
```bash
make electron-test
```

## Советы по производительности

1. **Production-сборки**: всегда используйте `npm run dist` вместо dev-режима для релизов
2. **Размер бандла**: проверяйте статистику Webpack перед выпуском крупных обновлений
3. **Память**: для миграции больших репозиториев рекомендуется 2GB+ оперативной памяти
4. **Сеть**: для больших миграций необходимо стабильное подключение

## Участие в разработке

При изменении Electron-приложения:

1. Протестируйте workflow разработки: `npm run dev`
2. Протестируйте production-сборку: `npm run build`
3. Проверьте бандлинг Webpack: убедитесь в корректности `dist/bundle.js`
4. Протестируйте сборку дистрибутива на целевых платформах
5. Обновите этот README при добавлении новых компонентов или значимых изменений

## Зависимости

Runtime:
- **React 18.2**: UI-фреймворк
- **Ant Design 6**: библиотека UI-компонентов
- **@ant-design/icons 6**: иконки для Ant Design
- **electron-store 11**: persistent хранилище настроек (ESM)
- **Electron 27**: десктопный фреймворк
- **@gitlab-dump/core**: общая core-библиотека (lib/)
- **Zod 3**: валидация настроек

Dev:
- **Tailwind CSS 4**: утилитарные CSS-классы
- **PostCSS 8** + **autoprefixer**: CSS post-processing
- **Webpack 5**: бандлер модулей
- **Babel 7**: JavaScript-транспилятор
- **electron-builder 24**: сборка дистрибутивов

Полный список зависимостей и версий см. в `package.json`.

## Лицензия

MIT — см. файл LICENSE в корне проекта
