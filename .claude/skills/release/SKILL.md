---
name: release
description: Publish a new version of the account-rotator plugin - pick the version, write its CHANGELOG entry, bump plugin.json, push, tag it with `claude plugin tag`, create the GitHub release, and check that an older install updates to it. Use when asked to release, publish, ship or cut a version.
---

# Release a version

Claude Code updates an installed plugin only when the `version` in `.claude-plugin/plugin.json` changes. Commits pushed without a bump reach new installs only: everyone who installed earlier stays on the commit they got, and `claude plugin update` tells them "already at the latest version". A release is that bump, with its changelog entry, tag and GitHub release. Bump the version nowhere else.

## 1. Check the tree

- On `main`, not behind `origin`: `git fetch origin && git status -sb`. Commits ahead of it go out with the release.
- Nothing uncommitted. Work another session left uncommitted gets a commit of its own first, with a message that says what it does, never folded into the release commit. If that session is still busy (`ListAgents`), ask the user before committing its work.
- `claude plugin test .`, `python3 -m unittest discover -s tests` and `claude plugin validate .` pass.

## 2. Pick the version

The last release is `git describe --tags --abbrev=0 --match 'account-rotator--v*'`. Read `git log <last tag>..HEAD` and pick by semver. While below 1.0:

- **minor** (0.2.0 to 0.3.0): new behavior, or anything a user does differently.
- **patch** (0.2.0 to 0.2.1): fixes and wording only.

Going to 1.0.0 is the user's call: ask.

## 3. Write the changelog entry

Add a section at the top of `CHANGELOG.md`, below its intro, headed with the version and the date:

```
## 0.3.0 - 2026-11-02
```

- Bullets with a bold lead-in, in the README's voice: what a user sees or does, not how the code does it. Most important first.
- Leave out refactors, tests, demo tooling and README-only edits, unless the README change is the point (a new way to do something).
- Name things as the panel and README do: **Use now**, **Usage based rotation**, **Connect**.

## 4. Bump and commit

- Set `"version"` in `.claude-plugin/plugin.json`. The entry in `.claude-plugin/marketplace.json` carries no version: keep it that way, or keep the two equal, since `claude plugin tag` refuses when they differ.
- One commit, `Release 0.3.0`, holding the bump and the changelog entry.

Show the user the version and the entry before publishing, unless they already said to go ahead.

## 5. Publish

Write the entry's bullets to a file in the session's scratchpad, then:

```sh
git push origin main
claude plugin tag . --push -m "account-rotator %s"
gh release create account-rotator--v0.3.0 --verify-tag --title "0.3.0" --notes-file <the bullets file>
```

`claude plugin tag` refuses while anything is uncommitted, checks the versions agree, and makes `account-rotator--v<version>`: the tag form Claude Code reads when someone pins a version range. Never move or reuse a tag; a mistake gets a new patch version.

## 6. Check that an older install updates

In a folder in the session's scratchpad, install the previous release from GitHub and update it:

```sh
T=<scratchpad>/release-check; rm -rf "$T"; mkdir -p "$T"
CLAUDE_CONFIG_DIR="$T" claude plugin marketplace add ivokund/claude-account-rotator
M="$T/plugins/marketplaces/claude-account-rotator"
git -C "$M" fetch -q --unshallow --tags; git -C "$M" reset -q --hard <previous tag>
CLAUDE_CONFIG_DIR="$T" claude plugin install account-rotator@claude-account-rotator
CLAUDE_CONFIG_DIR="$T" claude plugin marketplace update claude-account-rotator
CLAUDE_CONFIG_DIR="$T" claude plugin update account-rotator@claude-account-rotator
```

Expect an update to the new version, and its code under `$T/plugins/cache/claude-account-rotator/account-rotator/<version>/`. Pull the marketplace first: `claude plugin update` pulls it only sometimes (not when it was added or pulled moments before). "Already at the latest version" after the pull means the bump didn't reach GitHub: check `plugin.json` on `origin/main`.

## 7. Say where it is

- Users get it as Claude Code starts once they turn on auto-update (in `/plugin`: **Marketplaces**, **claude-account-rotator**, **Enable auto-update**), which is off by default for this marketplace. By hand, they run `claude plugin marketplace update claude-account-rotator`, then `claude plugin update account-rotator@claude-account-rotator`, then start a new session. Say both ways, in release notes too.
- In an issue the release fixes, link the GitHub release and say which version has the fix.
