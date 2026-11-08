# Changelog

What each version of the account rotator changed. To get each one as Claude Code starts, turn on auto-update: in `/plugin`, open **Marketplaces**, pick **claude-account-rotator** and choose **Enable auto-update**. To update by hand, run `claude plugin marketplace update claude-account-rotator`, then `claude plugin update account-rotator@claude-account-rotator`, and start a new session.

## 0.5.14-lutso.1 - 2026-11-08

- **`account-rotator account use --account <id, email or system>` moves the session running it from a shell**, as **Use now** does, and says where the session stands. In the Bash tool's foreground it is answered while the command runs; run any other way, within a minute. Outside a session of the mod it exits 2, and no other session applies it. `account list --json` now names the account this session is on. [From a shell](README.md#from-a-shell) has the rest.
- **A switch Claude Code's security policy holds back no longer says it happened.** Under a hold the session stayed where it was while **Use now** and the rotation reported the move; both now show the notice that says switching is refused.
- **`account select` in the Bash tool is answered while the command runs**, not at the session's next minute.

## 0.5.13-lutso.1 - 2026-11-08

- **`account-rotator account select --account <id, email or system>` sets the account new sessions start on from a shell**, as **New on** does, and says which account they really start on: the next with room, where the one you named has none. A session of the mod on that store applies it within a minute. With no session running it exits 3 and takes its request back. [From a shell](README.md#from-a-shell) has the rest.
- **A new sign-in is judged against who the store says holds it.** A session whose view lagged another session's sign-in no longer takes it for a new person and drops that account's usage.

## 0.5.12-lutso.1 - 2026-11-08

- **`account-rotator account list` prints each account's lines from a shell**, as the panel draws them, then when they were written and which account new sessions start on; `--json` prints the envelope of Orca's `orca account list --json`. It reads the mod's store and never writes it. It is on the Bash tool's PATH while the mod is enabled; [From a shell](README.md#from-a-shell) gives the path for another terminal.
- **The rows a tool outside Claude Code reads keep their times as instants**, shown on the reader's own clock and in its zone: sessions in different time zones store the same rows, the rows change only when a read, a failure or a reset does, and a reset that has passed since reads **passed**.
- **`account-rotator-launch` reads the newest store that holds accounts**: a file of the store's name that holds none is skipped, and a newest store that does not parse, as while a session writes it, stops it with exit 1 and the file's name instead of falling back to an older store's pick.
- **A session no longer puts back what another session changed**: the footer's look, the account list, where new sessions start and the Chrome extension's account are written from what the store holds, not from what the session last saw.
- **The store keeps no record per session** of the version it runs, which nothing read.

## 0.5.11-lutso.1 - 2026-11-08

- **Each account in the panel is two lines**: who it is, its Company and plan, then **updated HH:MM**; then **Used** with the week's bar and percent used, the Fable week's, and when they reset. A third line shows the 5-hour window where the account has one (**5h –** while the **5h limit** is off). The account numbers and the separate "its last usage check failed" line are gone: a read that failed ends line 1 with its time and **Failed to update (HTTP 429)**, and an account that needs a sign-in says **⚠ sign in needed** there. The percents are what is used, whatever the footer fills with.
- **The panel opens wide enough for the two lines and the buttons.** On a narrower one, the buttons move to the end of line 2, then to a line of their own, and the company, then the middle of the email, shorten.
- **What a tool outside Claude Code reads from the store follows each usage check at once**, from what every session stored.

## 0.5.10-lutso.1 - 2026-11-08

- **Every session stores each account's row as text, for a tool outside Claude Code to read**: who the account is (email, Company, plan) with **updated HH:MM**, the time of its last usage read that worked, whichever session made it; then its week and Fable week used and when they reset; then its 5-hour window where it has one. A usage read that failed since shows its time and **Failed to update (HTTP 429)** instead, and an account that needs a sign-in says **sign in needed**. A response, or a usage answer that held no usage, no longer counts as a read that worked. The panel draws as before.

## 0.5.9-lutso.1 - 2026-11-08

- **An account shows a 5-hour window only where it is known to have one**: its usage reported one, or a stop marked one. An account not read yet, such as one whose usage check keeps answering HTTP 429, no longer shows an empty **5h** row "no reading yet", and with no account known to have a 5-hour window the footer leaves out its top row and the panel its **5h limit** row (which stays while it is set to **off**, so it can be set on again).
- **A 5-hour window stays known whatever the 5h limit is set to**, including one only a response reported.
- **The footer no longer draws a blank top row** when its glyphs are off and the account in use has no 5-hour window while another does.

## 0.5.8-lutso.1 - 2026-11-08

- **Each account shows its Fable week in the panel**, under its week: how much is left and when it resets, from the account's own usage. On Max and Ultra, which have a separate weekly limit for Fable, an account whose usage lists no Fable week yet shows **Fable –**: unknown, never 0%. Pro, Team and Enterprise show no Fable row unless their usage lists one.
- **A Fable week a stop marked spent stays spent until its reset, for every session**, even when a usage check of the same week reads it lower, as the check can lag the stop. A check of a new week ends it, so a stop just before the week resets no longer holds the next week spent; the week a weekly stop marks works the same way.
- **A mark another session drops leaves every session**, as when its switch ends with no response showing it took: the 5-hour, week and Fable marks, whether an account has a 5-hour window, and its usage. Before, each session kept its own copy until the mark's reset.
- **Another session's real Fable stop is never taken back** when a switch in this session ends unproven.

## 0.5.7-lutso.1 - 2026-11-08

- **Each account shows its plan by name: Ultra, Max, Pro, Team or Enterprise**, where it showed the raw word ("max") or nothing. The name comes from the account's profile, else, on a Max plan, from its sign-in's tier (Max 20x is Ultra), else from its plan, with a Max whose usage reports no 5-hour window counted as Ultra. A plan word the mod does not know shows as it is.
- **An account in the organization named for its own email shows no company**; an account in another organization shows it before the plan.
- **A new sign-in on an account never shows the last one's plan**, so a new Pro or Max 5x sign-in never shows as Ultra. A sign-in as another account also drops the last one's usage, and is read at once. A token refresh keeps the account's reading.

## 0.5.6-lutso.1 - 2026-11-07

- **A usage-limit stop while a switch is still unproven no longer leaves a guess behind.** When the switch ends with no response showing it took (it gives up, you switch again, or you quit Claude Code), the mark it put on the account moved to is dropped, with the 5-hour window and Fable state the stop changed. A mark another session made since stays, and so does one whose switch a response later proves. A switch the stop itself makes at once keeps it.
- **An account a session on an older version keeps reading is read on this version's schedule too**, so its row shows this version's own usage instead of "no reading yet" until that session restarts. Until then both versions read it, each on its own schedule. A wait an older session set after a failed read still stands.
- **A new session no longer reads an account early** just because its schedule came from this version and the account shows no reading yet.

## 0.5.5-lutso.1 - 2026-11-07

- **Each account shows only its own usage.** A response counts for the account in use only when its week resets at that account's time, which each account has of its own. Accounts whose weeks reset together are read from the usage check alone, so two accounts no longer show one account's numbers.
- **A sign-in nobody has confirmed as an account gets no usage at all**, and the panel says why, as in "the profile call answered HTTP 429, so its usage is not read until it names the sign-in". The next check that names it reads its usage.
- **When an older version of the mod still runs in another session**, the line above the prompt says "An older account-rotator still runs in another session; restart it." The line goes once that session has stored no reading for 30 minutes.
- **A usage-limit stop while a switch is still unproven** marks the account a response since the switch names, or none when no response names one alone. With no response since the switch, it marks the account moved to, and drops that mark if the switch turns out not to have taken.

## 0.5.4-lutso.1 - 2026-11-07

- **All your sessions share one usage schedule.** Each account's usage is read once per interval, however many sessions run: every 10 minutes for an account a session is using, every 30 for the rest. More sessions no longer mean more usage calls, so the usage endpoint answers "HTTP 429" far less. Sessions on an older version still read on their own until they restart.
- **A failed usage read waits before it tries again**, for every session. After a 429 every session waits what the endpoint's Retry-After asks, or 2 minutes doubling with each failure, whichever is longer, at most an hour. The panel's failure line names the wait, as in "(retry after 1800 s)". The account keeps its last good reading meanwhile.
- **A usage-limit stop, `/login` or a sign-in reads the account again only once its last read is a minute old** and no wait stands. A switch reads each of its two accounts at most once while it settles.
- **A new sign-in on an account is read at once**, even when the account's last sign-in was read moments before or was waiting after a 429.

## 0.5.3-lutso.1 - 2026-11-07

- **`/accounts` opens and closes the panel.** Type it at the prompt, even while Claude works, to open the panel the footer opens, and again to close it. Where you or another plugin already have an `accounts` command, yours stays yours and `/accounts` is not added.
- **The panel opens and closes as you ask.** When a close or an open did not take, the next press or `/accounts` now does what it says instead of the opposite.

## 0.5.2-lutso.1 - 2026-11-07

- **No 5h row for an account with no 5-hour window.** An account whose usage reports none, such as a verified Ultra account, has no 5h row in the panel and leaves its place in the footer's top row blank. With no 5-hour window on any account, the footer's top row is left out.
- **The footer always shows which account needs a sign-in.** Its mark goes on a row that draws glyphs, whichever rows the panel's **Display** turns off; when no other row would draw them, the top row stays for it.

## 0.5.1-lutso.1 - 2026-11-07

- **Each account shows its own usage.** A session no longer records its usage under another account: not in its first moments, before it knows which account it is on, and not after a switch whose first answers still came from the account it left. An account no longer shows another account's week, and **New on** no longer names a spent account as having the most room.
- **A reading saved by an older version is set aside.** It cannot show which account it belongs to, so the panel shows that account's usage again once its own session or usage check reads it; a 5-hour stop or a spent week marked on it still counts.
- **An account whose usage check fails and that has no reading of its own is never where new sessions start or where the rotation moves.**

## 0.5.0-lutso.1 - 2026-11-07

- **Week** in the panel's **Usage based rotation** box sets how much of its week the account in use has left when the session moves: 0% by default, so only a spent week moves it; **-** and **+** step it from 0 to 99. The line at the top of the panel that stated the rule is gone.
- **New on** in the same box picks the account a launcher starts new sessions on: the most room, the first with room, the soonest reset, or one account, else the next with room. An account with any limit at 0% left is skipped. `account-rotator-launch` prints that account's slot for a launcher. The panel no longer names Claude Code's login.
- **A session-limit stop marks the 5-hour window.** A turn that dies with Claude saying the session or 5-hour limit was hit counts that account's 5-hour window spent, even where its usage reported none.

## 0.4.3-lutso.1 - 2026-11-07

- **A switch no longer overwrites the account it moves to.** A session that started on an account whose sign-in token had run out was moved at once, and the refresh Claude Code then made was saved under the account moved to, which afterwards held the first account's sign-in and asked for its own again. The switch now waits until the token has refreshed, as it already did in the token's last minutes; an account whose sign-in itself has run out is still left at once.
- **A usage check that fails says so.** The account's line in the panel shows why its last usage check failed, until one succeeds.

## 0.4.2-lutso.1 - 2026-11-07

- **An account with no 5-hour window never shows one.** A verified Ultra account's usage reports only a week, and the panel showed it a 5-hour window at 0% left after a usage limit, so every account read near its limit and nothing could rotate. Such an account now takes no 5-hour mark, whatever **5h limit** is set to, and the marks earlier versions left on it count for nothing once this version loads.
- **A new session that starts on a spent account no longer blames the account it moves to.** The session moves at once, but Claude Code sends on the old account for up to 35 seconds; a turn that dies then is the old account's. Nothing is marked on the account moved to, and Claude carries on there once the switch lands, once however many turns died.
- **A weekly limit marks the week.** A turn that dies on the weekly limit, or any limit on an account with no 5-hour window, counts that account's week spent until the week resets, through every later check.

## 0.4.1-lutso.1 - 2026-11-07

- **A usage-limit stop is no longer lost between two sessions.** A session saving an account's usage could erase the stop another session had just recorded on it, and that account then rejoined the rotation early. The stop now has its own record, which no save of usage touches, and it counts until its reset: the 5-hour window's, or five hours where the account reports none.
- **Updating while older sessions still run keeps their stops.** A stop an older version recorded is carried over the first time this version saves that account's usage.

## 0.4.0-lutso.1 - 2026-11-07

- **5h limit** in the panel's **Usage based rotation** box. **where reported**, the default, counts an account's 5-hour window where its usage reports one; **off** counts none, so only the week and the Fable week move the session. The panel's first line says which is in force, and a press applies to every session on the Mac.
- **Accounts that report no 5-hour window, such as verified Ultra accounts, are ranked by their week:** **soonest reset** by the week's reset, **most room** by the week's room. Before, they ranked as if they had all their room, behind every account with a running 5-hour window.
- **A usage limit no longer keeps an account out for good.** An account a plain usage limit stopped counts as spent until its 5-hour window resets, or for five hours where it reports none, and then rejoins the rotation, though no session reads it again.
- **A Fable stop moves only to an account with Fable room**, and leaves the 5-hour window alone. The Fable week it marked spent stands through checks that list no Fable week, until its reset. With every Fable week spent, the session stays put and says when the next one frees up, once through the terminal's notice. After a Fable switch the mod sends `fable-continue-text` from its store, as your own words, where one is kept.

## 0.3.0 - 2026-10-16

- **Other accounts** at the top of the panel's **Chrome** box lists the accounts no Chrome extension is known to answer as, each with **Try to connect**: for a Chrome opened on another account after the window started. The accounts that answer have **Use for Chrome**.
- **A press keeps an account only once a browser answers as it.** If none does, Claude in Chrome goes back to the account picked before, and a toast says what to check. This replaces **Use this account**, which made any account the extension's, and listed it as active, though no browser answered.
- **The box lists every account a browser answered as the last time the mod connected as it,** where before it kept only the one picked. One whose Chrome has closed leaves the list once a press or a new window finds no browser there.

## 0.2.1 - 2026-10-16

- **The Chrome box lists every account until an extension answers,** so you pick the extension's straight away: **Look for Chrome on another account** is gone. Once a browser has answered as an account, the box lists those, and the one picked for it.
- **A window that can't switch accounts says so in the Chrome box,** with the command that brings the conversation back in a session that can: `claude --resume <id>`.

## 0.2.0 - 2026-10-16

Every copy installed before this one said 0.1.0, whatever it held, so `claude plugin update` never offered an update. Updating once brings everything below.

- **Usage based rotation** in the panel picks where the session moves: by default the account whose 5-hour window resets soonest, so room about to refill is used before it does; else the one with the most room, or the next in the list; or disabled, which leaves switching to you.
- **Team and Enterprise seats.** Where Claude Code's security default stops a session from switching, the mod says so once, with why and how to get a session that can switch, marks the footer, and stops trying. **Use now** gives the same answer instead of an error. The README's [Team and Enterprise accounts](README.md#team-and-enterprise-accounts) lists the ways around it, best first.
- **Claude in Chrome stays connected** as the account its extension is signed in to. Pick it with **Use this account** in the panel's **Chrome** box. Each window connects there as it opens, whatever usage that account has left, reconnects by itself after a drop, and **Connect** above the prompt does it by hand. When no extension answers, the panel says what to check.
- **Shows the account really in use.** When responses minutes after a switch still show the old account's usage, the footer and panel go back to it, and the rotation leaves the other account be for the session.
- **Follows `/login`.** An account whose sign-in turns out to be another listed account's asks for its own again, and the session moves off it; one signed in as an account not on the list becomes that account. The panel's second line names Claude Code's own login, and whether it is personal or a Team or Enterprise seat.
- **Linux.** Sign-ins are read from each account's `.credentials.json`, where Claude Code keeps them there.
- **The footer's looks:** bars, pies or braille; the account in use between lines, on a tile or with the rest dimmed; room left or what is used. The panel adds **Rotate now**, notices became toasts, and the footer is the way into the panel: `/accounts` is gone.

## 0.1.0 - 2026-10-12

The first version: each account's usage under the prompt, and a session that moves to another account before the one in use runs out.
