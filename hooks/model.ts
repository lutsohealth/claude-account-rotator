import type { Account, CheckError, Fill, FiveHourLimit, FooterStyle, Glyphs, Health, Highlight, LaunchOn, LaunchPick, Mark, PlanTier, Reading, RotateTo, RotatorRequest, Row, RowPart, StoredRows, StoredRun, UsageDue, UsageWindow, View } from '../types'

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

/** The session leaves the login in use once this much of its week is left (percent): by default, only once it is spent. */
export const DEFAULT_WEEK_LEAVE = 0
/** The most of its week a login may have left when the session leaves it (percent). */
export const WEEK_LEAVE_MAX = 99

/** New sessions start on the login with the most room, unless the pane picks another rule or an account. */
export const DEFAULT_LAUNCH_ON: LaunchOn = 'room'

export const EMPTY_VIEW: View = {
  accounts: [],
  readings: {},
  health: {},
  activeId: '1',
  footer: DEFAULT_FOOTER,
  rotateTo: DEFAULT_ROTATE_TO,
  fiveHourLimit: DEFAULT_FIVE_HOUR_LIMIT,
  weekLeave: DEFAULT_WEEK_LEAVE,
  launchOn: DEFAULT_LAUNCH_ON,
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

/** The week left at which the session leaves, as stored: a whole number 0 to 99, else the default. */
export function weekLeaveFrom(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= WEEK_LEAVE_MAX ? (value as number) : DEFAULT_WEEK_LEAVE
}

const LAUNCH_RULES: readonly LaunchOn[] = ['room', 'nonzero', 'reset']

/** Which login new sessions start on, as stored: a rule, or `account:<id>`; else the default. */
export function launchOnFrom(value: unknown): LaunchOn {
  if (isOneOf(value, LAUNCH_RULES)) return value
  return typeof value === 'string' && /^account:[^\s]+$/.test(value) ? (value as LaunchOn) : DEFAULT_LAUNCH_ON
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
export function availableNow(r: Reading | undefined, now: number, weekLeave = DEFAULT_WEEK_LEAVE): number | undefined {
  const five = roomLeft(r?.fiveHour, now)
  if (five === undefined) return undefined
  return isWeekSpent(r, now, weekLeave) ? 0 : five
}

/** Whether a login's week has no more left than the session leaves it at, `weekLeave` percent. */
export function isWeekSpent(r: Reading | undefined, now: number, weekLeave = DEFAULT_WEEK_LEAVE): boolean {
  return (windowPct(r?.sevenDay, now) ?? 0) >= 100 - weekLeave
}

export function isSpent(r: Reading | undefined, now: number, weekLeave = DEFAULT_WEEK_LEAVE): boolean {
  return (windowPct(r?.fiveHour, now) ?? 0) >= LEAVE_FIVE_HOUR || isWeekSpent(r, now, weekLeave)
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

/** Whether the last message of a turn that died on a limit says the limit was the session's, the 5-hour window. */
export function isSessionStop(text: string | undefined): boolean {
  return /hit your session limit|5-hour limit/i.test(text ?? '')
}

/** Whether the last message of a turn that died on a limit says the limit was the week. */
export function isWeeklyStop(text: string | undefined): boolean {
  return /hit your weekly limit/.test(text ?? '')
}

export function shouldLeave(view: View, now: number, need?: Need): boolean {
  const r = view.readings[view.activeId]
  return view.health[view.activeId]?.kind === 'login-needed' || isSpent(r, now, view.weekLeave) || (need === 'fable' && isFableSpent(r, now))
}

/**
 * When a login's 5-hour window resets, or its week where it reports no 5-hour window, epoch ms; Infinity while the
 * reading holds no reset to come: none, one already past, or one that does not parse. A window at 0% used still resets
 * at its time: a week runs whether it is used or not.
 */
function resetOf(r: Reading | undefined, now: number): number {
  const w = r?.fiveHour ?? r?.sevenDay
  const at = w?.resetsAt === undefined ? NaN : Date.parse(w.resetsAt)
  return Number.isFinite(at) && at > now ? at : Infinity
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
/** A login whose usage check fails and that has no reading of its own: room no one can show. */
export const isUnread = (view: View, a: Account): boolean => view.checkErrors?.[a.id] !== undefined && view.readings[a.id] === undefined

export function pickTarget(view: View, now: number, need?: Need): Account | undefined {
  const isFable = need === 'fable'
  const open = view.accounts.filter(
    a =>
      a.id !== view.activeId &&
      view.health[a.id]?.kind === 'ok' &&
      !isUnread(view, a) &&
      !isSpent(view.readings[a.id], now, view.weekLeave) &&
      !(isFable && isFableSpent(view.readings[a.id], now)),
  )
  // A login never read for the Fable week may have none: it is taken only when no read one has room.
  const read = open.filter(a => view.readings[a.id]?.fable !== undefined)
  const ready = isFable && read.length > 0 ? read : open
  // A login with no 5-hour window serves what its week has left.
  const available = (a: Account) => availableNow(view.readings[a.id], now, view.weekLeave) ?? roomLeft(view.readings[a.id]?.sevenDay, now) ?? 100
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

/** Whether a login has room on every limit it reports: none of its windows, the Fable week among them, is at 100%. */
export function hasRoom(r: Reading | undefined, now: number): boolean {
  return [r?.fiveHour, r?.sevenDay, r?.fable].every(w => (windowPct(w, now) ?? 0) < 100)
}

const LAUNCH_WHY: Record<'room' | 'nonzero' | 'reset', string> = {
  room: 'it has the most room',
  nonzero: 'it is the first in the list with room',
  reset: 'its window resets soonest',
}

/**
 * The login new sessions start on, as `launchOn` picks among the signed-in
 * logins with room on every limit: the most room, the first in the list, the
 * soonest reset, or the one account named, else the next in the list after it
 * with room. A rule passes over a login the rotation would leave at once while
 * another stays. Undefined while no login has room.
 */
export function pickLaunch(view: View, now: number): Omit<LaunchPick, 'at'> | undefined {
  const ready = view.accounts.filter(a => view.health[a.id]?.kind === 'ok' && !isUnread(view, a) && hasRoom(view.readings[a.id], now))
  const pick = (a: Account | undefined, why: string) => (a === undefined ? undefined : { id: a.id, slot: a.slot, why })
  const room = (a: Account) => availableNow(view.readings[a.id], now, 0) ?? roomLeft(view.readings[a.id]?.sevenDay, now) ?? 100
  // A view kept from before a hot reload lacks the setting: it reads as the default.
  const on = view.launchOn ?? DEFAULT_LAUNCH_ON
  if (on.startsWith('account:')) {
    const id = on.slice('account:'.length)
    const at = view.accounts.findIndex(a => a.id === id)
    if (at === -1) return pick(ready[0], `account ${id} is not on the list, and it is the first with room`)
    const after = [...view.accounts.slice(at), ...view.accounts.slice(0, at)]
    const found = after.find(a => ready.includes(a))
    return pick(found, found?.id === id ? 'you picked it' : `account ${id} has no room, and it is the next with room`)
  }
  // A rule starts no session on a login the rotation would leave at its first check, while another login stays;
  // with every login past that line, it picks among all with room, so a launch always has a login while one has room.
  const staying = ready.filter(a => !isSpent(view.readings[a.id], now, view.weekLeave))
  const pool = staying.length > 0 ? staying : ready
  const rule = on as 'room' | 'nonzero' | 'reset'
  if (rule === 'nonzero') return pick(pool[0], LAUNCH_WHY.nonzero)
  if (rule === 'room') return pick([...pool].sort((a, b) => room(b) - room(a))[0], LAUNCH_WHY.room)
  const reset = (a: Account) => resetOf(view.readings[a.id], now)
  return pick([...pool].sort((a, b) => (reset(a) === reset(b) ? room(b) - room(a) : reset(a) < reset(b) ? -1 : 1))[0], LAUNCH_WHY.reset)
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
export type StayReason = 'chrome' | 'off' | 'blocked' | 'fable-spent' | 'no-room'

/** Claude Code's own way out of the Fable limit. */
const FABLE_WAY_OUT = 'Run /usage-credits to continue or switch models with /model.'

/**
 * For a Fable stop the rotation did not act on: why, in the order the rotation
 * checks for a stop (Connect, rotation off, Claude Code's policy), then
 * no account with Fable room, then no account ready at all, and the words that
 * say it with the way out. Undefined where the session can move. `skip` holds
 * the accounts a switch did not take.
 */
export function fableStay(view: View, now: number, isConnecting: boolean, skip: ReadonlySet<string>): { reason: StayReason; text: string } | undefined {
  const stay = (reason: StayReason, why: string) => ({ reason, text: `Fable limit reached on account ${view.activeId}${why} ${FABLE_WAY_OUT}` })
  if (isConnecting) return stay('chrome', ' while Claude in Chrome connects, so the session stays.')
  if (view.rotateTo === 'off') return stay('off', ', and usage based rotation is disabled, so the session stays. Pick another Move to in the accounts pane.')
  if (view.isSwitchBlocked) return stay('blocked', ", and Claude Code's policy stops this session from switching accounts.")
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
  // Only a body that lists no 5-hour window at all says the account has none; one it cannot read says nothing.
  const isNone = five_hour === null || five_hour === undefined
  return { ...(fiveHour ? { fiveHour } : isNone ? { noFiveHour: true } : {}), ...(sevenDay ? { sevenDay } : {}), ...(fable ? { fable } : {}), at: now }
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
 * Whether the usage endpoint says the account has no 5-hour window, as a
 * verified Ultra account's does, with no window read since: such an account has
 * no 5-hour window to mark. A response that lists none says nothing of it.
 */
export function reportsNoFiveHour(r: Reading | undefined): boolean {
  return r?.noFiveHour === true && r.fiveHour === undefined
}

/** Two reads whose week resets lie within this of each other read the same week. */
const SAME_WEEK_MS = 3600_000

/**
 * Whether a read's week, which resets at `reset`, began after the stop that left `mark`: a later week than the one
 * the stop spent, whatever reset the mark guessed.
 */
const isLaterWeek = (reset: string, mark: Mark): boolean => Date.parse(reset) - WEEK_MS > mark.at

/**
 * A reading with the week a stop marked spent, until that week's reset: the
 * usage read can lag the stop, so no read of the same week ends the mark. A
 * read of a week that began after the stop, or resets at another time, is a new
 * week, and the mark was the old one's.
 */
export function withWeekMark(r: Reading | undefined, mark: Mark | undefined, now: number): Reading | undefined {
  if (mark === undefined || Date.parse(mark.resetsAt) <= now) return r
  const reset = r?.sevenDay?.resetsAt
  if (reset !== undefined && (isLaterWeek(reset, mark) || Math.abs(Date.parse(reset) - Date.parse(mark.resetsAt)) > SAME_WEEK_MS)) return r
  return { ...(r ?? { at: mark.at }), sevenDay: { pct: mark.pct, resetsAt: mark.resetsAt, isStop: true } }
}

/**
 * A reading with the Fable week a stop marked spent, until the mark's reset: a
 * Fable stop says the week was full, so a body of the same week that reads it
 * lower lags the stop. A body whose Fable week began after the stop, or resets
 * over an hour after the mark's, reads a new week, which ends the mark; one that
 * resets after the stop and before the mark ends a mark that guessed a week from
 * the stop at that real reset. A week that reset before the stop is an older
 * one, and says nothing.
 */
export function withFableMark(r: Reading | undefined, mark: Mark | undefined, now: number): Reading | undefined {
  if (mark === undefined) return r
  const read = r?.fable?.resetsAt
  if (read !== undefined && (isLaterWeek(read, mark) || Date.parse(read) - Date.parse(mark.resetsAt) > SAME_WEEK_MS)) return r
  const isMarksWeek = read !== undefined && Date.parse(read) > mark.at && Date.parse(read) < Date.parse(mark.resetsAt)
  const resetsAt = isMarksWeek ? read : mark.resetsAt
  if (Date.parse(resetsAt) <= now) return r
  return { ...(r ?? { at: mark.at }), fable: { pct: mark.pct, resetsAt, isStop: true } }
}

/**
 * Of two marks, the one that ends later: a write keeps it, as the store has no conditional write. A held mark that
 * stands takes the later time of the two, so the write is the writer's own, never byte-equal to an earlier stop's
 * that an undo would take back.
 */
export function laterMark(held: Mark | undefined, mark: Mark): Mark {
  return held !== undefined && Date.parse(held.resetsAt) >= Date.parse(mark.resetsAt) ? { ...held, at: Math.max(held.at, mark.at) } : mark
}

/**
 * A reading with the 5-hour window a stop marked spent, until the mark's reset
 * time and no sooner: no read ends a mark, so no order between a reading and a
 * mark matters. A read that reports no 5-hour window takes no mark.
 */
export function withMark(r: Reading | undefined, mark: Mark | undefined, now: number): Reading | undefined {
  if (mark === undefined || Date.parse(mark.resetsAt) <= now || reportsNoFiveHour(r)) return r
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

/** How long a week, the Fable week among them, runs: a mark with no reset time of its own stands this long. */
export const WEEK_MS = 7 * 24 * 3600_000
export const FABLE_WEEK_MS = WEEK_MS

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
export const CONTINUE_TEXT_MAX = 500

/**
 * The line that asks Claude to carry on after a Fable switch, as stored: text of at most 500 characters, trimmed;
 * anything else is ignored. A character is a code point, as bin/account-rotator counts it, so an emoji is one; a lone
 * surrogate, which UTF-8 cannot hold and the CLI refuses, is refused here too.
 */
export function continueTextFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  const count = Array.from(text).length
  return count > 0 && count <= CONTINUE_TEXT_MAX && !/\p{Cs}/u.test(text) ? text : undefined
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

/**
 * The version of the store's shapes this mod writes, stamped as `v` on `usage:<id>`, `usage-due:<id>` and `rows`,
 * whose lines it does not version (`StoredRows`).
 */
export const WRITER_VERSION = 1

/**
 * Two week resets name one account's week: within an hour of each other, or a whole number of weeks apart (a
 * reading from before a reset against one after it). Each account's week resets at a time of its own.
 */
export function isSameWeek(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false
  const gap = Math.abs(Date.parse(a) - Date.parse(b)) % WEEK_MS
  return Number.isFinite(gap) && (gap <= SAME_WEEK_MS || WEEK_MS - gap <= SAME_WEEK_MS)
}

/**
 * Whose week a response's reading is: every login whose stored week resets with it. A response proves its login
 * only when this is that one login; one with no week, or whose week two logins share, proves none.
 */
export function whoseWeek(reading: Reading | undefined, readings: Readonly<Record<string, Reading | undefined>>): string[] {
  const reset = reading?.sevenDay?.resetsAt
  if (reset === undefined) return []
  return Object.entries(readings)
    .filter(([, r]) => isSameWeek(r?.sevenDay?.resetsAt, reset))
    .map(([id]) => id)
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
  /** `rateLimitTier`, the sign-in's rate-limit tier: default_claude_max_20x is Ultra. */
  tier?: string
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
  const { accessToken, expiresAt, refreshTokenExpiresAt, refreshToken, subscriptionType, rateLimitTier } = oauth as Record<string, unknown>
  if (typeof accessToken !== 'string' || typeof expiresAt !== 'number') return undefined
  return {
    accessToken,
    expiresAt,
    ...(typeof refreshTokenExpiresAt === 'number' ? { refreshTokenExpiresAt } : {}),
    ...(typeof refreshToken === 'string' ? { refreshToken } : {}),
    ...(typeof subscriptionType === 'string' ? { plan: subscriptionType } : {}),
    ...(typeof rateLimitTier === 'string' && rateLimitTier !== '' ? { tier: rateLimitTier } : {}),
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
  return error instanceof SwitchHeld || String(error).includes('is not for plugins outside policy to change')
}

/** The engine's own hold on a variable, which `$.env.set` resolves with rather than rejects, its reason in words of its own. */
export class SwitchHeld extends Error {}

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

export type Identity = Pick<Account, 'email' | 'orgId' | 'orgName' | 'plan' | 'planName' | 'tier'>

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

/**
 * Whether an account still holds the login a request read: its slot, and `sameLogin` as far as the reader knew it. An
 * email or organization the mod has learned since is no other login; a part it knew and the account now lacks or differs in is.
 */
export function holdsLogin(seen: { slot: string; email?: string; orgId?: string }, account: Account): boolean {
  if (seen.slot !== account.slot) return false
  if (seen.email === undefined) return true
  return sameLogin(seen, seen.orgId === undefined ? { email: account.email } : account)
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
  const planName = field(organization, 'plan_display_name')
  if (typeof email !== 'string' || email === '') return undefined
  return {
    email,
    ...(typeof orgId === 'string' ? { orgId } : {}),
    ...(typeof orgName === 'string' ? { orgName } : {}),
    ...(typeof planName === 'string' && planName !== '' ? { planName } : {}),
  }
}

/** The plan words `subscriptionType` says, by the name the pane draws. */
const PLAN_WORDS: Readonly<Record<string, PlanTier>> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' }

/**
 * A login's plan by its name: the one its profile names; else its sign-in's tier, Max 20x being Ultra (the
 * renamed plan) and Max 5x Max; else its plan word, a max whose usage reports no 5-hour window being Ultra, as only
 * an Ultra plan has none. A plan word the mod does not know is drawn as it is; nothing known, nothing drawn.
 */
export function planName(account: Pick<Account, 'plan' | 'planName' | 'tier'>, hasNoFiveHour: boolean): PlanTier | string | undefined {
  if (account.planName !== undefined && account.planName !== '') return account.planName
  // A Max tier names a max plan, or one with no word: a Team or Enterprise seat on such a tier is still its seat.
  const isMaxLike = account.plan === undefined || account.plan === 'max'
  if (isMaxLike && account.tier !== undefined && /(^|_)max_20x$/.test(account.tier)) return 'Ultra'
  if (isMaxLike && account.tier !== undefined && /(^|_)max_5x$/.test(account.tier)) return 'Max'
  if (account.plan === undefined) return undefined
  if (account.plan === 'max' && hasNoFiveHour) return 'Ultra'
  return PLAN_WORDS[account.plan] ?? account.plan
}

/** The Company a login's row names: its organization, unless that is the one named for its own email. */
export function companyOf(account: Pick<Account, 'email' | 'orgName'>): string | undefined {
  const { email, orgName } = account
  if (orgName === undefined || orgName.trim() === '') return undefined
  // Emails match whatever their case, and a name's outer spaces are no part of it.
  const isOwn = email !== undefined && orgName.trim().toLowerCase() === `${email.trim().toLowerCase()}'s organization`
  return isOwn ? undefined : orgName.trim()
}

// ---------------------------------------------------------------- the row
// One model of a login's row, which the pane draws and every session stores under `rows` for the CLI, so the two
// cannot drift. Its lines are the operator's: `<email> · <Company> · <Plan>  updated HH:MM`, then
// `Used <bar> N% Fable <bar> N%  resets Nd Nh Nm`, then a 5-hour line where the login has the window.

/** Whether a login's usage said it has no 5-hour window, in its reading or, with none yet, in the store: the plan's name infers Ultra from it. */
export function hasNoFiveHour(view: View, id: string): boolean {
  const r = view.readings[id]
  return r === undefined ? view.noFiveHour?.[id] === true : reportsNoFiveHour(r)
}

/**
 * Whether a login is known to have a 5-hour window: its reading holds one (a read's, or a stop's mark), or its usage
 * last said it has one. A login with no reading and no word either way is unknown, and unknown draws nothing.
 */
export function hasFiveHour(view: View, id: string): boolean {
  return view.readings[id]?.fiveHour !== undefined || view.noFiveHour?.[id] === false
}

/** The plans with a separate weekly limit for Fable: on these, a login whose usage lists no Fable week draws it unknown. */
export const HAS_FABLE_WEEK = /^(max|ultra)\b/i

/**
 * "2d 3h 14m", "20h 27m", "27m": the time until `at` (ISO 8601 or epoch milliseconds), the days dropped under a day
 * and the hours under an hour. bin/account-rotator renders a stored `until` by the same rule, rounding a half minute up.
 */
export function resetText(at: string | number, now: number): string {
  const minutes = Math.max(0, Math.round(((typeof at === 'string' ? Date.parse(at) : at) - now) / 60_000))
  const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60]
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

/** HH:MM on a 24-hour clock in `timeZone`, else in the machine's own. */
export function clockText(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone === undefined ? {} : { timeZone }) }).format(at)
}

/**
 * Two resets this close are one to the row: the Fable week's says nothing beside the week's. Judged on the instants,
 * never on their text at `now`, so the stored row does not change with the writer's second.
 */
const SAME_RESET_MS = 60_000

/** A reset ahead: the time left as the row says it, and when, in epoch milliseconds. */
type Reset = { text: string; at: number }

/** A window's reset, while it lies ahead. */
function resetAhead(w: UsageWindow | undefined, now: number): Reset | undefined {
  const at = w?.resetsAt === undefined ? NaN : Date.parse(w.resetsAt)
  return at > now ? { text: resetText(at, now), at } : undefined
}

/** One part of text and resets: its text now, and its runs, each reset an {until} for `rows` to store. */
function resetsPart(pieces: (string | Reset)[]): RowPart {
  return { text: pieces.map(p => (typeof p === 'string' ? p : p.text)).join(''), runs: pieces.map(p => (typeof p === 'string' ? p : { until: p.at })) }
}

/**
 * A window as the row draws it: its label, then a ten-cell bar and the percent used, whatever the footer fills with,
 * the bar's part carrying that percent for its color; a dash, dim, where none is read.
 */
function usedParts(label: string, w: UsageWindow | undefined, now: number): RowPart[] {
  const pct = windowPct(w, now)
  if (pct === undefined) return [{ text: `${label} –`, tone: 'dim' }]
  const used = Math.round(pct)
  return [{ text: `${label} ` }, { text: `${longBar(used)} ${used}%`, used }]
}

/**
 * Why a read failed, as a row says it: `forms` the cause in full, then in the shorter forms a narrow pane takes, each
 * keeping what the row needs (the status, the call, the wait for a session). `hasNext` where `usage-due:<id>.next` is
 * the next try of what failed.
 */
type Cause = { forms: string[]; hasNext: boolean }

/**
 * The cause in a failure's why, which the writers of `check-error:<id>` word (hooks/register.tsx). The schedule
 * `usage-due:<id>.next` retries the usage read alone, and requestUsage stores its back-off for a usage call that
 * answered a failure or threw, so only those causes name it. The profile call and a check that threw elsewhere are
 * tried again by the 10-minute check (checkAll), a run-out token once a session refreshes it: no stored time says
 * when, so those rows name none. A why no writer words has no cause and no time.
 */
function causeOf(why: string): Cause | undefined {
  const status = (call: RegExp) => call.exec(why)?.[1]
  const [usage, profile] = [status(/usage call answered HTTP (\d{3})/), status(/profile call answered HTTP (\d{3})/)]
  if (usage !== undefined) return { forms: [` (HTTP ${usage})`, ` (${usage})`], hasNext: true }
  if (why.startsWith('the usage call threw')) return { forms: [' (usage call threw)', ' (usage error)', ' (error)'], hasNext: true }
  if (profile !== undefined) return { forms: [` (profile HTTP ${profile})`, ` (profile ${profile})`], hasNext: false }
  if (why.startsWith('the profile answer named no email')) return { forms: [' (profile named no email)', ' (profile no email)', ' (no email)'], hasNext: false }
  if (why.startsWith('its token has run out')) return { forms: [' (token run out), until a session refreshes its token', ' (waits for a session)', ' (needs a session)'], hasNext: false }
  if (why.startsWith('the check failed')) return { forms: [' (check failed)', ' (check error)', ' (error)'], hasNext: false }
  return undefined
}

/** A failed read's line 1 end: its time, its cause, and the next try where the schedule is the failed read's own. */
function failedParts(failure: CheckError, nextAt: number | undefined, timeZone: string | undefined): RowPart[] {
  const tone = 'warning' as const
  const cause = causeOf(failure.why)
  const failed = ' Failed to update'
  const next = nextAt === undefined ? undefined : clockText(nextAt, timeZone)
  return [
    { text: `${clockText(failure.at, timeZone)}${failed}`, tone, runs: [{ clock: failure.at }, failed] },
    ...(cause === undefined ? [] : [{ text: cause.forms[0] ?? '', tone, shrink: 'cause' as const, forms: cause.forms }]),
    ...(next === undefined || nextAt === undefined || cause?.hasNext !== true
      ? []
      : [{ text: `, next try ${next}`, tone, shrink: 'next' as const, forms: [`, next try ${next}`, `, next ${next}`], runs: [', next try ', { clock: nextAt }] }]),
  ]
}

/**
 * Line 1's end: a sign-in needed; else a failed check no older than the last good read, at its time, with its cause
 * and next try; else the last good read's time, while a reading stands. With no good read known and no failure,
 * nothing.
 */
function statePart(view: View, a: Account, timeZone: string | undefined): RowPart[] {
  if (view.health[a.id]?.kind === 'login-needed') return [{ text: '⚠ sign in needed', tone: 'warning' }]
  const readAt = view.readAt?.[a.id]
  const failure = view.checkErrors?.[a.id]
  // A good read clears the failure, so one standing at the good read's own millisecond came after it.
  if (failure !== undefined && (readAt === undefined || failure.at >= readAt)) return failedParts(failure, view.nextAt?.[a.id], timeZone)
  // A time over no reading would name a read the row cannot show.
  if (readAt === undefined || view.readings[a.id] === undefined) return []
  return [{ text: `updated ${clockText(readAt, timeZone)}`, runs: ['updated ', { clock: readAt }] }]
}

/** Line 2: the week used, the Fable week used (a dash on Max and Ultra where no body listed it), and the resets ahead. */
function usageLine(view: View, a: Account, now: number): RowPart[] {
  const r = view.readings[a.id]
  if (r === undefined) return [{ text: `Used ${longBar(0)} no reading yet`, tone: 'dim' }]
  const plan = planName(a, hasNoFiveHour(view, a.id))
  const isFable = r.fable !== undefined || (plan !== undefined && HAS_FABLE_WEEK.test(plan))
  const fable = isFable ? usedParts(' Fable', r.fable, now) : []
  const [week, fableReset] = [resetAhead(r.sevenDay, now), resetAhead(r.fable, now)]
  const resets =
    week === undefined
      ? fableReset === undefined ? undefined : ['  Fable resets ', fableReset]
      : ['  resets ', week, ...(fableReset === undefined || Math.abs(fableReset.at - week.at) < SAME_RESET_MS ? [] : [' · Fable ', fableReset])]
  return [...usedParts('Used', r.sevenDay, now), ...fable, ...(resets === undefined ? [] : [resetsPart(resets)])]
}

/**
 * Line 3, where the login is known to have a 5-hour window (hasFiveHour), whatever the 5h limit: it used and its
 * reset ahead, as the counted reading holds it; a dash, dim, where the limit set off drops it from the count.
 */
function fiveHourLine(view: View, a: Account, now: number): RowPart[] | undefined {
  if (!hasFiveHour(view, a.id)) return undefined
  const w = view.readings[a.id]?.fiveHour
  if (w === undefined) return [{ text: '5h –', tone: 'dim' }]
  const reset = resetAhead(w, now)
  return [...usedParts('5h', w, now), ...(reset === undefined ? [] : [resetsPart(['  resets ', reset])])]
}

/**
 * A login's row from the counted view: line 1 who it is (email, Company, plan, and Chrome where the extension is
 * signed in to it) and its last read's state, line 2 its week and Fable week used, line 3 its 5-hour window where it
 * has one. A failure shown dims the usage lines. `timeZone` names the clock's zone; the machine's own where none is named.
 */
export function rowOf(view: View, a: Account, now: number, timeZone?: string): Row {
  const who = a.email ?? (a.slot === '' ? 'your normal account' : 'not signed in yet')
  const [company, plan] = [companyOf(a), planName(a, hasNoFiveHour(view, a.id))]
  const state = statePart(view, a, timeZone)
  const line1: RowPart[] = [
    { text: who, shrink: 'email' },
    ...(company === undefined ? [] : [{ text: ` · ${company}`, shrink: 'company' as const }]),
    ...(plan === undefined ? [] : [{ text: ` · ${plan}`, shrink: 'plan' as const }]),
    ...(view.chromeAccountId === a.id ? [{ text: ' · Chrome' }] : []),
    ...(state.length === 0 ? [] : [{ text: '  ' }, ...state]),
  ]
  const isFailed = state[0]?.tone === 'warning' && view.health[a.id]?.kind !== 'login-needed'
  const dim = (line: RowPart[]): RowPart[] => (isFailed ? line.map(p => ({ ...p, tone: 'dim' })) : line)
  const five = fiveHourLine(view, a, now)
  return { id: a.id, lines: [line1, dim(usageLine(view, a, now)), ...(five === undefined ? [] : [dim(five)])] }
}

/** A row's lines as text. */
export function rowText(row: Row): string[] {
  return row.lines.map(line => line.map(p => p.text).join(''))
}

/**
 * A row line as `rows` stores it: its text in runs, each time of day as {clock} and each reset as {until}, so the
 * stored bytes hold neither the writer's zone nor its minute, and every session on a store writes the same ones.
 */
export function storedLine(line: readonly RowPart[]): StoredRun[] {
  return line
    .flatMap(p => p.runs ?? [p.text])
    .reduce<StoredRun[]>((runs, r) => {
      const last = runs.at(-1)
      return typeof r === 'string' && typeof last === 'string' ? [...runs.slice(0, -1), last + r] : [...runs, r]
    }, [])
}

/** Every login's row, as the merge stores it under `rows`. */
export function rowsOf(view: View, now: number): StoredRows['rows'] {
  return view.accounts.map(a => ({ id: a.id, lines: rowOf(view, a, now).lines.map(storedLine) }))
}

/**
 * A stored line as a reader at `now` prints it, in `timeZone` or the machine's own: bin/account-rotator's rule. A reset
 * already past reads `passed`: the row was written before it, and no session has read the account since.
 */
export function storedLineText(line: readonly StoredRun[], now: number, timeZone?: string): string {
  const until = (at: number) => (at > now ? resetText(at, now) : 'passed')
  return line.map(r => (typeof r === 'string' ? r : 'clock' in r ? clockText(r.clock, timeZone) : until(r.until))).join('')
}

/** Whether the store's `rows` already hold these lines: then the merge writes nothing. */
export function isSameRows(stored: unknown, rows: StoredRows['rows']): boolean {
  const held = typeof stored === 'object' && stored !== null ? (stored as { rows?: unknown }).rows : undefined
  return JSON.stringify(held) === JSON.stringify(rows)
}

/** A row fitted to a width: its lines, and the line whose end holds the buttons, an empty one where they have their own. */
export type FittedRow = { lines: RowPart[][]; endLine: number }

/** The cells between a line's text and the buttons at its end. */
export const END_GAP = 2

/** The cells a line takes, one per character. */
export const cellsOf = (line: readonly RowPart[]): number => line.reduce((n, p) => n + [...p.text].length, 0)

/** A Company part cut to `cells` (at least ` · X…`), or an email in its middle (at least `x…y`), with an ellipsis. */
function cutTo(p: RowPart, cells: number): RowPart {
  const chars = [...p.text]
  if (cells >= chars.length) return p
  if (p.shrink === 'company') return { ...p, text: `${chars.slice(0, Math.max(5, cells) - 1).join('')}…` }
  const keep = Math.max(2, cells - 1)
  const head = Math.ceil(keep / 2)
  return { ...p, text: `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (keep - head)).join('')}` }
}

/** The parts of one kind taking their `n`th form (the last one where they have fewer), or none of their text. */
const inForm = (line: RowPart[], kind: RowPart['shrink'], n: number | 'gone'): RowPart[] =>
  line.map(p => {
    if (p.shrink !== kind) return p
    const { runs: _runs, ...rest } = p
    return { ...rest, text: n === 'gone' ? '' : (p.forms?.[Math.min(n, p.forms.length - 1)] ?? p.text) }
  })

/** The parts of one kind cut by the `over` cells the line is over (cutTo). */
const cutKind = (line: RowPart[], kind: RowPart['shrink'], over: number): RowPart[] =>
  line.map(p => (p.shrink === kind ? cutTo(p, [...p.text].length - over) : p))

/**
 * Line 1 cut to `columns`, one step at a time while it is over: a failed read's cause to its short form and its next
 * try to a shorter one, the Company, the email's middle, then the cause to its shortest form, the Company and the plan
 * gone. The time, `Failed to update`, and Chrome's name stay, and so does each cause's word for what the row needs.
 */
function fitLine1(line: RowPart[], columns: number): RowPart[] {
  const steps: ((fitted: RowPart[], over: number) => RowPart[])[] = [
    fitted => inForm(fitted, 'cause', 1),
    (fitted, over) => cutKind(fitted, 'company', over),
    (fitted, over) => cutKind(fitted, 'email', over),
    fitted => inForm(fitted, 'next', 1),
    fitted => inForm(fitted, 'cause', 2),
    fitted => inForm(fitted, 'company', 'gone'),
    fitted => inForm(fitted, 'plan', 'gone'),
  ]
  return steps.reduce((fitted, step) => (cellsOf(fitted) > columns ? step(fitted, cellsOf(fitted) - columns) : fitted), line)
}

/**
 * A row fitted to a pane `columns` wide, its buttons `endWidth` cells: line 1 cut to the width, and the buttons at
 * line 1's end where they fit beside it, else at line 2's end, else on a line of their own after line 2. Without
 * buttons they end line 1.
 */
export function fitRow(row: Row, columns: number, endWidth: number): FittedRow {
  const [first = [], second, ...rest] = row.lines
  const line1 = fitLine1(first, columns)
  const fits = (line: RowPart[] | undefined) => line !== undefined && cellsOf(line) + END_GAP + endWidth <= columns
  if (endWidth === 0 || fits(line1)) return { lines: [line1, ...(second === undefined ? [] : [second]), ...rest], endLine: 0 }
  if (fits(second)) return { lines: [line1, second as RowPart[], ...rest], endLine: 1 }
  const before = [line1, ...(second === undefined ? [] : [second])]
  return { lines: [...before, [], ...rest], endLine: before.length }
}

// ---------------------------------------------------------------- one usage schedule per store
// Every session reads every login's usage, so the calls grow as sessions times logins, and the usage endpoint
// answers 429 to all of them. One key per login, shared by every session, says when it is next read.

/** A login whose responses some session stored since its last read is read again after this long. */
export const USAGE_IN_USE_MS = 10 * 60_000
/** A login no response read since its last read is read again after this long. */
export const USAGE_IDLE_MS = 30 * 60_000
/** The wait after a first failed read; each failure since doubles it, up to `USAGE_BACKOFF_MAX_MS`. */
export const USAGE_BACKOFF_MS = 2 * 60_000
/** The longest wait a failure or its Retry-After sets. */
export const USAGE_BACKOFF_MAX_MS = 60 * 60_000
/**
 * A read due this soon is made now: the check that made the last read comes round again a little before the next
 * falls due, the last read having come after its check began, and a timer fires late as often as early.
 */
export const USAGE_EARLY_MS = 30_000
/** How long a claim holds a read for the session that made it, early window included: one that died mid-read frees it after this. */
export const USAGE_CLAIM_MS = 90_000
/** How long a session waits before reading its claim back: a claim another session made meanwhile wins. */
export const USAGE_CLAIM_WAIT_MS = 300
/** A stop, a /login or a sign-in reads a login again only once its last good read is this old. */
export const USAGE_FORCE_AFTER_MS = 60_000

/** A login's schedule as stored; anything else is none, so the read is due. */
export function usageDueFrom(value: unknown): UsageDue | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { next, fails, claim, at, retryAfter, v } = value as Record<string, unknown>
  if (typeof next !== 'number' || !Number.isFinite(next)) return undefined
  return {
    next,
    fails: Number.isInteger(fails) && (fails as number) >= 0 ? (fails as number) : 0,
    ...(typeof claim === 'string' ? { claim } : {}),
    ...(typeof at === 'number' && Number.isFinite(at) ? { at } : {}),
    ...(typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? { retryAfter } : {}),
    ...(Number.isInteger(v) ? { v: v as number } : {}),
  }
}

/**
 * The schedule that gates a login's read. An older version's (no `v`) with no back-off gates no login this version
 * holds no `usage:` reading of: that version reads on its own schedule into its own key, which this one cannot trust,
 * so the login is read here too until the older sessions restart. Its back-off still stands.
 */
export function gatingDue(due: UsageDue | undefined, hasOwnReading: boolean): UsageDue | undefined {
  return due !== undefined && due.v === undefined && due.fails === 0 && !hasOwnReading ? undefined : due
}

/** A read is due: no session has scheduled one, or its time comes within the early window; a back-off's, only once it has come. */
export const isUsageDue = (due: UsageDue | undefined, now: number): boolean =>
  due === undefined || due.next <= now + (due.fails > 0 ? 0 : USAGE_EARLY_MS)

/** A failed read set a wait that has not passed. */
export const isBackedOff = (due: UsageDue | undefined, now: number): boolean => due !== undefined && due.fails > 0 && due.next > now

/** Another session's read is under way: its claim stands until the read stores the schedule, or the claim runs out. */
const isClaimedElsewhere = (due: UsageDue | undefined, sessionId: string, now: number): boolean =>
  due?.claim !== undefined && due.claim !== sessionId && due.next > now

/**
 * A stop, a /login or a sign-in may read the login now: no back-off stands, no other session's read is under way,
 * and its last good read is over a minute old.
 */
export const mayForceUsage = (due: UsageDue | undefined, sessionId: string, now: number): boolean =>
  !isBackedOff(due, now) && !isClaimedElsewhere(due, sessionId, now) && (due?.at === undefined || now - due.at > USAGE_FORCE_AFTER_MS)

/**
 * A settling switch may read a login once: no back-off stands, no other session's read is under way, and no good
 * read came after the switch began (`since`). The minute gate does not apply: the switch is news the last read lacks.
 */
export const mayReadSince = (due: UsageDue | undefined, sessionId: string, now: number, since: number): boolean =>
  !isBackedOff(due, now) && !isClaimedElsewhere(due, sessionId, now) && (due?.at === undefined || due.at <= since)

/**
 * The claim renewed as this session's read of the login starts, so the claim lasts from the read, not from the
 * check that claimed it; undefined when the claim is no longer this session's (it ran out and another took it, or
 * another session's read has finished).
 */
export const renewClaim = (due: UsageDue | undefined, sessionId: string, now: number): UsageDue | undefined =>
  due?.claim === sessionId ? claimUsage(due, sessionId, now) : undefined

/** The schedule with this session's claim on the read: every other session finds it not due until the claim runs out. */
export const claimUsage = (due: UsageDue | undefined, sessionId: string, now: number): UsageDue => ({
  ...(due ?? { fails: 0 }),
  next: now + USAGE_CLAIM_MS,
  claim: sessionId,
  v: WRITER_VERSION,
})

/** The store the schedule lives in: the mod's own, which every session of it shares. */
export type DueStore = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }

/**
 * Claims, for `sessionId`, the read of each login whose schedule says it is due: writes the claims, waits once
 * (`wait`, the claim wait), and answers the logins whose claim still stands. Of sessions that claim one login at
 * once, the last to write reads it; the store has no compare-and-set, so this is a re-read after a delay, not a lock.
 * `hasOwnReading`: whether this version holds a `usage:` reading of the login (`gatingDue`).
 */
export async function claimDueReads(
  store: DueStore,
  ids: readonly string[],
  sessionId: string,
  now: number,
  wait: () => Promise<void>,
  hasOwnReading: (id: string) => Promise<boolean> = async () => true,
): Promise<Set<string>> {
  const claimed: string[] = []
  for (const id of ids) {
    const due = gatingDue(usageDueFrom(await store.get(`usage-due:${id}`)), await hasOwnReading(id))
    if (!isUsageDue(due, now)) continue
    await store.set(`usage-due:${id}`, claimUsage(due, sessionId, now))
    claimed.push(id)
  }
  const ours = new Set<string>()
  if (claimed.length === 0) return ours
  await wait()
  for (const id of claimed) {
    if (usageDueFrom(await store.get(`usage-due:${id}`))?.claim === sessionId) ours.add(id)
  }
  return ours
}

/** The Retry-After a failed call carries, in milliseconds: seconds or an HTTP date; none, 0 or unreadable is undefined. */
export function retryAfterFrom(headers: Readonly<Record<string, string>>, now: number): number | undefined {
  const raw = headers['retry-after']?.trim()
  if (raw === undefined || raw === '') return undefined
  const ms = /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/**
 * What a read came to, for the schedule: a body (and whether responses were stored since the last), a body that holds
 * no usage the mod reads (`empty`), a failure, a rejected sign-in.
 */
export type UsageOutcome = { kind: 'ok' | 'empty'; hasResponded: boolean } | { kind: 'failed'; retryAfter?: number } | { kind: 'rejected' }

/**
 * The schedule after a read. A body: the next in 10 minutes for a login in use, else 30; a body with no usage in it
 * the same, but it is no good read, so the last one's time stays. A failure: the wait its
 * Retry-After asks, or 2 minutes doubled for each failure before, whichever is longer, at most 60 minutes. A rejected
 * sign-in is no rate limit: read again in 10 minutes, so a new sign-in is read at once.
 */
export function afterUsage(due: UsageDue | undefined, outcome: UsageOutcome, now: number): UsageDue {
  const last = due?.at === undefined ? {} : { at: due.at }
  const v = WRITER_VERSION
  if (outcome.kind === 'ok') return { next: now + (outcome.hasResponded ? USAGE_IN_USE_MS : USAGE_IDLE_MS), fails: 0, at: now, v }
  if (outcome.kind === 'empty') return { next: now + (outcome.hasResponded ? USAGE_IN_USE_MS : USAGE_IDLE_MS), fails: 0, ...last, v }
  if (outcome.kind === 'rejected') return { next: now + USAGE_IN_USE_MS, fails: 0, ...last, v }
  const fails = due?.fails ?? 0
  const wait = Math.min(USAGE_BACKOFF_MAX_MS, Math.max(outcome.retryAfter ?? 0, USAGE_BACKOFF_MS * 2 ** fails))
  return { next: now + wait, fails: fails + 1, ...last, ...(outcome.retryAfter === undefined ? {} : { retryAfter: outcome.retryAfter }), v }
}

// ---------------------------------------------------------------- requests from bin/account-rotator
// The CLI never writes the store: it drops a request file a session applies on its minute tick and answers with a
// result file beside it. A request names the store it was read from by that store's `store-id`.

/** How long a request waits for a session: a CLI that gave up or died leaves nothing a later session applies. */
export const REQUEST_TTL_MS = 5 * 60_000

/** The most a request file holds: far above what the CLI writes. A larger one is skipped unread. */
export const REQUEST_MAX_BYTES = 4096

/** How often a Bash call that names the CLI looks for its request: the CLI polls for the answer at the same pace. */
export const REQUEST_POLL_MS = 250

/** A nonce the CLI writes: letters, digits and dashes, so it names a file in the requests folder and nothing else. */
const NONCE = /^[A-Za-z0-9-]{6,64}$/

/** Whether `nonce` is one the CLI writes, so a result for it lands beside its request and nowhere else. */
export function isRequestNonce(nonce: string): boolean {
  return NONCE.test(nonce)
}

/** A request read back from its file, while it is fresh; anything else is none. */
export function requestFrom(value: unknown, now: number): RotatorRequest | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { kind, nonce, at, id, store, session, slot, email, orgId } = value as Record<string, unknown>
  if (typeof nonce !== 'string' || !NONCE.test(nonce) || typeof id !== 'string' || typeof store !== 'string') return undefined
  if (typeof at !== 'number' || Math.abs(now - at) > REQUEST_TTL_MS) return undefined
  if (kind === 'select') return { kind, nonce, at, id, store }
  if (kind === 'rm') {
    if (typeof slot !== 'string' || (email !== undefined && typeof email !== 'string') || (orgId !== undefined && typeof orgId !== 'string')) return undefined
    return { kind, nonce, at, id, store, slot, ...(email === undefined ? {} : { email }), ...(orgId === undefined ? {} : { orgId }) }
  }
  if (kind === 'add') return typeof slot === 'string' && slot !== '' ? { kind, nonce, at, id, store, slot } : undefined
  if (kind === 'continue-text') return { kind, nonce, at, id, store, text: (value as Record<string, unknown>).text }
  return kind === 'use' && typeof session === 'string' && session !== '' ? { kind, nonce, at, id, store, session } : undefined
}

/** Where each account's folder lives, whichever config a session runs on. A HOME's trailing slash goes: the CLI's expanduser strips it. */
export const accountsRoot = (home: string): string => `${home.replace(/\/+$/, '')}/.claude/accounts`

/** The number of a folder directly under the accounts folder, as `account add` makes and takes them; any other slot has none. */
export function slotNumber(slot: string, home: string): string | undefined {
  const root = `${accountsRoot(home)}/`
  const name = slot.startsWith(root) ? slot.slice(root.length) : ''
  return /^[1-9][0-9]*$/.test(name) ? name : undefined
}

/** The requests folder: in the Claude config folder, CLAUDE_CONFIG_DIR or `~/.claude`, as bin/account_rotator_store.py finds it. */
export function requestsDir(configDir: string | undefined, home: string): string {
  return `${configDir || `${home}/.claude`}/account-rotator-requests`
}

