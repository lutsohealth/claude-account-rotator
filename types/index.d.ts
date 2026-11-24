/**
 * One usage window of a login: percent used, and when it resets (ISO 8601); `isStop` where a stop marked it, not a read.
 * `at`, on a Fable row: when a usage body listed it (epoch ms). A response save refreshes the reading's own `at` and keeps
 * the older body's Fable row, so the row's own time is the one its age is judged on. A row stored before it was kept has none.
 */
export type UsageWindow = { pct: number; resetsAt?: string; isStop?: true; at?: number }

/**
 * A login's usage as last read, `at` in epoch milliseconds. `startedAt` is when a body's request began; a reading
 * without it is treated as begun at `at`. `fable` is the
 * Fable week, which only the usage endpoint lists: a response never reports it.
 * `noFiveHour` where the usage endpoint listed no 5-hour window: the account
 * has none, as a verified Ultra account, so no stop marks one on it. A view's
 * reading carries it from `View.noFiveHour`; a stored one does not. `by` is the login whose sign-in produced the
 * read; a stored reading without it, or naming another login, is no login's and is not read back.
 */
export type Reading = { fiveHour?: UsageWindow; sevenDay?: UsageWindow; fable?: UsageWindow; noFiveHour?: true; at: number; startedAt?: number; by?: string; v?: number; src?: ReadingSource }

/**
 * A usage body read of a login's windows, under its own store key `usage-body:<id>:<read time>:<session mark>`, written once
 * by the body path and never rewritten: counters are compared body to body (the newest of every session's
 * that completed before the request began), never against a response row or a mark, which a stop or another session may have
 * stored between two bodies. `by` is the account identity it was read under (`bodyIdentity`); a body without one is no baseline.
 */
export type BodyRead = { at: number; by?: string; fiveHour?: UsageWindow; sevenDay?: UsageWindow; fable?: UsageWindow }

/**
 * Where a stored reading came from: a usage body (`body`), a response's rate limits (`response`), or a stop that
 * marked a window spent (`stop`). Stored under `usage:<id>` with `v`, the writer's version; `reading:<id>` is an
 * older version's, read only for the stop marks it may carry and to tell that an older version still runs.
 */
export type ReadingSource = 'body' | 'response' | 'stop'

/**
 * The 5-hour window a stop marked spent, kept in the store under its own key,
 * `mark:<id>`, which only a stop writes, so no session's save of a reading can
 * erase it. `at` is when the stop came, in epoch milliseconds.
 */
export type Mark = { pct: number; resetsAt: string; at: number }

/**
 * What a stop's pick of a login rests on, which the carry-on's line follows: the tier it was taken in, the age of the read it
 * was judged on, when a login believed spent frees (epoch ms), and whether a fresh read that lists the Fable week showed room.
 * `isIdle`: the login's token had run out, so nothing reads it until a session refreshes the token.
 */
export type StopProof = { tier: 'fresh' | 'stale' | 'unread' | 'spent-old'; readAgeMs?: number; freesAt?: number; hasFableRoom: boolean; isIdle?: true }

/** A usage check that failed: what failed (a stage and an HTTP status, or the error), and when, in epoch milliseconds. */
/** `isUsageRead`: the usage read itself failed, which runs only once a profile call has named the sign-in. */
export type CheckError = { why: string; at: number; isUsageRead?: true }

/**
 * A run of a row's text, and how it is drawn: dim, or as a warning; plain where no tone is named. `shrink` marks what
 * a narrow pane cuts: the email, the Company and the
 * plan, and a failed read's cause and next try, which take the shorter of their `forms`. `runs` is how `rows` stores a
 * part that holds a time: its text with each time as epoch milliseconds.
 */
export type RowPart = { text: string; tone?: 'dim' | 'warning'; shrink?: 'email' | 'company' | 'plan' | 'cause' | 'next'; forms?: string[]; runs?: StoredRun[] }

/**
 * A run of a stored row line: text, or a time its reader renders at its own clock and zone: `clock` as HH:MM, `until`
 * as the time left until it, both epoch milliseconds.
 */
export type StoredRun = string | { clock: number } | { until: number }

/** A login's row: who it is with the last read's state, its week and Fable week used, then its 5-hour window where it has one. */
export type Row = { id: string; lines: RowPart[][] }

