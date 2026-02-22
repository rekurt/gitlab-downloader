"""Tests for logging configuration."""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from gitlab_downloader.logging_config import setup_logging


class TestSetupLogging:
    """Tests for setup_logging function."""

    def test_sets_log_level_info(self) -> None:
        """Test that INFO level is set correctly."""
        setup_logging("INFO")
        root = logging.getLogger()
        assert root.level == logging.INFO

    def test_sets_log_level_debug(self) -> None:
        """Test that DEBUG level is set correctly."""
        setup_logging("DEBUG")
        root = logging.getLogger()
        assert root.level == logging.DEBUG

    def test_sets_log_level_warning(self) -> None:
        """Test that WARNING level is set correctly."""
        setup_logging("WARNING")
        root = logging.getLogger()
        assert root.level == logging.WARNING

    def test_case_insensitive_level(self) -> None:
        """Test that level string is case-insensitive."""
        setup_logging("debug")
        root = logging.getLogger()
        assert root.level == logging.DEBUG

    def test_adds_stream_handler(self) -> None:
        """Test that a stream handler is added."""
        setup_logging("INFO")
        root = logging.getLogger()
        stream_handlers = [h for h in root.handlers if isinstance(h, logging.StreamHandler)]
        assert len(stream_handlers) >= 1

    def test_clears_previous_handlers(self) -> None:
        """Test that previous handlers are cleared."""
        root = logging.getLogger()
        root.addHandler(logging.StreamHandler())
        root.addHandler(logging.StreamHandler())
        initial_count = len(root.handlers)
        assert initial_count >= 2

        setup_logging("INFO")
        # After setup, should have exactly 1 stream handler
        assert len(root.handlers) == 1

    def test_with_log_file(self) -> None:
        """Test that a file handler is added when log_file is specified."""
        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = str(Path(tmpdir) / "test.log")
            setup_logging("INFO", log_file=log_file)

            root = logging.getLogger()
            file_handlers = [h for h in root.handlers if isinstance(h, logging.FileHandler)]
            assert len(file_handlers) == 1

            # Clean up file handler to release the file
            for h in file_handlers:
                h.close()
                root.removeHandler(h)

    def test_without_log_file(self) -> None:
        """Test that no file handler is added when log_file is None."""
        setup_logging("INFO", log_file=None)
        root = logging.getLogger()
        file_handlers = [h for h in root.handlers if isinstance(h, logging.FileHandler)]
        assert len(file_handlers) == 0

    def test_invalid_level_defaults_to_info(self) -> None:
        """Test that an invalid level string defaults to INFO."""
        setup_logging("INVALID_LEVEL")
        root = logging.getLogger()
        assert root.level == logging.INFO
