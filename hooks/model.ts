import type { Account, Fill, FiveHourLimit, FooterStyle, Glyphs, Health, Highlight, Mark, Reading, RotateTo, UsageWindow, View } from '../types'

/** Leave a login once its 5-hour window is this full (percent). */
export const LEAVE_FIVE_HOUR = 90
/** Leave a login once its weekly window is this full (percent). */
export const LEAVE_SEVEN_DAY = 95
/** Warn this long before a login's refresh token runs out. */
export const SIGN_IN_WARN_MS = 3 * 24 * 3600_000

export const DEFAULT_FOOTER: FooterStyle = { session: 'braille', week: 'bars', sessionPercent: true, weekPercent: true, active: 'lines', fill: 'left' }

export const DEFAULT_ROTATE_TO: RotateTo = 'reset'

/** On: a 5-hour window counts where the usage read reports one. Off: only the week and the Fable week count. */
export const DEFAULT_FIVE_HOUR_LIMIT: FiveHourLimit = 'on'

export const EMPTY_VIEW: View = {
  accounts: [],
  readings: {},
  health: {},
  holders: {},
  activeId: '1',
  footer: DEFAULT_FOOTER,
  rotateTo: DEFAULT_ROTATE_TO,
  fiveHourLimit: DEFAULT_FIVE_HOUR_LIMIT,
  hasFontBlocks: false,
}

export const GLYPHS: readonly Glyphs[] = ['bars', 'pie', 'braille', 'none']
export const HIGHLIGHTS: readonly Highlight[] = ['lines', 'tile', 'dim']
export const FILLS: readonly Fill[] = ['left', 'used']
export const ROTATE_TOS: readonly RotateTo[] = ['reset', 'room', 'order', 'off']
export const FIVE_HOUR_LIMITS: readonly FiveHourLimit[] = ['on', 'off']

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)

/** Which login the rotation moves to, as stored; unknown is the default's. */
export function rotateToFrom(value: unknown): RotateTo {
  return isOneOf(value, ROTATE_TOS) ? value : DEFAULT_ROTATE_TO
}

/** Whether the 5-hour window counts, as stored; unknown is the default's. */
export function fiveHourLimitFrom(value: unknown): FiveHourLimit {
  return isOneOf(value, FIVE_HOUR_LIMITS) ? value : DEFAULT_FIVE_HOUR_LIMIT
}

/** How long a 5-hour window runs: a stop's mark with no reset time of its own stands this long. */
export const FIVE_HOUR_MS = 5 * 3600_000

/**
 * A reading as the rules count it. A full 5-hour window with no reset time is
 * the mark a stop left before marks carried one: it stands five hours from its
 * read. A read window with room and no reset time is one not yet started. A mark
 * past its reset time is dropped, as the account reported no window. With the
 * limit off, a 5-hour window the usage read reported is dropped; the mark a stop
 * leaves stays, so the session that hit the stop still moves.
 */
export function counted(r: Reading, limit: FiveHourLimit, now: number): Reading {
  const w = r.fiveHour
  if (w === undefined) return r
  const isOldMark = w.resetsAt === undefined && w.isStop !== true && w.pct >= 100
  const fiveHour: UsageWindow = isOldMark ? { ...w, resetsAt: new Date(r.at + FIVE_HOUR_MS).toISOString(), isStop: true } : w
  const isOver = fiveHour.isStop === true && fiveHour.resetsAt !== undefined && Date.parse(fiveHour.resetsAt) <= now
  if (isOver || (limit === 'off' && fiveHour.isStop !== true)) {
    const { fiveHour: _dropped, ...rest } = r
    return rest
  }
  return fiveHour === w ? r : { ...r, fiveHour }
}

/** The footer's look as stored; any part missing or unknown is the default's. */
export function footerStyleFrom(value: unknown): FooterStyle {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    session: isOneOf(v.session, GLYPHS) ? v.session : DEFAULT_FOOTER.session,
    week: isOneOf(v.week, GLYPHS) ? v.week : DEFAULT_FOOTER.week,
    sessionPercent: typeof v.sessionPercent === 'boolean' ? v.sessionPercent : DEFAULT_FOOTER.sessionPercent,
    weekPercent: typeof v.weekPercent === 'boolean' ? v.weekPercent : DEFAULT_FOOTER.weekPercent,
    active: isOneOf(v.active, HIGHLIGHTS) ? v.active : DEFAULT_FOOTER.active,
    fill: isOneOf(v.fill, FILLS) ? v.fill : DEFAULT_FOOTER.fill,
  }
}

