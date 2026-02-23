from __future__ import annotations

import os
from urllib.parse import quote, urlparse, urlunparse


def trim_prefix(value: str, prefix: str) -> str:
    normalized_value = value.strip("/")
    normalized_prefix = prefix.strip("/")
    if normalized_prefix and normalized_value.startswith(normalized_prefix):
        rest = normalized_value[len(normalized_prefix) :]
        if not rest or rest.startswith("/"):
            return rest.strip("/")
    return normalized_value


def sanitize_path_component(value: str) -> str:
    cleaned = value.replace("\\", "/").replace("\x00", "")
    cleaned = "".join(ch for ch in cleaned if ch >= " " and ord(ch) != 127)
    parts = [part for part in cleaned.split("/") if part and part not in {".", ".."}]
    return "/".join(parts)


def extract_group_path(root_full_path: str, path_with_namespace: str) -> str:
    parent = path_with_namespace.rsplit("/", 1)[0] if "/" in path_with_namespace else ""
    return trim_prefix(parent, root_full_path)


def is_subpath(base_path: str, target_path: str) -> bool:
    base_real = os.path.realpath(base_path)
    target_real = os.path.realpath(target_path)
    try:
        return os.path.commonpath([base_real, target_real]) == base_real
    except ValueError:
        return False


def sanitize_git_output(text: str) -> str:
    """Remove credentials from git command output (stderr/stdout).

    Strips oauth2:token@ and user:password@ patterns from URLs in the text.
    """
    import re

    # Remove oauth2:token@, user:password@, or bare token@ patterns in URLs
    return re.sub(r"://[^@/\s]+@", "://***@", text)


def build_authenticated_clone_url(https_url: str, token: str) -> str:
    parsed = urlparse(https_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Invalid repository URL")

    encoded_token = quote(token, safe="")
    host = parsed.hostname
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"oauth2:{encoded_token}@{host}{port}"
    return urlunparse(
        (parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment)
    )
