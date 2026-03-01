# Electron Full-Cycle App with Ant Design + Tailwind CSS

## Overview

Transform the Electron application from a migration-only tool into a full-cycle GitLab workflow app (authenticate, browse projects, clone, update, migrate). Replace vanilla CSS with Ant Design component library and Tailwind CSS utility classes.

## Context

- Files involved: `electron/` directory (main.js, preload.js, webpack.config.js, package.json, src/App.js, all components)
- Related patterns: IPC handler pattern in main.js, contextBridge whitelist in preload.js, lazy ESM import of `@gitlab-dump/core`
- Dependencies to add: antd, @ant-design/icons, tailwindcss, postcss, autoprefixer, postcss-loader, electron-store
- Core library interfaces already implemented but not wired to GUI: `lib/auth.js` (OAuth device flow), `lib/client.js` (API client with pagination), `lib/cloner.js` (clone/update with concurrency), `lib/config.js` (Zod validation), `lib/reporting.js` (summary/dry-run)

## Development Approach

- **Testing approach**: Regular (code first, then tests)
- Complete each task fully before moving to the next
- Each task includes IPC + UI + tests together for the same feature
- **CRITICAL: every task MUST include new/updated tests**
- **CRITICAL: all tests must pass before starting next task**

## Implementation Steps

### Task 1: UI Infrastructure - Ant Design + Tailwind CSS

**Files:**
- Modify: `electron/package.json`
- Modify: `electron/webpack.config.js`
- Create: `electron/tailwind.config.js`
- Create: `electron/postcss.config.js`
- Create: `electron/src/styles/globals.css`
- Modify: `electron/src/index.js`
- Delete: `electron/src/App.css`, `electron/src/styles/index.css`, `electron/src/styles/RepoList.css`, `electron/src/styles/MigrationWizard.css`, `electron/src/styles/AuthorMapper.css`, `electron/src/styles/ProgressIndicator.css`

- [x] Install dependencies: `antd`, `@ant-design/icons`, `tailwindcss`, `postcss`, `autoprefixer`, `postcss-loader`
- [x] Create `tailwind.config.js` with content paths pointing to `src/**/*.{js,jsx}`
- [x] Create `postcss.config.js` with tailwindcss and autoprefixer plugins
- [x] Update `webpack.config.js`: add `postcss-loader` to CSS pipeline (style-loader -> css-loader -> postcss-loader)
- [x] Create `src/styles/globals.css` with Tailwind directives (`@tailwind base/components/utilities`) and `@import 'antd/dist/reset.css'`
- [x] Update `src/index.js` to import `globals.css` instead of old `styles/index.css`
- [x] Delete old CSS files (App.css, all files in styles/)
- [x] Verify webpack dev build and production build both succeed
- [x] Write test: verify bundle builds without errors
- [x] Run project test suite - must pass before task 2

### Task 2: App Shell, Navigation & Settings with Persistent Storage

**Files:**
- Modify: `electron/package.json`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `electron/src/App.js`
- Create: `electron/src/components/AppLayout.js`
- Create: `electron/src/components/SettingsPage.js`

- [x] Install `electron-store`
- [x] Create `AppLayout` component: Ant Design `Layout` + `Sider` with `Menu` (icons: SettingOutlined, CloudDownloadOutlined, FolderOutlined, SwapOutlined). 5 menu items: Settings, Projects, Clone, Repositories, Migration
- [x] Rewrite `App.js` to use `AppLayout` with state-based view switching (`currentView` state + `<AppLayout>` wrapper)
- [x] Create `SettingsPage` component with Ant Design `Form`:
  - GitLab URL (Input with URL validation)
  - Auth method (Radio: token / oauth)
  - Token input (Input.Password, shown when auth=token)
  - OAuth Client ID (Input, shown when auth=oauth)
  - Clone path (Input with folder picker button via IPC dialog)
  - Max concurrency (InputNumber, 1-10)
  - Git auth mode (Radio: url / credential_helper)
  - "Test Connection" button (calls test-connection IPC, shows success/error result)
  - "Save" button