/** A window's percent now: 0 once its reset time has passed. */
export function windowPct(w: UsageWindow | undefined, now: number): number | undefined {
  if (w === undefined) return undefined
  if (w.resetsAt !== undefined && Date.parse(w.resetsAt) <= now) return 0
  return w.pct
}

/**
 * What a login can serve right now, percent of its 5-hour window: a week's
 * percent is a far bigger budget, so the session decides until the week is
 * spent, and then nothing is. Undefined before any 5-hour reading.
 */
export function availableNow(r: Reading | undefined, now: number): number | undefined {
  const five = roomLeft(r?.fiveHour, now)
  if (five === undefined) return undefined
  return (windowPct(r?.sevenDay, now) ?? 0) >= LEAVE_SEVEN_DAY ? 0 : five
}

export function isSpent(r: Reading | undefined, now: number): boolean {
  return (
    (windowPct(r?.fiveHour, now) ?? 0) >= LEAVE_FIVE_HOUR ||
    (windowPct(r?.sevenDay, now) ?? 0) >= LEAVE_SEVEN_DAY
  )
}

/** Whether a login's Fable week is as full as the week is when the rotation leaves it. */
export function isFableSpent(r: Reading | undefined, now: number): boolean {
  return (windowPct(r?.fable, now) ?? 0) >= LEAVE_SEVEN_DAY
}

/**
 * What a move is for, when the 5-hour window and the week are not the reason:
 * the Fable week. A session leaves a login for it only after a turn died on it,
 * so a session that never uses Fable stays where it is.
 */
export type Need = 'fable'

/** Whether the last message of a turn that died on a limit says the limit was the Fable week: the fallback when the usage read does not show it. */
export function isFableStop(text: string | undefined): boolean {
  return /reached your Fable limit/.test(text ?? '')
}

export function shouldLeave(view: View, now: number, need?: Need): boolean {
  const r = view.readings[view.activeId]
  return view.health[view.activeId]?.kind === 'login-needed' || isSpent(r, now) || (need === 'fable' && isFableSpent(r, now))
}

/** When a login's 5-hour window resets, or its week where it reports no 5-hour window, epoch ms; Infinity while none is running. */
function resetOf(r: Reading | undefined, now: number): number {
  const w = r?.fiveHour ?? r?.sevenDay
  if (w?.resetsAt === undefined || (windowPct(w, now) ?? 0) === 0) return Infinity
  return Date.parse(w.resetsAt)
}

/**
 * The signed-in login below both thresholds to move to, as `rotateTo` picks:
 * the one that can serve the most right now (unread counts as fresh); the one
 * whose 5-hour window resets soonest, so room about to refill is used first,
 * the most room breaking ties; or the next in the list after the one in use.
 * With the rotation off, Rotate now takes the one with the most room.
 * For the Fable week (`need`), one whose Fable week is spent is not ready, one
 * with a Fable reading comes before any with none, and the most room means the
 * most Fable room, then the most 5-hour room.
 */
export function pickTarget(view: View, now: number, need?: Need): Account | undefined {
  const isFable = need === 'fable'
  const open = view.accounts.filter(
    a =>
      a.id !== view.activeId &&
      view.health[a.id]?.kind === 'ok' &&
      !isSpent(view.readings[a.id], now) &&
      !(isFable && isFableSpent(view.readings[a.id], now)),
  )
  // A login never read for the Fable week may have none: it is taken only when no read one has room.
  const read = open.filter(a => view.readings[a.id]?.fable !== undefined)
  const ready = isFable && read.length > 0 ? read : open
  // A login with no 5-hour window serves what its week has left.
  const available = (a: Account) => availableNow(view.readings[a.id], now) ?? roomLeft(view.readings[a.id]?.sevenDay, now) ?? 100
  const fableRoom = (a: Account) => 100 - (windowPct(view.readings[a.id]?.fable, now) ?? 0)
  const byRoom = (a: Account, b: Account) => (isFable && fableRoom(a) !== fableRoom(b) ? fableRoom(b) - fableRoom(a) : available(b) - available(a))
  switch (view.rotateTo) {
    case 'room':
    case 'off':
      return ready.sort(byRoom)[0]
    case 'reset': {
      const reset = (a: Account) => resetOf(view.readings[a.id], now)
      return ready.sort((a, b) => (reset(a) === reset(b) ? byRoom(a, b) : reset(a) < reset(b) ? -1 : 1))[0]
    }
    case 'order': {
      const at = view.accounts.findIndex(a => a.id === view.activeId)
      const after = [...view.accounts.slice(at + 1), ...view.accounts.slice(0, at + 1)]
      return after.find(a => ready.includes(a))
    }
  }
}

