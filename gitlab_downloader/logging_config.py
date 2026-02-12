from __future__ import annotations

import logging
import sys


def setup_logging(level: str, log_file: str | None = None) -> None:
    root = logging.getLogger()
    root.handlers.clear()

    resolved_level = getattr(logging, level.upper(), logging.INFO)
    root.setLevel(resolved_level)

    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root.addHandler(stream_handler)

    if log_file:
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
