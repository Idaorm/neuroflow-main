"""Project configuration shared by the backend and the standalone EEG server."""

import os
from pathlib import Path


def load_env_file(path):
    """Load simple KEY=VALUE pairs without overriding the process environment."""
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "\'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def load_emotiv_credentials():
    load_env_file(Path(__file__).resolve().parent / ".env")
    names = ("EMOTIV_CLIENT_ID", "EMOTIV_CLIENT_SECRET")
    missing = [name for name in names if not os.environ.get(name, "").strip()]
    if missing:
        raise RuntimeError(
            "Missing Emotiv credentials: " + ", ".join(missing)
            + ". Set them in the project .env file (see .env.example)."
        )
    return tuple(os.environ[name] for name in names)
