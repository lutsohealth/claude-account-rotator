"""Tests for bin/account-rotator-claude, the launcher that starts a plain `claude` on the slot the mod picked.

Each test runs the launcher as a program, HOME pointing at a temporary folder that holds the store, with a stub
`claude` next on PATH that prints the account variables and the arguments it was started with.

Run from the repo's root: python3 -m unittest discover -s tests
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from test_account_rotator_cli import ROOT, STORE, run

LAUNCHER = ROOT / "bin" / "account-rotator-claude"
SLOT_VAR = "CLAUDE_SECURESTORAGE_CONFIG_DIR"
UNSET = "<unset>"
STUB = f"""#!/bin/sh
echo "slot=${{{SLOT_VAR}-{UNSET}}}"
echo "config=${{CLAUDE_CONFIG_DIR-{UNSET}}}"
echo "path=$PATH"
echo "args=$*"
"""


class LauncherCase(unittest.TestCase):
    """A temporary HOME whose store picks slot 5, with rows written a minute ago."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="account-rotator-claude-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.slot = self.home / ".claude" / "accounts" / "5"
        self.slot.mkdir(parents=True)
        self.stub_bin = self.tmp / "stub"
        self.stub_bin.mkdir()
        stub = self.stub_bin / "claude"
        stub.write_text(STUB, encoding="utf-8")
        stub.chmod(0o755)
        self.write_store(pick=str(self.slot), rows_age_minutes=1)

    def write_store(self, pick: str | None, rows_age_minutes: float | None, raw: str | None = None) -> None:
        stores = self.home / ".claude" / "plugins" / "store"
        stores.mkdir(parents=True, exist_ok=True)
        data: dict = {"accounts": []}
        if rows_age_minutes is not None:
            data["rows"] = {"at": time.time() * 1000 - rows_age_minutes * 60_000}
        if pick is not None:
            data["launch-slot"] = {"slot": pick, "id": "5" if pick else "1", "at": time.time() * 1000}
        (stores / STORE).write_text(raw if raw is not None else json.dumps(data), encoding="utf-8")

    def launch(self, *args: str, launcher: Path = LAUNCHER, path: str | None = None, **env: str) -> dict[str, str]:
        base = {k: v for k, v in os.environ.items() if k not in (SLOT_VAR, "CLAUDE_CONFIG_DIR")}
        base.update(HOME=str(self.home), PATH=path or f"{self.stub_bin}:/usr/bin:/bin", **env)
        done = run(launcher, *args, env=base)
        self.assertEqual(done.returncode, 0, done.stderr)
        seen = dict(line.split("=", 1) for line in done.stdout.splitlines())
        seen["stderr"] = done.stderr
        return seen


class SessionStart(LauncherCase):
    def test_a_fresh_pick_sets_the_slot(self) -> None:
        self.assertEqual(self.launch()["slot"], str(self.slot))

    def test_a_print_mode_prompt_that_reads_like_a_subcommand_still_gets_the_pick(self) -> None:
        self.assertEqual(self.launch("-p", "plugin")["slot"], str(self.slot))

    def test_a_subcommand_that_starts_no_session_gets_no_slot(self) -> None:
        for args in (("mcp", "list"), ("--model", "haiku", "auth", "status"), ("--version",)):
            with self.subTest(args=args):
                self.assertEqual(self.launch(*args)["slot"], UNSET)

    def test_every_argument_reaches_claude_as_given(self) -> None:
        self.assertEqual(self.launch("-p", "reply OK", "--settings", "{}")["args"], "-p reply OK --settings {}")


class ValueAlreadySet(LauncherCase):
    def test_a_slot_already_set_wins_over_the_pick(self) -> None:
        self.assertEqual(self.launch(**{SLOT_VAR: "/hand"})["slot"], "/hand")

    def test_an_empty_value_reaches_claude_empty_and_asks_no_pick(self) -> None:
        """Claude Code 2.1.325 reads an empty value as its own login, whatever CLAUDE_CONFIG_DIR says."""
        self.assertEqual(self.launch(**{SLOT_VAR: ""})["slot"], "")


