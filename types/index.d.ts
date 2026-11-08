/** One usage window of a login: percent used, and when it resets (ISO 8601); `isStop` where a stop marked it, not a read. */
export type UsageWindow = { pct: number; resetsAt?: string; isStop?: true }

/**
 * A login's usage as last read, `at` in epoch milliseconds. `fable` is the
 * Fable week, which only the usage endpoint lists: a response never reports it.
 * `noFiveHour` where the usage endpoint listed no 5-hour window: the account
 * has none, as a verified Ultra account, so no stop marks one on it. A view's
 * reading carries it from `View.noFiveHour`; a stored one does not. `by` is the login whose sign-in produced the
 * read; a stored reading without it, or naming another login, is no login's and is not read back.
 */
export type Reading = { fiveHour?: UsageWindow; sevenDay?: UsageWindow; fable?: UsageWindow; noFiveHour?: true; at: number; by?: string; v?: number; src?: ReadingSource }

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

/** A usage check that failed: what failed (a stage and an HTTP status, or the error), and when, in epoch milliseconds. */
export type CheckError = { why: string; at: number }

/**
 * A run of a row's text, and how it is drawn: dim, or as a warning; plain where no tone is named. `used` is a bar's
 * percent used, which colors it by the room left; `shrink` marks the email and the Company, which a narrow pane cuts.
 * `runs` is how `rows` stores a part that holds a time: its text with each time as epoch milliseconds.
 */
export type RowPart = { text: string; tone?: 'dim' | 'warning'; used?: number; shrink?: 'email' | 'company'; runs?: StoredRun[] }

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

/**
 * The rows every session's merge stores under `rows`, for the CLI: each login's lines as runs, when, and the writer's
 * version. A session older than this shape stored each line as one string, its times rendered by the writer.
 */
export type StoredRows = { v: number; at: number; rows: { id: string; lines: StoredRun[][] }[] }

/**
 * When a login's usage is next read, for every session, under `usage-due:<id>`: every usage call goes through it.
 * `next` is when a read is due, `at` when the last good one came, both epoch milliseconds; `fails` counts the failed
 * reads since; `claim` names the session whose read is under way; `retryAfter` is the wait the last failure's
 * Retry-After asked for, in milliseconds; `v` is the writer's version (`WRITER_VERSION`), absent where an older one wrote it.
 */
export type UsageDue = { next: number; fails: number; claim?: string; at?: number; retryAfter?: number; v?: number }

/** Whether a login can serve requests, or why not. */
export type Health =
  | { kind: 'ok'; refreshExpiresAt?: number }
  | { kind: 'login-needed'; why: string }
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
  health: Record<string, Health>
  /** The login this session sends its requests with. */
  activeId: string
  /** Set after a switch until a response shows the new login's usage. */
  pending?: { id: string; from: string; since: number }
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
