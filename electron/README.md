# GitLab Dump — Десктопное приложение

## Обзор

Десктопное приложение на базе Electron для управления репозиториями GitLab и миграции данных. Предоставляет удобный графический интерфейс для настройки и выполнения операций GitLab Dump. Использует общую Node.js-библиотеку (`lib/`) напрямую через IPC, без внешнего серверного процесса.

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
├── preload.js             # Безопасный IPC-мост к renderer
├── env.js                 # Конфигурация окружения
├── webpack.config.js      # Конфигурация Webpack
├── package.json           # Зависимости и npm-скрипты
├── electron-builder.config.js  # Конфигурация сборки дистрибутивов
├── src/                   # Исходники React-приложения
│   ├── index.js          # Точка входа
│   ├── App.js            # Главный компонент
│   ├── App.css           # Основные стили
│   ├── index.html        # HTML-шаблон
│   ├── components/       # React-компоненты
│   │   ├── AuthorMapper.js
│   │   ├── MigrationWizard.js
│   │   ├── ProgressIndicator.js
│   │   └── RepoList.js
│   └── styles/           # Стили компонентов
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

### AuthorMapper
Маппинг пользователей GitLab на Git-авторов для корректной атрибуции коммитов при миграции.

### MigrationWizard
Пошаговый визард для миграции:
- Выбор репозиториев
- Настройка учётных данных
- Параметры миграции
- Отслеживание прогресса

### ProgressIndicator
Отслеживание прогресса в реальном времени с обновлениями статуса, обработкой ошибок и уведомлениями о завершении. Получает обновления через IPC-события от main-процесса.

### RepoList
Список доступных репозиториев, просканированных из локальной директории клонов, с фильтрацией и выбором.

## IPC-каналы

### Renderer → Main (через preload)

**Invoke-обработчики (запрос-ответ):**
- `get-clone-path`: получить директорию хранения репозиториев
- `get-repos`: просканировать директорию и получить список git-репозиториев
- `get-author-mappings`: загрузить маппинг авторов/коммитеров из конфигурации
- `save-author-mappings`: сохранить маппинг авторов/коммитеров
- `get-config`: загрузить конфигурацию миграции из репозитория
- `save-config`: сохранить конфигурацию миграции в репозиторий
- `start-migration`: запустить асинхронную миграцию, возвращает migrationId
- `cancel-migration`: отменить запущенную миграцию по ID
- `request-shutdown`: запросить корректное завершение приложения

### Main → Renderer (события)

- `migration-progress`: обновления прогресса миграции в реальном времени

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
- Обработка CSS-модулей
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

- **React 18.2**: UI-фреймворк
- **Electron 27**: десктопный фреймворк
- **Webpack 5**: бандлер модулей
- **Babel 7**: JavaScript-транспилятор
- **electron-builder 24**: сборка дистрибутивов
- **@gitlab-dump/core**: общая core-библиотека (lib/)

Полный список зависимостей и версий см. в `package.json`.

## Лицензия

MIT — см. файл LICENSE в корне проекта