/**
 * When the soonest spent window among all logins resets, epoch ms; with
 * `need`, only the Fable week counts.
 */
export function nextReset(view: View, now: number, need?: Need): number | undefined {
  const times = view.accounts.flatMap(a => {
    const r = view.readings[a.id]
    // A Fable week holds nothing back until it is spent.
    const fable = isFableSpent(r, now) ? r?.fable : undefined
    return (need === 'fable' ? [fable] : [r?.fiveHour, r?.sevenDay, fable])
      .filter((w): w is UsageWindow => w !== undefined && w.resetsAt !== undefined && (windowPct(w, now) ?? 0) > 0)
      .map(w => Date.parse(w.resetsAt ?? ''))
  })
  return times.length === 0 ? undefined : Math.min(...times)
}

/**
 * What to say when every login's Fable week is spent, the soonest reset
 * included where one is known; undefined while any login has Fable room.
 */
export function fableSpentNotice(view: View, now: number): string | undefined {
  if (view.accounts.length === 0 || !view.accounts.every(a => isFableSpent(view.readings[a.id], now))) return undefined
  const at = nextReset(view, now, 'fable')
  return `Every Claude account has used its Fable week${at === undefined ? '' : `; the next frees up ${untilText(at, now)}`}.`
}

/** Why a turn that died on the Fable week left the session where it was. */
export type StayReason = 'chrome' | 'off' | 'blocked' | 'pending' | 'fable-spent' | 'no-room'

/** Claude Code's own way out of the Fable limit. */
const FABLE_WAY_OUT = 'Run /usage-credits to continue or switch models with /model.'

/**
 * For a Fable stop the rotation did not act on: why, in the order the rotation
 * checks (Connect, rotation off, Claude Code's policy, a switch pending), then
 * no account with Fable room, then no account ready at all, and the words that
 * say it with the way out. Undefined where the session can move. `skip` holds
 * the accounts a switch did not take.
 */
export function fableStay(view: View, now: number, isConnecting: boolean, skip: ReadonlySet<string>): { reason: StayReason; text: string } | undefined {
  const stay = (reason: StayReason, why: string) => ({ reason, text: `Fable limit reached on account ${view.activeId}${why} ${FABLE_WAY_OUT}` })
  if (isConnecting) return stay('chrome', ' while Claude in Chrome connects, so the session stays.')
  if (view.rotateTo === 'off') return stay('off', ', and usage based rotation is disabled, so the session stays. Pick another Move to in the accounts pane.')
  if (view.isSwitchBlocked) return stay('blocked', ", and Claude Code's policy stops this session from switching accounts.")
  if (view.pending !== undefined) return stay('pending', ` while the switch to account ${view.pending.id} is still settling.`)
  const spent = fableSpentNotice(view, now)
  if (spent !== undefined) return { reason: 'fable-spent', text: spent }
  if (pickTarget({ ...view, accounts: view.accounts.filter(a => !skip.has(a.id)) }, now, 'fable') !== undefined) return undefined
  return stay('no-room', ', and no other Claude account can take over now (5-hour window or week full, a sign-in needed, or a switch there that did not take).')
}

function windowFrom(value: unknown): UsageWindow | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { utilization, resets_at } = value as { utilization?: unknown; resets_at?: unknown }
  if (typeof utilization !== 'number') return undefined
  return { pct: utilization, ...(typeof resets_at === 'string' ? { resetsAt: resets_at } : {}) }
}

/** The model names read as Fable: "Fable", "Fable 5", "Fable 5.1". */
const FABLE_NAME = /^fable(\s|$)/i

/**
 * The Fable week from the usage body's `limits` rows: the row of a week scoped
 * to a model named Fable, its percent used 0-100. A row scoped to a surface or
 * to another model is not it.
 */
