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
printf 'args='; for word in "$@"; do printf '%s:%s;' "${{#word}}" "$word"; done; echo
"""
# The stub for the own login's status read: `claude auth status` logs its argv and the variable's state, then answers
# with AUTH_EXIT and AUTH_TEXT, or hangs with a child of its own when AUTH_HANG is 1. Any other call is STUB's.
AUTH_STUB = f"""#!/bin/sh
if [ "$1" = auth ] && [ "$2" = status ]; then
  echo "$*|${{{SLOT_VAR}-{UNSET}}}" >> "$AUTH_LOG"
  [ "$AUTH_HANG" = 1 ] && {{ sleep 30 & wait; }}
  echo "$AUTH_TEXT"
  exit "${{AUTH_EXIT:-0}}"
fi
""" + STUB.split("\n", 1)[1]
SIGNED_OUT = {"AUTH_EXIT": "1", "AUTH_TEXT": '{"authMethod":"none"}'}
NOT_SIGNED_IN = "not signed in"
# Every option of the launcher's TAKES_ONE, TAKES_MAYBE and TAKES_MANY, named here by hand, so an option dropped
# from a table is a failing test: each takes the next word as its value, never as a subcommand.
VALUE_OPTIONS = (
    "--agent", "--agents", "--append-system-prompt", "--autocompact", "--debug-file", "--effort", "--environment",
    "--fallback-model", "--input-format", "--json-schema", "--max-budget-usd", "--model", "-n", "--name",
    "--output-format", "--permission-mode", "--permission-prompts", "--plugin-dir", "--plugin-url",
    "--remote-control-session-name-prefix", "--session-id", "--setting-sources", "--settings", "--system-prompt",
    "--system-prompt-snapshot",
    "--cloud", "-d", "--debug", "--from-pr", "--prompt-suggestions", "--remote-control", "-r", "--resume", "--teleport",
    "-w", "--worktree",
    "--add-dir", "--allowedTools", "--allowed-tools", "--betas", "--disallowedTools", "--disallowed-tools", "--file",
    "--mcp-config", "--tools",
)


def words(encoded: str) -> list[str]:
    """The words the stub printed as `<length>:<word>;` each, so no word can read as two or two as one."""
    found, i = [], 0
    while i < len(encoded):
        colon = encoded.index(":", i)
        end = colon + 1 + int(encoded[i:colon])
        if encoded[end] != ";":
            raise ValueError(f"not the stub's encoding at {i}: {encoded!r}")
        found.append(encoded[colon + 1:end])
        i = end + 1
    return found


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
        self.assertEqual(words(self.launch("-p", "reply OK", "--settings", "{}")["args"]), ["-p", "reply OK", "--settings", "{}"])

    def test_each_word_reaches_claude_whole_and_apart(self) -> None:
        """Review of #81 and of #83 F1: a space, a delimiter or an empty word never joins or splits words."""
        for given in (["-p", "a b"], ["-p", "a", "b"], ["-p", "a><b"], ["-p", "a:1;b"], ["-p", ""]):
            with self.subTest(given=given):
                self.assertEqual(words(self.launch(*given)["args"]), given)

    def test_an_option_value_that_reads_like_a_subcommand_still_gets_the_pick(self) -> None:
        """Review of #83 F2: every option the launcher's tables list takes the next word as its value."""
        for option in VALUE_OPTIONS:
            with self.subTest(option=option):
                self.assertEqual(self.launch(option, "mcp")["slot"], str(self.slot))

    def test_help_starts_no_session(self) -> None:
        for args in (("-h",), ("--help",), ("mcp", "--help")):
            with self.subTest(args=args):
                self.assertEqual(self.launch(*args)["slot"], UNSET)

    def test_agents_starts_a_session_unless_it_prints_json(self) -> None:
        self.assertEqual(self.launch("agents", "--json")["slot"], UNSET)
        self.assertEqual(self.launch("agents")["slot"], str(self.slot))

    def test_the_value_of_resume_is_not_read_as_a_subcommand(self) -> None:
        for args in (("--resume", "mcp"), ("-r", "auth"), ("--resume",)):
            with self.subTest(args=args):
                self.assertEqual(self.launch(*args)["slot"], str(self.slot))

    def test_a_word_after_a_double_dash_is_an_operand_even_when_it_starts_with_a_dash(self) -> None:
        """`claude -- -x mcp` starts a session: `-x mcp` is the prompt, not an option and a subcommand."""
        self.assertEqual(self.launch("--", "-x", "mcp")["slot"], str(self.slot))
        self.assertEqual(self.launch("--", "mcp")["slot"], UNSET)


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

    def test_no_store_file_starts_on_the_login_and_names_the_store_error(self) -> None:
        (self.home / ".claude" / "plugins" / "store" / STORE).unlink()
        seen = self.launch()
        self.assertEqual(seen["slot"], UNSET)
        self.assertIn("starting on Claude Code's own login: no account-rotator store found", seen["stderr"])


