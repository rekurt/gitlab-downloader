"""Tests for bundling and packaging verification."""

import json
from pathlib import Path


class TestElectronBuilderConfig:
    """Test electron-builder configuration."""

    def test_config_file_exists(self):
        """Test that electron-builder.config.js exists."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        assert config_path.exists(), "electron-builder.config.js should exist"
        assert config_path.stat().st_size > 0, "Config file should not be empty"

    def test_config_has_required_fields(self):
        """Test that config has required fields."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()

        required_fields = [
            "appId",
            "productName",
            "win",
            "mac",
            "linux",
        ]

        for field in required_fields:
            assert field in content, f"Config should contain {field}"

    def test_config_windows_portable_enabled(self):
        """Test that Windows portable target is enabled."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "portable" in content, "Windows portable target should be enabled"
        assert "target: 'portable'" in content or 'target: "portable"' in content

    def test_config_macos_dmg_enabled(self):
        """Test that macOS dmg target is enabled."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "dmg" in content, "macOS dmg target should be enabled"

    def test_config_linux_appimage_enabled(self):
        """Test that Linux AppImage target is enabled."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "AppImage" in content, "Linux AppImage target should be enabled"

    def test_config_asar_enabled(self):
        """Test that asar is enabled for security."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "asar: true" in content, "ASAR should be enabled for security"

    def test_config_python_binary_files_included(self):
        """Test that Python binary is included in files."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "python_binary" in content or "python" in content, (
            "Python binary should be included in files"
        )


class TestPythonBinaryEmbedding:
    """Test Python binary embedding script."""

    def test_embed_script_exists(self):
        """Test that embedding script exists."""
        script_path = Path(__file__).parent.parent / "build" / "embed_python_binary.js"
        assert script_path.exists(), "embed_python_binary.js should exist"
        assert script_path.stat().st_size > 0, "Script should not be empty"

    def test_embed_script_has_embedPythonBinary_function(self):
        """Test that script has embedPythonBinary function."""
        script_path = Path(__file__).parent.parent / "build" / "embed_python_binary.js"
        content = script_path.read_text()
        assert "embedPythonBinary" in content, "Script should have embedPythonBinary function"
        assert (
            "function embedPythonBinary" in content or "async function embedPythonBinary" in content
        )

    def test_embed_script_has_verifyBinary_function(self):
        """Test that script has verifyBinary function."""
        script_path = Path(__file__).parent.parent / "build" / "embed_python_binary.js"
        content = script_path.read_text()
        assert "verifyBinary" in content, "Script should have verifyBinary function"

    def test_embed_script_handles_windows(self):
        """Test that embedding script handles Windows."""
        script_path = Path(__file__).parent.parent / "build" / "embed_python_binary.js"
        content = script_path.read_text()
        assert "win32" in content, "Script should handle Windows (win32)"
        assert "python.exe" in content, "Script should reference python.exe for Windows"

    def test_embed_script_handles_macos(self):
        """Test that embedding script handles macOS."""
        script_path = Path(__file__).parent.parent / "build" / "embed_python_binary.js"
        content = script_path.read_text()
        assert "darwin" in content, "Script should handle macOS (darwin)"

    def test_embed_script_handles_linux(self):
        """Test that embedding script handles Linux."""
        script_path = Path(__file__).parent.parent / "build" / "embed_python_binary.js"
        content = script_path.read_text()
        assert "linux" in content or "os.platform" in content, "Script should handle Linux"

    def test_embed_script_verifies_file_size(self):
        """Test that verification checks binary file size."""
        script_path = Path(__file__).parent.parent / "build" / "embed_python_binary.js"
        content = script_path.read_text()
        assert "size" in content, "Script should check binary size"
        assert "1000000" in content or "1MB" in content, "Script should verify file size"

    def test_embed_script_makes_executable_on_unix(self):
        """Test that script makes binary executable on Unix."""
        script_path = Path(__file__).parent.parent / "build" / "embed_python_binary.js"
        content = script_path.read_text()
        assert "chmodSync" in content or "chmod" in content, (
            "Script should make binary executable on Unix"
        )


class TestMainJSIntegration:
    """Test main.js integration with embedded binary."""

    def test_main_js_has_python_executable_path(self):
        """Test that main.js has getPythonExecutablePath function."""
        main_path = Path(__file__).parent.parent / "electron" / "main.js"
        content = main_path.read_text()
        assert "getPythonExecutablePath" in content, (
            "main.js should have getPythonExecutablePath function"
        )

    def test_main_js_supports_embedded_binary(self):
        """Test that main.js supports embedded binary path."""
        main_path = Path(__file__).parent.parent / "electron" / "main.js"
        content = main_path.read_text()
        assert "process.resourcesPath" in content or "resources" in content, (
            "main.js should reference embedded resources"
        )

    def test_main_js_handles_extraction_error(self):
        """Test that main.js handles extraction errors."""
        main_path = Path(__file__).parent.parent / "electron" / "main.js"
        content = main_path.read_text()
        assert "try" in content and "catch" in content, "main.js should have error handling"

    def test_main_js_uses_resources_path(self):
        """Test that main.js uses resourcesPath for production binary."""
        main_path = Path(__file__).parent.parent / "electron" / "main.js"
        content = main_path.read_text()
        assert "process.resourcesPath" in content, (
            "main.js should use process.resourcesPath for production binary"
        )

    def test_main_js_preserves_dev_behavior(self):
        """Test that main.js preserves development behavior."""
        main_path = Path(__file__).parent.parent / "electron" / "main.js"
        content = main_path.read_text()
        assert "isDev" in content, "main.js should check isDev flag"
        assert "venv" in content, "main.js should support venv in development"


class TestPackageJsonBuildScripts:
    """Test package.json build scripts."""

    def test_package_json_exists(self):
        """Test that package.json exists."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        assert package_path.exists(), "package.json should exist"

    def test_package_json_has_build_python_script(self):
        """Test that package.json has build-python script."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_path, encoding="utf-8") as f:
            package_json = json.load(f)
        assert "scripts" in package_json, "package.json should have scripts"
        assert "build-python" in package_json["scripts"], "Should have build-python script"

    def test_package_json_has_embed_python_script(self):
        """Test that package.json has embed-python script."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_path, encoding="utf-8") as f:
            package_json = json.load(f)
        assert "embed-python" in package_json["scripts"], "Should have embed-python script"

    def test_package_json_has_dist_scripts(self):
        """Test that package.json has distribution scripts."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_path, encoding="utf-8") as f:
            package_json = json.load(f)
        scripts = package_json.get("scripts", {})
        assert "dist" in scripts, "Should have dist script"
        assert "dist-win" in scripts, "Should have dist-win script"
        assert "dist-mac" in scripts, "Should have dist-mac script"
        assert "dist-linux" in scripts, "Should have dist-linux script"

    def test_package_json_has_fs_extra_dependency(self):
        """Test that package.json includes fs-extra."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_path, encoding="utf-8") as f:
            package_json = json.load(f)
        dev_deps = package_json.get("devDependencies", {})
        assert "fs-extra" in dev_deps, "fs-extra should be in devDependencies"

    def test_package_json_no_redundant_build_config(self):
        """Test that package.json doesn't have redundant build config."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_path, encoding="utf-8") as f:
            package_json = json.load(f)
        # The build config should be in electron-builder.config.js, not here
        assert "build" not in package_json, (
            "Build config should be in electron-builder.config.js, not package.json"
        )

    def test_dist_script_calls_embed_python(self):
        """Test that dist scripts call embed-python."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_path, encoding="utf-8") as f:
            package_json = json.load(f)
        dist_script = package_json["scripts"].get("dist", "")
        assert "embed-python" in dist_script or "prebuild-portable" in dist_script, (
            "dist script should call embed-python"
        )