function fableFrom(limits: unknown): UsageWindow | undefined {
  if (!Array.isArray(limits)) return undefined
  for (const row of limits as unknown[]) {
    if (typeof row !== 'object' || row === null) continue
    const { kind, scope, percent, resets_at } = row as { kind?: unknown; scope?: { model?: { display_name?: unknown } | null } | null; percent?: unknown; resets_at?: unknown }
    const name = scope?.model?.display_name
    if (kind !== 'weekly_scoped' || typeof name !== 'string' || !FABLE_NAME.test(name) || typeof percent !== 'number') continue
    return { pct: percent, ...(typeof resets_at === 'string' ? { resetsAt: resets_at } : {}) }
  }
  return undefined
}

/** A reading from the body of GET /api/oauth/usage. */
export function readingFromUsage(body: unknown, now: number): Reading | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { five_hour, seven_day, limits } = body as { five_hour?: unknown; seven_day?: unknown; limits?: unknown }
  const fiveHour = windowFrom(five_hour)
  const sevenDay = windowFrom(seven_day)
  const fable = fableFrom(limits)
  if (fiveHour === undefined && sevenDay === undefined && fable === undefined) return undefined
  return { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}), ...(fable ? { fable } : {}), at: now }
}

/**
 * A fresh reading with the Fable week the stored one holds, where the fresh
 * body lists none: a body without the row says nothing of the week, and the
 * mark a stop left stands until its reset time passes. A week with no reset
 * time to go by is not kept. A row in the body replaces it.
 */
export function keepFable(fresh: Reading, stored: Reading | undefined, now: number): Reading {
  const kept = stored?.fable
  if (fresh.fable !== undefined || kept?.resetsAt === undefined || Date.parse(kept.resetsAt) <= now) return fresh
  return { ...fresh, fable: kept }
}

/**
 * A reading with the 5-hour window a stop marked spent, until the mark's reset
 * time and no sooner: no read ends a mark, so no order between a reading and a
 * mark matters.
 */
export function withMark(r: Reading | undefined, mark: Mark | undefined, now: number): Reading | undefined {
  if (mark === undefined || Date.parse(mark.resetsAt) <= now) return r
  return { ...(r ?? { at: mark.at }), fiveHour: { pct: mark.pct, resetsAt: mark.resetsAt, isStop: true } }
}

/**
 * The stop mark an older version of the mod left inside a stored reading, as a
 * mark: a window `isStop` marks, or a full one with no reset time, which stands
 * five hours from its read. Undefined when there is none or it has passed.
 */
export function legacyMark(stored: Reading | undefined, now: number): Mark | undefined {
  const w = stored === undefined ? undefined : counted(stored, 'on', now).fiveHour
  return w?.isStop === true && w.resetsAt !== undefined ? { pct: w.pct, resetsAt: w.resetsAt, at: stored?.at ?? now } : undefined
}

/** A stored mark, as the store holds it; anything else is no mark. */
export function markFrom(value: unknown): Mark | undefined {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const isMark = typeof v.pct === 'number' && typeof v.resetsAt === 'string' && typeof v.at === 'number'
  return isMark ? { pct: v.pct as number, resetsAt: v.resetsAt as string, at: v.at as number } : undefined
}

/** How long a Fable week runs: a mark with no reset time of its own stands this long. */
export const FABLE_WEEK_MS = 7 * 24 * 3600_000

/**
 * The mark a Fable stop leaves on a login: its Fable week spent, until the
 * reset time the last read gave, else a week from the stop, so that a check
 * whose usage lists no Fable week cannot end it at once.
 */
export function fableMark(read: UsageWindow | undefined, now: number): UsageWindow {
  return spentMark(read, now, FABLE_WEEK_MS)
}

/** A window marked spent by a stop: until the reset time the last read gave, else `lengthMs` from the stop. */
export function spentMark(read: UsageWindow | undefined, now: number, lengthMs: number): UsageWindow {
  const isAhead = read?.resetsAt !== undefined && Date.parse(read.resetsAt) > now
  return { pct: 100, resetsAt: isAhead ? (read.resetsAt as string) : new Date(now + lengthMs).toISOString() }
}

/** The most characters of the line that asks Claude to carry on. */
const CONTINUE_TEXT_MAX = 500