class SystemLogin(LauncherCase):
    def test_a_pick_of_the_login_leaves_both_variables_unset(self) -> None:
        self.write_store(pick="", rows_age_minutes=1)
        seen = self.launch()
        self.assertEqual((seen["slot"], seen["config"]), (UNSET, UNSET))


class AuthStubs:
    """Mixin for a LauncherCase: the stub answers `auth status` and logs each run to a file of the test's folder."""

    def setUp(self) -> None:
        super().setUp()  # type: ignore[misc]
        (self.stub_bin / "claude").write_text(AUTH_STUB, encoding="utf-8")
        self.auth_log = self.tmp / "auth.log"

    def auth_env(self, answer: dict[str, str], hang: bool = False) -> dict[str, str]:
        return {**answer, "AUTH_LOG": str(self.auth_log), "AUTH_HANG": "1" if hang else "0"}

    def auth_runs(self) -> list[str]:
        """One `<argv>|<the variable's state>` per run of `claude auth status`."""
        return self.auth_log.read_text(encoding="utf-8").splitlines() if self.auth_log.exists() else []


def lines_naming_the_login(stderr: str) -> list[str]:
    return [line for line in stderr.splitlines() if NOT_SIGNED_IN in line]


class OwnLoginNotSignedIn(AuthStubs, LauncherCase):
    """No pick stands and Claude Code's own login reads not signed in: one line says so, and claude starts anyway."""

    def setUp(self) -> None:
        super().setUp()
        self.write_store(pick=None, rows_age_minutes=1)

    def test_a_signed_out_own_login_is_named_in_one_line_and_claude_still_starts(self) -> None:
        seen = self.launch("-p", "reply OK", "--settings", "{}", **self.auth_env(SIGNED_OUT))
        named = lines_naming_the_login(seen["stderr"])
        self.assertEqual(len(named), 1, seen["stderr"])
        self.assertIn("Claude Code's own login", named[0])
        self.assertIn("starting on Claude Code's own login: no pick stored", seen["stderr"])
        self.assertEqual(seen["slot"], UNSET)
        self.assertEqual(words(seen["args"]), ["-p", "reply OK", "--settings", "{}"])

    def test_the_read_is_one_status_run_under_the_empty_variable(self) -> None:
        self.launch(**self.auth_env(SIGNED_OUT))
        self.assertEqual(self.auth_runs(), ["auth status|"])

    def test_a_pick_runs_no_status_read(self) -> None:
        """A pick of a slot, and a pick of the own login: the start pays nothing and prints nothing new."""
        for pick in (str(self.slot), ""):
            with self.subTest(pick=pick):
                self.write_store(pick=pick, rows_age_minutes=1)
                seen = self.launch(**self.auth_env(SIGNED_OUT))
                self.assertEqual(lines_naming_the_login(seen["stderr"]), [])
                self.assertEqual(self.auth_runs(), [])

    def test_every_start_without_a_pick_reads_the_status(self) -> None:
        cases = {
            "stale rows": dict(pick=str(self.slot), rows_age_minutes=61),
            "slot folder gone": dict(pick=str(self.home / "gone"), rows_age_minutes=1),
            "store does not parse": dict(pick=None, rows_age_minutes=None, raw="{"),
        }
        for name, store in cases.items():
            with self.subTest(name):
                self.write_store(**store)
                seen = self.launch(**self.auth_env(SIGNED_OUT))
                self.assertEqual(len(lines_naming_the_login(seen["stderr"])), 1, seen["stderr"])

    def test_an_answer_that_is_not_the_signed_out_pair_prints_nothing_new(self) -> None:
        answers = {
            "signed in": {"AUTH_EXIT": "0", "AUTH_TEXT": '{"authMethod":"claude.ai"}'},
            "exit 0 whatever it says": {"AUTH_EXIT": "0", "AUTH_TEXT": '{"authMethod":"none"}'},
            "exit 1 with no JSON": {"AUTH_EXIT": "1", "AUTH_TEXT": "Not logged in"},
            "exit 1 with another method": {"AUTH_EXIT": "1", "AUTH_TEXT": '{"authMethod":"oauth_token"}'},
            "exit 2 with the signed-out text": {"AUTH_EXIT": "2", "AUTH_TEXT": '{"authMethod":"none"}'},
        }
        for name, answer in answers.items():
            with self.subTest(name):
                seen = self.launch("-p", "hi", **self.auth_env(answer))
                self.assertEqual(lines_naming_the_login(seen["stderr"]), [], seen["stderr"])
                self.assertIn("starting on Claude Code's own login: no pick stored", seen["stderr"])
                self.assertEqual(words(seen["args"]), ["-p", "hi"])

    def test_a_status_that_hangs_is_cut_off_and_claude_still_starts(self) -> None:
        began = time.monotonic()
        seen = self.launch("-p", "hi", **self.auth_env(SIGNED_OUT, hang=True))
        self.assertLess(time.monotonic() - began, 10, "the launcher waited out a hung status read")
        self.assertEqual(lines_naming_the_login(seen["stderr"]), [], seen["stderr"])
        self.assertIn("starting on Claude Code's own login: no pick stored", seen["stderr"])
        self.assertEqual((seen["slot"], words(seen["args"])), (UNSET, ["-p", "hi"]))


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

    def test_a_mod_missing_from_the_install_record_starts_claude_on_the_login(self) -> None:
        """No record, a record without the mod, or only a project-scope install: claude still runs, on the login."""
        record = self.home / ".claude" / "plugins" / "installed_plugins.json"
        cases = {
            "no record file": None,
            "the mod not listed": {"plugins": {}},
            "only a project install": {"plugins": {"account-rotator@claude-account-rotator": [
                {"scope": "project", "installPath": str(ROOT)}]}},
        }
        for name, installs in cases.items():
            with self.subTest(name):
                if installs is None:
                    record.unlink(missing_ok=True)
                else:
                    record.write_text(json.dumps(installs), encoding="utf-8")
                seen = self.launch(launcher=self.copy, path=f"{self.own}:{self.stub_bin}:/usr/bin:/bin")
                self.assertEqual(seen["slot"], UNSET)
                self.assertIn("starting on Claude Code's own login", seen["stderr"])

    def test_the_user_install_is_found_wherever_it_stands_in_the_record(self) -> None:
        """Review of #83 F3: a record that lists a project install before or after the user one."""
        record = self.home / ".claude" / "plugins" / "installed_plugins.json"
        project = {"scope": "project", "installPath": str(self.home / "no-such-install")}
        user = {"scope": "user", "installPath": str(ROOT)}
        for entries in ([project, user], [user, project]):
            with self.subTest(first=entries[0]["scope"]):
                record.write_text(json.dumps({"plugins": {"account-rotator@claude-account-rotator": entries}}), encoding="utf-8")
                seen = self.launch(launcher=self.copy, path=f"{self.own}:{self.stub_bin}:/usr/bin:/bin")
                self.assertEqual(seen["slot"], str(self.slot))

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


class OwnLoginNotSignedInOnPath(AuthStubs, InstalledCopy):
    """The installed copy, its folder twice on PATH: the read runs the next claude, once, and never the launcher."""

    def test_the_read_asks_the_next_claude_once_with_its_own_folder_removed(self) -> None:
        self.write_store(pick=None, rows_age_minutes=1)
        path = f"{self.own}:{self.own}/:{self.stub_bin}:/usr/bin:/bin"
        seen = self.launch("--model", "haiku", launcher=self.copy, path=path, **self.auth_env(SIGNED_OUT))
        self.assertEqual(self.auth_runs(), ["auth status|"])
        self.assertEqual(len(lines_naming_the_login(seen["stderr"])), 1, seen["stderr"])
        self.assertEqual((seen["path"], words(seen["args"])), (path, ["--model", "haiku"]))


if __name__ == "__main__":
    unittest.main()
