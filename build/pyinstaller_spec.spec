# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for gitlab-dump Python API backend.

This spec creates a standalone executable that includes the FastAPI server
and all dependencies, allowing the Electron app to bundle it without requiring
a Python installation.
"""

import sys
import os
from pathlib import Path

# Build configuration
block_cipher = None

# Get the project root directory
project_root = Path(__file__).parent.parent

# Collect all hidden imports needed by the application
hidden_imports = [
    'gitlab_downloader',
    'gitlab_downloader.api',
    'gitlab_downloader.api_routes',
    'gitlab_downloader.api_schemas',
    'gitlab_downloader.app',
    'gitlab_downloader.auth',
    'gitlab_downloader.client',
    'gitlab_downloader.cloner',
    'gitlab_downloader.config',
    'gitlab_downloader.logging_config',
    'gitlab_downloader.migration',
    'gitlab_downloader.author_mapper',
    'gitlab_downloader.models',
    'gitlab_downloader.reporting',
    'fastapi',
    'uvicorn',
    'uvicorn.workers',
    'uvicorn.logging',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websocket',
    'uvicorn.protocols.websocket.auto',
    'uvicorn.protocols.lifespan',
    'uvicorn.protocols.lifespan.auto',
    'uvicorn.server',
    'pydantic',
    'pydantic.json_schema',
    'aiohttp',
    'yaml',
    'dotenv',
    'rich',
]

# Data files to include
datas = [
    (str(project_root / 'gitlab_downloader'), 'gitlab_downloader'),
]

# Optionally include .env if it exists
env_file = project_root / '.env'
if env_file.exists():
    datas.append((str(env_file), '.'))

a = Analysis(
    [str(project_root / 'gitlab_downloader' / 'api.py')],
    pathex=[str(project_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludedimports=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='api-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# For macOS .app bundle (only on macOS)
if sys.platform == 'darwin':
    app = BUNDLE(
        exe,
        name='api-server.app',
        icon=None,
        bundle_identifier='com.gitlab-dump.api-server',
        info_plist={
            'NSPrincipalClass': 'NSApplication',
        },
    )