/**
 * A request `account-rotator account select` writes to `<nonce>.json` in the requests folder: new sessions start on
 * login `id`. `store` is the `store-id` of the store the CLI read; `at` is when it wrote the request, epoch ms. The
 * session that applies it writes `<nonce>.result.json`: `{ nonce, ok, message, pickId?, at }`, `pickId` the login new
 * sessions then start on, which is another where `id` has no room. `account use` writes one that moves the session
 * whose mark is `session`, the ACCOUNT_ROTATOR_SESSION it set; its result carries `activeId`, the login that session is
 * on after it, and no other session applies it. `account rm` writes one any session on the store applies, which drops
 * login `id` while it still holds the `slot`, `email` and `orgId` the CLI read; its `pickId` is where new sessions then start.
 */
export type RotatorRequest =
  | { kind: 'select'; nonce: string; at: number; id: string; store: string }
  | { kind: 'rm'; nonce: string; at: number; id: string; store: string; slot: string; email?: string; orgId?: string }
  | { kind: 'use'; nonce: string; at: number; id: string; store: string; session: string }
  | { kind: 'add'; nonce: string; at: number; id: string; store: string; slot: string }
  /** `text` as the file held it: the session judges it, so a malformed one is refused with an answer. Null clears. */
  | { kind: 'continue-text'; nonce: string; at: number; id: string; store: string; text: unknown }

/**
 * The rows every session's merge stores under `rows`, for the CLI: each login's lines as runs, its windows as numbers,
 * and when. A session older than this shape stored each line as one string, its times rendered by the writer.
 * `v` versions the rows: 1 holds lines alone, 2 adds each login's `windows`. It does not version the lines: both shapes
 * of a line carry 1 or 2, so a reader tells them by each line's type. A new line shape takes a new key, as `usage:<id>`
 * did, or versions on one store rewrite each other's rows until the older restarts.
 */
export type StoredRows = { v: number; at: number; rows: { id: string; lines: StoredRun[][]; windows?: StoredWindows }[] }

/** Where a window's number comes from: a read (a usage body, or a response's rate limits), a value kept from an earlier read, or a stop's mark. */
export type WindowSource = 'read' | 'kept' | 'stop'

/** A window's percent used as a row shows it, its source, and when that was read or marked (epoch ms; absent where unknown). */
export type ShownWindow = { pct: number; source: WindowSource; readAt?: number }

/** What a login's stored row says of its week and its Fable week, as numbers, for the CLI's `list --json`. */
export type StoredWindows = { week?: ShownWindow; fable?: ShownWindow }

/**
 * When a login's usage is next read, for every session, under `usage-due:<id>`: every usage call goes through it.
 * `next` is when a read is due, `at` when the last good one came, both epoch milliseconds; `fails` counts the failed
 * reads since; `claim` names the session whose read is under way; `retryAfter` is the wait the last failure's
 * Retry-After asked for, in milliseconds; `startedAt` is when that last good read began; a row without it is treated
 * as begun at `at`, as an older writer's is, and a read counts as since a switch only if it began after it; `v` is the writer's version (`WRITER_VERSION`), absent where an older one wrote it.
 */
export type UsageDue = { next: number; fails: number; claim?: string; at?: number; startedAt?: number; retryAfter?: number; v?: number }

/** Whether a login can serve requests, or why not; `isIdle` where its token has run out, its usage unread until a session refreshes it. */
export type Health =
  | { kind: 'ok'; refreshExpiresAt?: number; isIdle?: true }
  | { kind: 'login-needed'; why: string; at?: number }
  | { kind: 'logging-in'; since: number }

/**
 * One Claude login. `slot` is the credentials directory Claude Code reads it
 * from: '' is the normal login, anything else an absolute directory.
 */
export type Account = {
  id: string
  slot: string
  email?: string
  /** One email can hold logins in several organizations (your Max plan, a Team seat). */
  orgId?: string
  orgName?: string
  /** `subscriptionType` as `claude auth status` reports it: max, team, pro. */
  plan?: string
  /** The plan's name as the profile names it (`organization.plan_display_name`): Ultra. */
  planName?: string
  /** The sign-in's rate-limit tier, its credential's `rateLimitTier`: default_claude_max_20x. */
  tier?: string
}

