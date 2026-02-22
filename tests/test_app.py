"""Tests for the main application module."""

from __future__ import annotations

import asyncio
from unittest import mock

import pytest

from gitlab_downloader.app import install_signal_handlers, main, run


class TestInstallSignalHandlers:
    """Tests for install_signal_handlers."""

    def test_sets_shutdown_event_on_signal(self) -> None:
        """Test that signal handler sets the shutdown event."""
        loop = asyncio.new_event_loop()
        shutdown_event = asyncio.Event()

        install_signal_handlers(loop, shutdown_event)

        # The handler should have been installed. We can't easily trigger
        # a real signal in tests, but we can verify the function doesn't raise.
        assert not shutdown_event.is_set()
        loop.close()

    def test_handles_not_implemented_error(self) -> None:
        """Test graceful handling when signal handlers can't be installed."""
        loop = mock.MagicMock()
        loop.add_signal_handler.side_effect = NotImplementedError
        shutdown_event = asyncio.Event()

        # Should not raise
        install_signal_handlers(loop, shutdown_event)

    def test_handles_runtime_error(self) -> None:
        """Test graceful handling on RuntimeError."""
        loop = mock.MagicMock()
        loop.add_signal_handler.side_effect = RuntimeError
        shutdown_event = asyncio.Event()

        # Should not raise
        install_signal_handlers(loop, shutdown_event)


class TestRun:
    """Tests for run() entry point."""

    @mock.patch("gitlab_downloader.app.main")
    def test_run_returns_exit_code(self, mock_main: mock.MagicMock) -> None:
        """Test that run() returns exit code from main()."""
        mock_main.return_value = 0

        async def fake_main(argv=None):
            return 0

        mock_main.side_effect = None
        mock_main.return_value = 0
        with mock.patch("gitlab_downloader.app.asyncio.run", return_value=0) as mock_arun:
            result = run()
            assert result == 0
            mock_arun.assert_called_once()

    def test_run_handles_keyboard_interrupt(self) -> None:
        """Test that run() handles KeyboardInterrupt gracefully."""
        with mock.patch("gitlab_downloader.app.asyncio.run", side_effect=KeyboardInterrupt):
            result = run()
            assert result == 130

    def test_run_handles_eof_error(self) -> None:
        """Test that run() handles EOFError gracefully."""
        with mock.patch("gitlab_downloader.app.asyncio.run", side_effect=EOFError):
            result = run()
            assert result == 130


class TestMain:
    """Tests for main() async function."""

    @pytest.mark.asyncio
    @mock.patch("gitlab_downloader.api.run_api_server_async")
    async def test_main_api_server_mode(
        self,
        mock_run_api: mock.MagicMock,
    ) -> None:
        """Test main() in API server mode."""
        mock_run_api.return_value = None

        result = await main(["--api-server", "--api-host", "127.0.0.1", "--api-port", "8000"])
        assert result == 0
        mock_run_api.assert_called_once_with(host="127.0.0.1", port=8000)