class StalePick(LauncherCase):
    def test_rows_older_than_60_minutes_drop_the_pick_and_say_so(self) -> None:
        self.write_store(pick=str(self.slot), rows_age_minutes=61)
        seen = self.launch()
        self.assertEqual(seen["slot"], UNSET)
        self.assertIn("starting on Claude Code's own login", seen["stderr"])

    def test_rows_stamped_in_the_future_drop_the_pick(self) -> None:
        """Review R1 F3: rows written in the last 60 minutes, never later than now."""
        for minutes in (-1, -24 * 60):
            with self.subTest(minutes=minutes):
                self.write_store(pick=str(self.slot), rows_age_minutes=minutes)
                self.assertEqual(self.launch()["slot"], UNSET)

    def test_rows_59_minutes_old_keep_the_pick(self) -> None:
        self.write_store(pick=str(self.slot), rows_age_minutes=59)
        self.assertEqual(self.launch()["slot"], str(self.slot))

    def test_no_pick_a_missing_slot_folder_or_a_damaged_store_starts_on_the_login(self) -> None:
        cases = {
            "no rows": dict(pick=str(self.slot), rows_age_minutes=None),
            "no pick": dict(pick=None, rows_age_minutes=1),
            "slot folder gone": dict(pick=str(self.home / "gone"), rows_age_minutes=1),
            "store does not parse": dict(pick=None, rows_age_minutes=None, raw="{"),
        }
        for name, store in cases.items():
            with self.subTest(name):
                self.write_store(**store)
                self.assertEqual(self.launch()["slot"], UNSET)


class SystemLogin(LauncherCase):
    def test_a_pick_of_the_login_leaves_both_variables_unset(self) -> None:
        self.write_store(pick="", rows_age_minutes=1)
        seen = self.launch()
        self.assertEqual((seen["slot"], seen["config"]), (UNSET, UNSET))


class InstalledCopy(LauncherCase):
    """The copy a person installs as `claude` in a folder of its own, ahead of the real claude on PATH."""

    def setUp(self) -> None:
        super().setUp()
        self.own = self.home / ".claude" / "accounts" / "bin"
        self.own.mkdir()
        self.copy = self.own / "claude"
        shutil.copy2(LAUNCHER, self.copy)
        installs = {"plugins": {"account-rotator@claude-account-rotator": [{"scope": "user", "installPath": str(ROOT)}]}}
        plugins = self.home / ".claude" / "plugins"
        (plugins / "installed_plugins.json").write_text(json.dumps(installs), encoding="utf-8")

    def test_it_finds_the_store_through_the_installed_mod(self) -> None:
        self.assertEqual(self.launch(launcher=self.copy, path=f"{self.own}:{self.stub_bin}:/usr/bin:/bin")["slot"], str(self.slot))

    def test_its_own_folder_twice_on_path_runs_the_next_claude_and_keeps_path_whole(self) -> None:
        path = f"{self.own}:{self.own}/:{self.stub_bin}:/usr/bin:/bin"
        seen = self.launch(launcher=self.copy, path=path)
        self.assertEqual((seen["slot"], seen["path"]), (str(self.slot), path))

    def test_a_link_to_the_launcher_runs_the_next_claude_not_itself(self) -> None:
        self.copy.unlink()
        self.copy.symlink_to(LAUNCHER)
        seen = self.launch(launcher=self.copy, path=f"{self.own}:{self.stub_bin}:/usr/bin:/bin")
        self.assertEqual(seen["slot"], str(self.slot))

    def test_hard_links_to_the_launcher_on_path_run_the_next_claude_not_each_other(self) -> None:
        """Review R1 F1: the launcher knows itself by file identity, not by its path's spelling."""
        second = self.home / "second"
        second.mkdir()
        os.link(self.copy, second / "claude")
        seen = self.launch(launcher=self.copy, path=f"{self.own}:{second}:{self.stub_bin}:/usr/bin:/bin")
        self.assertEqual(seen["slot"], str(self.slot))

    def test_a_hard_link_to_the_launcher_at_the_fallback_path_is_not_run(self) -> None:
        """Review R1 F1: with no other claude, the launcher says so and exits 127."""
        fallback = self.home / ".local" / "bin"
        fallback.mkdir(parents=True)
        os.link(self.copy, fallback / "claude")
        env = {k: v for k, v in os.environ.items() if k != SLOT_VAR}
        done = run(self.copy, env={**env, "HOME": str(self.home), "PATH": f"{self.own}:/usr/bin:/bin"})
        self.assertEqual(done.returncode, 127, done.stderr)
        self.assertIn("found no claude", done.stderr)

    def test_a_claude_that_cannot_run_is_passed_over_for_the_next(self) -> None:
        """Review R1 F2: one broken claude on PATH never stops a working one later."""
        for name, text in (("bad-interpreter", "#!/no/such/interpreter\n"), ("bad-format", "not a program\n")):
            with self.subTest(name):
                bad = self.home / name
                bad.mkdir()
                (bad / "claude").write_text(text, encoding="utf-8")
                (bad / "claude").chmod(0o755)
                seen = self.launch(launcher=self.copy, path=f"{self.own}:{bad}:{self.stub_bin}:/usr/bin:/bin")
                self.assertEqual(seen["slot"], str(self.slot))


if __name__ == "__main__":
    unittest.main()
