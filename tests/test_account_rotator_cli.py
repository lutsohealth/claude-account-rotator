"""Tests for bin/account-rotator and the store pick it shares with bin/account-rotator-launch (puma-eslxj.11, C10).

Run from the repo's root: python3 -m unittest discover -s tests
"""

from __future__ import annotations

import importlib.machinery
import importlib.util
import io
import json
import os
import pty
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from contextlib import redirect_stdout
from pathlib import Path
from types import ModuleType
from unittest.mock import patch
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
        (self.stores / "account-rotator_claude-account-rotator-dangling.json").symlink_to(self.tmp / "gone")
        self.assertEqual(self.picks(), {"account-rotator-launch": "/the/installed/store", "account-rotator": str(self.store)})

    def test_a_dangling_file_of_the_stores_name_alone_is_no_store(self) -> None:
        self.store.unlink()
        (self.stores / "account-rotator_inline-a7581201d848.json").unlink()
        (self.stores / "account-rotator_claude-account-rotator-dangling.json").symlink_to(self.tmp / "gone")
        said = {name: run(ROOT / "bin" / name, *BINS[name], env=self.env()).stderr for name in BINS}
        self.assertEqual({name: "no account-rotator store found" in text for name, text in said.items()}, dict.fromkeys(BINS, True), said)

    def test_each_bin_reads_the_store_through_a_link_as_path_may_reach_it(self) -> None:
        on_path = self.tmp / "on-path"
        on_path.mkdir()
        codes = {}
        for name in BINS:
            (on_path / name).symlink_to(ROOT / "bin" / name)
            codes[name] = run(on_path / name, *BINS[name], env=self.env()).returncode
        self.assertEqual(codes, dict.fromkeys(BINS, 0))

    def test_store_names_the_file_whatever_its_name(self) -> None:
        inline = self.stores / "account-rotator_inline-a7581201d848.json"
        done = run(LAUNCH, "--store", str(inline), env=self.env())
        self.assertEqual(done.stdout.strip(), "/a/plugin-dir/store")


BINS = {"account-rotator": ["account", "list"], "account-rotator-launch": []}
ACCOUNT = {"id": "1", "slot": "", "email": "a@example.com"}
HOUR_MS = 3_600_000
MALFORMED = {
    "no accounts list": json.dumps({"rows": {"rows": []}, "launch-slot": {"id": "1", "slot": "/slot", "why": "x", "at": 1}}),
    "accounts null": '{"accounts": null}',
    "accounts a number": '{"accounts": 5}',
    "an account not an object": json.dumps({"accounts": [5]}),
    "rows.rows a number": json.dumps({"accounts": [ACCOUNT], "rows": {"v": 1, "at": 0, "rows": 5}}),
    "a line a number": json.dumps({"accounts": [ACCOUNT], "rows": {"v": 1, "at": 0, "rows": [{"id": "1", "lines": [5]}]}}),
    "a run of no known shape": json.dumps({"accounts": [ACCOUNT], "rows": {"v": 1, "at": 0, "rows": [{"id": "1", "lines": [[{"x": 1}]]}]}}),
    "a clock run out of range": json.dumps({"accounts": [ACCOUNT], "rows": {"v": 1, "at": 0, "rows": [{"id": "1", "lines": [[{"clock": 1e20}]]}]}}),
    "rows.at out of range": json.dumps({"accounts": [ACCOUNT], "rows": {"v": 1, "at": 1e20, "rows": []}}),
    "an until run of 1e400": '{"accounts": [{"id": "1", "slot": ""}], "rows": {"v": 1, "at": 0, "rows": [{"id": "1", "lines": [[{"until": 1e400}]]}]}}',
    "launch-slot.at of 1e400": '{"accounts": [], "launch-slot": {"id": "1", "slot": "", "at": 1e400}}',
}
TORN = {"empty, truncated before the write": "", "cut mid-object": '{"accounts": [{"id": "1", "slot": ""'}


class ReviewStoreReadContract(StoreCase):
    """Review C10-R1 EXPLICIT-STORE-SHAPE (Codex), F2 and F3 (Opus) [STORE-READ-CONTRACT] (RULING 4574): what both bins
    take as the store, and how they say they cannot: exit 1, one stderr line naming the file, never a traceback and
    never an older file in place of a newest one that does not parse."""

    def bin_run(self, name: str, *args: str) -> subprocess.CompletedProcess[str]:
        return run(ROOT / "bin" / name, *BINS[name], *args, env=self.env())

    def test_every_bin_refuses_a_store_it_is_named_that_holds_no_accounts_list(self) -> None:
        named = self.tmp / "named.json"
        named.write_text(MALFORMED["no accounts list"], encoding="utf-8")
        codes = {name: self.bin_run(name, "--store", str(named)).returncode for name in BINS}
        self.assertEqual(codes, dict.fromkeys(BINS, 1))

    def test_every_bin_stops_at_a_newest_store_that_does_not_parse_and_names_it(self) -> None:
        cases = [(name, form, text) for name in BINS for form, text in TORN.items()]
        self.assertTrue(cases)
        offenders = []
        newest = self.stores / "account-rotator_claude-account-rotator-bbbbbbbbbbbb.json"
        for name, form, text in cases:
            newest.write_text(text, encoding="utf-8")
            os.utime(newest, (4_000_000_000, 4_000_000_000))
            done = self.bin_run(name)
            if done.returncode != 1 or str(newest) not in done.stderr:
                offenders.append(f"{name}, newest store {form}: exit {done.returncode}, stderr {done.stderr.strip()!r}")
        self.assertEqual(offenders, [], "fix: a newest store that does not parse stops the pick with exit 1 naming it")

    def test_no_bin_answers_a_malformed_store_with_a_traceback(self) -> None:
        self.assertTrue(MALFORMED)
        offenders = []
        for name in BINS:
            for form, text in MALFORMED.items():
                store = self.tmp / "malformed.json"
                store.write_text(text, encoding="utf-8")
                done = self.bin_run(name, "--store", str(store))
                if "Traceback" in done.stderr or (done.returncode == 1 and len(done.stderr.strip().splitlines()) != 1):
                    offenders.append(f"{name}, {form}: exit {done.returncode}, {done.stderr.strip().splitlines()[-1:]}")
        self.assertEqual(offenders, [], "fix: each bin answers a malformed store with one stderr line and exit 1")

    def test_account_list_refuses_each_malformed_value_with_exit_1(self) -> None:
        codes = {}
        for form, text in MALFORMED.items():
            store = self.tmp / "malformed.json"
            store.write_text(text, encoding="utf-8")
            codes[form] = self.bin_run("account-rotator", "--store", str(store)).returncode
        self.assertEqual(codes, dict.fromkeys(MALFORMED, 1))