/** The line that asks Claude to carry on after a Fable switch, as stored: text of at most 500 characters, trimmed; anything else is ignored. */
export function continueTextFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length > 0 && text.length <= CONTINUE_TEXT_MAX ? text : undefined
}

/** A reading from the rate-limit windows the last response reported. */
export function readingFromLimits(
  limits: readonly { kind: string; percentUsed: number; resetsAt?: string }[],
  now: number,
): Reading | undefined {
  const pick = (kind: string): UsageWindow | undefined => {
    const w = limits.find(l => l.kind === kind)
    return w && { pct: w.percentUsed, ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}) }
  }
  const fiveHour = pick('five_hour')
  const sevenDay = pick('seven_day')
  if (fiveHour === undefined && sevenDay === undefined) return undefined
  return { ...(fiveHour ? { fiveHour } : {}), ...(sevenDay ? { sevenDay } : {}), at: now }
}

/** True when two readings agree within a few points on every shared window. */
export function sameUsage(a: Reading | undefined, b: Reading | undefined, now: number): boolean {
  if (a === undefined || b === undefined) return false
  const pairs: [UsageWindow | undefined, UsageWindow | undefined][] = [
    [a.fiveHour, b.fiveHour],
    [a.sevenDay, b.sevenDay],
  ]
  const shared = pairs.filter(([x, y]) => x !== undefined && y !== undefined)
  return (
    shared.length > 0 &&
    shared.every(([x, y]) => Math.abs((windowPct(x, now) ?? 0) - (windowPct(y, now) ?? 0)) <= 3)
  )
}

/** The part of a stored login Claude Code keeps in the keychain (on Linux, a file) that matters here. */
export type Credential = {
  accessToken: string
  expiresAt: number
  refreshTokenExpiresAt?: number
  /** A new sign-in brings a new one. */
  refreshToken?: string
  /** `subscriptionType`, the plan Claude Code reads from the sign-in: on a Team or Enterprise one it keeps plugins from switching. */
  plan?: string
}

export function credentialFrom(text: string): Credential | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // An entry that is not JSON is no usable login: the caller asks for a sign-in.
    return undefined
  }
  const oauth = (parsed as { claudeAiOauth?: unknown } | null)?.claudeAiOauth
  if (typeof oauth !== 'object' || oauth === null) return undefined
  const { accessToken, expiresAt, refreshTokenExpiresAt, refreshToken, subscriptionType } = oauth as Record<string, unknown>
  if (typeof accessToken !== 'string' || typeof expiresAt !== 'number') return undefined
  return {
    accessToken,
    expiresAt,
    ...(typeof refreshTokenExpiresAt === 'number' ? { refreshTokenExpiresAt } : {}),
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
    ...(typeof subscriptionType === 'string' ? { plan: subscriptionType } : {}),
  }
}

/** A login's health from its stored credential alone. */
export function healthOf(cred: Credential | undefined, now: number): Health {
  if (cred === undefined) return { kind: 'login-needed', why: 'not signed in' }
  if (cred.refreshTokenExpiresAt !== undefined && cred.refreshTokenExpiresAt <= now) {
    return { kind: 'login-needed', why: 'sign-in expired' }
  }
  return { kind: 'ok', ...(cred.refreshTokenExpiresAt ? { refreshExpiresAt: cred.refreshTokenExpiresAt } : {}) }
}

/** The percent a glyph or bar fills to and the footer prints: the room left, or what is used. */
export function shown(fill: Fill, leftPct: number): number {
  return fill === 'left' ? leftPct : 100 - leftPct
}

/** Percent of a window still free; undefined when the window has no reading. */
export function roomLeft(w: UsageWindow | undefined, now: number): number | undefined {
  const pct = windowPct(w, now)
  return pct === undefined ? undefined : Math.round(100 - pct)
}

/**
 * The color for a percent of room left: green with all of it, through yellow,
 * to red with none (hue 120 down to 0); lighter while the pointer is over it.
 */
