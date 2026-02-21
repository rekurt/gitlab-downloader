# GitLab Dump Desktop Application

## Overview

This is the Electron-based desktop application for GitLab repository management and migration. It provides a user-friendly graphical interface for configuring and managing GitLab dump operations, while communicating with the Python backend via REST API.

The application supports Windows (portable executable), macOS (app bundle), and Linux (AppImage) distributions.

## Architecture

### Components

The application consists of three main layers:

1. **Main Process** (`main.js`): Electron main process that manages windows, handles IPC communication, and spawns the Python backend process
2. **Renderer Process** (`src/`): React application UI that runs in a Chromium window
3. **Python Backend**: CLI tool exposing REST API on port 8000

### Communication Flow

```
Renderer (React UI)
        ↓ (IPC & HTTP)
Main Process (Electron)
        ↓ (spawns)
Python Backend (FastAPI)
```

The renderer process communicates with the main process via IPC (Inter-Process Communication), which in turn manages the Python API backend and exposes endpoints to the renderer via the preload script.

### Security

The application uses a preload script (`preload.js`) to establish a secure bridge between the main and renderer processes. Only whitelisted IPC channels are allowed, preventing unauthorized access to system resources.

## Directory Structure

```
electron/
├── main.js                 # Electron main process
├── preload.js             # Secure IPC bridge to renderer
├── env.js                 # Environment configuration
├── webpack.config.js      # Webpack bundling configuration
├── package.json           # Dependencies and npm scripts
├── src/                   # React application source
│   ├── index.js          # Entry point
│   ├── App.js            # Main component
│   ├── App.css           # Main styles
│   ├── index.html        # HTML template
│   ├── components/       # React components
│   │   ├── AuthorMapper.js
│   │   ├── ConfigViewer.js
│   │   ├── MigrationWizard.js
│   │   ├── ProgressIndicator.js
│   │   └── RepoList.js
│   ├── services/         # API service layer
│   │   └── api.js        # REST API client
│   └── styles/           # Component-specific styles
├── dist/                 # Built Webpack output
├── dist_electron/        # Electron builder output
└── node_modules/         # npm dependencies
```

## Setup & Development

### Prerequisites

- **Node.js**: 16.x or higher (check with `node --version`)
- **npm**: 8.x or higher (check with `npm --version`)
- **Python**: 3.8+ (for the backend API)
- **Virtual Environment**: Backend should be running in `venv/`

### Installation

From the `electron/` directory:

```bash
npm install
```

This installs all Electron, React, Webpack, and build tool dependencies.

### Development Mode

To run both the Webpack dev server and Electron during development:

```bash
npm run dev
```

This command:
1. Starts Webpack dev server on port 8080 with hot reload
2. Waits for the dev server to be ready
3. Launches Electron with remote debugging enabled on port 9222

The Python backend must be running separately (see main project README).

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

The application uses `electron-builder` for creating platform-specific binaries. Before building, the Python backend must be embedded (see below).

#### Build Prerequisites

```bash
# From electron/ directory, ensure Python backend binary is embedded
npm run prebuild-portable
```

This:
1. Runs Webpack production build
2. Embeds the Python binary into the app bundle

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

### ConfigViewer
Displays current configuration settings, environment variables, and connection details.

### MigrationWizard
Step-by-step wizard guiding users through the migration process:
- Repository selection
- Credential configuration
- Migration options
- Progress tracking

### ProgressIndicator
Real-time progress tracking with status updates, error handling, and completion notifications.

### RepoList
Browsable list of available repositories from the GitLab instance with filtering and selection.

## REST API Endpoints

The application expects the Python backend to provide the following endpoints on `http://127.0.0.1:8000`:

- `GET /api/status` - Backend health check
- `GET /api/repos` - List available repositories
- `POST /api/migrate` - Start migration operation
- `GET /api/progress` - Get current migration progress
- `POST /api/config` - Update configuration
- `GET /api/config` - Retrieve current configuration

See the main project documentation for complete API specification.

## Environment Configuration

Configuration is handled via `env.js`:

```javascript
{
  isDev: boolean,           // Development mode indicator
  API_PORT: 5000,          // Backend API port
  API_HOST: '127.0.0.1',   // Backend API host
  LOG_LEVEL: 'debug',      // 'debug' in dev, 'info' in production
  DEBUG: boolean           // Debug mode enabled
}
```

Override at runtime with environment variables:
```bash
API_PORT=8000 npm run dev
API_HOST=192.168.1.100 npm run dev
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

## IPC Channels

### Main → Renderer

- `backend-status`: Backend process status update
- `backend-error`: Backend process error message
- `migration-progress`: Migration progress update
- `migration-complete`: Migration operation completed

### Renderer → Main (via preload)

- `get-api-endpoint`: Get the API endpoint URL
- `check-api-status`: Check if API backend is running
- `request-shutdown`: Request graceful application shutdown
- `get-backend-status`: Get current backend status

### Window Control Channels

- `app-quit`: Quit the application
- `app-minimize`: Minimize the window
- `app-maximize`: Toggle maximize state

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
- Ensure Webpack dev server is running on port 8080
- Check `npm run webpack-dev` output for errors
- Clear Electron cache: `rm -rf ~/.config/GitLab\ Dump/`

**Backend not connecting**
- Verify Python backend is running on port 8000
- Check main.js logs for Python process startup errors
- Test API manually: `curl http://127.0.0.1:8000/api/status`

**High CPU usage after build**
- This is typically the embedded Python binary indexing files on first run
- Wait for CPU usage to normalize (usually completes within a few minutes)

**Built executable won't run**
- Ensure Python binary is properly embedded: `npm run prebuild-portable`
- Check system architecture matches build target (x64 vs ia32)
- On Linux, verify AppImage dependencies: `ldd GitLab\ Dump-*.AppImage`

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
- **axios**: HTTP client for API calls

See `package.json` for complete dependency list and versions.

## License

MIT - See main project LICENSE file