class ReviewPassedReset(StoreCase):
    """Review C10-R1 F4 (Opus), RESET-EXPIRY (Codex) [ROW-AT-ANOTHER-NOW] (RULING 4574): a stored reset read after it
    passed says `passed`, and the last line names the account, never `0m`. The pane's line past a reset with no session
    running is the known limit [ROWS-PAST-A-RESET]: the CLI does not redo the percent."""

    def test_a_5h_reset_two_hours_past_reads_passed(self) -> None:
        line = self.fixture["store"]["rows"]["rows"][1]["lines"][2]
        until = next(r["until"] for r in line if isinstance(r, dict))
        text = load_cli().line_text(line, until + 2 * HOUR_MS, ZoneInfo(self.fixture["zone"]))
        self.assertEqual(text, "5h ▰▰▰▰▰▱▱▱▱▱ 50%  resets passed")

    def test_no_stored_until_reads_as_due_now_once_it_has_passed(self) -> None:
        cli, zone = load_cli(), ZoneInfo(self.fixture["zone"])
        sites = [(row["id"], i, line, run["until"]) for row in self.fixture["store"]["rows"]["rows"]
                 for i, line in enumerate(row["lines"]) for run in line if isinstance(run, dict) and "until" in run]
        self.assertTrue(sites)
        offenders = [f"account {rid} line {i + 1}: {cli.line_text(line, until + HOUR_MS, zone)!r}"
                     for rid, i, line, until in sites if "passed" not in cli.line_text(line, until + HOUR_MS, zone)]
        self.assertEqual(offenders, [], "fix: a passed {until} reads `passed`")

    def test_the_last_line_names_each_account_whose_reset_passed(self) -> None:
        out = io.StringIO()
        with redirect_stdout(out):
            load_cli().main(["account", "list", "--store", str(self.store)], now=self.fixture["now"] + 2 * HOUR_MS, zone=ZoneInfo("UTC"))
        last = out.getvalue().rstrip("\n").split("\n")[-1]
        self.assertIn("a reset has passed since its row was written for account 2", last)


class RequestCase(StoreCase):
    """A store with a store-id, and a session that answers the requests the CLI leaves."""

    def setUp(self) -> None:
        super().setUp()
        store = json.loads(json.dumps(self.fixture["store"]))
        store["store-id"] = "store-abc"
        self.store = self.write(STORE, store)
        self.requests = self.tmp / "account-rotator-requests"

    def answer(self, ok: bool, message: str, pick_id: str | None = None, active_id: str | None = None) -> threading.Thread:
        """A session that answers the first request it finds, as the mod's minute tick does."""

        def respond() -> None:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                found = [p for p in self.requests.glob("*.json") if not p.name.endswith(".result.json")] if self.requests.is_dir() else []
                if found:
                    request = json.loads(found[0].read_text(encoding="utf-8"))
                    self.seen = request
                    answered = {"nonce": request["nonce"], "ok": ok, "message": message, "pickId": pick_id or request["id"]}
                    if active_id is not None:
                        answered["activeId"] = active_id
                    (self.requests / f"{request['nonce']}.result.json").write_text(json.dumps(answered), encoding="utf-8")
                    return
                time.sleep(0.05)

        thread = threading.Thread(target=respond)
        thread.start()
        self.addCleanup(thread.join)
        return thread


