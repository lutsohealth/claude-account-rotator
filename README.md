# Claude account rotator

A [Claude Code](https://code.claude.com) mod for people with more than one Claude account. It shows each account's usage under the prompt, and moves your session to another account before the one in use runs out.

![The footer up close as the account in use runs low; the session moves to another account and a notice says so; then the panel switches the footer's top row between bars, pies and braille](demo/demo.gif)

<sub>A real session fed imitated accounts (`demo/harness`), so no real account appears.</sub>

## Install

```
/plugin install account-rotator --marketplace ivokund/claude-account-rotator
```

**Turn on auto-update**, or you stay on the version you installed: in `/plugin`, open **Marketplaces**, pick **claude-account-rotator** and choose **Enable auto-update**. Claude Code then updates the mod each time it starts. It is off by default for every marketplace but Anthropic's own.

Then click the usage in the footer, press **+ Add an account** and approve the sign-in in your browser. The account you are signed in with now is account 1.

To update by hand instead, pull the marketplace, then the mod, and start a new session:

```
claude plugin marketplace update claude-account-rotator
claude plugin update account-rotator@claude-account-rotator
```

The [changelog](CHANGELOG.md) says what each version changed.

## The footer

A column per account. The top row is the room it has right now (its 5-hour window, or none once its week is spent), the bottom row its week: green with plenty left, red with little. The percents are the account in use's. An account shows a 5-hour window only where it is known to have one, whatever the **5h limit** row is set to: its usage reported one, or a stop marked one. One whose usage reports none, such as a verified Ultra account, and one not read yet leave their top place blank and have no 5h row in the panel; with no account known to have a 5-hour window, the top row is left out, unless it is the one row with glyphs to show that an account needs a sign-in, and the panel's **5h limit** row too, unless it is set to **off**. A top row of percents alone shows only while the account in use has 5-hour room to show. The demo shows both rows.

Click it, or type `/accounts`, for the panel (`/accounts` again closes it). Each account is two lines, `<email> · <Company> · <Plan>  updated HH:MM`, then `Used <bar> N% Fable <bar> N%  resets Nd Nh Nm`: the percents are what is used, whatever the footer fills with, and the Fable reset shows only where it differs from the week's. A third line shows the 5-hour window where the account has one (**5h –** while the **5h limit** is off). A usage read that failed since the last that worked ends line 1 with its time, **Failed to update**, its cause in brackets (the status the usage or the profile call answered, a usage call that threw, a sign-in whose token has run out, another check that threw), and for a usage read that failed, by an answer or a throw, when it is tried next, as in `18:39 Failed to update (HTTP 429), next try 18:45`, and dims line 2; a run-out token says **until a session refreshes its token**, and a narrow panel shortens the cause (`(429)`, `(waits for a session)`), then the next try, then the company, the email and the plan, so line 1 never wraps; an account that needs a sign-in says **⚠ sign in needed**. On a panel narrower than the two lines and the buttons, the buttons move to the end of line 2, then to a line of their own, and the company, then the middle of the email, shorten. The Fable week shows where its usage lists one, on any plan; on Max and Ultra, which have a separate weekly limit for Fable, **Fable –** while none does, as the week is unknown. The company shows unless the organization is the one named for its own email; the plan by name (Ultra, Max, Pro, Team, Enterprise): the name the account's profile gives, else, on a Max plan, its sign-in's tier, else its plan, with a Max whose usage reports no 5-hour window counted as Ultra; a new sign-in on an account drops the last one's plan, and a sign-in as another account its usage too, and is read at once; **Sign in**, **Use now** and **Remove**, **+ Add an account**, **Rotate now**, **Chrome**, which picks the account Claude in Chrome uses, **Usage based rotation**, which picks the account the rotation moves to, and **Display**, which picks the footer's look:

![The footer's looks. Glyphs: bars, pies or braille. The account in use: between lines, on a tile, or with the rest dimmed. Counting what is used instead of the room left, without percents, or without glyphs. An account that needs a sign-in, one signing in, and the rows' names under the pointer.](demo/looks.png)

## What it does

- **Rotates.** Once the account in use is down to 10% of its 5-hour window, where its usage reports one, or to the week left its **Week** row sets (0% by default, so only a spent week; **-** and **+** step it from 0 to 99), the session moves to another account, and a notice says which and why. **Usage based rotation** in the panel picks which: by default the one whose 5-hour window, or else week, resets soonest, so room about to refill is used before it does; else the one with the most room, or the next in the list; or **disabled**, which leaves switching to you. Its **5h limit** row set to **off** counts no account's 5-hour window, so only the week and the Fable week move the session; **where reported**, the default, counts it where the usage reports one.
- **Recovers.** A turn that still hits a usage limit or a rejected sign-in switches accounts and asks Claude to carry on. An account a plain usage limit stopped counts as spent until its 5-hour window resets. One whose usage reports no 5-hour window, such as a verified Ultra account, or one the weekly limit stopped, counts its week spent until the week resets, and never shows a 5-hour window. A turn that dies in the 35 seconds before a switch lands went out on the account being left: nothing is marked on the one moved to, and the turn carries on there once the switch lands. One that dies later, before any response shows the switch took, marks the one moved to only until the switch ends: a switch that ends with no such response (it gives up, you switch again, or you quit Claude Code) drops that mark, unless another session has marked the account since. A switch the stop itself makes at once keeps it; a plain stop's switch that waits for a token to refresh does not. One that hits the Fable week moves only to an account with Fable room, leaves the 5-hour window alone, and with every Fable week spent stays put and says when the next one frees up, in the band and once through the terminal's notice. The week it marked spent stands until its reset, for every session, whatever lower percent a check of the same week reads, as the usage check can lag the stop: only a check of a new week, one that began after the stop or resets later, ends it early, and a check whose week resets sooner than the mark guessed ends it at that reset. A mark another session drops, as when its switch ends unproven, leaves every session at its next look at the store. A session that never hits the Fable week never leaves an account for it. After a Fable switch the line it sends is `fable-continue-text` in the mod's store, up to 500 characters, sent as your own words; else the mod's own line. Every other switch sends the mod's own line. A Fable switch held back for a token about to refresh still carries on once it lands, a plain one does not. A switch held back stands while the mod's code reloads and through `/clear`, `/resume` and `/branch`, and so does what undoes a stop on an unproven switch. A Fable stop that does not move says why through the terminal's notice, once a session per reason (no other account with room, rotation off, switching blocked, Claude in Chrome connecting, every Fable week spent), with Claude Code's own way out: `/usage-credits`, or `/model`. The carry-on goes out only if the session made no other switch in the 35 seconds before it.
- **Shows what is really in use.** If a switch doesn't take, the footer and panel go back to the old account, and the rotation stops trying the other one for that session. Each account shows only its own usage: a response counts for the account in use only when its week resets at that account's time, which each account has of its own, and accounts whose weeks reset together are read from the usage check alone. A sign-in nobody has confirmed as an account gets no usage at all until it is. When an older version of the mod still runs in another session, the line above the prompt says to restart it.
- **Follows `/login`.** `/login` signs in the account the session is on, which after a switch isn't Claude Code's login. The mod checks who each account's sign-in belongs to: one that now holds another account's asks for its own again, and the session moves off it; one signed in as an account not on the list becomes that account.
- **Picks where new sessions start.** **New on** in **Usage based rotation** picks the account a launcher starts new sessions on: the one with the most room, the first with room, the soonest reset, or one account, else the next after it with room; an account with any limit at 0% left is skipped. `account-rotator-launch` (on the Bash PATH while the mod is enabled; `--help`) prints that account's slot, so `CLAUDE_SECURESTORAGE_CONFIG_DIR="$(account-rotator-launch)" claude` starts there with no switch at all. A plain `claude` still starts on Claude Code's login.
- **Keeps Claude in Chrome working.** Your Chrome extension answers only the account it is signed in to: press **Try to connect** next to it in the panel's **Chrome** box. Each window connects Claude in Chrome as that account when it opens, and the connection stays as the rotation moves the window. When a browser call still finds no browser, the mod reconnects it and tells Claude to carry on. See [Claude in Chrome](#claude-in-chrome).
- **Warns.** When every account is near its limit, a line above the prompt says when the next one frees up. When an account needs signing in again, the same line says so and signs it in with one click.

## Requirements

- macOS, where Claude Code keeps sign-ins in the keychain, or Linux, where it keeps them in files.
- Claude Code 2.1.299 or later, in its fullscreen renderer (`/tui fullscreen`), the only one that passes clicks on: the panel opens with a click.
- Any Mac terminal: Terminal.app, iTerm2, Ghostty, Warp, VS Code; on Linux, one with mouse reporting. In iTerm2 the profile's *Enable mouse reporting* must be on, in tmux `set -g mouse on`, and iTerm2's `tmux -CC` mode can't run fullscreen.
- Claude subscription accounts (tested with Max and Team seats). For sessions that switch, keep your `/login` a personal account, Pro or Max: see [Team and Enterprise accounts](#team-and-enterprise-accounts).

Claude Code's own "You've used N% of your session limit" warning can still show for a minute after a switch: the switch lands within about 35 seconds, and warnings Claude Code queued before it still play. No mod can hide it.

Mods are early access in Claude Code, and this one relies on internals a release can change: where sign-ins are stored, and the usage endpoint behind `/usage`.

## Team and Enterprise accounts

The mod moves between personal accounts and Team or Enterprise seats. But Claude Code stops plugins from switching accounts, for the rest of a session, when:

- **the session started on a Team or Enterprise account**, or
- **plugins reloaded while one was in use**: `/reload-plugins`, or installing, enabling or disabling a plugin (since 2.1.299).

The block comes from a built-in security default that stops plugins you install from changing where Claude Code reads its sign-in. It also runs on any machine with managed settings. The mod tells you when a session is blocked, and marks it in the footer.

Ways around it, best first:

| Way | Rotates | For |
| --- | --- | --- |
| 1. [Start on a personal account](#1-start-on-a-personal-account) | Yes | Anyone with a personal account, Pro or Max |
| 2. [Start on a chosen account](#2-start-on-a-chosen-account) | No: restart Claude to change accounts | When all your accounts are seats |
| 3. [Turn the security default off](#3-turn-the-security-default-off) | Yes, untested | A machine you alone control: read its warning first |

### 1. Start on a personal account

The fix. A session that starts on a personal account can switch, to seats as well. A plain `claude` starts on Claude Code's login, the account whose folder is `~/.claude` itself:

- **`/login` with your personal account (Pro or Max)** in a new session. `/login` changes Claude Code's login only in a session on it; in a session the mod moved, it signs in that account instead. It doesn't unblock the session it runs in: restart Claude after.
- **Add Team seats from the panel**, not `/login`: **+ Add an account**, and **Sign in** to renew.
- **Restart Claude when blocked anyway**, as after a plugin reload on a seat: quit, and run `claude --continue` or `claude --resume` to keep your conversation (or plain `claude`). Each starts on your `/login`. Not `/restart`: it stays on the account in use.

### 2. Start on a chosen account

Not a fix: a session started on a seat this way still can't switch. It only picks the account: with only seats, start on the one the footer shows with room, and restart Claude on another when it runs low.

```sh
CLAUDE_SECURESTORAGE_CONFIG_DIR="$HOME/.claude/accounts/2" claude --continue
```

`2` is the account's number in the footer and the panel; plain `claude` starts on account 1, Claude Code's login. Type the path as here, with no `/` at the end and no `~` in quotes: Claude Code and the mod know the account by its exact text, so any other spelling can start signed out, and shows in the panel as a new account. Set it on the command, not with `export`, or every later `claude` in that shell starts there too. Numbers are reused after **Remove**: check the panel before putting one in an alias.

Started this way on a personal account, a session rotates as in 1, with your `/login` left a seat.

### 3. Turn the security default off

> [!WARNING]
> This removes a security protection for every plugin and every session on the machine. With it off, a plugin you install can override what an organization's policy sets for Claude Code (its hooks, prompt content, settings, tool and MCP server rules) and change where Claude Code reads sign-ins and settings from. Anthropic's [Usage Policy](https://www.anthropic.com/legal/aup) forbids intentionally bypassing restrictions or guardrails built into its products. This is a setting Claude Code offers administrators, but using it so a Team session can switch accounts may count as bypassing. Do it only on a machine you alone control, with plugins you trust. Never do it where an organization manages Claude Code, or where your Team or Enterprise organization's rules forbid it.

Managed settings decide whether the default runs: once they set `prependPlugins`, it runs only if listed there. The file must be owned by an administrator, since Claude Code ignores this key in a file your account can write. If the file below already exists, it holds your organization's policy: leave it alone. Otherwise:

```sh
# macOS
sudo mkdir -p "/Library/Application Support/ClaudeCode"
echo '{ "prependPlugins": [] }' | sudo tee "/Library/Application Support/ClaudeCode/managed-settings.json"

# Linux
sudo mkdir -p /etc/claude-code
echo '{ "prependPlugins": [] }' | sudo tee /etc/claude-code/managed-settings.json
```

It applies to sessions started after. Delete the file to turn the default back on. Managed settings an organization sends from Anthropic's servers can override it.

Untested: this follows how Claude Code 2.1.301 describes and reads the setting, but it has not been tried end to end, and a release can change it. You use it at your own risk.

## Claude in Chrome

The Claude extension in Chrome is signed in to one claude.ai account and answers only Claude Code connections made as that account. Claude Code connects Claude in Chrome at a session's first browser call, as the account the session is on then, and keeps that connection until it drops. With the rotation moving sessions between accounts, that is often not the extension's: Claude Code then says the extension is signed in to a different account and suggests `/login`, which doesn't fix it, and in a session the mod moved signs in the wrong account.

- **Pick the extension's account** in the panel's **Chrome** box. It lists the accounts a Chrome extension answers as: the one this window's Chrome is connected as marked **in use**, the others with **Use for Chrome**. **Other accounts** at the top of the box lists the rest with **Try to connect**, for a Chrome opened on another account; until a browser has answered as any, the box lists them all so. Either press connects Claude in Chrome as that account. Once a browser answers there, that is the account in this window now and in new windows from then on. If none does, Claude in Chrome goes back to the one before, and the account leaves the list until a browser answers as it again. The mod finds out only by connecting, so an account whose Chrome has closed stays listed until it next connects there. With the extension in several Chrome profiles, each signed in to another account, this picks the profile Claude uses.
- **Connected as a window opens.** Claude Code connects Claude in Chrome with the sign-in the window uses, so the mod visits that account: it moves the window there, waits about 35 seconds for Claude Code to read its sign-in, connects by asking Claude in Chrome which browsers answer, and moves the window back. That uses the account's sign-in, not its usage, so it works with none left. Browser calls wait meanwhile, and a prompt that hits that account's usage limit carries on once the window is back. The connection stays as the rotation moves the window.
- **Reconnects by itself.** After sleep or a network change, the connection comes back as the account in use, and the next browser call finds no browser. The mod visits the extension's account again, runs `/mcp reconnect claude-in-chrome`, and once a browser answers tells Claude to carry on. **Connect** above the prompt does the same by hand. While the window visits the extension's account, its line in the panel says **Connecting Chrome…**, not **in use**.
- **Says what's wrong.** When no Chrome extension answers, the panel and the line above the prompt say so: open Chrome and check its Claude extension is signed in with that account's email; if it is, restart Chrome, which reconnects a stuck extension.

A window Claude Code stops from switching can connect only as the account it is on. Where that isn't the extension's, the line above the prompt gives the command that brings the conversation back in a new session, which starts free to switch: `claude --resume <id>`.

## How it works

- Each account you add gets a folder, `~/.claude/accounts/<n>`: the first number from 2 with no account on it and no folder, by **+ Add an account** and `account add` alike, so a sign-in never replaces the one a folder holds, and removing an account leaves its folder, so neither takes that number again. Claude Code keeps its sign-in in the keychain under that folder's name (on Linux, in that folder's `.credentials.json`), as for any config folder. A switch points the session at another account's sign-in.
- Its only network traffic: each account's usage, from the endpoint `/usage` reads, on one schedule that every session of the installed mod shares, so more sessions add no scheduled reads (a `--plugin-dir` session keeps its own, as under [Develop](#develop)): every 10 minutes for an account some session is using, every 30 for the rest, and at once for a new sign-in. After a failed read every session waits the longer of the endpoint's Retry-After and 2 minutes doubling with each failure, at most an hour. An account whose token has run out, with no session on it to refresh the token, is not read: where it holds a last usage, its row says **Failed to update**, and the rotation and **New on** still rank it on that usage until a session refreshes the token. A session on an older version of the mod keeps a schedule of its own: an account only it has read is read on this one too until that session restarts, though a wait it set still stands. Beside the schedule, a usage-limit stop, `/login` or a sign-in reads the account again once its last read is a minute old and no wait stands, and a switch reads each of the two accounts it moves between at most once while it settles. And once per sign-in who it belongs to, from the one Claude Code asks at a sign-in, each with that account's own token. In a session with Claude in Chrome it also asks Claude Code's own Claude in Chrome which browsers answer, as the session opens, before moving off the extension's account, and on **Use for Chrome**, **Try to connect** and **Connect**. Tokens stay where Claude Code keeps them; the mod stores each account's email, organization, plan and last usage, a digest of its token, to tell a new sign-in, and which account your Chrome extension is signed in to.
- Every session also stores each account's row under `rows`, for `account-rotator` (under [From a shell](#from-a-shell)) to read: `<email> · <Company> · <Plan>  updated HH:MM`, then `Used <bar> N% Fable <bar> N%  resets Nd Nh Nm`, then the 5-hour window's line where the account has one. `updated` is the time of the last usage read that worked, whichever session made it; a usage read that failed since puts its time and `Failed to update (HTTP <status>)` in its place, and an account that needs a sign-in says `⚠ sign in needed`. Each time is stored as an instant, which the reader shows on its own clock and in its own zone, so the stored rows change only when a read, a failure or a reset does. A session looks after each of its usage checks and once a minute, each time from what the store holds, and writes `rows` only when its lines differ from the stored ones, with the time it wrote them: they lag another session's read by at most that minute.

## From a shell

`account-rotator account list` prints each account's row as the panel draws it, then when the rows were written and which account new sessions start on (`--help` says the rest). `--json` prints the envelope of Orca's `orca account list --json`, with the mod's own fields for each account; an account with no row stored has `lines` empty and `hasRow` false. It reads the mod's store and never writes it. Like `account-rotator-launch`, it is on the Bash tool's PATH while the mod is enabled; in another terminal, run it from the installed mod's `bin` folder, `~/.claude/plugins/cache/claude-account-rotator/account-rotator/<version>/bin/`. Both read the newest store of the installed mod that holds accounts, or the one `--store` names; a newest one that does not parse, as while a session writes it, stops them with exit 1 and its name, so run again.

The rows are as the last session left them: with no session running, each row's `updated` says how old its usage is. A reset that has passed since reads `passed`, and the last line names the account; the usage beside it is as before the reset, where the panel, which reads the account again, would show the new week. A row an older version of the mod stored prints as that version wrote it, its times as of then, and the last line says so.

`account-rotator account select --account <id, email or system>` sets the account new sessions start on, as **New on** in **Usage based rotation** does: `account-rotator-launch` then prints its slot, or the next account's with room where that one has none, and the command says which. It never writes the store either. It leaves a request in the `account-rotator-requests` folder of the store's Claude config folder, naming the store it read; a session of the mod on that store takes it within a minute, and the command waits for its answer (`--wait`, 90 seconds by default, at most 300). With no session running, or when stopped, it takes the request back and exits 3, or 130. A request or answer left behind, by a command killed or a session that died, stays until the next such command on that store removes it, once past the five minutes a request lasts. A `--plugin-dir` session keeps a store of its own, and so does a throwaway config: pass that store with `--store` to reach its sessions.

`account-rotator account use --account <id, email or system>` moves the session running it, as **Use now** does, under the same rule: only an account signed in, and a switch held back while the token in use is about to refresh, in which case the command says so and exits 0. Claude Code's security policy refusing the switch gives its words and exit 4, and so does Claude in Chrome connecting, which moves the session and back: run it again in a minute. It finds its session by `ACCOUNT_ROTATOR_SESSION`, a mark the mod sets at its start in the environment of its Bash children; with that unset, as in another terminal, it exits 2. Run in the Bash tool's foreground, it is answered while the command runs. Run any other way, such as `!` at the prompt, under a wrapper's name or as a background Bash, that session takes it within a minute, so a `--wait` under 60 can exit 3. No other session applies a `use`.

`account list --json` names, as `thisSessionAccountId`, the account whose slot that process inherited with the mark, as of when it started: a `list` in the same command line as a `use` reads the account before the move, and a child that outlives its session still names the account it inherited.

`account-rotator account rm --account <id or email>` signs an account out and drops it, as **Remove** does, through any session of the mod on that store. It keeps every other account, and picks again where new sessions start. A session on that account moves off first; with no other to take over, or while Claude in Chrome connects, it answers no and exits 4. So does an account that holds another login than the command read, or that shares its sign-in with one that stays. It compares only what the command read: where it read no email, whatever login that slot now holds goes; where it read an email and no organization, so does another organization under that email in that slot. A sign-out that fails keeps the account, and says why, for **Remove** too: an account dropped with its login still signed in would be out of sight. Other sessions on that account are not moved: their next check finds its sign-in gone. Claude Code's own login is not the mod's to remove: `rm` exits 2 and names `claude auth logout`.

`account-rotator account add` signs a new account in, as **+ Add an account** does, in that terminal, because a person approves it in the browser: with no terminal, as in the Bash tool, it exits 2. It makes the next free folder, as under [How it works](#how-it-works). Then a session of the mod on that store lists it within a minute, under the folder's number unless another folder's account has that number. A sign-in approved in the browser is not cheap to repeat, so every way out after it keeps the folder and names it: a sign-in that does not finish (exit 5), no session running (exit 3), a session that refuses (exit 4), a folder or store it cannot read or write (exit 1), stopped (exit 130). `account add --folder <path>` asks again: it takes a folder already signed in, and runs no sign-in. A later `add` takes the next number. A login some account already holds, Claude Code's own among them, answers no and exits 4, and its folder stays signed in with no account on it, so the answer gives the sign-out command [TWIN-LEFT-SIGNED-IN]. A row whose organization no session has read yet counts as that login: ask again once a check has read it. `add` checks for a terminal, not a person: anything running in a terminal passes it.

## Uninstall

Remove each account in the panel, which signs it out. Then run `claude plugin marketplace remove claude-account-rotator`, which uninstalls the mod and deletes what it stored, and delete `~/.claude/accounts`.

## Terms

As of October 2026:

- Neither Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) (October 8, 2025) nor its [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) (June 17, 2025) forbid one person from holding more than one Claude account. The Consumer Terms forbid sharing an account's login details, so add only your own. A Team or Enterprise seat is also under its organization's rules.
- Claude Code's [legal page](https://code.claude.com/docs/en/legal-and-compliance) says the advertised usage limits of Pro and Max assume ordinary, individual usage. It also says Anthropic may enforce its rules on sign-ins and credentials without notice. The mod signs accounts in only through Claude Code's own `claude auth login` and keeps no tokens of its own.
- The Consumer Terms forbid reaching the Services "through automated or non-human means" except with an API key. The mod's scheduled usage checks and its "carry on" prompt after a switch run inside Claude Code, as part of your own session, but judge that for yourself.
- The [Usage Policy](https://www.anthropic.com/legal/aup) forbids intentionally bypassing restrictions or guardrails built into Anthropic's products: read the warning in [Turn the security default off](#3-turn-the-security-default-off) first.

Terms change; this is not legal advice. Not affiliated with or endorsed by Anthropic.

## Develop

```
claude --plugin-dir .     # a session with the mod loaded from this folder
claude plugin validate .
claude plugin test .
python3 -m unittest discover -s tests   # bin/account-rotator and the store pick both bins share
```

`.github/workflows/checks.yml` runs the last three on every pull request and every push to main.

`--plugin-dir` loads this folder over the installed release for that session only, with a list of accounts of its own, so a broken working tree breaks only that window. Keep the marketplace installed from GitHub: added from this folder instead, every window loads the folder as it stands. `/release` publishes a version, by the steps in `.claude/skills/release`.

`demo/record.mjs` records the GIF and `demo/looks.mjs` draws the footer's looks, both from a real session fed imitated accounts; their headers say what they need.

## License

[MIT](LICENSE)
