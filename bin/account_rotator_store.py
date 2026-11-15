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
from datetime import datetime, tzinfo

STORE_GLOB = "account-rotator_claude-account-rotator-*.json"

# 9999-12-30T00:00:00Z, the last day a Python datetime holds in any zone: a stored time past it was never the mod's.
MAX_INSTANT_MS = 253_402_128_000_000


class StoreError(Exception):
    """Why no store can be read: the one line a bin prints on stderr before it exits 1."""


def is_instant(value: object) -> bool:
    """Whether a stored value is a time the mod writes: epoch milliseconds a Python datetime can render."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= MAX_INSTANT_MS


def label(account: dict, accounts: list) -> str:
    """An account as text names it, as hooks/model.ts label: its email, its organization only where the email is on several."""
    email = account.get("email")
    if not isinstance(email, str):
        return "Claude Code's login" if account.get("slot") == "" else f"account {account.get('id')} (not signed in yet)"
    org = account.get("orgName")
    is_shared = sum(1 for a in accounts if isinstance(a, dict) and a.get("email") == email) > 1
    return f"{email} · {org}" if is_shared and isinstance(org, str) and org else email


def label_of(accounts: list, account_id: object) -> str:
    """The account `account_id` names, by label; "account <id>" where `accounts` holds none, as hooks/model.ts labelOf."""
    found = next((a for a in accounts if isinstance(a, dict) and a.get("id") == account_id), None)
    return f"account {account_id}" if found is None else label(found, accounts)  # id fallback


def launch_pick(data: dict) -> dict | None:
    """The stored `launch-slot` pick where it has the shape the mod writes (a slot string, "" for Claude Code's own
    login, and an id string), else None: the one reading bin/account-rotator-launch and bin/account-rotator-claude share."""
    pick = data.get("launch-slot")
    if isinstance(pick, dict) and isinstance(pick.get("slot"), str) and isinstance(pick.get("id"), str):
        return pick
    return None


def rows_written_within(data: dict, minutes: float, now_ms: float) -> bool:
    """Whether a session wrote the store's `rows` in the last `minutes`, at or before `now_ms`: a stamp in the future
    is not recent, since a clock moved back says nothing about a session running now."""
    rows = data.get("rows")
    at = rows.get("at") if isinstance(rows, dict) else None
    return is_instant(at) and 0 <= now_ms - at < minutes * 60_000


def clock_text(at_ms: float, zone: tzinfo | None) -> str:
    """HH:MM on a 24-hour clock in `zone`, else in this machine's own: hooks/model.ts clockText."""
    return datetime.fromtimestamp(at_ms / 1000, zone).strftime("%H:%M")


def same_pick_since(at_ms: object, zone: tzinfo | None = None) -> str:
    """How both bins say since when new sessions have started on the same account, in `zone` or this machine's own; empty where no time is stored."""
    return f"the same pick since {clock_text(at_ms, zone)}" if is_instant(at_ms) else ""


def config_folder() -> str:
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")


def requests_folder(store: str) -> str:
    """Where `account select` leaves requests for the sessions on `store`: the folder of the config it lies in, by
    its `<config>/plugins/store/` path, else this shell's config folder (hooks/model.ts requestsDir)."""
    folder = os.path.dirname(os.path.abspath(store))
    plugins = os.path.dirname(folder)
    is_in_config = os.path.basename(folder) == "store" and os.path.basename(plugins) == "plugins"
    return os.path.join(os.path.dirname(plugins) if is_in_config else config_folder(), "account-rotator-requests")


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