export function roomColor(leftPct: number, isLit = false): string {
  const hue = Math.max(0, Math.min(100, leftPct)) * 1.2
  const [s, l] = [0.75, isLit ? 0.72 : 0.55]
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** A vertical bar for a percentage, an eighth to full height. */
export function bar(pct: number): string {
  return BARS[Math.min(7, Math.max(0, Math.round((pct / 100) * 7)))] ?? '█'
}

const BRAILLE = ['⡀', '⣀', '⣄', '⣤', '⣦', '⣶', '⣷', '⣿']

/** A braille cell filled from the bottom for a percentage, one dot to all eight. */
export function braille(pct: number): string {
  return BRAILLE[Math.min(7, Math.max(0, Math.round((pct / 100) * 7)))] ?? '⣿'
}

const PIES = ['○', '◔', '◑', '◕', '●']

/** A pie for a percentage, empty to full in quarters; a dot when unknown. */
export function pie(pct: number | undefined): string {
  if (pct === undefined) return '·'
  return PIES[Math.min(4, Math.max(0, Math.round(pct / 25)))] ?? '●'
}

/** One login's glyph for a percentage in a footer row's style. */
export function glyph(style: Glyphs, pct: number): string {
  switch (style) {
    case 'bars':
      return bar(pct)
    case 'pie':
      return pie(pct)
    case 'braille':
      return braille(pct)
    case 'none':
      return ''
  }
}

/** A ten-cell bar for the pane, filled by a percentage. */
export function longBar(pct: number | undefined): string {
  if (pct === undefined) return '··········'
  const full = Math.min(10, Math.max(0, Math.round(pct / 10)))
  return '▰'.repeat(full) + '▱'.repeat(10 - full)
}

/** "in 1h 20m", "in 3d 4h": relative, so it needs no time zone. */
export function untilText(at: number | string | undefined, now: number): string {
  if (at === undefined) return ''
  const ms = (typeof at === 'string' ? Date.parse(at) : at) - now
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function label(account: Account | undefined): string {
  if (account === undefined) return '?'
  if (account.email === undefined) return account.id
  return `${account.id} (${account.email}${account.orgName ? ` · ${account.orgName}` : ''})`
}

/**
 * The keychain entry Claude Code keeps a slot's login in. Mirrors Claude Code
 * 2.1.296: the normal login has no suffix; any other slot is suffixed with
 * the first 8 hex digits of the SHA-256 of its directory, NFC-normalized.
 */
export async function keychainItem(slot: string): Promise<string> {
  if (slot === '') return 'Claude Code-credentials'
  return `Claude Code-credentials-${(await sha256(slot.normalize('NFC'))).slice(0, 8)}`
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** A digest of a sign-in's token: tells a new sign-in from the one asked about, without keeping the token. */
export async function fingerprint(token: string): Promise<string> {
  return (await sha256(token)).slice(0, 16)
}

/**
 * The file Claude Code keeps a slot's login in where there is no keychain
 * (Linux): where 2.1.296 puts it for a `claude` child run with `slotEnv`, the
 * normal login's in ~/.claude and any other slot's in its own directory,
 * NFC-normalized. Undefined for the normal login with no home. A session
 * started with CLAUDE_CONFIG_DIR set keeps its normal login in that directory
 * instead, which this misses as `keychainItem` does on macOS.
 */
export function credentialsFile(slot: string, home: string | undefined): string | undefined {
  const dir = slot === '' ? home && `${home}/.claude` : slot
  return dir ? `${dir.normalize('NFC')}/.credentials.json` : undefined
}

/** The environment that points a `claude` child at a slot's login. */
export function slotEnv(slot: string): Record<string, string> {
  return slot === ''
    ? { CLAUDE_SECURESTORAGE_CONFIG_DIR: '' }
    : { CLAUDE_SECURESTORAGE_CONFIG_DIR: slot, CLAUDE_CONFIG_DIR: slot }
}

/**
 * Whether an error is Claude Code's security default refusing the switch: in
 * a session on a Team or Enterprise account, or on a machine with managed
 * settings, it keeps a plugin you install from changing where sign-ins are read.
 */
export function isPolicyRefusal(error: unknown): boolean {
  return String(error).includes('is not for plugins outside policy to change')
}

/** Whether this session reads the normal login, the one `/login` signs in, rather than a slot the mod moved it to. */
export function isOnNormalLogin(view: View): boolean {
  return (view.accounts.find(a => a.id === view.activeId)?.slot ?? '') === ''
}

/**
 * Why switching is blocked, and how to get a session that can switch. One on
 * the normal login started on a Team seat: signing that login in to a personal
 * account fixes the next session. One on a seat reloaded plugins there, or
 * started there, as `/restart` keeps the slot in use; a new session from the
 * terminal starts on the normal login already. `/login` there would sign in
 * the seat instead, as sign-ins follow the slot in use.
 */
export function blockedAdvice(isNormalLogin: boolean): string {
  return isNormalLogin
    ? "Claude Code doesn't let plugins switch accounts in a session that starts on a Team or Enterprise account. " +
        'Fix: /login with your personal (Pro or Max) account, then restart Claude.'
    : "Claude Code doesn't let plugins switch accounts once a session on a Team or Enterprise account starts or reloads plugins. " +
        'Fix: quit Claude and run `claude --continue` or `claude --resume`. Not /restart, which keeps this account.'
}

/** What the mod says once Claude Code's security default refuses switching. */
export function blockedText(isNormalLogin: boolean): string {
  return (
    `Can't switch accounts in this session. ${blockedAdvice(isNormalLogin)} ` +
    'More: https://github.com/ivokund/claude-account-rotator#team-and-enterprise-accounts'
  )
}

/** The MCP server Claude Code runs Claude in Chrome as, and the names of its tools. */
export const CHROME_SERVER = 'claude-in-chrome'
export const CHROME_TOOL = /^mcp__claude-in-chrome__/

/**
 * How many browsers `list_connected_browsers` lists: the Chrome extensions
 * signed in to the account Claude in Chrome connected as. Undefined for an
 * answer that is no list.
 */
export function browsersFrom(text: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.length : undefined
  } catch {
    // Words, not a list: an error, which counts no browsers either way.
    return undefined
  }
}

/** Whether a browser call's error says no browser answered, as Claude Code words it over its bridge or its local socket. */
export function isNoBrowser(text: string): boolean {
  return /Browser extension is not connected|isn't paired with your browser|No Chrome extension connected/.test(text)
}

/**
 * Whether Connect can run in a session: an account is named for the Chrome
 * extension, and the session is on it or free to move there.
 */
export function canConnectChrome(view: View): boolean {
  const own = view.chromeAccountId
  return own !== undefined && view.hasChrome !== false && (!view.isSwitchBlocked || view.activeId === own)
}

/** What brings this conversation back in a new session, which starts on Claude Code's login, free to switch. */
export function resumeCommand(view: View): string {
  return view.sessionId === undefined ? 'claude --continue' : `claude --resume ${view.sessionId}`
}

/**
 * Why Claude is told about Claude in Chrome: a call held back while Connect is
 * under way, or one that found no browser, and then the mod connects it now,
 * or no browser answered there before, or the session can't move to the
 * extension's account, or no account is named for the extension.
 */
export type ChromeNoteKind = 'held' | 'connecting' | 'no-browser' | 'blocked' | 'unset'

/**
 * What Claude reads about Claude in Chrome, in place of Claude Code's advice
 * to /login, which in a session the mod moved signs in the account the
 * session is on: what happens now, and what to tell the user.
 */
export function chromeNote(view: View, kind: ChromeNoteKind): string {
  const named = (id: string | undefined) => {
    const a = view.accounts.find(x => x.id === id)
    return a === undefined ? undefined : `Claude account ${a.id}${a.email === undefined ? '' : ` (${a.email})`}`
  }
  const own = `${named(view.chromeAccountId) ?? 'one account'}, the account the user's Chrome extension is signed in to`
  const as = named(view.chrome?.as)
  const found = as === undefined ? 'Claude in Chrome found no browser.' : `Claude in Chrome connected as ${as} and found no browser.`
  const wait = "End your turn now: you'll get a message once it's connected."
  const noLogin = "Don't suggest /login: it doesn't fix this."
  switch (kind) {
    case 'held':
      return `The account-rotator mod is connecting Claude in Chrome as ${own}, which takes under a minute; browser calls wait until then. ${wait}`
    case 'connecting':
      return `${found} The account-rotator mod is now ${view.chrome?.as === view.chromeAccountId ? 'reconnecting' : 'connecting'} it as ${own}, which takes under a minute. ${wait} ${noLogin}`
    case 'no-browser':
      return (
        `No Chrome extension answers as ${named(view.chromeAccountId) ?? 'that account'}, the account picked for it in the Claude accounts panel: Chrome may be closed, its Claude extension signed in with another email, or its connection stuck. ` +
        "Ask the user to open Chrome and check the email its Claude extension is signed in with. If it is another account, they press Use for Chrome or Try to connect next to it under Chrome in the Claude accounts panel (click the usage under the prompt; under Other accounts if it isn't listed). " +
        (canConnectChrome(view)
          ? `If it matches, they restart Chrome and press Connect above the prompt. You'll get a message once it's connected. ${noLogin}`
          : `If it matches, they restart Chrome, then you try again. ${noLogin}`)
      )
    case 'blocked':
      return (
        `${found} This session can't connect it as ${own}: Claude Code doesn't let this session switch accounts. ` +
        `Tell the user that to use Chrome, they quit Claude Code and run \`${resumeCommand(view)}\` in this terminal, which brings this conversation back with Chrome connected. ${noLogin}`
      )
    case 'unset':
      return (
        `${found} The user's Chrome extension answers only the Claude account it is signed in to, and the account-rotator mod doesn't know which one that is. ` +
        `Ask the user to press Use for Chrome or Try to connect next to it under Chrome in the Claude accounts panel (click the usage under the prompt; under Other accounts if it isn't listed). You'll get a message once it's connected. ${noLogin}`
      )
  }
}

/** The keychain account name Claude Code files its entries under. */
export function keychainUser(user: string | undefined): string {
  return user !== undefined && /^[a-zA-Z0-9._-]+$/.test(user) ? user : 'claude-code-user'
}

/** The first number from 2 up that no login uses yet. */
export function freeId(accounts: readonly Account[]): string {
  const taken = new Set(accounts.map(a => a.id))
  let n = 2
  while (taken.has(String(n))) n += 1
  return String(n)
}

export type Identity = Pick<Account, 'email' | 'orgId' | 'orgName' | 'plan'>

/** Who a slot is signed in as, from `claude auth status --json`; undefined when signed out. */
export function identityFromStatus(stdout: string): Identity | undefined {
  let status: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    status = parsed as Record<string, unknown>
  } catch {
    // Output that is not JSON leaves who it is unknown; the label falls back to the number.
    return undefined
  }
  if (status.loggedIn !== true || typeof status.email !== 'string') return undefined
  return {
    email: status.email,
    ...(typeof status.orgId === 'string' ? { orgId: status.orgId } : {}),
    ...(typeof status.orgName === 'string' ? { orgName: status.orgName } : {}),
    ...(typeof status.subscriptionType === 'string' ? { plan: status.subscriptionType } : {}),
  }
}

/** The same login: one email in one organization. */
export function sameLogin(a: Identity, b: Identity): boolean {
  return a.email !== undefined && a.email === b.email && (a.orgId ?? '') === (b.orgId ?? '')
}

/** A listed login is the account `who` signed in as, as far as it is known: by its email, and its organization once known. */
export function isLoginOf(a: Identity, who: Identity): boolean {
  return a.email !== undefined && a.email === who.email && (a.orgId === undefined || a.orgId === who.orgId)
}

/**
 * Who a token signs in, from the body of GET /api/oauth/profile, which Claude
 * Code asks at a sign-in: email and organization. The plan is the sign-in's own.
 */
export function identityFromProfile(body: unknown): Identity | undefined {
  const field = (value: unknown, key: string) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined)
  const { account, organization } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const [email, orgId, orgName] = [field(account, 'email'), field(organization, 'uuid'), field(organization, 'name')]
  if (typeof email !== 'string' || email === '') return undefined
  return {
    email,
    ...(typeof orgId === 'string' ? { orgId } : {}),
    ...(typeof orgName === 'string' ? { orgName } : {}),
  }
}

/** A Team or Enterprise plan: Claude Code keeps plugins from switching accounts in a session that starts on one. */
export const isSeatPlan = (plan: string | undefined): boolean => plan === 'team' || plan === 'enterprise'

/** A plan as the pane names it: personal Max or Pro, or a Team or Enterprise seat. */
export function planText(plan: string): string {
  switch (plan) {
    case 'max':
      return 'personal Max'
    case 'pro':
      return 'personal Pro'
    case 'team':
      return 'a Team seat'
    case 'enterprise':
      return 'an Enterprise seat'
    default:
      return plan
  }
}