- [x] Add IPC handlers in `main.js`:
  - `load-settings`: read from electron-store, return settings object
  - `save-settings`: validate with Zod schema, write to electron-store
  - `test-connection`: build config from settings, call `fetchJson` on `/api/v4/user` endpoint, return success/error
  - `select-directory`: use Electron `dialog.showOpenDialog` for clone path picker
- [x] Expose new IPC channels in `preload.js`: `loadSettings`, `saveSettings`, `testConnection`, `selectDirectory`
- [x] Load settings on app startup and pass to child views as context or props
- [x] Write tests: IPC handlers (load-settings, save-settings, test-connection), SettingsPage component render + form validation
- [x] Run project test suite - must pass before task 3

### Task 3: Authentication - OAuth Device Flow UI

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `electron/src/components/SettingsPage.js`
- Create: `electron/src/components/OAuthDeviceFlow.js`

- [x] Add IPC handler `start-oauth-device-flow` in `main.js`:
  - Build config from stored settings
  - Call `deviceAuthorize()` from `lib/auth.js`
  - Return device code info to renderer (verification_uri, user_code, verification_uri_complete)
  - Start `pollDeviceToken()` in background, send progress via `webContents.send('oauth-progress')`
  - On success: save token to electron-store, send `{status: 'success', token}` event
  - On failure/timeout: send `{status: 'error', message}` event
- [x] Expose in `preload.js`: `startOAuthDeviceFlow`, `onOAuthProgress` listener
- [x] Create `OAuthDeviceFlow` component:
  - "Authorize with OAuth" button triggers `startOAuthDeviceFlow` IPC
  - Shows verification URL (clickable link via `shell.openExternal`) and user code (large, copyable text)
  - Ant Design `Spin` while polling
  - Success: show checkmark, auto-close after delay
  - Error: show error message with retry button
- [x] Integrate into `SettingsPage`: when auth method is OAuth, show OAuthDeviceFlow component instead of token input
- [x] Write tests: OAuthDeviceFlow component states (idle, pending, success, error), IPC handler
- [x] Run project test suite - must pass before task 4

### Task 4: GitLab Projects Browser

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Create: `electron/src/components/ProjectsPage.js`

- [x] Add IPC handlers in `main.js`:
  - `fetch-projects`: build config from stored settings + resolved token, optionally call `fetchGroupMetadata` + `getAllProjects` (if group set) or `getUserProjects` (if no group). Return array of project objects
  - Cancel support: track active fetch with AbortController, add `cancel-fetch-projects` handler
- [x] Expose in `preload.js`: `fetchProjects`, `cancelFetchProjects`
- [x] Create `ProjectsPage` component:
  - "Load Projects" button (with loading spinner via Ant Design `Button` loading state)
  - Optional group input field (if not set in settings, allow override here)
  - Ant Design `Table` with columns: name, path_with_namespace, http_url_to_repo (truncated), last_activity_at (formatted date)
  - Row selection with checkboxes (`rowSelection` prop)
  - Search input to filter table rows by name
  - Footer: "{N} projects selected" + "Clone Selected" button
  - "Clone Selected" passes selected projects to clone view via App-level state
- [x] Write tests: ProjectsPage component (loading state, table render, selection, search filter), IPC handlers
- [x] Run project test suite - must pass before task 5

### Task 5: Clone & Update Operations

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Create: `electron/src/components/ClonePage.js`

- [ ] Add IPC handlers in `main.js`:
  - `clone-repositories`: receive project list, build config from settings + token, call `cloneAllRepositories` with `onResult` callback that sends `webContents.send('clone-progress', {project, result, completed, total})`. Track with AbortController
  - `cancel-clone`: abort the active clone operation
  - `dry-run-projects`: build config with `dryRun: true`, compute clone targets via `buildCloneTarget` for each project, return preview array [{name, targetPath, status: 'new'|'exists'}]
