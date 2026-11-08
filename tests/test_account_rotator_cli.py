"""Tests for bin/account-rotator and the store pick it shares with bin/account-rotator-launch (puma-eslxj.11, C10).

Run from the repo's root: python3 -m unittest discover -s tests
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from contextlib import redirect_stdout
from pathlib import Path
from types import ModuleType
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "bin" / "account-rotator"
LAUNCH = ROOT / "bin" / "account-rotator-launch"
FIXTURE = ROOT / "tests" / "fixtures" / "rows.ts"
STORE = "account-rotator_claude-account-rotator-6a98198262ca.json"
FIXTURE_PREFIX = "export default "


def load_fixture() -> dict:
    """The fixture model.test.ts imports: a TypeScript module whose default export is JSON."""
    text = FIXTURE.read_text(encoding="utf-8")
    if not text.startswith(FIXTURE_PREFIX):
        raise AssertionError(f"{FIXTURE} no longer starts with {FIXTURE_PREFIX!r}")
    return json.loads(text[len(FIXTURE_PREFIX):])


def load_cli() -> ModuleType:
    loader = importlib.machinery.SourceFileLoader("account_rotator_cli", str(CLI))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def run(path: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(path), *args], capture_output=True, text=True, env=env, timeout=30)


class StoreCase(unittest.TestCase):
    """A temporary Claude config folder holding the fixture's store."""

    def setUp(self) -> None:
        self.fixture = load_fixture()
        self.tmp = Path(tempfile.mkdtemp(prefix="account-rotator-cli-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.stores = self.tmp / "plugins" / "store"
        self.stores.mkdir(parents=True)
        self.store = self.write(STORE, self.fixture["store"])

    def write(self, name: str, data: object, mtime: float | None = None) -> Path:
        path = self.stores / name
        path.write_text(json.dumps(data), encoding="utf-8")
        if mtime is not None:
            os.utime(path, (mtime, mtime))
        return path

    def env(self) -> dict[str, str]:
        return {**os.environ, "CLAUDE_CONFIG_DIR": str(self.tmp)}

    def list_in_process(self, *args: str, store: Path | None = None) -> tuple[int, str]:
        """`account list` run in this process at the fixture's clock and zone."""
        out = io.StringIO()
        with redirect_stdout(out):
            code = load_cli().main(["account", "list", "--store", str(store or self.store), *args],
                                   now=self.fixture["now"], zone=ZoneInfo(self.fixture["zone"]))
        return code, out.getvalue()


class HelpAndUsage(StoreCase):
    def test_help_exits_0_on_the_root_on_account_and_on_list(self) -> None:
        for args in (["--help"], ["account", "--help"], ["account", "list", "--help"]):
            with self.subTest(args=args):
                done = run(CLI, *args)
                self.assertEqual((done.returncode, "account list" in done.stdout), (0, True), done.stderr)

    def test_an_unknown_flag_or_a_bare_group_exits_2(self) -> None:
        for args in (["account", "list", "--bogus"], ["account"], [], ["account", "select"]):
            with self.subTest(args=args):
                self.assertEqual(run(CLI, *args, env=self.env()).returncode, 2)

    def test_an_agent_other_than_claude_exits_2_naming_claude(self) -> None:
        done = run(CLI, "account", "list", "--agent", "codex", env=self.env())
        self.assertEqual((done.returncode, "claude" in done.stderr), (2, True), done.stderr)

    def test_a_missing_or_unreadable_store_exits_1(self) -> None:
        empty = self.tmp / "empty"
        empty.mkdir()
        (self.tmp / "not-a-store.json").write_text("[1, 2]", encoding="utf-8")
        cases = {
            "missing --store": run(CLI, "account", "list", "--store", str(self.tmp / "nope.json")),
            "no store in the config": run(CLI, "account", "list", env={**os.environ, "CLAUDE_CONFIG_DIR": str(empty)}),
            "JSON not an object": run(CLI, "account", "list", "--store", str(self.tmp / "not-a-store.json")),
        }
        self.assertEqual({name: done.returncode for name, done in cases.items()}, dict.fromkeys(cases, 1))


class ListText(StoreCase):
    def test_list_prints_each_accounts_lines_as_the_pane_draws_them(self) -> None:
        code, out = self.list_in_process()
        blocks = out.rstrip("\n").split("\n\n")
        expected = ["\n".join(self.fixture["lines"][a["id"]]) for a in self.fixture["store"]["accounts"]]
        self.assertEqual((code, blocks[:-1]), (0, expected))

    def test_the_times_are_this_clocks_and_this_zones(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            load_cli().main(["account", "list", "--store", str(self.store)], now=self.fixture["now"] + 60_000, zone=ZoneInfo("UTC"))
        first = out.getvalue().split("\n\n")[0].split("\n")
        self.assertEqual(first, [
            "andres@lutsohealth.com · Company · Ultra  updated 16:34",
            "Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable ▰▰▰▰▱▱▱▱▱▱ 38%  resets 2d 3h 13m · Fable 1d 3h 13m",
        ])

    def test_the_last_line_says_when_the_rows_were_written_and_where_new_sessions_start(self) -> None:
        _, out = self.list_in_process()
        last = out.rstrip("\n").split("\n")[-1]
        self.assertIn("rows written 18:40", last)
        self.assertIn("new sessions start on account 1 (the most room", last)

    def test_a_line_an_older_session_stored_as_text_prints_as_is_and_says_so(self) -> None:
        store = json.loads(json.dumps(self.fixture["store"]))
        store["rows"]["rows"][0]["lines"] = ["older line 1", "older line 2"]
        _, out = self.list_in_process(store=self.write("older.json", store))
        self.assertTrue(out.startswith("older line 1\nolder line 2\n\n"), out)
        self.assertIn("older", out.rstrip("\n").split("\n")[-1])

    def test_an_account_with_no_row_stored_says_so_under_its_email(self) -> None:
        store = json.loads(json.dumps(self.fixture["store"]))
        store["accounts"].append({"id": "3", "slot": "/home/test/.claude/accounts/3", "email": "three@example.com"})
        _, out = self.list_in_process(store=self.write("third.json", store))
        self.assertIn("three@example.com  no row stored yet", out.split("\n\n")[2])


class ListJson(StoreCase):
    def test_json_is_orcas_envelope_with_the_mods_own_fields_per_account(self) -> None:
        code, out = self.list_in_process("--json")
        data = json.loads(out)
        uuid.UUID(data["id"])
        result = data["result"]
        accounts = result["accounts"]
        self.assertEqual((code, data["ok"], [a["id"] for a in accounts]), (0, True, ["1", "2"]))
        self.assertEqual([a["lines"] for a in accounts], [self.fixture["lines"]["1"], self.fixture["lines"]["2"]])
        self.assertEqual([a["system"] for a in accounts], [True, False])
        self.assertEqual([a["health"] for a in accounts], ["ok", "ok"])
        self.assertEqual((result["activeAccountId"], result["activeAccountIdsByRuntime"]), ("1", {"host": "1", "wsl": {}}))
        self.assertEqual(data["_meta"], {"runtimeId": None, "store": str(self.store), "rowsAt": self.fixture["now"]})


class ReadOnly(StoreCase):
    def test_list_leaves_the_store_files_bytes_and_mtime_as_they_were(self) -> None:
        before = (self.store.read_bytes(), self.store.stat().st_mtime_ns)
        for args in ([], ["--json"]):
            with self.subTest(args=args):
                done = run(CLI, "account", "list", *args, env=self.env())
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual((self.store.read_bytes(), self.store.stat().st_mtime_ns), before)


class StorePick(StoreCase):
    """Both bins pick the newest store file of the installed mod that holds an accounts list."""

    def setUp(self) -> None:
        super().setUp()
        store = json.loads(json.dumps(self.fixture["store"]))
        store["launch-slot"] = {"id": "1", "slot": "/the/installed/store", "why": "the most room", "at": self.fixture["now"]}
        self.store = self.write(STORE, store, mtime=1_000_000)
        inline = {**store, "launch-slot": {"id": "9", "slot": "/a/plugin-dir/store", "why": "x", "at": 0}}
        self.write("account-rotator_inline-a7581201d848.json", inline, mtime=3_000_000)

    def picks(self) -> dict[str, str]:
        launch = run(LAUNCH, env=self.env())
        listed = run(CLI, "account", "list", "--json", env=self.env())
        meta = json.loads(listed.stdout)["_meta"]["store"] if listed.returncode == 0 else f"exit {listed.returncode}"
        return {"account-rotator-launch": launch.stdout.strip() or f"exit {launch.returncode}", "account-rotator": meta}

    def test_a_newer_inline_store_never_wins(self) -> None:
        self.assertEqual(self.picks(), {"account-rotator-launch": "/the/installed/store", "account-rotator": str(self.store)})

    def test_a_newer_file_of_the_mods_name_with_no_accounts_never_wins(self) -> None:
        self.write("account-rotator_claude-account-rotator-gone.json", {"generation": 1}, mtime=2_000_000)
        torn = self.stores / "account-rotator_claude-account-rotator-torn.json"
        torn.write_text('{"accounts": [', encoding="utf-8")
        os.utime(torn, (2_500_000, 2_500_000))
        self.assertEqual(self.picks(), {"account-rotator-launch": "/the/installed/store", "account-rotator": str(self.store)})

    def test_store_names_the_file_whatever_its_name(self) -> None:
        inline = self.stores / "account-rotator_inline-a7581201d848.json"
        done = run(LAUNCH, "--store", str(inline), env=self.env())
        self.assertEqual(done.stdout.strip(), "/a/plugin-dir/store")


if __name__ == "__main__":
    unittest.main()
