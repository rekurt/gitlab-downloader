#!/usr/bin/env python
"""
Build script for creating standalone Python binary using PyInstaller.

This script creates a standalone executable that includes the FastAPI server
and all dependencies, allowing the Electron app to bundle it without requiring
a Python installation.

Usage:
    python build/create_python_binary.py [--platform windows|macos|linux]
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def get_project_root() -> Path:
    """Get the project root directory."""
    return Path(__file__).parent.parent


def get_platform() -> str:
    """Get the current platform."""
    if sys.platform == 'win32':
        return 'windows'
    elif sys.platform == 'darwin':
        return 'macos'
    else:
        return 'linux'


def check_pyinstaller() -> bool:
    """Check if PyInstaller is installed."""
    try:
        import PyInstaller  # noqa: F401
        return True
    except ImportError:
        return False


def install_pyinstaller() -> bool:
    """Install PyInstaller."""
    try:
        subprocess.check_call(
            [sys.executable, '-m', 'pip', 'install', 'pyinstaller>=5.0.0'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def build_binary(platform: str | None = None) -> bool:
    """
    Build the Python binary for the specified platform.

    Args:
        platform: Target platform ('windows', 'macos', 'linux'). If None, uses current platform.

    Returns:
        True if build succeeds, False otherwise.
    """
    if platform is None:
        platform = get_platform()

    print(f'Building API server binary for {platform}...')

    project_root = get_project_root()
    spec_file = project_root / 'build' / 'pyinstaller_spec.spec'

    if not spec_file.exists():
        print(f'Error: Spec file not found at {spec_file}')
        return False

    if not check_pyinstaller():
        print('PyInstaller not found. Installing...')
        if not install_pyinstaller():
            print('Error: Failed to install PyInstaller')
            return False

    # Create output directory
    output_dir = project_root / 'build' / 'dist'
    output_dir.mkdir(parents=True, exist_ok=True)

    # Clean previous build
    dist_dir = project_root / 'dist'
    build_cache_dir = project_root / 'build' / 'build'

    if dist_dir.exists():
        shutil.rmtree(dist_dir)

    if build_cache_dir.exists():
        shutil.rmtree(build_cache_dir)

    try:
        # Run PyInstaller
        cmd = [
            sys.executable,
            '-m',
            'PyInstaller',
            '--clean',
            '--distpath',
            str(output_dir),
            '--buildpath',
            str(project_root / 'build' / 'build'),
            '--specpath',
            str(project_root / 'build'),
            str(spec_file),
        ]

        print(f'Running: {" ".join(cmd)}')
        result = subprocess.run(cmd, cwd=str(project_root), check=False)

        if result.returncode != 0:
            print('Error: PyInstaller build failed')
            return False

        print('Build completed successfully')

        # Verify the binary was created
        if platform == 'windows':
            binary_path = output_dir / 'api-server.exe'
        elif platform == 'macos':
            binary_path = output_dir / 'api-server.app' / 'Contents' / 'MacOS' / 'api-server'
        else:  # linux
            binary_path = output_dir / 'api-server'

        if binary_path.exists():
            print(f'Binary created: {binary_path}')
            print(f'Binary size: {binary_path.stat().st_size / 1024 / 1024:.1f} MB')
            return True
        else:
            print(f'Error: Binary not found at {binary_path}')
            return False

    except Exception as e:
        print(f'Error during build: {e}')
        return False


def get_binary_path(platform: str | None = None) -> Path | None:
    """
    Get the path to the built binary for the specified platform.

    Args:
        platform: Target platform. If None, uses current platform.

    Returns:
        Path to the binary, or None if not found.
    """
    if platform is None:
        platform = get_platform()

    project_root = get_project_root()
    output_dir = project_root / 'build' / 'dist'

    if platform == 'windows':
        binary_path = output_dir / 'api-server.exe'
    elif platform == 'macos':
        binary_path = output_dir / 'api-server.app' / 'Contents' / 'MacOS' / 'api-server'
    else:  # linux
        binary_path = output_dir / 'api-server'

    if binary_path.exists():
        return binary_path

    return None


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Build standalone Python binary for gitlab-dump API server'
    )
    parser.add_argument(
        '--platform',
        choices=['windows', 'macos', 'linux'],
        default=None,
        help='Target platform (default: current platform)',
    )

    args = parser.parse_args()

    if build_binary(args.platform):
        return 0
    else:
        return 1


if __name__ == '__main__':
    sys.exit(main())
