"""Tests for Electron main process integration."""

from __future__ import annotations

from pathlib import Path


class TestElectronStructure:
    """Test Electron directory structure and files."""

    def test_electron_directory_exists(self) -> None:
        """Test that electron directory is created."""
        electron_dir = Path(__file__).parent.parent / "electron"
        assert electron_dir.exists(), "electron directory should exist"

    def test_package_json_exists(self) -> None:
        """Test that package.json exists and has required fields."""
        package_json = Path(__file__).parent.parent / "electron" / "package.json"
        assert package_json.exists(), "electron/package.json should exist"

        import json

        with open(package_json) as f:
            config = json.load(f)

        required_fields = ["name", "version", "main", "scripts", "dependencies"]
        for field in required_fields:
            assert field in config, f"package.json should have {field} field"

        assert config["main"] == "main.js"
        assert "start" in config["scripts"]
        assert "dev" in config["scripts"]
        assert "build" in config["scripts"]

    def test_main_js_exists(self) -> None:
        """Test that main.js exists."""
        main_js = Path(__file__).parent.parent / "electron" / "main.js"
        assert main_js.exists(), "electron/main.js should exist"

        with open(main_js) as f:
            content = f.read()

        # Check for required Electron main process code
        assert "BrowserWindow" in content
        assert 'app.on("ready"' in content
        assert "startPythonBackend" in content
        assert "stopPythonBackend" in content

    def test_preload_js_exists(self) -> None:
        """Test that preload.js exists and sets up IPC bridge."""
        preload_js = Path(__file__).parent.parent / "electron" / "preload.js"
        assert preload_js.exists(), "electron/preload.js should exist"

        with open(preload_js) as f:
            content = f.read()

        # Check for required IPC setup
        assert "contextBridge" in content
        assert "exposeInMainWorld" in content
        assert "electronAPI" in content
        assert "getApiEndpoint" in content
        assert "checkApiStatus" in content

    def test_webpack_config_exists(self) -> None:
        """Test that webpack configuration exists."""
        webpack_config = Path(__file__).parent.parent / "electron" / "webpack.config.js"
        assert webpack_config.exists(), "webpack.config.js should exist"

        with open(webpack_config) as f:
            content = f.read()

        assert "module.exports" in content
        assert "entry" in content
        assert "output" in content
        assert "babel-loader" in content

    def test_src_directory_exists(self) -> None:
        """Test that src directory and subdirectories are created."""
        src_dir = Path(__file__).parent.parent / "electron" / "src"
        assert src_dir.exists(), "electron/src should exist"

        required_dirs = ["components", "services", "styles"]
        for dir_name in required_dirs:
            dir_path = src_dir / dir_name
            assert dir_path.exists(), f"electron/src/{dir_name} should exist"

    def test_app_js_exists(self) -> None:
        """Test that main App component exists."""
        app_js = Path(__file__).parent.parent / "electron" / "src" / "App.js"
        assert app_js.exists(), "electron/src/App.js should exist"

        with open(app_js) as f:
            content = f.read()

        # Check for React component code
        assert "function App()" in content or "const App =" in content
        assert "electronAPI" in content
        assert "useEffect" in content
        assert "useState" in content

    def test_index_html_exists(self) -> None:
        """Test that HTML entry point exists."""
        index_html = Path(__file__).parent.parent / "electron" / "src" / "index.html"
        assert index_html.exists(), "electron/src/index.html should exist"

        with open(index_html) as f:
            content = f.read()

        assert "<html" in content.lower()
        assert "<body" in content.lower()
        assert 'id="root"' in content

    def test_index_js_exists(self) -> None:
        """Test that main JavaScript entry point exists."""
        index_js = Path(__file__).parent.parent / "electron" / "src" / "index.js"
        assert index_js.exists(), "electron/src/index.js should exist"

        with open(index_js) as f:
            content = f.read()

        assert "React" in content
        assert "ReactDOM" in content
        assert "createRoot" in content

    def test_env_config_exists(self) -> None:
        """Test that environment configuration exists."""
        env_config = Path(__file__).parent.parent / "electron" / "env.js"
        assert env_config.exists(), "electron/env.js should exist"

        with open(env_config) as f:
            content = f.read()

        assert "isDev" in content
        assert "API_PORT" in content
        assert "API_HOST" in content


class TestMainJsStructure:
    """Test main.js implementation details."""

    def test_main_js_imports_electron(self) -> None:
        """Test that main.js imports required Electron modules."""
        main_js = Path(__file__).parent.parent / "electron" / "main.js"
        with open(main_js) as f:
            content = f.read()

        assert 'require("electron")' in content
        assert "BrowserWindow" in content
        assert "ipcMain" in content

    def test_main_js_spawns_python_process(self) -> None:
        """Test that main.js includes Python process spawning logic."""
        main_js = Path(__file__).parent.parent / "electron" / "main.js"
        with open(main_js) as f:
            content = f.read()

        assert "spawn(" in content
        assert "getPythonExecutablePath" in content
        assert "-m" in content

    def test_main_js_handles_app_lifecycle(self) -> None:
        """Test that main.js handles app lifecycle events."""
        main_js = Path(__file__).parent.parent / "electron" / "main.js"
        with open(main_js) as f:
            content = f.read()

        required_events = ['app.on("ready"', 'app.on("window-all-closed"', 'app.on("activate"']
        for event in required_events:
            assert event in content, f"main.js should handle {event}"

    def test_main_js_handles_signals(self) -> None:
        """Test that main.js handles process signals."""
        main_js = Path(__file__).parent.parent / "electron" / "main.js"
        with open(main_js) as f:
            content = f.read()

        assert "SIGTERM" in content or "process.on" in content
        assert "stopPythonBackend" in content


