# GitLab Dump 0.2

[English README](README.md)

GitLab Dump клонирует репозитории и выполняет консервативный перенос между GitLab-инсталляциями. CLI и Electron используют один небольшой пакет `@gitlab-dump/core`.

Версия 0.2 намеренно несовместима с CLI 0.1. Удалены token-флаги, PAT в URL, plaintext migration config, `MigrationExecutor` и `git filter-branch`.

## Требования

- Node.js 24 LTS и npm 11;
- Git;
- `git-lfs` для репозиториев с LFS;
- `git-filter-repo` для переписывания истории;
- Electron 43 для desktop-сборки.

```bash
npm ci
npm run lint
npm test
npm run build
```

## CLI и секреты

Доступны только явные команды:

```text
gitlab-dump clone
gitlab-dump transfer plan
gitlab-dump transfer run
gitlab-dump transfer status
gitlab-dump transfer cancel
gitlab-dump rewrite-history
```

PAT читаются только из `GITLAB_TOKEN`, `GITLAB_SOURCE_TOKEN`, `GITLAB_DESTINATION_TOKEN` или через скрытый TTY prompt. Token-флагов нет. Git использует временный `GIT_ASKPASS`; PAT не попадает в аргументы процесса, remote URL, plan, report или обычный config.

Пример:

```bash
export GITLAB_SOURCE_TOKEN='...'
export GITLAB_DESTINATION_TOKEN='...'

gitlab-dump transfer plan \
  --source-url https://source.example.com \
  --destination-url https://destination.example.com \
  --source-path team/platform \
  --source-type group \
  --destination-namespace archive \
  --out ./transfer-plan.json

gitlab-dump transfer run --plan ./transfer-plan.json --report ./transfer-report.json
```

`status` и `cancel` используют private state только с IDs, URL, статусами и timestamps. Cancel передаётся через state-файл; сохранённые PID не используются и посторонним процессам сигналы не отправляются.

## Режимы переноса

- `direct_transfer` — отсутствующая сущность переносится официальным GitLab Direct Transfer.
- `git_sync` — целевой проект существует; синхронизируется только Git без объединения issues/MR/metadata.
- `git_only_fallback` — создаётся пустой group/project и переносится только Git/wiki/LFS.
- `blocked` — preflight не пройден, сущность не изменяется.

Git-sync создаёт отсутствующие branches/tags и обновляет branch только при доказанном fast-forward. Divergent branches и конфликтующие tags остаются без изменений. Удаление refs и force-push запрещены.

Git-only fallback — не «полный перенос GitLab»: он не переносит issues, MR, runners, secrets, registry artifacts и instance-level данные.

Для Direct Transfer GitLab рекомендует версии 16.8+, разницу не более двух minor-версий, HTTPS, включённый Direct Transfer, PAT с `api` scope и необходимые права. См. [официальные prerequisites](https://docs.gitlab.com/user/group/import/direct_transfer_migrations/) и [Bulk Imports API](https://docs.gitlab.com/api/bulk_imports/).

Direct Transfer создаёт копии и переносит не все ресурсы. Пользователи автоматически не создаются. Актуальная матрица и ограничения находятся в [документации GitLab](https://docs.gitlab.com/user/group/import/).

## Переписывание истории

Используется только versioned mapping JSON без credentials и обязательный `git-filter-repo`. Работа всегда идёт в новом mirror-каталоге. До изменения создаётся Git bundle, пригодный для восстановления.

```bash
gitlab-dump rewrite-history \
  --repository ./source.git \
  --mapping ./history-mapping.json \
  --output ./rewritten.git \
  --dry-run
```

Перед `--push` CLI автоматически выполняет свежий preview и показывает число изменяемых commits/refs, после чего нужно вручную ввести фразу `I UNDERSTAND THAT COMMIT SHAS WILL CHANGE`. Desktop также не разрешает push без успешного preview для выбранных repository и mapping. Каждый изменённый ref отправляется отдельно с точным `--force-with-lease`; protected branch не отключается.

## Electron

Renderer работает с `sandbox` и `contextIsolation`; navigation/window creation запрещены. OAuth URL открывает main-процесс после проверки HTTPS и origin. Секреты хранятся через Electron `safeStorage`; если OS encryption недоступно, они остаются только в памяти сессии. При первом чтении legacy plaintext tokens версии 0.1 мигрируют в это хранилище и сразу удаляются из обычных settings. Renderer получает operation/resource IDs, статусы и profile, но не access token и не произвольный доступ к filesystem.

## Проверки

```bash
npm run lint
npm run test:coverage
npm run build
npm run pack
npm audit --omit=dev --audit-level=high
```

CI использует Node 24, `npm ci` и unsigned packaging smoke на Linux, macOS и Windows. Code signing/notarization требуют пользовательских сертификатов и остаются отдельной release-задачей.

Opt-in workflow `GitLab opt-in smoke` требует подготовленные fixtures для новой группы, существующего проекта, cancel/resume и намеренной relation failure. Credentials поступают только из защищённых CI secrets.

Лицензия: MIT.
