# GitLab Dump Desktop Application

## Overview

This is the Electron-based desktop application for GitLab repository management and migration. It provides a user-friendly graphical interface for configuring and managing GitLab dump operations. The application uses the shared Node.js core library (`lib/`) directly via IPC, without any external backend process.

The application supports Windows (portable executable), macOS (app bundle), and Linux (AppImage) distributions.

## Architecture

### Components

The application consists of two main layers:

1. **Main Process** (`main.js`): Electron main process that manages windows, handles IPC communication, and calls `lib/` modules directly
2. **Renderer Process** (`src/`): React application UI that runs in a Chromium window

### Communication Flow

```
Renderer (React UI)
        ↓ (IPC via preload.js)
Main Process (Electron)
        ↓ (direct function calls)
@gitlab-dump/core (lib/)
```

The renderer process communicates with the main process via IPC (Inter-Process Communication). The main process imports and calls `lib/` modules directly — no HTTP server, no external process.

### Security

The application uses a preload script (`preload.js`) to establish a secure bridge between the main and renderer processes. Only whitelisted IPC channels are allowed, preventing unauthorized access to system resources.

## Directory Structure

```
electron/
├── main.js                 # Electron main process (IPC handlers → lib/)
├── preload.js             # Secure IPC bridge to renderer
├── env.js                 # Environment configuration
├── webpack.config.js      # Webpack bundling configuration
├── package.json           # Dependencies and npm scripts
├── electron-builder.config.js  # Distribution packaging config
├── src/                   # React application source
│   ├── index.js          # Entry point
│   ├── App.js            # Main component
│   ├── App.css           # Main styles
│   ├── index.html        # HTML template
│   ├── components/       # React components
│   │   ├── AuthorMapper.js
│   │   ├── MigrationWizard.js
│   │   ├── ProgressIndicator.js
│   │   └── RepoList.js
│   └── styles/           # Component-specific styles
├── __tests__/            # Jest test files
├── dist/                 # Built Webpack output
├── dist_electron/        # Electron builder output
└── node_modules/         # npm dependencies
```

## Setup & Development

### Prerequisites

- **Node.js**: 16.x or higher (check with `node --version`)
- **npm**: 8.x or higher (check with `npm --version`)

### Installation

From the project root:

```bash
# Install all dependencies (lib, cli, electron)
make node-install
```

Or from the `electron/` directory:

```bash
npm install
```

### Development Mode

To run both the Webpack dev server and Electron during development:

```bash
npm run dev
```

This command:
1. Starts Webpack dev server on port 8000 with hot reload
2. Waits for the dev server to be ready
3. Launches Electron with remote debugging enabled on port 9222

#### Development Features

- **Hot Reload**: React components update without restarting the app
- **Remote Debugging**: Chrome DevTools available at `localhost:9222`
- **Fast Iteration**: Combined Webpack and Electron watches for changes

### Individual Commands

If you prefer to run components separately:

```bash
# Terminal 1: Start Webpack dev server
npm run webpack-dev

# Terminal 2: Start Electron (after webpack is ready)
npm run electron-dev
```

## Building

### Production Build

To create optimized production bundle:

```bash
npm run build
```

This runs Webpack in production mode, generating minified code in `dist/`.

### Creating Distributions

The application uses `electron-builder` for creating platform-specific binaries. No external backend is required — all logic is bundled via `lib/`.

#### Platform-Specific Distributions

**All platforms:**
```bash
npm run dist
```
Creates native installers for all platforms (requires build tools for each platform).

**Windows only (portable .exe):**
```bash
npm run dist-win
```
Creates: `GitLab Dump-X.Y.Z-win-x64.exe`

**macOS only (.dmg and .zip):**
```bash
npm run dist-mac
```
Creates: `GitLab Dump-X.Y.Z.dmg` and `.zip`

**Linux only (AppImage):**
```bash
npm run dist-linux
```
Creates: `GitLab Dump-X.Y.Z.AppImage`

### Signing & Notarization

For production releases with code signing:

Set environment variables before building:

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