/** A plan's name, where the mod knows it; a plan word it does not know is drawn as it is. */
export type PlanTier = 'Ultra' | 'Max' | 'Pro' | 'Team' | 'Enterprise'

/**
 * Who a login's sign-in belongs to, as the profile endpoint answered for the
 * token `token` digests; the plan as Claude Code reads it from the sign-in.
 */
export type Holder = { token: string; who: Pick<Account, 'email' | 'orgId' | 'orgName' | 'plan' | 'planName' | 'tier'> & { email: string } }

/** How the footer draws one of its rows: a glyph per login, or not at all. */
export type Glyphs = 'bars' | 'pie' | 'braille' | 'none'

/** How the footer marks the login in use: a dark line down each side of its column, a tile behind it, or the rest dimmed. */
export type Highlight = 'lines' | 'tile' | 'dim'

/** What glyphs and bars fill with: the room a login has left, or what it has used. */
export type Fill = 'left' | 'used'

/**
 * Which login the rotation moves to: the one whose 5-hour window resets
 * soonest, the one with the most room right now, or the next in the list; or
 * none, the rotation off: the session moves only when the person picks.
 */
export type RotateTo = 'reset' | 'room' | 'order' | 'off'

/** Whether a 5-hour window counts where the usage read reports one ('on'), or never ('off'): then only the week and the Fable week do. */
export type FiveHourLimit = 'on' | 'off'

/**
 * Which login new Claude Code sessions start on, as `bin/account-rotator-launch` names it to a launcher:
 * the most room, the first in the list with room, the soonest reset, or one account (`account:<id>`), and the
 * next with room after it when it has none.
 */
export type LaunchOn = 'room' | 'nonzero' | 'reset' | `account:${string}`

/** The login a launcher starts new sessions on, as the mod last picked it: its id and slot, why, and when. */
export type LaunchPick = { id: string; slot: string; why: string; at: number }

/** The footer's look, picked in the pane and kept across sessions. */
export type FooterStyle = {
  session: Glyphs
  week: Glyphs
  /** Whether a row ends with the login in use's percent. */
  sessionPercent: boolean
  weekPercent: boolean
  active: Highlight
  /** Either way the colors go from green with all the room left to red with none. */
  fill: Fill
}

/**
 * Claude in Chrome in one session: the account its connection was made as,
 * where known, and whether a browser answered there; `hasFailed` once a
 * browser call found none, until one is answered again.
 */
export type ChromeLink = { as?: string; isPaired: boolean; hasFailed?: boolean }

/** A run of the footer's text: its color, and the lighter one it takes while the pointer is over the footer. */
export type FooterRun = { text: string; color?: string; lit?: string; backgroundColor?: string; dimColor?: boolean }

/**
 * A stop marked on the login moved to before any response proved the switch (`since`, its start). `writes`: each
 * store key the stop changed, with what stood there once its own usage read was in (`before`, undefined for none)
 * and what it `written`. `setFableStop`: the stop set this session's Fable stop. `readAt`: when its own read was in.
 * Kept only when a settle proves the switch, or a stop's own move leaves it; undone by every other end of the
 * switch: a settle that finds it did not take, a give-up, another switch, the end of the process.
 */
export type ProvisionalStop = {
  id: string
  since: number
  readAt: number
  writes: Record<string, { before: unknown; written: unknown }>
  setFableStop: boolean
}