class TestPreloadJsStructure:
    """Test preload.js implementation details."""

    def test_preload_js_context_isolation(self) -> None:
        """Test that preload.js uses context isolation."""
        main_js = Path(__file__).parent.parent / "electron" / "main.js"
        with open(main_js) as f:
            content = f.read()

        assert "contextIsolation: true" in content
        assert "nodeIntegration: false" in content
        assert "enableRemoteModule: false" in content

    def test_preload_js_api_exposure(self) -> None:
        """Test that preload.js exposes safe APIs."""
        preload_js = Path(__file__).parent.parent / "electron" / "preload.js"
        with open(preload_js) as f:
            content = f.read()

        required_methods = ["getApiEndpoint", "checkApiStatus", "send", "on", "off", "once"]
        for method in required_methods:
            assert method in content, f"preload.js should expose {method}"

    def test_preload_js_channel_whitelist(self) -> None:
        """Test that preload.js uses channel whitelisting."""
        preload_js = Path(__file__).parent.parent / "electron" / "preload.js"
        with open(preload_js) as f:
            content = f.read()

        assert "validChannels" in content
        assert "includes(channel)" in content


class TestPythonBackendIntegration:
    """Test Python backend integration."""

    def test_api_module_has_create_app(self) -> None:
        """Test that api.py has create_app and run_api_server_async."""
        api_py = Path(__file__).parent.parent / "gitlab_downloader" / "api.py"
        with open(api_py) as f:
            content = f.read()

        assert "def create_app" in content
        assert "async def run_api_server_async" in content

    def test_main_module_exists(self) -> None:
        """Test that __main__.py exists for module execution."""
        main_module = Path(__file__).parent.parent / "gitlab_downloader" / "__main__.py"
        assert main_module.exists(), "gitlab_downloader/__main__.py should exist"

        with open(main_module) as f:
            content = f.read()

        assert "from .app import run" in content


class TestReactAppStructure:
    """Test React application structure."""

    def test_app_js_has_hooks(self) -> None:
        """Test that App.js uses React hooks correctly."""
        app_js = Path(__file__).parent.parent / "electron" / "src" / "App.js"
        with open(app_js) as f:
            content = f.read()

        assert "useState" in content
        assert "useEffect" in content

    def test_app_css_exists_and_styles(self) -> None:
        """Test that App.css exists and has styling."""
        app_css = Path(__file__).parent.parent / "electron" / "src" / "App.css"
        assert app_css.exists(), "electron/src/App.css should exist"

        with open(app_css) as f:
            content = f.read()

        # Check for CSS rules
        assert ".app" in content
        assert "display:" in content or "flex" in content

    def test_index_css_exists(self) -> None:
        """Test that global styles exist."""
        index_css = Path(__file__).parent.parent / "electron" / "src" / "styles" / "index.css"
        assert index_css.exists(), "electron/src/styles/index.css should exist"

        with open(index_css) as f:
            content = f.read()

        # Check for base styles
        assert "*" in content or "body" in content
        assert "font" in content.lower()


class TestPackageJsonDependencies:
    """Test that package.json has required dependencies."""

    def test_dependencies_present(self) -> None:
        """Test that all required dependencies are in package.json."""
        package_json = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_json) as f:
            import json

            config = json.load(f)

        # Check dependencies
        deps = config.get("dependencies", {})
        assert "react" in deps
        assert "react-dom" in deps
        assert "axios" in deps
        assert "electron-is-dev" in deps

    def test_dev_dependencies_present(self) -> None:
        """Test that all required devDependencies are in package.json."""
        package_json = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_json) as f:
            import json

            config = json.load(f)

        # Check devDependencies
        dev_deps = config.get("devDependencies", {})
        assert "electron" in dev_deps
        assert "electron-builder" in dev_deps
        assert "webpack" in dev_deps
        assert "webpack-cli" in dev_deps
        assert "webpack-dev-server" in dev_deps
        assert "babel-loader" in dev_deps
        assert "@babel/preset-react" in dev_deps


class TestWebpackConfiguration:
    """Test webpack configuration."""

    def test_webpack_babel_loader(self) -> None:
        """Test that webpack is configured for Babel."""
        webpack_config = Path(__file__).parent.parent / "electron" / "webpack.config.js"
        with open(webpack_config) as f:
            content = f.read()

        assert "babel-loader" in content
        assert "@babel/preset-env" in content
        assert "@babel/preset-react" in content

    def test_webpack_css_loader(self) -> None:
        """Test that webpack is configured for CSS."""
        webpack_config = Path(__file__).parent.parent / "electron" / "webpack.config.js"
        with open(webpack_config) as f:
            content = f.read()

        assert "style-loader" in content
        assert "css-loader" in content

    def test_webpack_html_plugin(self) -> None:
        """Test that webpack uses HtmlWebpackPlugin."""
        webpack_config = Path(__file__).parent.parent / "electron" / "webpack.config.js"
        with open(webpack_config) as f:
            content = f.read()

        assert "HtmlWebpackPlugin" in content
        assert "index.html" in content