class Select(RequestCase):
    """C11 (puma-eslxj.12, RULING 4593 and 4595): `account select` writes a request file in the config folder's
    account-rotator-requests, naming the store's store-id, and waits for the result file a session writes."""

    def select(self, *args: str) -> subprocess.CompletedProcess[str]:
        return run(CLI, "account", "select", *args, env=self.env())

    def test_json_says_the_account_new_sessions_really_start_on(self) -> None:
        # Found live on vox login 2 at 52f30f5: the account selected had no room, and the pick was another.
        self.answer(True, "new sessions start on account 1 (account 2 has no room, and it is the next with room)", pick_id="1")
        done = self.select("--account", "2", "--json", "--wait", "10")
        result = json.loads(done.stdout)["result"]
        self.assertEqual((done.returncode, result["activeAccountId"], result["launchOn"]), (0, "1", "account:2"))

    def write_result(self, make_body) -> threading.Thread:
        """A session that writes whatever `make_body(nonce)` gives, as a result, once a request stands."""

        def respond() -> None:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                found = [p for p in self.requests.glob("*.json") if not p.name.endswith(".result.json")] if self.requests.is_dir() else []
                if found:
                    nonce = json.loads(found[0].read_text(encoding="utf-8"))["nonce"]
                    (self.requests / f"{nonce}.result.json").write_text(make_body(nonce), encoding="utf-8")
                    return
                time.sleep(0.02)

        thread = threading.Thread(target=respond)
        thread.start()
        self.addCleanup(thread.join)
        return thread

    # Review C11-R1 WAIT-01 (Codex), F4 (Opus) [REQUEST-LIFE] (RULING 4607).
    def test_a_wait_not_finite_or_outside_the_time_a_request_lasts_exits_2_before_any_file(self) -> None:
        corpus = ["nan", "inf", "-inf", "Infinity", "1e999", "0", "-1", "301", "soon"]
        self.assertTrue(corpus)
        offenders = {}
        for value in corpus:
            try:
                code = self.select("--account", "2", f"--wait={value}").returncode
            except subprocess.TimeoutExpired:
                code = "no end"
            if code != 2 or self.requests.exists():
                offenders[value] = code
        self.assertEqual(offenders, {}, "fix: --wait is finite, above 0, at most REQUEST_TTL_MS, or exit 2 before any file")

    # Review C11-R1 RESULT-01 (Codex) [REQUEST-LIFE], F8 (Opus) [UNPINNED-GUARD]: the answers that are no answer.
    def test_only_a_result_with_its_own_nonce_a_bool_ok_and_a_string_message_is_an_answer(self) -> None:
        bodies = {
            "another nonce": lambda n: json.dumps({"nonce": "someone-else", "ok": True, "message": "applied"}),
            "no nonce": lambda n: json.dumps({"ok": True, "message": "applied"}),
            "no message": lambda n: json.dumps({"nonce": n, "ok": True}),
            "ok not a bool": lambda n: json.dumps({"nonce": n, "ok": "yes", "message": "applied"}),
            "not an object": lambda n: "[1]",
            "torn": lambda n: '{"nonce": "',
        }
        self.assertTrue(bodies)
        codes = {}
        for name, body in bodies.items():
            self.write_result(body)
            codes[name] = self.select("--account", "2", "--wait", "1").returncode
        self.assertEqual(codes, dict.fromkeys(bodies, 3), "fix: answer() takes only its own nonce, ok a bool, message a string")

    def test_a_result_with_no_pick_says_so_in_json(self) -> None:
        # Review C11-R1 F8: the --json pick fallback, as when no account has room.
        self.write_result(lambda n: json.dumps({"nonce": n, "ok": True, "message": "no account has room"}))
        done = self.select("--account", "2", "--json", "--wait", "10")
        self.assertEqual((done.returncode, json.loads(done.stdout)["result"]["activeAccountId"]), (0, None), done.stderr)

    def test_the_request_is_whole_at_the_moment_it_takes_its_name(self) -> None:
        # Review C11-R1 F8: the rename. At os.replace the temp file holds the whole request and the name is free.
        cli, seen = load_cli(), []
        real = cli.os.replace

        def watch(source: str, target: str) -> None:
            seen.append((sorted(json.loads(Path(source).read_text(encoding="utf-8"))), os.path.exists(target)))
            real(source, target)

        with patch.object(cli.os, "replace", watch), patch.object(cli, "answer", lambda *a: None), patch.object(sys, "stderr", io.StringIO()), patch.dict(os.environ, self.env()):
            cli.main(["account", "select", "--account", "2", "--wait", "1"])
        self.assertEqual(seen, [(["at", "id", "kind", "nonce", "store"], False)])

    # Review C11-R1 F3 (Opus) [REQUEST-LIFE]: a live CLI takes its request back, whatever stopped it.
    def test_no_catchable_signal_leaves_a_request_or_a_traceback(self) -> None:
        signals = {"SIGINT": signal.SIGINT, "SIGTERM": signal.SIGTERM, "SIGHUP": signal.SIGHUP}
        self.assertTrue(signals)
        offenders = {}
        for name, signum in signals.items():
            child = subprocess.Popen([sys.executable, str(CLI), "account", "select", "--account", "2", "--wait", "30"], env=self.env(), stderr=subprocess.PIPE, text=True)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not list(self.requests.glob("*.json")):
                time.sleep(0.02)
            self.assertTrue(list(self.requests.glob("*.json")), "the CLI wrote no request: the fixture did not reach the wait")
            child.send_signal(signum)
            _, stderr = child.communicate(timeout=5)
            left = sorted(p.name for p in self.requests.iterdir())
            if left or "Traceback" in stderr or child.returncode != 130:
                offenders[name] = (left, child.returncode, stderr[-120:])
        self.assertEqual(offenders, {}, "fix: finally withdraws the request on every exit, one line, exit 130")

    # Review C11-R2 (Codex) [SIGNAL-PRETRY-GAP]: a signal anywhere in the verb, the folder lookup before the write too.
    def test_a_signal_during_the_folder_lookup_is_one_line_and_exit_130(self) -> None:
        signals = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)
        self.assertTrue(signals)
        outcomes = {}
        for signum in signals:
            cli = load_cli()
            with patch.object(cli, "requests_folder", side_effect=lambda _store, s=signum: os.kill(os.getpid(), s)), patch.dict(os.environ, self.env()), patch.object(sys, "stderr", io.StringIO()):
                try:
                    outcomes[signum.name] = cli.main(["account", "select", "--account", "2", "--wait", "1"])
                except BaseException as error:  # noqa: BLE001: a test of what escapes
                    outcomes[signum.name] = type(error).__name__
        self.assertEqual(outcomes, {s.name: 130 for s in signals})

    # Review C11-R1 F7 (Opus) [REQUEST-LIFE]: an OSError on the write is one line and exit 1.
    def test_a_requests_folder_it_cannot_write_exits_1_in_one_line(self) -> None:
        self.requests.write_text("a file, not a folder", encoding="utf-8")
        done = self.select("--account", "2", "--wait", "1")
        self.assertEqual((done.returncode, "Traceback" in done.stderr, len(done.stderr.strip().splitlines())), (1, False, 1), done.stderr)

    # Review C11-R1 F6 (Opus) [REQUEST-FOLDER]: --store names another config's store, so its sessions' folder is that config's.
    def test_a_store_of_another_config_takes_the_request_to_that_configs_folder(self) -> None:
        other = self.tmp / "other-config"
        (other / "plugins" / "store").mkdir(parents=True)
        store = json.loads(self.store.read_text(encoding="utf-8"))
        named = other / "plugins" / "store" / "account-rotator_inline-a7581201d848.json"
        named.write_text(json.dumps(store), encoding="utf-8")
        self.requests = other / "account-rotator-requests"
        self.answer(True, "ok")
        done = self.select("--account", "2", "--store", str(named), "--wait", "10")
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_a_store_outside_a_config_takes_the_request_to_this_shells_folder(self) -> None:
        named = self.tmp / "elsewhere.json"
        named.write_text(self.store.read_text(encoding="utf-8"), encoding="utf-8")
        self.answer(True, "ok")
        self.assertEqual(self.select("--account", "2", "--store", str(named), "--wait", "10").returncode, 0)

    def test_an_id_an_email_and_system_each_name_one_account(self) -> None:
        for given, expected in (("2", "2"), ("two@example.com", "2"), ("TWO@example.com", "2"), ("system", "1")):
            with self.subTest(account=given):
                self.answer(True, f"new sessions start on account {expected}")
                done = self.select("--account", given, "--wait", "10")
                self.assertEqual((done.returncode, self.seen["id"], self.seen["store"], self.seen["kind"]), (0, expected, "store-abc", "select"), done.stderr)
                self.assertEqual(sorted(p.name for p in self.requests.iterdir()), [], "the CLI removes both files once it has the result")

    def test_an_account_no_listed_one_names_or_an_email_two_share_exits_2_naming_the_ids(self) -> None:
        store = json.loads(self.store.read_text(encoding="utf-8"))
        store["accounts"].append({"id": "3", "slot": "/home/test/.claude/accounts/3", "email": "two@example.com"})
        self.write(STORE, store)
        shared, unknown = self.select("--account", "two@example.com"), self.select("--account", "nobody@example.com")
        self.assertEqual((shared.returncode, "2, 3" in shared.stderr), (2, True), shared.stderr)
        self.assertEqual((unknown.returncode, "two@example.com" in unknown.stderr), (2, True), unknown.stderr)
        self.assertFalse(self.requests.exists(), "a refused --account writes no request")

    def test_a_session_that_refuses_gives_exit_4_with_its_reason(self) -> None:
        self.answer(False, "account 2 is not listed")
        done = self.select("--account", "2", "--wait", "10")
        self.assertEqual((done.returncode, "account 2 is not listed" in done.stderr), (4, True), done.stderr)

    def test_no_session_within_wait_gives_exit_3_and_withdraws_the_request(self) -> None:
        done = self.select("--account", "2", "--wait", "0.3")
        self.assertEqual((done.returncode, "account list" in done.stderr), (3, True), done.stderr)
        self.assertEqual(list(self.requests.iterdir()), [])

    def test_a_store_no_session_has_given_a_store_id_gives_exit_3_and_writes_nothing(self) -> None:
        store = json.loads(self.store.read_text(encoding="utf-8"))
        del store["store-id"]
        self.write(STORE, store)
        done = self.select("--account", "2", "--wait", "0.3")
        self.assertEqual(done.returncode, 3, done.stderr)
        self.assertFalse(self.requests.exists())

    def test_json_is_orcas_envelope(self) -> None:
        self.answer(True, "new sessions start on account 2")
        done = self.select("--account", "2", "--json", "--wait", "10")
        data = json.loads(done.stdout)
        self.assertEqual((done.returncode, data["ok"], data["result"]["activeAccountId"], data["result"]["launchOn"]), (0, True, "2", "account:2"))


