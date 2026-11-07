/** One usage window of a login: percent used, and when it resets (ISO 8601); `isStop` where a stop marked it, not a read. */
export type UsageWindow = { pct: number; resetsAt?: string; isStop?: true }

/**
 * A login's usage as last read, `at` in epoch milliseconds. `fable` is the
 * Fable week, which only the usage endpoint lists: a response never reports it.
 * `noFiveHour` where the usage endpoint listed no 5-hour window: the account
 * has none, as a verified Ultra account, so no stop marks one on it. A view's
 * reading carries it from `View.noFiveHour`; a stored one does not.
 */
export type Reading = { fiveHour?: UsageWindow; sevenDay?: UsageWindow; fable?: UsageWindow; noFiveHour?: true; at: number }

/**
 * The 5-hour window a stop marked spent, kept in the store under its own key,
 * `mark:<id>`, which only a stop writes, so no session's save of a reading can
 * erase it. `at` is when the stop came, in epoch milliseconds.
 */
export type Mark = { pct: number; resetsAt: string; at: number }

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
}

/**
 * Who a login's sign-in belongs to, as the profile endpoint answered for the
 * token `token` digests; the plan as Claude Code reads it from the sign-in.
 */
export type Holder = { token: string; who: Pick<Account, 'email' | 'orgId' | 'orgName' | 'plan'> & { email: string } }

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
  health: Record<string, Health>
  /** Who each login's sign-in belongs to: a /login in a session on a login signs in there, whoever it signs in. */
  holders: Record<string, Holder>
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
  /** The line that asks Claude to carry on after a switch for the Fable week, kept across sessions; the mod's own where none is kept. */
  fableContinueText?: string
  /** This session only: a turn died on the Fable week, so the band says when it frees up once every account has used it. */
  isFableStopped?: boolean
  /** This session only: Claude Code's security default refuses switching, as on a Team or Enterprise account. */
  isSwitchBlocked?: boolean
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
