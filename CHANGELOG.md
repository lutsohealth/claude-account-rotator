# Changelog

What each version of the account rotator changed. To get each one as Claude Code starts, turn on auto-update: in `/plugin`, open **Marketplaces**, pick **claude-account-rotator** and choose **Enable auto-update**. To update by hand, run `claude plugin marketplace update claude-account-rotator`, then `claude plugin update account-rotator@claude-account-rotator`, and start a new session.

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
