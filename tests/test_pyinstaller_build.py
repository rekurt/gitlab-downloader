"""Tests for PyInstaller build process."""

from unittest import mock


class TestBuildScript:
    """Test the build script utilities."""

    def test_get_platform_windows(self) -> None:
        """Test platform detection for Windows."""
        with mock.patch("sys.platform", "win32"):
            from build.create_python_binary import get_platform

            assert get_platform() == "windows"

    def test_get_platform_macos(self) -> None:
        """Test platform detection for macOS."""
        with mock.patch("sys.platform", "darwin"):
            from build.create_python_binary import get_platform

            assert get_platform() == "macos"

    def test_get_platform_linux(self) -> None:
        """Test platform detection for Linux."""
        with mock.patch("sys.platform", "linux"):
            from build.create_python_binary import get_platform

            assert get_platform() == "linux"

    def test_get_project_root(self) -> None:
        """Test that get_project_root returns a valid directory."""
        from build.create_python_binary import get_project_root

        root = get_project_root()
        assert root.exists()
        assert (root / "gitlab_downloader").exists()
        assert (root / "build").exists()
        assert (root / "tests").exists()

    def test_spec_file_exists(self) -> None:
        """Test that the PyInstaller spec file exists."""
        from build.create_python_binary import get_project_root

        spec_file = get_project_root() / "build" / "pyinstaller_spec.spec"
        assert spec_file.exists()

    def test_spec_file_content(self) -> None:
        """Test that spec file has required content."""
        from build.create_python_binary import get_project_root

        spec_file = get_project_root() / "build" / "pyinstaller_spec.spec"
        content = spec_file.read_text()

        # Check for required imports
        assert "Analysis" in content
        assert "PYZ" in content
        assert "EXE" in content

        # Check for key dependencies
        assert "fastapi" in content
        assert "uvicorn" in content
        assert "pydantic" in content
        assert "aiohttp" in content

        # Check for gitlab_downloader modules
        assert "gitlab_downloader.api" in content
        assert "gitlab_downloader.config" in content

    def test_build_script_exists(self) -> None:
        """Test that build script exists."""
        from build.create_python_binary import get_project_root

        script_path = get_project_root() / "build" / "create_python_binary.py"
        assert script_path.exists()

    def test_build_script_executable(self) -> None:
        """Test that build script is executable."""
        from build.create_python_binary import get_project_root

        script_path = get_project_root() / "build" / "create_python_binary.py"
        # Check if script is readable
        assert script_path.read_text().startswith("#!/usr/bin/env python")

    def test_check_pyinstaller_installed(self) -> None:
        """Test checking if PyInstaller is installed."""
        from build.create_python_binary import check_pyinstaller

        # PyInstaller may or may not be installed
        result = check_pyinstaller()
        assert isinstance(result, bool)

    def test_binary_path_windows(self) -> None:
        """Test getting binary path for Windows."""
        from build.create_python_binary import get_binary_path

        # Mock that the binary exists
        with mock.patch("pathlib.Path.exists", return_value=True):
            path = get_binary_path("windows")
            assert path is not None
            assert str(path).endswith("api-server.exe")

    def test_binary_path_macos(self) -> None:
        """Test getting binary path for macOS."""
        from build.create_python_binary import get_binary_path

        # Mock that the binary exists
        with mock.patch("pathlib.Path.exists", return_value=True):
            path = get_binary_path("macos")
            assert path is not None
            assert "api-server.app" in str(path)

    def test_binary_path_linux(self) -> None:
        """Test getting binary path for Linux."""
        from build.create_python_binary import get_binary_path

        # Mock that the binary exists
        with mock.patch("pathlib.Path.exists", return_value=True):
            path = get_binary_path("linux")
            assert path is not None
            assert str(path).endswith("api-server")

    def test_binary_path_not_found(self) -> None:
        """Test getting binary path when not found."""
        from build.create_python_binary import get_binary_path

        # Mock that the binary does not exist
        with mock.patch("pathlib.Path.exists", return_value=False):
            path = get_binary_path("linux")
            assert path is None

    def test_build_requirements(self) -> None:
        """Test that required modules exist for building."""
        import gitlab_downloader
        from gitlab_downloader import api, config

        # Verify modules can be imported
        assert hasattr(gitlab_downloader, "__file__")

        # Verify key modules
        assert hasattr(api, "create_app")
        assert hasattr(config, "GitlabConfig")
