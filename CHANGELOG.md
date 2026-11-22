# Changelog

What each version of the account rotator changed. To get each one as Claude Code starts, turn on auto-update: in `/plugin`, open **Marketplaces**, pick **claude-account-rotator** and choose **Enable auto-update**. To update by hand, run `claude plugin marketplace update claude-account-rotator`, then `claude plugin update account-rotator@claude-account-rotator`, and start a new session.

## 0.5.51-lutso.1 - 2026-11-22

- **After a Claude in Chrome visit that cut a usage-limit stop, the work carries on once, not twice**: where a carry-on is owed for a free login, that carry-on carries the work on, and the visit's own line waits as its backup. The backup looks again each minute while the carry-on is owed or armed. It stands down once a carry-on sent since the visit's end was answered, not dropped or refused. Every carry-on of the session must also have its answer. Otherwise the backup goes, even where that makes two. A reload of the mod's code drops the backup. A visit that connected Claude in Chrome still sends its own line, so two lines can go there (#152, puma-9arph.90).
- **The backup line still goes where nothing shows that the owed carry-on reached the work**: where an older carry-on never got its answer, where only a refresh nudge went since the visit, and where Claude Code dropped the owed carry-on after a later line went (#154, puma-9arph.95, and #155, puma-9arph.100).
- **Not fixed yet after a Claude in Chrome visit that cut a stop**: in two orders of events, this version sends no carry-on where 0.5.50-lutso.1 sent the visit's line, so the stopped work does not carry on. In the first order, an earlier carry-on never gets its answer from Claude Code. Then the owed carry-on goes, a turn of yours starts, a refresh nudge goes, and Claude Code drops the owed carry-on. The visit's line then waits each minute and never goes. In the second order, the owed carry-on goes and waits in Claude Code's queue. The visit's line goes, and the mod holds it back behind that carry-on. Then a turn of yours starts, Claude Code drops the queued carry-on, and the held-back line is lost with it. The mod's tests show both orders, and no real session showed either. A stop-log line for each such visit will show whether a real session loses a carry-on this way (puma-9arph.101, puma-9arph.105). In a third order, the backup goes as a second carry-on: the owed carry-on was answered, but an older one still waits on its answer (puma-9arph.102).
- **Not fixed yet**: a switch whose move of the session Claude Code never answers holds every later stop and the resume. A reload of the mod's code while a switch is held forgets its refresh line, and the minute's retry of a held switch can hold it again after a drop and carry on a second time (puma-9arph.67). A reload in the 35 seconds after a stop's switch lands drops the carry-on it owes, and a reload during a stop drops the Esc for the limit menu (puma-9arph.66). A reload in the moment a carry-on goes can drop it. A second visit that starts and ends while the first one closes can send the carry-on less than 35 seconds after its move back (puma-9arph.93).

## 0.5.50-lutso.1 - 2026-11-20

- **A usage-limit stop with no login left says so once, and the work carries on by itself once a login frees up**: every login tried, or none with room, gives one notice and one stop-log line (`no login left: one carry-on at <time>`, or `once a login frees up` with no reset time known). Once a login's spent limits all reach their reset, the session moves there and carries on, or, on the account in use, carries on 3 minutes after its reset if no turn began since the stop. A second stop before then adds nothing (#112, puma-9arph.35).
- **A switch you make ends that wait**: after **Use now**, `account-rotator account use`, or a later stop's own move, no stray carry-on line goes into the session later. The minute's own rotation and a **Connect** visit leave it owed (#143, puma-9arph.84).
- **A carry-on held back behind another one that waits is no longer lost**: where Claude Code drops or refuses the one that waits, the held one goes once in its place, or after a Claude in Chrome visit open then (#150, puma-9arph.91).
- **A Claude in Chrome visit that fails carries on as one that ends**: the window moves back first, and the carry-on goes 35 seconds after the move back. Where the move back fails too, it goes once on the login visited (#151, puma-9arph.89).
- **The carry-on owed for a free login waits out a Claude in Chrome visit**, and goes at the first check after it ends. Where Claude Code refuses the write that records the wait, the mod writes it again at the next minute's check (#147, puma-9arph.86).
- **A carry-on owed goes once although Claude Code refuses the write that clears it**, and a reload of the mod's code does not owe it again. It is owed once more where Claude Code refused the mod's store write or read too, where the session's Bash calls carry no `$ACCOUNT_ROTATOR_SESSION`, or where that clearing write stays refused over 7 days after the carry-on went (#145, puma-9arph.40).
- **A second stop with no login left is no longer hidden behind the first one's ended wait**, so a reload still owes its carry-on; and a carry-on that a switch armed waits out a Claude in Chrome visit before it goes (#149, puma-9arph.88).
- **A wait that a switch or a press ended is never written back by a late write**, and a read of the wait that fails just after the mod clears it loses no carry-on: it goes at a later check (#148, puma-9arph.87).
- **A switch whose read of the stored sign-in gets no answer in 10 seconds is held, not let go**, and tried again each minute until a read answers; the looks that press Escape after a stop send no key when their fill of the prompt box gets no answer (#144, puma-9arph.74).
- **A terminal notice that gets no answer, or that Claude Code refuses, holds no stop and ends none**: the stop-log line, the move and the carry-on no longer wait for it (#146, puma-9arph.85).
- **Not fixed yet**: a switch whose move of the session Claude Code never answers holds every later stop and the resume; a reload of the mod's code while a switch is held forgets its refresh line, and the minute's retry of a held switch can hold it again after a drop and carry on a second time (puma-9arph.67); a reload in the 35 seconds after a stop's switch lands drops the carry-on it owes, and a reload during a stop drops the Esc for the limit menu (puma-9arph.66); a reload in the moment a carry-on goes can drop it; a second visit that starts and ends while the first one closes can send the carry-on less than 35 seconds after its move back (puma-9arph.93).

## 0.5.49-lutso.1 - 2026-11-18

- **After a usage-limit stop, the Escape that closes the limit menu waits while a prompt is entering, a switch settles or a switch is held**: the look that presses it holds its key while a prompt is still entering, and once its fill of the prompt box answers it reads all three again just before the key, so no Escape goes while any of them holds. The stop log names each reason once a stop (`owed resume: no key, a prompt began entering during the fill`, `... the switch moved during the fill`, `... a switch was held during the fill`) (#141, puma-9arph.81). Proven by tests alone: no stand-in run and no real stop read it, and the flow tests cannot draw the fill's own dialog answer, so no flow test sees that Escape go or held.
- **Not fixed yet**: the switch's own read of the stored sign-in has no 10-second bound (puma-9arph.74); a stop's rejected-sign-in mark is not bound to the token it saw, so a later token's expiry can let a held switch go (puma-9arph.69); a reload of the mod's code during a stop drops the carry-on it owes and the Esc for the limit menu (puma-9arph.66); the minute's retry of a held switch can hold it again after a drop, and its landing can carry on a second time after the first carry-on entered (puma-9arph.67); the Escape that cancels Claude Code's own continue reads once, before its waits, whether a switch is held, and not again just before its key; the two Escapes read their conditions again in code of their own, so a fix to one does not reach the other.

## 0.5.48-lutso.1 - 2026-11-18

- **After a usage-limit stop the work carries on once, also when a background agent's turn comes first**: the Escape that cancels Claude Code's own continue was dropped when a background agent's notification began a turn after the carry-on, and was never armed when such a turn entered the resume, so the work carried on a second time at the old account's reset. The wait for that Escape now starts once the stop's resume answers, whichever turn entered it, and only your own prompt, a new stop, the key or its deadline ends it. No key goes while any prompt is still entering, and the prompt box and the other conditions are read again just before the key (#139, puma-9arph.80). Read in a stand-in at the merged head: a weekly stop whose carry-on a background agent's turn followed carried on once, the Escape going 8 seconds after that turn; not read: a Fable stop, and any stop on a real login.
- **Not fixed yet**: the switch's own read of the stored sign-in has no 10-second bound (puma-9arph.57); a stop's rejected-sign-in mark is not bound to the token it saw, so a later token's expiry can let a held switch go (puma-9arph.69); a reload of the mod's code during a stop drops the carry-on it owes and the Esc for the limit menu (puma-9arph.66); the minute's retry of a held switch can hold it again after a drop, and its landing can carry on a second time after the first carry-on entered (puma-9arph.67); the Escape that closes the limit menu does not read again, just before its key, whether a prompt is entering, a switch settles or a switch is held (puma-9arph.81).

## 0.5.47-lutso.1 - 2026-11-18

- **After a weekly or a Fable stop, the Escape that cancels Claude Code's own continue has a deadline**: the reset of the window the stop judged, plus 45 seconds. Past it the mod sends no key (`own continue: disarmed, past the own continue's deadline` in the stop log). Such a stop marks only its own window, and the deadline read only the 5-hour mark, so after a weekly or a Fable stop it had none (#136, puma-9arph.77). A flow test pins that reset for a weekly, a Fable and a 5-hour stop (#137, puma-9arph.78). Read on Claude Code 2.1.327 in a stand-in at the merged head (puma-9arph.55): a weekly stop with a draft in the box wrote the deadline line 55 seconds after the week's reset, and a weekly stop whose resume entered by a background agent's turn armed no Escape; not read: a Fable stop, a stop where the Escape goes, and any stop on a real login.
- **Not fixed yet**: the switch's own read of the stored sign-in has no 10-second bound (puma-9arph.57); a reload of the mod's code during a stop drops the carry-on it owes and the Esc for the limit menu (puma-9arph.66); the minute's retry of a held switch can hold it again after a drop, and its landing can carry on a second time after the first carry-on entered (puma-9arph.67).

## 0.5.46-lutso.1 - 2026-11-18

- **After a usage-limit stop the work carries on once, not twice**: Claude Code arms its own continue at the old account's reset ("Continuing automatically · Esc to cancel"), and the mod's carry-on did not stop it, so the work carried on a second time at that reset. Once the carry-on's own turn answers, the mod presses one Escape in its Orca pane, only with no turn running, the prompt box empty and that countdown on screen (`own continue` in the stop log) (#134, puma-9arph.71). Read on Claude Code 2.1.327 in a stand-in: a 5-hour stop, a weekly stop near and far from its reset, and a Fable stop near its reset each carried on once; not read: a Fable stop far from its reset, and any stop on a real login (puma-9arph.75). Outside Orca, with a draft in the box, or after a reload of the mod's code, the countdown still continues once more.
- **Not fixed yet**: the switch's own read of the stored sign-in has no 10-second bound; a stop's rejected-sign-in mark is not bound to the token it saw, so a later token's expiry can let a held switch go (puma-9arph.69); a reload of the mod's code during a stop drops the carry-on it owes and the Esc for the limit menu (puma-9arph.66); the minute's retry of a held switch can hold it again after a drop, and can move the session after `account use` ended the hold while no switch ran (puma-9arph.67); after a weekly or Fable stop that Escape has no deadline, as the stop marks the week and not the 5-hour window the deadline reads (puma-9arph.77).

## 0.5.45-lutso.1 - 2026-11-17

- **`account-rotator account use` on the account in use says so when a running switch keeps the session's held switch**: it used to answer that the session already uses that account and exit 0, while the switch could still move the session. It now says a switch is running that may move it, and exits 4: run it again in a minute (#132, puma-9arph.68).
- **Not fixed yet**: the switch's own read of the stored sign-in has no 10-second bound; a stop's rejected-sign-in mark is not bound to the token it saw, so a later token's expiry can let a held switch go (puma-9arph.69); a reload of the mod's code during a stop drops the carry-on it owes and the Esc for the limit menu (puma-9arph.66); the minute's retry of a held switch can hold it again after a drop, and can move the session after `account use` ended the hold while no switch ran (puma-9arph.67).

## 0.5.44-lutso.1 - 2026-11-17

- **A switch held for a token refresh no longer waits hours while no turn runs**: with the prompt box empty, the session sends one line of its own on the account in use 4 minutes before that token runs out. The request refreshes the token, the turn stops on the limit, and that stop lands the switch and carries on (`refresh nudge` in the stop log). A token that runs out unrefreshed gets one more line, never a third, and a draft in the box holds the switch until you send it or clear the box. At the token's expiry, only a rejected sign-in the stop itself saw, or a refresh, lets the held switch go; a check's mark does not (#129, #130; puma-9arph.57, .65, .32, .64).
- **Not fixed yet**: the switch's own read of the stored sign-in has no 10-second bound; a stop's rejected-sign-in mark is not bound to the token it saw, so a later token's expiry can let a held switch go (puma-9arph.69); a reload of the mod's code during a stop drops the carry-on it owes and the Esc for the limit menu (puma-9arph.66); the minute's retry of a held switch can hold it again after a drop (puma-9arph.67); **Use now** on the login in use can clear a held switch while a switch runs (puma-9arph.68).

## 0.5.43-lutso.1 - 2026-11-17

- **A read that hangs while a stop is handled no longer holds a later stop and the resume**: a stop's own read of the account, its stored sign-in, its usage or its profile, with no answer in 10 seconds counts as a failed read. The stop still marks the account, moves and carries on, and the stop log names the read that timed out (`stop read failed: UsageReadTimedOut`, `ProfileReadTimedOut` or `CredentialReadTimedOut`). Every usage and profile read, the scheduled check's too, ends at the same 10 seconds (#127, puma-9arph.59).
- **Not fixed yet**: the switch's own read of the stored sign-in, made to see whether the token in use refreshes soon, still has no bound of the mod's own; a stop's switch held for a token refresh, with no turn running, can land after the bound (puma-9arph.57).

## 0.5.42-lutso.1 - 2026-11-17

- **A resume another turn interrupts or fails is acted on again, and the carry-on goes out once**: when a turn that is not the carry-on's own enters the resume and is then interrupted, fails or dies on a limit, the mod looks again and frees the waiting carry-on, and the new stop's switch sends no second one. The carry-on's own turn is told by its text inside the frame Claude Code puts around a plugin's prompt, so when it dies on a limit the next login gets a carry-on of its own. A carry-on refused or dropped while another turn runs is not brought back. The stop log says how each such entry ended (`resume ended`) (#125, puma-9arph.60).
- **Not fixed yet**: a usage or profile read that hangs while a stop is handled holds a later stop and the resume (puma-9arph.59); a stop's switch held for a token refresh, with no turn running, can land after the bound (puma-9arph.57). A prompt you type that holds the carry-on's whole text reads as the carry-on's own turn: if it is interrupted, the waiting carry-on waits for you. An interrupted carry-on turn, and the look again after an interrupted entry, are proven by tests alone.

## 0.5.41-lutso.1 - 2026-11-17

- **After a usage-limit stop the session moves to a login read lately and carries on with no person**: the mod moves first to a login whose usage read is under 35 minutes old and shows room, then to one read earlier, one never read, and last one spent, never to one this stop's recovery already died on. Every 15 seconds it looks whether the carry-on still waits under Claude Code's limit menu with no turn of any agent running, and presses Escape in the session's own Orca pane so the resume enters, also when another agent's turn was open at the stop. The stop log names each step (#123, puma-9arph.54).
- **Not fixed yet**: a resume whose entering turn ends in an error is not acted on again and waits for you (puma-9arph.60); a usage or profile read that hangs while a stop is handled holds a later stop and the resume (puma-9arph.59); a stop's switch held for a token refresh, with no turn running, can land after the bound (puma-9arph.57). The look again after an entry that is interrupted is proven by a test alone.

## 0.5.40-lutso.1 - 2026-11-17

- **A Fable stop is read as the Fable week in every wording Claude Code uses**: Claude Code 2.1.325 and later says "hit your Fable limit", where the mod knew only "reached your Fable limit", so such a stop marked the login's whole week spent and moved the session without looking for a login with Fable room. It now moves to a login with Fable room, marks only the Fable week and says so in the stop log, as it did before (#121, puma-9arph.56).

## 0.5.39-lutso.1 - 2026-11-17

- **The mod keeps an installed launcher copy current**: at a session's start it replaces `~/.claude/accounts/bin/claude` with the mod's own `bin/account-rotator-claude` when their bytes differ, through a temporary file that it reads back and tests for execute before the rename. It never makes a copy where none stands and never replaces a link; a failure leaves the old copy and is one debug line (#119, puma-9arph.26).

## 0.5.38-lutso.1 - 2026-11-17

- **A plain `claude` with no launch pick says on stderr when Claude Code's own login reads not signed in**: where the launcher starts `claude` on that login for want of a pick, one more line names the login as not signed in and says to type `/login`, so a start with no login says why. The `claude` still starts (#116, puma-9arph.50).
- **The signal tests pass when a gate starts with `&`**: such a gate runs with SIGINT ignored, so the tests now give themselves the default SIGINT (#117, puma-9arph.44).

## 0.5.37-lutso.1 - 2026-11-16

- **A login Claude Code does not count as signed in says ⚠ sign in needed, and New on passes it over**: each check asks Claude Code (`claude auth status`) whether the login is signed in, so `account-rotator-launch` and the launcher no longer start new sessions on a login whose sign-in Claude Code no longer counts, until it is signed in again (#114, puma-9arph.48).

## 0.5.36-lutso.1 - 2026-11-16

- **A login whose sign-in Claude Code rejected stays passed over by New on** until a new sign-in or a usage read that works, so `account-rotator-launch` and the launcher no longer start new sessions on it (#110, puma-9arph.42).
- **Two switches never run at once.** While one runs, a rotation that carries nothing starts none, a stop's move rides it and carries on once, and a press or a Claude in Chrome visit waits for it, at most 30 seconds, then takes the switch over. The session's login follows the footer again within a minute, and where that write fails, the footer names the account the session is on (#108, puma-9arph.38, .39 and .41).
- **A switch made as a session starts keeps the session on the account the footer shows**: the start's own check, landing after the switch, no longer puts the session back on the account it started on (#109, puma-9arph.41).
- **After a rejected sign-in the mod presses no Escape**: only a usage-limit stop, which raises Claude Code's limit menu, arms it (#111, puma-9arph.36).

## 0.5.35-lutso.1 - 2026-11-16

- **A usage-limit stop whose own read of the account fails still moves the session and carries on**: a usage or profile call left unanswered, or a store write refused, no longer drops the stop. The account is marked, the session moves and carries on, and the stop-log says `stop read failed`. A fault in Claude Code's own store or hooks outside that read still ends the recovery, and the stop-log says `stop handling failed`.

## 0.5.34-lutso.1 - 2026-11-16

- **After a usage-limit stop, the carry-on Claude Code's menu holds gets one Escape** in the session's own Orca pane, so the session carries on by itself: once, 5 seconds after the carry-on went, only while no turn runs and a dialog holds the prompt box, never after a rejected sign-in. Outside Orca the carry-on waits for your own Esc.
- **A stop whose switch waits for a token refresh carries on once the switch lands**, whatever the stop, where only a Fable stop did. **Each session writes a stop-log** to the mod's store under `stop-log:<session mark>`: what each stop did, with logins by id and no token, email or prompt text.
- **An account whose usage read failed is still moved to**, after every account that shows room, where it was passed over; one whose sign-in no check has named yet is still passed over.

## 0.5.33-lutso.1 - 2026-11-15

- **The usage lines line up whatever the plan**: a plan with no Fable week keeps those cells blank, and **5h** stands as wide as **Used**, so every bar and every `resets` stand at one column on Pro, Max and Ultra rows and on the 5-hour line, a dash for an unread percent included.
- **No text names an account by a bare number or a "?"**: a switch to an account another session removed meanwhile names it in its notices, and the launch pick and a request answer say `account <id>` for an account not on the list.
- **Two accounts with no email stored are two logins**, where they read as one, and an account whose stored email is not text reads "not signed in yet", where its row could not be drawn.

## 0.5.32-lutso.1 - 2026-11-15

- **The panel names each account by its email**, plus its organization only when that email is on more than one account, where it named them by number: the rows, **New on**, the **Chrome** box, toasts, bands, `account-rotator account list` and `account-rotator-launch`.
- **The usage lines line up, and their bars carry no color**: a percent takes three cells, so Fable and resets stand at one column from 0% to 100%. A failed row stays dim; the footer under the prompt keeps its colors.
- **A Fable limit hit just after a switch, or while Claude in Chrome connects, no longer marks the account switched to as spent**: the session carries on once the switch lands. A read 30 minutes after a Fable mark that shows the same week below 100% ends the mark, where a wrong mark stood until the reset.
- **An idle account whose sign-in has run out reads `updated HH:MM · idle`**, where it read Failed to update, and a token refresh keeps a usage back-off that still stands, where the next read went out at once.
- **A sign-in rejected just after a switch no longer marks the account switched to as needing a sign-in**, unless a response proved the switch; one marked on a switch that does not take is given back when the switch ends.
- **No window opens on a spent account to connect Claude in Chrome**; **a window that can't switch says what to do** once its account runs out (`/stop`, then `claude --resume <id>`); and **Cancel** ends a sign-in as not finished, not with a TypeError. These come from upstream 0.3.1, 0.3.2 and ivokund#3.

## 0.5.31-lutso.1 - 2026-11-14

- **A plain `claude` can start on the account New on picks**: `bin/account-rotator-claude`, copied as `claude` into a folder ahead of Claude Code's own on PATH, starts every plain `claude` (a terminal, a script, Orca's background actions) on that pick while a session of the mod wrote the store's rows in the last 60 minutes, else on Claude Code's login. A `CLAUDE_SECURESTORAGE_CONFIG_DIR` already set wins, and an empty one starts on Claude Code's login. Install and undo: README, **Picks where new sessions start**.

## 0.5.30-lutso.1 - 2026-11-12

- **A switch waiting for the token in use to refresh says so on the row of the account it goes to**, where it said so only in a short notice and **Use now** looked like a dead button; and **Use now waits while Claude in Chrome connects**, as `account use` does, where the connection's visit moved the session back unsaid.

## 0.5.29-lutso.1 - 2026-11-12

- **A switch stays made when an older switch gives up meanwhile**: after **Use now** or `account use`, the session no longer goes back a minute later to the account it left two switches before.
- **The Chrome box no longer marks an account in use when Claude in Chrome lists no browser**: `list_connected_browsers` answering an empty list leaves Chrome unpaired, lists no account and moves no window; Connect stays a press away.
- **Try to connect and Connect find a paired browser again when Claude in Chrome adds a note after its list of browsers**, where the answer read as failed, the account never became the Chrome one, and an empty list with a note marked Chrome in use.

## 0.5.28-lutso.1 - 2026-11-12

- **A Fable stop stays known through `/clear`, `/resume` and `/branch` after the mod's code reloads**, where the session forgot it.
- **A session whose start failed once still stores the usage each response reports, and takes `account use` while its Bash call runs**, where it did neither until the session ended.
- **The Chrome box keeps how Claude in Chrome stands through `/clear`, `/resume` and `/branch`**: a window without it still says so and offers no Connect, one connected still shows the account in use, and Try to connect after it reconnects Claude in Chrome, where another account's browser answered and the extension was named as the wrong account.

## 0.5.27-lutso.1 - 2026-11-11

- **`account-rotator continue-text --set "<text>"` sets the line a session sends after a Fable switch, and `--clear` clears it**, through a session of the mod as `account select` does, where nothing but a hand edit of the store could. A text empty or over 500 characters once trimmed is refused, by the command and by the session, which count an emoji as one character.
- **A request file a session cannot read is answered no**, as one that does not parse or is over 4096 bytes, so its command exits 4 at once, where it waited out `--wait` and exited 3.
- **A switch still unproven goes on through `/clear`, `/resume` and `/branch`**: a usage-limit stop marked during it is given back if the switch does not take, where the mark used to stay on the account until its reset, and a switch held back for a token refresh is still made when the refresh lands.
- **Soonest reset counts a window at 0% used by its reset time**, where its usage gives one, for the account new sessions start on and for the rotation, where an account at 0% used came after every account whose window was running: a week runs, and resets, whether it is used or not. A reset time that does not parse counts as none.
- **New on starts no session on an account the rotation would leave at once**, by the most room, the first with room or the soonest reset, while another account stays below the line: a week down to the **Week** row's line, or a 5-hour window at 90%. With every account past it, the pick is as before. A named account is not passed over.

## 0.5.26-lutso.1 - 2026-11-11

- **After `/clear`, `/resume` or `/branch` the panel marks the account the session runs on**, where it marked account 1. The session's mark for `account use` comes back too, and so do Terminal.app's block drawing, the notice that Claude Code's policy refuses switching, and the band after a Fable stop. A check in the moment after the command no longer switches away from the account the session runs on, and an `account rm` then no longer signs out that account. A session whose start could not read the accounts list rotates again at its next check.

## 0.5.25-lutso.1 - 2026-11-11

- **A row that failed to update says why**, as `18:39 Failed to update (HTTP 429), next try 18:45`, where it used to say only `Failed to update`. The cause names the status the usage or the profile call answered, a usage call that threw, a sign-in whose token has run out (which says `until a session refreshes its token`), or another check that threw. Only a usage read that failed, by an answer or a throw, names its next try, the time its schedule gives; the other causes name no time, as nothing stored says when they are tried again. A login whose usage read failed and that has no reading says it waits for a session once its token runs out, where it kept a next try nothing would take. A narrow panel shortens the cause, then the next try, then the company, the email and the plan, so each account stays two lines.
- **The start lines of `account-rotator-launch` and `account-rotator account list` say `the same pick since 14:02`**, the time the pick last changed in your zone, where they said `picked 20 min ago` about a pick the mod checks again each minute.

## 0.5.24-lutso.1 - 2026-11-11

- **An idle account whose sign-in has run out says Failed to update**, where its row used to show its last update's time as if it were current. The usage it shows is from that last update.

## 0.5.23-lutso.1 - 2026-11-08

- **A usage-limit stop during an unproven switch can still be given back after the mod's code reloads**, where its mark used to stay on the account until its reset.

## 0.5.22-lutso.1 - 2026-11-08

- **A usage-limit stop during an unproven switch no longer leaves an account marked spent by mistake** when you press **Use now** while its usage is being read. The mark goes back at your next switch, as it does in every other case.

## 0.5.21-lutso.1 - 2026-11-08

- **A switch held back for a token about to refresh stands while the mod's code reloads**, where it used to be lost after you were told "in a few minutes". It is tried at each minute's check until it goes.

## 0.5.20-lutso.1 - 2026-11-08

- **The demo harness refuses to store a real usage reading under any key**, by the reset times it hands out. A demo recording shows imitated usage only.
- **The stored rows' version number is documented as not versioning the line shape**: a reader tells a line's shape by its type, and a new shape takes a new key.

## 0.5.19-lutso.1 - 2026-11-08

- **A shell command now removes request files a killed command or a dead session left**, once past the five minutes a request lasts. A file of another shape stays.
- **An oversized or odd file in the requests folder is skipped unread** and logged once, in the debug log.
- **A requests folder that cannot be read is logged once**, and again only after it has read again.

## 0.5.18-lutso.1 - 2026-11-08

- **+ Add an account never signs in a folder that exists**, so it never replaces a sign-in. It and `account add` pick a folder by one rule: the first number from 2 with no account on it and no folder. Removing an account leaves its folder, so neither takes that number again.
- **A sign-in from the panel now refuses a login some account may already hold** by the rule `account add` uses: a row whose organization no session has read yet counts as that login, so sign in again once a check has read it.
- **A new account wears nothing an earlier account under its number left**, from **+ Add an account** and from a session started on a folder nobody listed.

## 0.5.17-lutso.1 - 2026-11-08

- **`account-rotator account list --json` gives an account with no row stored empty `lines` and `hasRow` false**, where `lines` held a placeholder. Every other account has `hasRow` true. The plain `list` still says so in words.
- **A refused read or write of the store's `store-id` no longer stops a session's minute:** it still settles a switch and checks its accounts, a session started then still boots, and the next minute tries again.

## 0.5.16-lutso.1 - 2026-11-08

- **`account-rotator account add` signs a new account in from a terminal**, as **+ Add an account** does: you approve it in the browser, and a session of the mod on that store lists it within a minute. With no terminal, as in the Bash tool, it exits 2. It only ever signs in a new folder under `~/.claude/accounts`, so it never replaces a sign-in. [From a shell](README.md#from-a-shell) has the rest.
- **A sign-in you approved is not lost:** every way out after it keeps the folder and names it, a failed sign-in (exit 5) too, and `account add --folder <path>` asks again. A later `add` takes the next number.
- **A login some account may already hold is refused**, Claude Code's own among them, and exits 4. A row whose organization no session has read yet counts as that login: ask again once a check has read it. The refused folder stays signed in with no account on it, and the answer gives the sign-out command.
- **Remove and `account rm` now drop one list of an account's stored values, and `add` drops the same list**, so a new account never shows what an earlier account under that number left. The panel's **+ Add an account** does not drop it yet.

## 0.5.15-lutso.1 - 2026-11-08

- **`account-rotator account rm --account <id or email>` signs an account out and drops it from a shell**, as **Remove** does, through any session of the mod on that store, and says where new sessions start now. It refuses Claude Code's own login, and an account that holds another login than the command read, as far as it read one: where it read no email, whatever login that slot now holds goes; where it read an email and no organization, so does another organization under that email in that slot. [From a shell](README.md#from-a-shell) has the rest.
- **A sign-out that fails now keeps the account, for Remove too**, and says why. Remove used to drop the account anyway, with its login still signed in and out of sight.
- **Remove now says so where it would have reached too far:** while Claude in Chrome connects, or where the account shares its sign-in with another that stays, it tells you and removes nothing.

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
