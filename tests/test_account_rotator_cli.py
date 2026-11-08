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

    def test_help_names_the_verb_and_what_it_moves(self) -> None:
        for args in (["account", "--help"], ["account", "use", "--help"]):
            done = run(CLI, *args)
            self.assertEqual((done.returncode, "use" in done.stdout), (0, True), done.stderr)
        self.assertIn(SESSION_VAR, run(CLI, "account", "use", "--help").stdout)

    def test_help_says_a_background_bash_waits_for_the_minute_and_connect_refuses(self) -> None:
        said = " ".join(run(CLI, "account", "use", "--help").stdout.split())
        for words in ("background Bash", "--wait under 60", "Chrome connects"):
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


if __name__ == "__main__":
    unittest.main()
