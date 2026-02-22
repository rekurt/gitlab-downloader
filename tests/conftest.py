"""Shared pytest fixtures for all tests."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

import gitlab_downloader.api_routes as api_routes


@pytest.fixture(autouse=True)
def _allow_temp_dir_in_path_validation() -> None:
    """Add system temp directories to allowed base dirs for tests.

    Many tests use tempfile.TemporaryDirectory, tmp_path, or hardcoded /tmp
    paths which resolve outside the user's home directory. This fixture
    temporarily allows those paths so that _validate_path boundary checks
    pass in tests.
    """
    temp_base = Path(tempfile.gettempdir()).resolve()
    # On macOS, /tmp -> /private/tmp, which differs from tempfile.gettempdir()
    tmp_resolved = Path("/tmp").resolve()

    original = api_routes._allowed_base_dirs.copy()
    for d in (temp_base, tmp_resolved):
        if d not in api_routes._allowed_base_dirs:
            api_routes._allowed_base_dirs.append(d)
    yield  # type: ignore[misc]
    api_routes._allowed_base_dirs[:] = original