For macOS notarization (required for distribution outside App Store):
```bash
export MAC_NOTARIZE=true
export APPLE_TEAM_ID=your_team_id
export APPLE_ID=your_apple_id
export APPLE_ID_PASSWORD=your_app_password
npm run dist-mac
```

## UI Components

### AuthorMapper
Maps GitLab users to Git author identities for proper commit attribution during migration.

### MigrationWizard
Step-by-step wizard guiding users through the migration process:
- Repository selection
- Credential configuration
- Migration options
- Progress tracking

### ProgressIndicator
Real-time progress tracking with status updates, error handling, and completion notifications. Receives updates via IPC events from the main process.

### RepoList
Browsable list of available repositories scanned from the local clone path, with filtering and selection.

## IPC Channels

### Renderer → Main (via preload)

**Invoke handlers (request-response):**
- `get-clone-path`: Get the directory where repositories are stored
- `get-repos`: Scan clone path and list git repositories
- `get-author-mappings`: Load author/committer mappings from a config file
- `save-author-mappings`: Save author/committer mappings to a config file
- `get-config`: Load migration config from a repository
- `save-config`: Save migration config to a repository
- `start-migration`: Start an async migration task, returns migrationId
- `cancel-migration`: Cancel a running migration by ID
- `request-shutdown`: Request graceful application shutdown

### Main → Renderer (events)

- `migration-progress`: Real-time migration progress updates

### Window Control Channels

- `app-quit`: Quit the application
- `app-minimize`: Minimize the window
- `app-maximize`: Toggle maximize state

## Environment Configuration

Configuration is handled via `env.js`:

```javascript
{
  isDev: boolean,           // Development mode indicator
  LOG_LEVEL: 'debug',      // 'debug' in dev, 'info' in production
  DEBUG: boolean           // Debug mode enabled
}
```

## Build Configuration

### Electron Builder Settings

See `electron-builder.config.js` for platform-specific configurations:

- **Windows**: Portable executable targeting x64 and ia32 architectures
- **macOS**: App bundle with DMG and ZIP distribution formats
- **Linux**: AppImage for universal Linux distribution

### Webpack Configuration

`webpack.config.js` handles:
- React component bundling with Babel
- CSS module processing
- HTML template generation via HtmlWebpackPlugin
- Development server configuration

## Troubleshooting

### Common Issues

**Webpack dev server not starting**
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npm run webpack-dev
```

**Electron window shows blank page**
- Ensure Webpack dev server is running on port 8000
- Check `npm run webpack-dev` output for errors
- Clear Electron cache: `rm -rf ~/.config/GitLab\ Dump/`

**IPC handlers not responding**
- Check main.js console output for errors
- Verify `lib/` modules are properly installed: `cd ../lib && npm install`
- Use DevTools (F12) to inspect IPC calls in the renderer

**Port 8000 already in use**
```bash
# Find process using port 8000
lsof -i :8000
# Kill process if needed
kill -9 <PID>
```

### Debug Mode

Enable additional logging:
```bash
DEBUG=gitlab-dump* npm run dev
```

Remote debugging available at `localhost:9222` when running with `npm run electron-dev`.

## Testing

Run tests:
```bash
npm test
```

Or from the project root:
```bash
make electron-test
```

## Performance Tips

1. **Production Builds**: Always use `npm run dist` instead of dev mode for release
2. **Bundle Size**: Check Webpack bundle stats before shipping major updates
3. **Memory**: Large repository migrations should be run with adequate system memory (2GB+ recommended)
4. **Network**: Stable connection required for large migrations (consider throttling recovery)

## Contributing

When modifying the Electron application:

1. Test development workflow: `npm run dev`
2. Test production build: `npm run build`
3. Verify Webpack bundling: Check `dist/bundle.js` size and validity
4. Test distribution build on target platforms before release
5. Update this README if adding new components or significant features

## Dependencies

- **React 18.2**: UI framework
- **Electron 27**: Desktop framework
- **Webpack 5**: Module bundler
- **Babel 7**: JavaScript transpiler
- **electron-builder 24**: Distribution packaging
- **@gitlab-dump/core**: Shared core library (lib/)

See `package.json` for complete dependency list and versions.

## License

MIT - See main project LICENSE file