MARK = "session-abc"
SESSION_VAR = "ACCOUNT_ROTATOR_SESSION"
SLOT_VAR = "CLAUDE_SECURESTORAGE_CONFIG_DIR"


class Use(RequestCase):
    """C12 (puma-eslxj.13, RULING 4624): `account use` moves the one session that runs it. The mod sets a mark in the
    environment of its Bash children; the request names it and only that session applies it, during the Bash call."""

    def session_env(self, **extra: str) -> dict[str, str]:
        """This process's environment, as a Bash child of a session on the mod sees it."""
        base = {k: v for k, v in self.env().items() if k not in (SESSION_VAR, SLOT_VAR)}
        return {**base, SESSION_VAR: MARK, **extra}

    def use(self, *args: str) -> subprocess.CompletedProcess[str]:
        return run(CLI, "account", "use", *args, env=self.session_env())

    def test_with_the_mark_unset_or_empty_it_exits_2_naming_the_way_out_and_leaves_no_file(self) -> None:
        unset = {k: v for k, v in self.session_env().items() if k != SESSION_VAR}
        for name, env in (("unset", unset), ("empty", {**unset, SESSION_VAR: ""})):
            with self.subTest(mark=name):
                done = run(CLI, "account", "use", "--account", "2", env=env)
                self.assertEqual((done.returncode, SESSION_VAR in done.stderr, "--help" in done.stderr, "Traceback" in done.stderr), (2, True, True, False), done.stderr)
                self.assertFalse(self.requests.exists(), "exit 2 writes no request")

    def test_with_the_mark_unset_it_exits_2_even_with_no_store(self) -> None:
        self.store.unlink()
        env = {k: v for k, v in self.session_env().items() if k != SESSION_VAR}
        self.assertEqual(run(CLI, "account", "use", "--account", "2", env=env).returncode, 2)

    def test_the_request_names_the_mark_the_store_and_the_account_and_both_files_go(self) -> None:
        for given, expected in (("2", "2"), ("two@example.com", "2"), ("system", "1")):
            with self.subTest(account=given):
                self.answer(True, f"this session now uses account {expected}")
                done = self.use("--account", given, "--wait", "10")
                self.assertEqual((done.returncode, self.seen["kind"], self.seen["session"], self.seen["store"], self.seen["id"]), (0, "use", MARK, "store-abc", expected), done.stderr)
                self.assertIn(f"this session now uses account {expected}", done.stdout)
                self.assertEqual(sorted(p.name for p in self.requests.iterdir()), [])

    def test_a_refusal_gives_exit_4_with_the_sessions_words(self) -> None:
        self.answer(False, "Claude Code's security policy refuses a switch")
        done = self.use("--account", "2", "--wait", "10")
        self.assertEqual((done.returncode, "security policy" in done.stderr), (4, True), done.stderr)

    def test_an_account_no_listed_one_names_exits_2_and_leaves_no_file(self) -> None:
        done = self.use("--account", "nobody@example.com")
        self.assertEqual(done.returncode, 2, done.stderr)
        self.assertFalse(self.requests.exists())

    def test_no_session_within_wait_gives_exit_3_says_whose_and_withdraws_the_request(self) -> None:
        done = self.use("--account", "2", "--wait", "0.3")
        self.assertEqual((done.returncode, "the session that ran this" in done.stderr), (3, True), done.stderr)
        self.assertEqual(list(self.requests.iterdir()), [])

    def test_a_store_no_session_has_given_a_store_id_gives_exit_3_and_writes_nothing(self) -> None:
        store = json.loads(self.store.read_text(encoding="utf-8"))
        del store["store-id"]
        self.write(STORE, store)
        self.assertEqual(self.use("--account", "2", "--wait", "0.3").returncode, 3)
        self.assertFalse(self.requests.exists())

    def test_no_catchable_signal_leaves_a_request_or_a_traceback(self) -> None:
        signals = {"SIGINT": signal.SIGINT, "SIGTERM": signal.SIGTERM, "SIGHUP": signal.SIGHUP}
        self.assertTrue(signals)
        offenders = {}
        for name, signum in signals.items():
            child = subprocess.Popen([sys.executable, str(CLI), "account", "use", "--account", "2", "--wait", "30"], env=self.session_env(), stderr=subprocess.PIPE, text=True)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and not (self.requests.is_dir() and list(self.requests.glob("*.json"))):
                time.sleep(0.02)
            self.assertTrue(self.requests.is_dir() and list(self.requests.glob("*.json")), "the CLI wrote no request: the fixture did not reach the wait")
            child.send_signal(signum)
            _, stderr = child.communicate(timeout=5)
            left = sorted(p.name for p in self.requests.iterdir())
            if left or "Traceback" in stderr or child.returncode != 130:
                offenders[name] = (left, child.returncode, stderr[-120:])
        self.assertEqual(offenders, {}, "fix: finally withdraws the request on every exit, one line, exit 130")

    def test_json_is_orcas_envelope_naming_the_account_this_session_is_on_after_it(self) -> None:
        self.answer(True, "this session moves to account 2 in a few minutes", active_id="1")
        done = self.use("--account", "2", "--json", "--wait", "10")
        data = json.loads(done.stdout)
        self.assertEqual((done.returncode, data["ok"], data["result"]["account"], data["result"]["thisSessionAccountId"], "in a few minutes" in data["result"]["message"]), (0, True, "2", "1", True), done.stderr)

    def test_help_names_the_verb_the_mark_the_minute_and_connect(self) -> None:
        for args in (["account", "--help"], ["account", "use", "--help"]):
            done = run(CLI, *args)
            self.assertEqual((done.returncode, "use" in done.stdout), (0, True), done.stderr)
        said = " ".join(run(CLI, "account", "use", "--help").stdout.split())
        for words in (SESSION_VAR, "background Bash", "--wait under 60", "Chrome connects"):
            self.assertIn(words, said)