class TestCrossplatformConfiguration:
    """Test cross-platform configuration."""

    def test_electron_builder_config_referenced(self):
        """Test that electron-builder.config.js is referenced."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        assert config_path.exists(), "electron-builder.config.js should exist"

    def test_windows_portable_exe_output(self):
        """Test that Windows output is portable .exe."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "portable" in content, "Should target portable .exe on Windows"

    def test_macos_single_app_bundle(self):
        """Test that macOS output is single .app bundle."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "dmg" in content, "Should create .dmg for macOS"

    def test_linux_appimage_single_file(self):
        """Test that Linux output is single AppImage file."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "AppImage" in content, "Should create AppImage for Linux"

    def test_environment_variables_for_signing(self):
        """Test that config uses environment variables for signing."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "process.env" in content, (
            "Config should use environment variables for signing credentials"
        )


class TestBuildProcess:
    """Test build process configuration."""

    def test_prebuild_portable_script_exists(self):
        """Test that prebuild-portable script is configured."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_path, encoding="utf-8") as f:
            package_json = json.load(f)
        scripts = package_json.get("scripts", {})
        assert "prebuild-portable" in scripts, "prebuild-portable script should exist"

    def test_dist_scripts_call_prebuild(self):
        """Test that all dist scripts call prebuild-portable."""
        package_path = Path(__file__).parent.parent / "electron" / "package.json"
        with open(package_path, encoding="utf-8") as f:
            package_json = json.load(f)
        scripts = package_json.get("scripts", {})

        dist_scripts = ["dist", "dist-win", "dist-mac", "dist-linux"]
        for script_name in dist_scripts:
            if script_name in scripts:
                script = scripts[script_name]
                assert "prebuild-portable" in script or "embed-python" in script, (
                    f"{script_name} should call prebuild-portable or embed-python"
                )

    def test_python_binary_included_in_resources(self):
        """Test that Python binary is included in build resources."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "python_binary" in content or "python" in content, (
            "Python binary should be included in files"
        )

    def test_asar_packaging_enabled(self):
        """Test that ASAR packaging is enabled."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "asar: true" in content, "ASAR should be enabled"


class TestSecurityConfiguration:
    """Test security-related configuration."""

    def test_code_signing_supported_windows(self):
        """Test that Windows code signing is supported."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "certificateFile" in content, "Windows code signing should be supported"
        assert "WIN_CERT" in content or "process.env" in content, (
            "Should use environment variables for certificate"
        )

    def test_code_signing_supported_macos(self):
        """Test that macOS code signing is supported."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "identity" in content, "macOS code signing should be supported"

    def test_notarization_supported_macos(self):
        """Test that macOS notarization is supported."""
        config_path = Path(__file__).parent.parent / "electron" / "electron-builder.config.js"
        content = config_path.read_text()
        assert "notarize" in content, "macOS notarization should be supported"