/** Everything the footer, band and pane draw from. */
export type View = {
  accounts: Account[]
  readings: Record<string, Reading>
  /** Each login's stop mark as last read from the store; absent in a view kept from before marks had their own key. */
  marks?: Record<string, Mark>
  /**
   * Whether each login's usage endpoint last said it has no 5-hour window, kept under its own key,
   * `no-five-hour:<id>`, which only a usage check writes, so no older version's save of a reading drops it.
   */
  noFiveHour?: Record<string, boolean>
  /** Each login's week a stop marked spent, under its own key, `week-mark:<id>`, for the reason `Mark` gives. */
  weekMarks?: Record<string, Mark>
  /** Each login's Fable week a stop marked spent, under its own key, `fable-mark:<id>`, which no save of a reading writes. */
  fableMarks?: Record<string, Mark>
  /** Each login's last usage check that failed, under `check-error:<id>`, until one succeeds: what failed, and when. */
  checkErrors?: Record<string, CheckError>
  /** When each login's last good usage read came, as its schedule `usage-due:<id>` holds it (`UsageDue.at`). */
  readAt?: Record<string, number>
  /** When each login's usage is next read, as its schedule `usage-due:<id>` holds it (`UsageDue.next`); absent while a read is claimed, when `next` is the claim's expiry. */
  nextAt?: Record<string, number>
  health: Record<string, Health>
  /** The login this session sends its requests with. */
  activeId: string
  /** Set after a switch until a response shows the new login's usage. */
  pending?: { id: string; from: string; since: number }
  /** This session only: the switch or point-back running now, by its token; absent while none runs (hooks/model.ts mayWrite). */
  owner?: { token: number }
  /** Account id whose removal waits for a second press. */
  removing?: string
  footer: FooterStyle
  /** Which login the rotation moves to, picked in the pane and kept across sessions. */
  rotateTo: RotateTo
  /** Whether the 5-hour window counts, picked in the pane and kept across sessions. */
  fiveHourLimit: FiveHourLimit
  /** The percent of its week left at which the session leaves the login in use, 0 to 99, picked in the pane and kept across sessions. */
  weekLeave: number
  /** Which login new sessions start on, picked in the pane and kept across sessions. */
  launchOn: LaunchOn
  /** The line that asks Claude to carry on after a switch for the Fable week, kept across sessions; the mod's own where none is kept. */
  fableContinueText?: string
  /** This session only: a turn died on the Fable week, so the band says when it frees up once every account has used it. */
  isFableStopped?: boolean
  /** This session only: Claude Code's security default refuses switching, as on a Team or Enterprise account. */
  isSwitchBlocked?: boolean
  /** This session only: an older version of the mod wrote a reading after this session started, so it still runs somewhere. */
  hasOlderWriter?: boolean
  /** This session only: it was told that the login in use is spent and the session can't leave it. */
  isStuckTold?: boolean
  /** This session only: a usage-limit stop found no login to move to, so it carries on by itself at `at`, when the first login frees up; with no `at`, once one does. `from` is the login in use at the stop; `owedAt`, when it was owed, names it among the debts this session's store marks ended. */
  carryDue?: { at?: number; from?: string; owedAt?: number }
  /**
   * The account the Chrome extension is signed in to, the only one it answers:
   * picked in the pane, or learned when Claude in Chrome paired; kept across sessions.
   */
  chromeAccountId?: string
  /** The accounts a Chrome extension has answered as, kept across sessions: the Chrome box lists them. */
  chromeAccountIds?: string[]
  /** This session only: the Chrome box also lists the accounts no Chrome extension has answered as yet. */
  isChromeOthersShown?: boolean
  /** This session only: whether it has Claude in Chrome, once a call to it told. */
  hasChrome?: boolean
  /** This session only: Claude in Chrome's connection, once made. */
  chrome?: ChromeLink
  /** This session only: Connect is under way, to this account. */
  chromeConnecting?: string
  /** This session's id, which `claude --resume` takes. */
  sessionId?: string
  /** This session only: the mark its Bash children carry in ACCOUNT_ROTATOR_SESSION, which `account use` names it by. */
  sessionMark?: string
  /** This session only: `activeId` is the login this session runs on; the reset of /clear, /resume and /branch clears it. */
  isBound?: boolean
  /** This session only: the switch the refresh guard holds back, tried each minute, kept by a reload; `carry`, a Fable stop's carry-on. */
  held?:{ target: Account; why: string; carry?: { need?: 'fable' }; isRotation: boolean }
  /** This session only: the warning that a credentials file stands beside the keychain login (credentialsFileText), told once and shown in the pane. */
  credentialsNote?: string
  /** This session only: a stop marked on the login moved to before any response proved the switch; a reload keeps it. */
  provisionalStop?: ProvisionalStop
  /** This session only: the footer draws imitated usage, to judge its look. */
  demo?: boolean
  /** This session's terminal draws block characters from its font, short of the line, as Terminal.app does. */
  hasFontBlocks: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'account-rotator': { view: View }
  }
}