class Remove(RequestCase):
    """C12 (puma-eslxj.13, RULING 4640): `account rm` asks any session on the store to drop an account, as Remove does."""

    def rm(self, *args: str) -> subprocess.CompletedProcess[str]:
        return run(CLI, "account", "rm", *args, env=self.env())

    def test_claude_codes_own_login_by_any_name_exits_2_naming_the_way_out_and_leaves_no_file(self) -> None:
        own = next(a for a in self.fixture["store"]["accounts"] if a["slot"] == "")
        names = ("system", own["id"], own["email"])
        self.assertTrue(names)
        for given in names:
            with self.subTest(account=given):
                done = self.rm("--account", given)
                self.assertEqual((done.returncode, "claude auth logout" in done.stderr, "--help" in done.stderr, "Traceback" in done.stderr), (2, True, True, False), done.stderr)
                self.assertFalse(self.requests.exists(), "exit 2 writes no request")

    def test_an_account_no_listed_one_names_exits_2_and_leaves_no_file(self) -> None:
        self.assertEqual(self.rm("--account", "nobody@example.com").returncode, 2)
        self.assertFalse(self.requests.exists())

    def test_the_request_names_the_store_and_the_account_and_no_session_and_both_files_go(self) -> None:
        for given in ("2", "two@example.com"):
            with self.subTest(account=given):
                self.answer(True, "account 2 is removed; new sessions start on account 1")
                done = self.rm("--account", given, "--wait", "10")
                self.assertEqual((done.returncode, self.seen["kind"], self.seen["store"], self.seen["id"], "session" in self.seen), (0, "rm", "store-abc", "2", False), done.stderr)
                self.assertIn("account 2 is removed", done.stdout)
                self.assertEqual(sorted(p.name for p in self.requests.iterdir()), [])

    def test_the_request_carries_what_this_read_of_the_account_saw(self) -> None:
        # Review C12-rm ID-REUSE (Codex) [RM-TARGET-NOT-SEEN]: the session compares them before it signs anything out.
        account = next(a for a in self.fixture["store"]["accounts"] if a["id"] == "2")
        self.answer(True, "account 2 is removed")
        self.assertEqual(self.rm("--account", "2", "--wait", "10").returncode, 0)
        self.assertEqual((self.seen["slot"], self.seen["email"]), (account["slot"], account["email"]))

    def test_an_account_with_no_email_or_organization_sends_none_and_one_with_them_sends_both(self) -> None:
        store = json.loads(self.store.read_text(encoding="utf-8"))
        row = next(a for a in store["accounts"] if a["id"] == "2")
        email = row.pop("email")
        row.pop("orgId", None)
        self.write(STORE, store)
        self.answer(True, "account 2 is removed")
        self.assertEqual(self.rm("--account", "2", "--wait", "10").returncode, 0)
        self.assertEqual(("email" in self.seen, "orgId" in self.seen), (False, False))
        row.update(email=email, orgId="org-a")
        self.write(STORE, store)
        self.answer(True, "account 2 is removed")
        self.assertEqual(self.rm("--account", "2", "--wait", "10").returncode, 0)
        self.assertEqual((self.seen["email"], self.seen["orgId"]), (email, "org-a"))

    def test_a_row_with_no_slot_exits_1_and_leaves_no_file(self) -> None:
        # Review C12-rm MALFORMED-ACCOUNT (Codex) [RM-TARGET-NOT-SEEN]: no writer in the mod makes one, and a session filters it out and would answer "already gone".
        store = json.loads(self.store.read_text(encoding="utf-8"))
        rows = [a for a in store["accounts"] if a["id"] == "2"]
        self.assertTrue(rows)
        del rows[0]["slot"]
        self.write(STORE, store)
        done = self.rm("--account", "2", "--wait", "1")
        self.assertEqual((done.returncode, "no slot" in done.stderr, "Traceback" in done.stderr), (1, True, False), done.stderr)
        self.assertFalse(self.requests.exists())

    def test_it_needs_no_session_of_its_own(self) -> None:
        env = {k: v for k, v in self.env().items() if k != SESSION_VAR}
        self.answer(True, "account 2 is removed")
        self.assertEqual(run(CLI, "account", "rm", "--account", "2", "--wait", "10", env=env).returncode, 0)

    def test_a_refusal_gives_exit_4_with_the_sessions_words(self) -> None:
        self.answer(False, "account 2 could not be signed out: keychain is locked")
        done = self.rm("--account", "2", "--wait", "10")
        self.assertEqual((done.returncode, "keychain is locked" in done.stderr), (4, True), done.stderr)

    def test_no_session_within_wait_gives_exit_3_and_withdraws_the_request(self) -> None:
        self.assertEqual(self.rm("--account", "2", "--wait", "0.3").returncode, 3)
        self.assertEqual(list(self.requests.iterdir()), [])

    def test_a_signal_withdraws_the_request_in_one_line(self) -> None:
        child = subprocess.Popen([sys.executable, str(CLI), "account", "rm", "--account", "2", "--wait", "30"], env=self.env(), stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not (self.requests.is_dir() and list(self.requests.glob("*.json"))):
            time.sleep(0.02)
        self.assertTrue(self.requests.is_dir() and list(self.requests.glob("*.json")), "the CLI wrote no request: the fixture did not reach the wait")
        child.send_signal(signal.SIGTERM)
        _, stderr = child.communicate(timeout=5)
        self.assertEqual((child.returncode, list(self.requests.iterdir()), "Traceback" in stderr), (130, [], False), stderr)

    def test_json_is_orcas_envelope_naming_where_new_sessions_start(self) -> None:
        self.answer(True, "account 2 is removed; new sessions start on account 1", pick_id="1")
        data = json.loads(self.rm("--account", "2", "--json", "--wait", "10").stdout)
        self.assertEqual((data["ok"], data["result"]["account"], data["result"]["activeAccountId"], "removed" in data["result"]["message"]), (True, "2", "1", True))

    def test_help_names_the_verb_and_says_it_signs_out(self) -> None:
        self.assertIn("rm", run(CLI, "account", "--help").stdout)
        said = " ".join(run(CLI, "account", "rm", "--help").stdout.split())
        for words in ("sign an account out", "Other sessions", "not moved", "keeps the account"):
            self.assertIn(words, said)


class ListThisSession(StoreCase):
    """C12: `list --json` names the account the session running it is on, read from the slot its Bash children carry."""

    def session(self, *args: str, **extra: str) -> dict:
        base = {k: v for k, v in self.env().items() if k not in (SESSION_VAR, SLOT_VAR)}
        return json.loads(run(CLI, "account", "list", "--json", *args, env={**base, **extra}).stdout)["result"]

    def test_the_account_whose_slot_this_session_carries(self) -> None:
        slots = {a["id"]: a["slot"] for a in self.fixture["store"]["accounts"]}
        self.assertTrue(slots)
        for account, slot in slots.items():
            with self.subTest(account=account):
                env = {SESSION_VAR: MARK, **({SLOT_VAR: slot} if slot else {})}
                self.assertEqual(self.session(**env)["thisSessionAccountId"], account)

    def test_help_says_the_field_is_what_this_process_inherited(self) -> None:
        # Review C12-R1 STALE_MARK (Codex) [MARK-LIFE], RULING 4629: no live proof without a session registry, so the words carry the limit.
        said = " ".join(run(CLI, "account", "list", "--help").stdout.split())
        for words in ("thisSessionAccountId", "inherited", "outlives its session"):
            self.assertIn(words, said)

    def test_none_outside_a_session_or_on_a_slot_no_account_holds(self) -> None:
        slot = next(a["slot"] for a in self.fixture["store"]["accounts"] if a["slot"])
        self.assertIsNone(self.session()["thisSessionAccountId"], "no mark: this shell is in no session")
        self.assertIsNone(self.session(**{SLOT_VAR: slot})["thisSessionAccountId"], "a slot with no mark is no session of the mod")
        self.assertIsNone(self.session(**{SESSION_VAR: MARK, SLOT_VAR: "/nowhere"})["thisSessionAccountId"])


# Stands in for `claude`: says what it was run with, prints a line as the real sign-in does, runs STUB_THEN, exits STUB_EXIT.
STUB_CLAUDE = """#!/bin/sh
{ printf 'argv=%s\\n' "$*"; printf 'slot=%s\\n' "$CLAUDE_SECURESTORAGE_CONFIG_DIR"; printf 'config=%s\\n' "$CLAUDE_CONFIG_DIR"
  if [ -t 0 ]; then echo tty=yes; else echo tty=no; fi; } >> "$STUB_LOG"
echo "stub: opening your browser"
if [ -n "$STUB_THEN" ]; then exec sh -c "$STUB_THEN"; fi
exit "${STUB_EXIT:-0}"
"""


class Add(RequestCase):
    """C13 (puma-eslxj.14, RULING 4660): `account add` signs a new folder in, in the foreground, and a session lists it."""

    def setUp(self) -> None:
        super().setUp()
        self.home = self.tmp / "home"
        self.accounts = self.home / ".claude" / "accounts"
        self.accounts.mkdir(parents=True)
        self.stub_log = self.tmp / "stub.log"
        stubs = self.tmp / "stubs"
        stubs.mkdir()
        stub = stubs / "claude"
        stub.write_text(STUB_CLAUDE, encoding="utf-8")
        stub.chmod(0o755)
        self.path = f"{stubs}{os.pathsep}{os.environ['PATH']}"
        self.next_number = str(1 + max(int(a["id"]) for a in self.fixture["store"]["accounts"]))

    def add_env(self, **more: str) -> dict[str, str]:
        return {**self.env(), "HOME": str(self.home), "PATH": self.path, "STUB_LOG": str(self.stub_log), **more}

    def add(self, *args: str, has_terminal: bool = True, **stub: str) -> subprocess.CompletedProcess[str]:
        """`account add` on a real terminal, or on none."""
        command = [sys.executable, str(CLI), "account", "add", *args]
        if not has_terminal:
            return subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True, env=self.add_env(**stub), timeout=30)
        ours, theirs = pty.openpty()
        self.addCleanup(os.close, ours)
        try:
            return subprocess.run(command, stdin=theirs, capture_output=True, text=True, env=self.add_env(**stub), timeout=30)
        finally:
            os.close(theirs)

    def stub_said(self) -> list[str]:
        return self.stub_log.read_text(encoding="utf-8").splitlines() if self.stub_log.exists() else []

    def stored(self) -> dict:
        return json.loads(self.store.read_text(encoding="utf-8"))

    def session(self, ok: bool = True, message: str = "account added", account_id: str | None = None) -> threading.Thread:
        """A session that takes the first add it finds and answers. It lists nothing, as the CLI reads no store after an
        answer: the session's own read back is held by the flow tests. These tests hold how the CLI forwards an answer."""

        def respond() -> None:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                found = [p for p in self.requests.glob("*.json") if not p.name.endswith(".result.json")] if self.requests.is_dir() else []
                if found:
                    request = json.loads(found[0].read_text(encoding="utf-8"))
                    self.seen = request
                    answered = {"nonce": request["nonce"], "ok": ok, "message": message, "accountId": account_id or request["id"], "pickId": "1"}
                    (self.requests / f"{request['nonce']}.result.json").write_text(json.dumps(answered), encoding="utf-8")
                    return
                time.sleep(0.05)

        thread = threading.Thread(target=respond)
        thread.start()
        self.addCleanup(thread.join)
        return thread

    def test_with_no_terminal_it_exits_2_before_any_folder_or_sign_in_naming_the_way_out(self) -> None:
        done = self.add(has_terminal=False)
        self.assertEqual((done.returncode, "--folder" in done.stderr, "--help" in done.stderr, "Traceback" in done.stderr), (2, True, True, False), done.stderr)
        self.assertEqual((list(self.accounts.iterdir()), self.stub_said(), self.requests.exists()), ([], [], False))

    def test_a_store_with_no_store_id_exits_3_before_any_folder_or_sign_in(self) -> None:
        store = self.stored()
        del store["store-id"]
        self.write(STORE, store)
        done = self.add("--wait", "1")
        self.assertEqual((done.returncode, "store-id" in done.stderr), (3, True), done.stderr)
        self.assertEqual((list(self.accounts.iterdir()), self.stub_said()), ([], []))

    def test_it_signs_the_next_free_folder_in_on_this_terminal_and_asks_a_session_to_list_it(self) -> None:
        self.session()
        done = self.add("--wait", "10")
        self.assertEqual(done.returncode, 0, done.stderr)
        slot = str(self.accounts / self.next_number)
        self.assertEqual(self.stub_said(), ["argv=auth login --claudeai", f"slot={slot}", f"config={slot}", "tty=yes"])
        self.assertEqual((self.seen["kind"], self.seen["slot"], self.seen["id"], self.seen["store"]), ("add", slot, self.next_number, "store-abc"))
        self.assertTrue((self.accounts / self.next_number / "README").is_file(), "the folder says whose it is, as the panel's add does")
        self.assertEqual(sorted(p.name for p in self.requests.iterdir()), [])
        self.assertIn("account added", done.stdout)

    def test_it_never_signs_in_a_folder_that_exists_or_a_number_or_slot_the_store_lists(self) -> None:
        # Review of the bead against 00f0d864b: on vox ids 1 to 5 are listed and folder 6 exists, unlisted.
        n = int(self.next_number)
        existing = self.accounts / str(n)
        existing.mkdir()
        (existing / "theirs").write_text("kept", encoding="utf-8")
        store = self.stored()
        store["accounts"].append({"id": str(n + 1), "slot": "/elsewhere/9"})
        store["accounts"].append({"id": "90", "slot": str(self.accounts / str(n + 2))})
        self.write(STORE, store)
        self.session()
        self.assertEqual(self.add("--wait", "10").returncode, 0)
        self.assertEqual(self.seen["slot"], str(self.accounts / str(n + 3)))
        self.assertEqual((existing / "theirs").read_text(encoding="utf-8"), "kept")

    def way_back(self) -> str:
        """Review C13-R1 F1, F2, F4: every return after the sign-in keeps the folder and names how to ask again, and claims no sign-in."""
        slot = self.accounts / self.next_number
        return f"{slot} is kept: account add --folder {slot} asks again"

    def test_a_failed_sign_in_exits_5_keeps_its_folder_and_asks_nothing(self) -> None:
        # Review C13-R1 F1 [AFTER-SIGN-IN] (RULING 4668): nobody read what the folder holds, and a keychain item outlives it.
        done = self.add("--wait", "1", STUB_EXIT="7")
        self.assertEqual((done.returncode, self.way_back() in done.stderr, "Traceback" in done.stderr), (5, True, False), done.stderr)
        self.assertTrue((self.accounts / self.next_number).is_dir())
        self.assertFalse(self.requests.exists())

    def test_no_claude_to_run_exits_5_and_keeps_its_folder(self) -> None:
        done = self.add("--wait", "1", PATH="/nowhere")
        self.assertEqual((done.returncode, "claude" in done.stderr, self.way_back() in done.stderr, "Traceback" in done.stderr), (5, True, True, False), done.stderr)

    def test_a_later_add_after_a_failed_sign_in_takes_the_next_number(self) -> None:
        self.assertEqual(self.add("--wait", "1", STUB_EXIT="7").returncode, 5)
        self.session()
        self.assertEqual(self.add("--wait", "10").returncode, 0)
        self.assertEqual(self.seen["slot"], str(self.accounts / str(int(self.next_number) + 1)))

    def test_the_first_folder_of_a_store_listing_only_claude_codes_login_is_2(self) -> None:
        store = self.stored()
        store["accounts"] = [a for a in store["accounts"] if a["slot"] == ""]
        self.write(STORE, store)
        self.session()
        self.assertEqual(self.add("--wait", "10").returncode, 0)
        self.assertEqual(self.seen["id"], "2")

    def test_every_return_after_the_sign_in_names_the_way_back(self) -> None:
        # Review C13-R1 F2 [AFTER-SIGN-IN]: a store-id gone, a store that does not parse, a request it cannot write.
        gone = {k: v for k, v in self.stored().items() if k != "store-id"}
        no_id = self.tmp / "no-id.json"
        no_id.write_text(json.dumps(gone), encoding="utf-8")
        torn = self.tmp / "torn.json"
        torn.write_text('{"accounts": [', encoding="utf-8")
        whole = self.store.read_text(encoding="utf-8")
        ways = {
            "store-id gone": (3, f"cp {no_id} {self.store}"),
            "store does not parse": (1, f"cp {torn} {self.store}"),
            "requests folder a file": (1, f"touch {self.requests}"),
        }
        self.assertTrue(ways)
        offenders = []
        for name, (code, then) in ways.items():
            done = self.add("--wait", "1", STUB_THEN=then)
            slot = max((p for p in self.accounts.iterdir() if p.name.isdigit()), key=lambda p: int(p.name))
            if done.returncode != code or f"{slot} is kept: account add --folder {slot} asks again" not in done.stderr or "Traceback" in done.stderr:
                offenders.append(f"{name}: exit {done.returncode}: {done.stderr}")
            self.store.write_text(whole, encoding="utf-8")
            if self.requests.is_file():
                self.requests.unlink()
        self.assertEqual(offenders, [], "a folder left unnamed after a sign-in")

    def test_folder_claims_no_sign_in_nobody_read(self) -> None:
        # Review C13-R1 F4 [AFTER-SIGN-IN].
        slot = self.accounts / "12"
        slot.mkdir()
        done = self.add("--folder", str(slot), "--wait", "0.2", has_terminal=False)
        self.assertEqual((done.returncode, "signed in" in done.stderr, f"{slot} is kept" in done.stderr), (3, False, True), done.stderr)

    def test_folder_refuses_a_link(self) -> None:
        # Review C13-R1 PATH-ALIAS [INPUT-EDGES]: the slot's name would be another folder's sign-in, outside or inside.
        outside = self.tmp / "outside"
        outside.mkdir()
        inside = self.accounts / "8"
        inside.mkdir()
        links = {"7": outside, "9": inside}
        for name, target in links.items():
            (self.accounts / name).symlink_to(target, target_is_directory=True)
            done = self.add("--folder", str(self.accounts / name), "--wait", "0.2", has_terminal=False)
            self.assertEqual((done.returncode, "--help" in done.stderr), (2, True), f"{name} -> {target}: {done.stderr}")
        self.assertFalse(self.requests.exists())

    def test_a_closed_stdin_exits_2(self) -> None:
        # Review C13-R1 F8 [INPUT-EDGES]: Python makes sys.stdin None then.
        done = subprocess.run(["sh", "-c", 'exec "$@" <&-', "sh", sys.executable, str(CLI), "account", "add"], capture_output=True, text=True, env=self.add_env(), timeout=30)
        self.assertEqual((done.returncode, "Traceback" in done.stderr), (2, False), done.stderr)

    def test_a_folder_it_cannot_make_exits_1_with_no_sign_in(self) -> None:
        self.accounts.rmdir()
        self.accounts.write_text("", encoding="utf-8")
        done = self.add("--wait", "1")
        self.assertEqual((done.returncode, "Traceback" in done.stderr, self.stub_said()), (1, False, []), done.stderr)

    def test_a_signal_during_the_sign_in_exits_130_and_keeps_its_folder(self) -> None:
        ours, theirs = pty.openpty()
        self.addCleanup(os.close, ours)
        started = self.tmp / "started"
        child = subprocess.Popen([sys.executable, str(CLI), "account", "add"], stdin=theirs, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                 env=self.add_env(STUB_THEN=f"touch {started}; exec sleep 20"))
        os.close(theirs)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not started.exists():
            time.sleep(0.02)
        self.assertTrue(started.exists(), "the stub never started: the fixture did not reach the sign-in")
        child.send_signal(signal.SIGTERM)
        _, stderr = child.communicate(timeout=10)
        self.assertEqual((child.returncode, "Traceback" in stderr, self.way_back() in stderr), (130, False, True), stderr)
        self.assertTrue((self.accounts / self.next_number).is_dir())

    def test_a_signal_while_a_session_is_asked_withdraws_the_request_keeps_the_folder_and_names_the_way_back(self) -> None:
        ours, theirs = pty.openpty()
        self.addCleanup(os.close, ours)
        child = subprocess.Popen([sys.executable, str(CLI), "account", "add", "--wait", "30"], stdin=theirs, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.add_env())
        os.close(theirs)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and not (self.requests.is_dir() and list(self.requests.glob("*.json"))):
            time.sleep(0.02)
        self.assertTrue(self.requests.is_dir() and list(self.requests.glob("*.json")), "the CLI wrote no request: the fixture did not reach the wait")
        child.send_signal(signal.SIGTERM)
        _, stderr = child.communicate(timeout=10)
        self.assertEqual((child.returncode, list(self.requests.iterdir()), self.way_back() in stderr, "Traceback" in stderr), (130, [], True, False), stderr)
        self.assertTrue((self.accounts / self.next_number).is_dir())

    def test_a_refusal_exits_4_in_the_sessions_words_and_keeps_the_folder(self) -> None:
        self.session(ok=False, message="that sign-in is account 2 already")
        done = self.add("--wait", "10")
        self.assertEqual((done.returncode, "account 2 already" in done.stderr, self.way_back() in done.stderr), (4, True, True), done.stderr)
        self.assertTrue((self.accounts / self.next_number).is_dir())

    def test_no_session_exits_3_withdraws_the_request_keeps_the_folder_and_names_the_way_back(self) -> None:
        done = self.add("--wait", "0.3")
        self.assertEqual((done.returncode, self.way_back() in done.stderr, len(done.stderr.strip().splitlines())), (3, True, 1), done.stderr)
        self.assertEqual(list(self.requests.iterdir()), [])
        self.assertTrue((self.accounts / self.next_number).is_dir())

    def test_json_names_the_id_the_session_answered_not_the_folders_number(self) -> None:
        self.session(account_id="3")
        self.assertEqual(json.loads(self.add("--json", "--wait", "10").stdout)["result"]["account"], "3")

    def test_the_request_names_the_store_id_as_it_stands_after_the_sign_in(self) -> None:
        # Two sessions on one store, `store-id`: a sign-in takes minutes, and two sessions booting at once settle on the last write.
        after = self.stored()
        after["store-id"] = "store-later"
        later = self.tmp / "later.json"
        later.write_text(json.dumps(after), encoding="utf-8")
        self.session()
        self.assertEqual(self.add("--wait", "10", STUB_THEN=f"cp {later} {self.store}").returncode, 0)
        self.assertEqual(self.seen["store"], "store-later")

    def test_folder_takes_a_folder_already_signed_in_with_no_terminal_and_no_sign_in(self) -> None:
        slot = self.accounts / "12"
        slot.mkdir()
        for given in (str(slot), f"{slot}/", os.path.relpath(slot)):
            with self.subTest(given=given):
                self.session()
                done = self.add("--folder", given, "--wait", "10", has_terminal=False)
                self.assertEqual((done.returncode, self.seen["slot"], self.seen["id"], self.stub_said()), (0, str(slot), "12", []), done.stderr)

    def test_folder_outside_the_accounts_folder_or_with_no_number_or_missing_exits_2_and_asks_nothing(self) -> None:
        (self.accounts / "abc").mkdir()
        (self.accounts / "0").mkdir()
        (self.accounts / "007").mkdir()
        (self.home / "9").mkdir()
        bad = (self.accounts / "abc", self.accounts / "0", self.accounts / "007", self.home / "9", self.accounts / "55", self.accounts)
        self.assertTrue(bad)
        for given in bad:
            with self.subTest(given=given):
                done = self.add("--folder", str(given), "--wait", "1", has_terminal=False)
                self.assertEqual((done.returncode, "--help" in done.stderr, "Traceback" in done.stderr), (2, True, False), done.stderr)
                self.assertFalse(self.requests.exists())

    def test_json_is_orcas_envelope_with_the_sign_ins_own_words_kept_off_stdout(self) -> None:
        self.session(message="account added")
        done = self.add("--json", "--wait", "10")
        data = json.loads(done.stdout)
        self.assertEqual((data["ok"], data["result"]["account"], data["result"]["folder"], data["result"]["activeAccountId"]), (True, self.next_number, str(self.accounts / self.next_number), "1"))
        self.assertIn("opening your browser", done.stderr)

    def test_help_names_the_verb_the_browser_the_flag_and_every_exit(self) -> None:
        self.assertIn("add", run(CLI, "account", "--help").stdout)
        said = " ".join(run(CLI, "account", "add", "--help").stdout.split())
        exits = ("1 no store or a damaged one", "2 a usage error", "3 no session", "4 a session refused", "5 the sign-in did not finish", "130 stopped")
        for words in ("browser", "--folder", "twin", "Claude Code's own login", "keeps", *exits):
            self.assertIn(words, said)


if __name__ == "__main__":
    unittest.main()