- [ ] Expose in `preload.js`: `cloneRepositories`, `cancelClone`, `dryRunProjects`, `onCloneProgress` listener
- [ ] Create `ClonePage` component:
  - Shows list of selected projects (Ant Design `List` or `Table`)
  - Toggle switch: "Update existing repositories" (sets `updateExisting` in config)
  - "Preview (Dry Run)" button: shows planned operations in a table without executing
  - "Start Clone" button: begins cloning, disables other controls
  - Per-repo status via Ant Design `Table` with dynamic status column (Tag: pending/cloning/success/updated/skipped/failed)
  - Overall Ant Design `Progress` bar (completed/total)
  - "Cancel" button (Ant Design `Popconfirm` for safety)
  - Summary `Card` when done: success/updated/skipped/failed counts with Ant Design `Statistic` components
  - Option to go to Repositories view after completion
- [ ] Write tests: ClonePage component (dry-run display, progress updates, completion summary), IPC handlers
- [ ] Run project test suite - must pass before task 6

### Task 6: Refactor Local Repositories View

**Files:**
- Modify: `electron/src/components/RepoList.js`

- [ ] Rewrite RepoList using Ant Design `Table`:
  - Columns: name, remote URL (ellipsis), local path (ellipsis), last updated (formatted), actions
  - Actions column with Ant Design `Space` + `Button`/`Tooltip`: Update (SyncOutlined), Migrate (SwapOutlined), Open folder (FolderOpenOutlined)
  - "Update" action: call IPC to pull single repo (reuse clone-repositories handler with single project + updateExisting=true)
  - "Migrate" action: navigate to Migration view with selected repo
  - "Open folder" action: call `shell.openPath` via new IPC handler `open-path`
  - Search input (Ant Design `Input.Search`) to filter by repo name
  - Empty state with Ant Design `Empty` component
- [ ] Add `open-path` IPC handler in `main.js` (uses `shell.openPath`)
- [ ] Expose `openPath` in `preload.js`
- [ ] Remove old CSS import
- [ ] Update existing RepoList tests for new component structure
- [ ] Run project test suite - must pass before task 7

### Task 7: Refactor Migration Wizard

**Files:**
- Modify: `electron/src/components/MigrationWizard.js`
- Modify: `electron/src/components/AuthorMapper.js`
- Modify: `electron/src/components/ProgressIndicator.js`

- [ ] Rewrite `MigrationWizard` with Ant Design `Steps` component:
  - Step 1: Author Mappings
  - Step 2: Review & Confirm
  - Step 3: Progress
  - Step 4: Complete
  - Navigation with Ant Design `Button` (Previous/Next/Start/Close)
- [ ] On wizard mount: call `getAuthorMappings` IPC to pre-load existing mappings, call `getConfig` IPC to discover repo migration config
- [ ] Rewrite `AuthorMapper` with Ant Design `Form`:
  - Dynamic form list (`Form.List`) for mapping entries
  - Each entry: type select (author/committer), original name/email inputs, new name/email inputs, remove button
  - "Add Mapping" button
  - Form validation (all fields required)
- [ ] Rewrite `ProgressIndicator` with Ant Design components:
  - `Progress` component (percentage mode when progress >= 0, indeterminate when < 0)
  - `Typography.Text` for current task
  - `Timeline` or scrollable `List` for message log
  - `Button` danger for cancel
- [ ] Rewrite Step 2 (Review) with Ant Design `Descriptions` or `Table` showing mappings read-only
- [ ] Rewrite Step 4 (Complete) with Ant Design `Result` (success icon + message)
- [ ] Remove old CSS imports
- [ ] Update existing MigrationWizard, AuthorMapper, ProgressIndicator tests
- [ ] Run project test suite - must pass before task 8

### Task 8: Verify acceptance criteria

- [ ] Manual test: full cycle - open app, configure settings, test connection, load projects, select and clone repos, view local repos, run migration
- [ ] Run full test suite: `cd electron && npm test`
- [ ] Run linter: `make node-lint`
- [ ] Verify all Ant Design components render correctly with Tailwind utility classes
- [ ] Verify IPC security: all new channels added to preload.js whitelist

### Task 9: Update documentation

- [ ] Update `electron/README.md` with new features and dependencies
- [ ] Update `CLAUDE.md` if internal patterns changed (new IPC channels, new components)
- [ ] Move this plan to `docs/plans/completed/`
