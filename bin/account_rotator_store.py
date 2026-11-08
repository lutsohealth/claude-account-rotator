"""The account-rotator mod's store, as bin/account-rotator and bin/account-rotator-launch read it; both import it.

A store is a JSON object holding an `accounts` list. The pick is the newest file of the installed mod's name in the
Claude config folder: one that parses and holds no accounts list is not a store and is skipped, and one that does not
parse stops the pick, since it may be the store caught mid-write and an older file would answer for it.
"""

# Read as text, so `str | None` is no error on a macOS python3 older than 3.10.
from __future__ import annotations

import glob
import json
import os

STORE_GLOB = "account-rotator_claude-account-rotator-*.json"

# 9999-12-30T00:00:00Z, the last day a Python datetime holds in any zone: a stored time past it was never the mod's.
MAX_INSTANT_MS = 253_402_128_000_000


class StoreError(Exception):
    """Why no store can be read: the one line a bin prints on stderr before it exits 1."""


def is_instant(value: object) -> bool:
    """Whether a stored value is a time the mod writes: epoch milliseconds a Python datetime can render."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= MAX_INSTANT_MS


def config_folder() -> str:
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")


def requests_folder() -> str:
    """Where `account select` leaves requests for the mod's sessions: hooks/model.ts requestsDir."""
    return os.path.join(config_folder(), "account-rotator-requests")


def is_store(data: object) -> bool:
    return isinstance(data, dict) and isinstance(data.get("accounts"), list)


def mtime(path: str) -> float:
    try:
        return os.path.getmtime(path)
    except OSError:
        return -1.0


def newest() -> str:
    """The newest store of the installed mod, or a StoreError naming why there is none to read."""
    pattern = os.path.join(config_folder(), "plugins", "store", STORE_GLOB)
    for path in sorted(glob.glob(pattern), key=mtime, reverse=True):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except OSError:
            continue
        except ValueError as error:
            raise StoreError(f"the newest store {path} does not parse ({error}); a session may be writing it: run again, or pass --store") from error
        if is_store(data):
            return path
    raise StoreError(f"no account-rotator store found ({pattern}); start one Claude Code session with the mod first, or pass --store")


def load(path: str) -> dict:
    """The store at `path`, or a StoreError naming why it is none."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except OSError as error:
        raise StoreError(f"cannot read {path}: {error.strerror or error}") from error
    except ValueError as error:
        raise StoreError(f"{path} does not parse ({error}); a session may be writing it: run again") from error
    if not is_store(data):
        raise StoreError(f"{path} is not an account-rotator store (its JSON holds no accounts list)")
    return data


def read(store: str | None) -> tuple[str, dict]:
    """The store `--store` names, else the newest: its path and its data."""
    path = store or newest()
    return path, load(path)
