import { expect, test } from 'claude-code/testing'

import type { RotateTo, View } from '../types'
import { weekLeaveFrom, launchOnFrom, pickLaunch, isSessionStop } from './model'
import { isSameWeek, whoseWeek } from './model'
import { companyOf, identityFromStatus, planName } from './model'
import { laterMark, spentMark, withFableMark } from './model'
import { EMPTY_VIEW, USAGE_IDLE_MS, fitRow, rowOf, rowsOf, rowText, storedLine, storedLineText } from './model'
import ROWS_FIXTURE from '../tests/fixtures/rows'
import { REQUEST_TTL_MS, requestFrom, requestsDir } from './model'
import { USAGE_BACKOFF_MAX_MS, USAGE_CLAIM_MS, USAGE_CLAIM_WAIT_MS, USAGE_EARLY_MS, WRITER_VERSION, afterUsage, claimDueReads, gatingDue, isUsageDue, mayForceUsage, mayReadSince, renewClaim, retryAfterFrom, usageDueFrom } from './model'
import { DEFAULT_FOOTER, availableNow, braille, browsersFrom, chromeNote, continueTextFrom, counted, fiveHourLimitFrom, credentialFrom, credentialsFile, fableMark, fableSpentNotice, fableStay, footerStyleFrom, healthOf, identityFromProfile, isFableSpent, isFableStop, isNoBrowser, isPolicyRefusal, keepFable, keychainItem, legacyMark, markFrom, nextReset, pickTarget, pie, readingFromUsage, rotateToFrom, shouldLeave, roomColor, windowPct, withMark, withWeekMark } from './model'

const NOW = Date.parse('2026-10-12T10:00:00Z')
const LATER = '2026-10-12T12:00:00Z'
const WEEK_END = '2026-10-18T03:00:00Z'
const FABLE_END = '2026-10-17T03:00:00Z'
const HOUR = 3600_000

/** A login's usage is [5-hour %, week %], with the Fable week's % as a third member where it has one. */
function view(
  readings: Record<string, [number, number] | [number, number, number]>,
  health: Record<string, View['health'][string]> = {},
  rotateTo: RotateTo = 'room',
): View {
  const ids = Object.keys(readings)
  return {
    accounts: ids.map(id => ({ id, slot: id === '1' ? '' : `/h/.claude/accounts/${id}` })),
    readings: Object.fromEntries(
      ids.map(id => {
        const [five, week, fable] = readings[id] ?? [0, 0]
        return [
          id,
          {
            fiveHour: { pct: five, resetsAt: LATER },
            sevenDay: { pct: week, resetsAt: WEEK_END },
            ...(fable === undefined ? {} : { fable: { pct: fable, resetsAt: FABLE_END } }),
            at: NOW,
          },
        ]
      }),
    ),
    health: Object.fromEntries(ids.map(id => [id, health[id] ?? { kind: 'ok' as const }])),
    activeId: '1',
    footer: DEFAULT_FOOTER,
    rotateTo,
    fiveHourLimit: 'on',
    weekLeave: 0,
    launchOn: 'room',
    hasFontBlocks: false,
  }
}

/** A login that reports no 5-hour window: its week alone, used `week` percent, resetting at `resetsAt`. */
const weekOnly = (week: number, resetsAt: string) => ({ sevenDay: { pct: week, resetsAt }, at: NOW })

test('a login whose usage check fails with no reading of its own is never a rotation target (puma-4q7j2.8, RULING 4278)', () => {
  const v = view({ '1': [95, 50], '2': [0, 0], '3': [0, 60] }, {}, 'room')
  delete v.readings['2']
  v.checkErrors = { '2': { why: 'the usage call answered HTTP 429', at: NOW } }
  expect(pickTarget(v, NOW)?.id).toBe('3')
})

test('a stored 5-hour limit choice is kept when known, else on', () => {
  expect(fiveHourLimitFrom('off')).toBe('off')
  expect(fiveHourLimitFrom('on')).toBe('on')
  expect(fiveHourLimitFrom('nope')).toBe('on')
  expect(fiveHourLimitFrom(undefined)).toBe('on')
})

test('logins that report no 5-hour window rank by their week: soonest reset by its week reset, most room by its week room', () => {
  const v = view({ '1': [95, 50], '2': [0, 0], '3': [0, 0], '4': [0, 0] }, {}, 'reset')
  v.readings['2'] = weekOnly(90, '2026-10-12T20:00:00Z')
  v.readings['3'] = weekOnly(20, '2026-10-14T03:00:00Z')
  v.readings['4'] = weekOnly(60, '2026-10-13T03:00:00Z')
  expect(pickTarget(v, NOW)?.id).toBe('2')
  expect(pickTarget({ ...v, rotateTo: 'room' }, NOW)?.id).toBe('3')
  // Spent by its week, a login with no 5-hour window is never a target.
  v.readings['2'] = weekOnly(100, '2026-10-12T20:00:00Z')
  expect(pickTarget(v, NOW)?.id).toBe('4')
})

test('with the 5-hour limit off a reported 5-hour window is dropped and a stop\'s mark stays; a mark with no reset time stands five hours from its read', () => {
  const read = { fiveHour: { pct: 95, resetsAt: LATER }, sevenDay: { pct: 10, resetsAt: WEEK_END }, at: NOW }
  expect(counted(read, 'on', NOW)).toBe(read)
  expect(counted(read, 'off', NOW)).toEqual({ sevenDay: { pct: 10, resetsAt: WEEK_END }, at: NOW })
  const v = view({ '1': [95, 10] })
  expect(shouldLeave(v, NOW)).toBe(true)
  expect(shouldLeave({ ...v, readings: { '1': counted(read, 'off', NOW) } }, NOW)).toBe(false)
  const mark = { ...read, fiveHour: { pct: 100, resetsAt: LATER, isStop: true as const } }
  expect(counted(mark, 'off', NOW)).toBe(mark)
  // The mark a stop left before marks carried a reset time: five hours from its read, then gone.
  const old = { fiveHour: { pct: 100 }, at: NOW }
  expect(counted(old, 'on', NOW + 5 * HOUR - 1).fiveHour).toEqual({ pct: 100, resetsAt: new Date(NOW + 5 * HOUR).toISOString(), isStop: true })
  expect(counted(old, 'on', NOW + 5 * HOUR)).toEqual({ at: NOW })
})

test('a stop\'s mark counts until its reset and no read ends it; an older version\'s mark inside a reading reads as a mark', () => {
  const mark = { pct: 100, resetsAt: LATER, at: NOW }
  const marked = { pct: 100, resetsAt: LATER, isStop: true }
  const fresh = { sevenDay: { pct: 20, resetsAt: WEEK_END }, at: NOW + HOUR }
  expect(withMark(fresh, mark, NOW + HOUR)).toEqual({ ...fresh, fiveHour: marked })
  expect(withMark(fresh, mark, Date.parse(LATER))).toBe(fresh)
  expect(withMark(undefined, mark, NOW)).toEqual({ fiveHour: marked, at: NOW })
  expect(withMark(fresh, undefined, NOW)).toBe(fresh)
  // No read ends a mark, whenever it was read: the mark stands until its reset.
  const after = { ...fresh, fiveHour: { pct: 30, resetsAt: LATER } }
  expect(withMark(after, mark, NOW + HOUR)).toEqual({ ...after, fiveHour: marked })
  const before = { ...after, at: NOW - HOUR }
  expect(withMark(before, mark, NOW + HOUR)).toEqual({ ...before, fiveHour: marked })
  // An older version's mark inside a reading, as a mark: isStop, or full with no reset time (five hours from its read).
  expect(legacyMark({ fiveHour: { pct: 100, resetsAt: LATER, isStop: true }, at: NOW }, NOW)).toEqual({ pct: 100, resetsAt: LATER, at: NOW })
  expect(legacyMark({ fiveHour: { pct: 100 }, at: NOW }, NOW + HOUR)).toEqual({ pct: 100, resetsAt: new Date(NOW + 5 * HOUR).toISOString(), at: NOW })
  expect(legacyMark({ fiveHour: { pct: 100 }, at: NOW }, NOW + 5 * HOUR)).toBeUndefined()
  expect(legacyMark({ fiveHour: { pct: 30, resetsAt: LATER }, at: NOW }, NOW)).toBeUndefined()
  expect(legacyMark(undefined, NOW)).toBeUndefined()
  // The store's value is a mark only in a mark's shape.
  expect(markFrom(mark)).toEqual(mark)
  expect(markFrom({ pct: 100, at: NOW })).toBeUndefined()
  expect(markFrom('mark')).toBeUndefined()
})

test('a 5-hour window read with no reset time and room left is a read, not a stop\'s mark: off drops it, on keeps it as read', () => {
  const unstarted = { fiveHour: { pct: 0 }, sevenDay: { pct: 10, resetsAt: WEEK_END }, at: NOW }
  expect(counted(unstarted, 'on', NOW + 6 * HOUR)).toBe(unstarted)
  expect(counted(unstarted, 'off', NOW)).toEqual({ sevenDay: { pct: 10, resetsAt: WEEK_END }, at: NOW })
})

// puma-4q7j2.4: the week left at which the session leaves is the pane's setting, 0 to 99, by default 0.
test('leaves at 90% of the 5-hour window, or once its week has no more left than the setting: by default only when spent', () => {
  expect(shouldLeave(view({ '1': [89, 99] }), NOW)).toBe(false)
  expect(shouldLeave(view({ '1': [10, 100] }), NOW)).toBe(true)
  expect(shouldLeave(view({ '1': [90, 10] }), NOW)).toBe(true)
  expect(shouldLeave({ ...view({ '1': [10, 94] }), weekLeave: 5 }, NOW)).toBe(false)
  expect(shouldLeave({ ...view({ '1': [10, 95] }), weekLeave: 5 }, NOW)).toBe(true)
  expect(shouldLeave({ ...view({ '1': [10, 0] }), weekLeave: 99 }, NOW)).toBe(false)
  expect(shouldLeave({ ...view({ '1': [10, 1] }), weekLeave: 99 }, NOW)).toBe(true)
  expect(shouldLeave(view({ '1': [0, 0] }, { '1': { kind: 'login-needed', why: 'x' } }), NOW)).toBe(true)
})

// puma-4q7j2.5: the login new sessions start on, by each rule, skipping any with a limit at 0% left.
test('new sessions start on the login the setting picks among those with room on every limit, the named one or the next after it', () => {
  // Login 1 has its week spent; 2 the most room; 3 the soonest reset; 4 its Fable week spent.
  const v = view({ '1': [10, 100], '2': [10, 20], '3': [60, 50], '4': [5, 5, 100] })
  v.readings['3'] = { ...v.readings['3'], fiveHour: { pct: 60, resetsAt: '2026-10-12T10:30:00Z' }, at: NOW }
  const on = (launchOn: View['launchOn']) => pickLaunch({ ...v, launchOn }, NOW)
  expect(on('room')).toMatchObject({ id: '2', slot: '/h/.claude/accounts/2' })
  expect(on('nonzero')?.id).toBe('2')
  expect(on('reset')?.id).toBe('3')
  expect(on('account:3')).toMatchObject({ id: '3', why: 'you picked it' })
  expect(on('account:4')).toMatchObject({ id: '2', why: 'account 4 has no room, and it is the next with room' })
  expect(on('account:1')?.id).toBe('2')
  expect(pickLaunch(view({ '1': [100, 10], '2': [10, 100] }), NOW)).toBeUndefined()
  expect(['room', 'nonzero', 'reset', 'account:3', 'account:', 'other', 7].map(launchOnFrom)).toEqual(['room', 'nonzero', 'reset', 'account:3', 'room', 'room', 'room'])
})

// RULING 4230: Claude's words naming the 5-hour window, or the session's limit, mean the account has one.
test('a stop names the 5-hour window by "session limit" or "5-hour limit", never by the week or Fable', () => {
  expect(["You've hit your session limit · resets 3pm", '5-hour limit reached'].map(isSessionStop)).toEqual([true, true])
  expect(["You've hit your weekly limit · resets Nov 10", "You've reached your Fable limit.", undefined].map(isSessionStop)).toEqual([false, false, false])
})

test('a stored week-leave is kept when it is a whole number 0 to 99, else it reads as 0', () => {
  expect([0, 5, 99].map(weekLeaveFrom)).toEqual([0, 5, 99])
  expect([100, -1, 5.5, '5', undefined, null].map(weekLeaveFrom)).toEqual([0, 0, 0, 0, 0, 0])
})

test('picks the signed-in login with the most room, never a spent or locked one', () => {
  const v = view(
    { '1': [95, 50], '2': [40, 80], '3': [10, 20], '4': [5, 5] },
    { '4': { kind: 'login-needed', why: 'sign-in expired' } },
  )
  expect(pickTarget(v, NOW)?.id).toBe('3')
  expect(pickTarget(view({ '1': [95, 50], '2': [91, 10] }), NOW)).toBeUndefined()
})

test('ranks logins by what they can serve now: the 5-hour room, nothing once the week is spent', () => {
  // A fresh session with a busy week beats a half-used session with a fresh week.
  expect(pickTarget(view({ '1': [95, 50], '2': [10, 80], '3': [50, 0] }), NOW)?.id).toBe('2')
  expect(availableNow({ fiveHour: { pct: 10, resetsAt: LATER }, sevenDay: { pct: 80, resetsAt: WEEK_END }, at: NOW }, NOW)).toBe(90)
  expect(availableNow({ fiveHour: { pct: 10, resetsAt: LATER }, sevenDay: { pct: 100, resetsAt: WEEK_END }, at: NOW }, NOW)).toBe(0)
  expect(availableNow({ fiveHour: { pct: 10, resetsAt: LATER }, sevenDay: { pct: 96, resetsAt: WEEK_END }, at: NOW }, NOW, 5)).toBe(0)
  expect(availableNow({ fiveHour: { pct: 97, resetsAt: LATER }, at: NOW }, Date.parse(LATER) + 1)).toBe(100)
})

test('soonest reset moves to the login whose 5-hour window resets first, never a spent one; one with no window running comes last', () => {
  const resetsAt = (v: View, id: string, at: string | undefined) => {
    const r = v.readings[id]
    if (r?.fiveHour) r.fiveHour = { pct: r.fiveHour.pct, ...(at ? { resetsAt: at } : {}) }
  }
  const v = view({ '1': [95, 50], '2': [10, 10], '3': [60, 10], '4': [91, 10] }, {}, 'reset')
  resetsAt(v, '2', '2026-10-12T14:00:00Z')
  resetsAt(v, '3', '2026-10-12T11:00:00Z')
  resetsAt(v, '4', '2026-10-12T10:30:00Z')
  expect(pickTarget(v, NOW)?.id).toBe('3')
  // Login 3's window resets before the switch: no window is running, so it comes last.
  expect(pickTarget(v, Date.parse('2026-10-12T11:00:00Z') + 1)?.id).toBe('2')
  // Two resets at once: the more room wins.
  resetsAt(v, '2', '2026-10-12T11:00:00Z')
  expect(pickTarget(v, NOW)?.id).toBe('2')
})

test('next in list moves to the login after the one in use, wrapping, past spent and locked ones', () => {
  const at = (activeId: string, v: View) => pickTarget({ ...v, activeId }, NOW)?.id
  const v = view({ '1': [10, 10], '2': [95, 10], '3': [20, 10], '4': [80, 10] }, {}, 'order')
  expect(at('2', v)).toBe('3')
  expect(at('4', v)).toBe('1')
  expect(at('3', v)).toBe('4')
  expect(at('2', view({ '1': [10, 10], '2': [95, 10], '3': [91, 10], '4': [80, 10] }, {}, 'order'))).toBe('4')
  expect(at('2', view({ '1': [10, 10], '2': [95, 10], '3': [20, 10], '4': [0, 0] }, { '3': { kind: 'login-needed', why: 'x' } }, 'order'))).toBe('4')
})

test('a stored rotation choice is kept when known, else the soonest reset', () => {
  expect(rotateToFrom('order')).toBe('order')
  expect(rotateToFrom('off')).toBe('off')
  expect(rotateToFrom('room')).toBe('room')
  expect(rotateToFrom('nope')).toBe('reset')
  expect(rotateToFrom(undefined)).toBe('reset')
})

test('a window counts as empty once its reset time has passed', () => {
  expect(windowPct({ pct: 97, resetsAt: LATER }, Date.parse(LATER) + 1)).toBe(0)
  expect(windowPct({ pct: 97, resetsAt: LATER }, NOW)).toBe(97)
})

test('reads the usage endpoint body as /usage serves it', () => {
  const body = {
    five_hour: { utilization: 39.0, resets_at: '2026-10-12T12:10:00.246761+00:00', locked_reason: null },
    seven_day: { utilization: 55.0, resets_at: '2026-10-18T03:00:00.246781+00:00', locked_reason: null },
    seven_day_opus: null,
  }
  expect(readingFromUsage(body, NOW)).toEqual({
    fiveHour: { pct: 39, resetsAt: '2026-10-12T12:10:00.246761+00:00' },
    sevenDay: { pct: 55, resetsAt: '2026-10-18T03:00:00.246781+00:00' },
    at: NOW,
  })
})

const fableRow = (display_name: string, percent: unknown = 100) => ({
  kind: 'weekly_scoped',
  group: 'weekly',
  percent,
  resets_at: FABLE_END,
  scope: { model: { display_name } },
})

test('reads the Fable week from the usage body\'s limits rows: Fable and its numbered versions, no other model, no surface, no row without a percent', () => {
  const five_hour = { utilization: 20, resets_at: LATER }
  const read = (...limits: unknown[]) => readingFromUsage({ five_hour, limits }, NOW)?.fable
  expect(read(fableRow('Fable', 100))).toEqual({ pct: 100, resetsAt: FABLE_END })
  expect(read(fableRow('Fable 5.1', 40))).toEqual({ pct: 40, resetsAt: FABLE_END })
  expect(read(fableRow('fable 5', 7))).toEqual({ pct: 7, resetsAt: FABLE_END })
  expect(read(fableRow('Sonnet', 100))).toBeUndefined()
  expect(read(fableRow('Fabled', 100))).toBeUndefined()
  expect(read({ kind: 'weekly_scoped', percent: 100, resets_at: FABLE_END, scope: { surface: { display_name: 'Fable' } } })).toBeUndefined()
  expect(read({ ...fableRow('Fable'), kind: 'weekly_all' })).toBeUndefined()
  expect(read(fableRow('Fable', 'lots'))).toBeUndefined()
  expect(readingFromUsage({ five_hour }, NOW)?.fable).toBeUndefined()
})

test('a usage body with only limits answers a reading holding the Fable week alone', () => {
  expect(readingFromUsage({ limits: [fableRow('Fable 5.1', 62)] }, NOW)).toEqual({ fable: { pct: 62, resetsAt: FABLE_END }, noFiveHour: true, at: NOW })
  expect(readingFromUsage({ limits: [fableRow('Sonnet', 62)] }, NOW)).toBeUndefined()
})

// Review R2 of #6 partial_body: only a body that lists no 5-hour window says the account has none.
test('a usage body says an account has no 5-hour window only where it lists none, never where it lists one it cannot read', () => {
  const week = { utilization: 7, resets_at: WEEK_END }
  expect(readingFromUsage({ five_hour: null, seven_day: week }, NOW)?.noFiveHour).toBe(true)
  expect(readingFromUsage({ seven_day: week }, NOW)?.noFiveHour).toBe(true)
  expect(readingFromUsage({ five_hour: { resets_at: LATER }, seven_day: week }, NOW)?.noFiveHour).toBeUndefined()
  expect(readingFromUsage({ five_hour: { utilization: 30, resets_at: LATER }, seven_day: week }, NOW)?.noFiveHour).toBeUndefined()
})

// Review R2 of #6 changed_reset: a week mark is the week it was made in, and a new week ends it.
test('a stop\'s week mark counts until its reset through any read of the same week, and not through a read of another week', () => {
  const mark = { pct: 100, resetsAt: WEEK_END, at: NOW }
  const marked = { pct: 100, resetsAt: WEEK_END, isStop: true }
  const sameWeek = { sevenDay: { pct: 60, resetsAt: new Date(Date.parse(WEEK_END) + 1000).toISOString() }, at: NOW + HOUR }
  expect(withWeekMark(sameWeek, mark, NOW + HOUR)).toEqual({ ...sameWeek, sevenDay: marked })
  expect(withWeekMark(undefined, mark, NOW)).toEqual({ sevenDay: marked, at: NOW })
  const freshWeek = { sevenDay: { pct: 6, resetsAt: new Date(Date.parse(WEEK_END) + 3 * 24 * HOUR).toISOString() }, at: NOW + HOUR }
  expect(withWeekMark(freshWeek, mark, NOW + HOUR)).toBe(freshWeek)
  expect(withWeekMark(sameWeek, mark, Date.parse(WEEK_END))).toBe(sameWeek)
})

test('the Fable week is spent at 95% and not before, and not once its reset time has passed', () => {
  const fable = (pct: number) => ({ fable: { pct, resetsAt: FABLE_END }, at: NOW })
  expect(isFableSpent(fable(95), NOW)).toBe(true)
  expect(isFableSpent(fable(100), NOW)).toBe(true)
  expect(isFableSpent(fable(94), NOW)).toBe(false)
  expect(isFableSpent(fable(100), Date.parse(FABLE_END) + 1)).toBe(false)
  expect(isFableSpent({ at: NOW }, NOW)).toBe(false)
  expect(isFableSpent(undefined, NOW)).toBe(false)
})

test('a fresh reading keeps the Fable week the stored one holds where its body lists none, until that week resets, and then drops it', () => {
  const five_hour = { utilization: 20, resets_at: LATER }
  const fresh = readingFromUsage({ five_hour }, NOW)!
  const stored = { fiveHour: { pct: 50, resetsAt: LATER }, fable: { pct: 100, resetsAt: FABLE_END }, at: NOW - 60_000 }
  expect(keepFable(fresh, stored, NOW)).toEqual({ ...fresh, fable: stored.fable })
  expect(keepFable(fresh, stored, Date.parse(FABLE_END) - 1)).toEqual({ ...fresh, fable: stored.fable })
  expect(keepFable(fresh, stored, Date.parse(FABLE_END))).toEqual(fresh)
  expect(keepFable(fresh, stored, Date.parse(FABLE_END) + 1)).toEqual(fresh)
  // A stored week with no reset time to go by is not kept past this check; nothing stored adds nothing.
  expect(keepFable(fresh, { fable: { pct: 100 }, at: NOW }, NOW)).toEqual(fresh)
  expect(keepFable(fresh, { at: NOW }, NOW)).toEqual(fresh)
  expect(keepFable(fresh, undefined, NOW)).toEqual(fresh)
})

test('a fresh reading keeps the stored Fable week whatever way its body lists none: no limits, none left, another model only, a Fable row without a percent', () => {
  const five_hour = { utilization: 20, resets_at: LATER }
  const bodies: [string, unknown][] = [
    ['no limits', { five_hour }],
    ['an empty list', { five_hour, limits: [] }],
    ['another model only', { five_hour, limits: [fableRow('Sonnet', 100)] }],
    ['a Fable row without a percent', { five_hour, limits: [fableRow('Fable', 'lots')] }],
    ['a row of another kind', { five_hour, limits: [{ ...fableRow('Fable'), kind: 'weekly_all' }] }],
  ]
  const stored = { fable: { pct: 100, resetsAt: FABLE_END }, at: NOW - 60_000 }
  for (const [name, body] of bodies) {
    const fresh = readingFromUsage(body, NOW)!
    expect([name, keepFable(fresh, stored, NOW).fable]).toEqual([name, stored.fable])
  }
})

test('a Fable stop\'s mark with no reset time of its own stands a week: a check that lists no Fable week keeps it, and it ends seven days on', () => {
  const MARK_END = NOW + 7 * 24 * HOUR
  const mark = fableMark(undefined, NOW)
  expect(mark).toEqual({ pct: 100, resetsAt: new Date(MARK_END).toISOString() })
  const stored = { fable: mark, at: NOW }
  const fresh = readingFromUsage({ five_hour: { utilization: 20, resets_at: LATER } }, NOW + HOUR)!
  expect(keepFable(fresh, stored, NOW + HOUR).fable).toEqual(mark)
  expect(keepFable(fresh, stored, MARK_END - 1).fable).toEqual(mark)
  expect(keepFable(fresh, stored, MARK_END).fable).toBeUndefined()
  expect(isFableSpent(stored, MARK_END - 1)).toBe(true)
  expect(isFableSpent(stored, MARK_END)).toBe(false)
  // A Fable row in a later check replaces it.
  const read = readingFromUsage({ limits: [fableRow('Fable', 40)] }, NOW + HOUR)!
  expect(keepFable(read, stored, NOW + HOUR).fable).toEqual({ pct: 40, resetsAt: FABLE_END })
})

test('a Fable stop\'s mark takes the reset time the last read gave while it lies ahead, else a week from the stop', () => {
  const weekOn = new Date(NOW + 7 * 24 * HOUR).toISOString()
  const reads: [string, { pct: number; resetsAt?: string } | undefined, string][] = [
    ['no read', undefined, weekOn],
    ['a read with no reset time', { pct: 60 }, weekOn],
    ['a read whose reset has passed', { pct: 60, resetsAt: new Date(NOW - HOUR).toISOString() }, weekOn],
    ['a read whose reset is now', { pct: 60, resetsAt: new Date(NOW).toISOString() }, weekOn],
    ['a read whose reset lies ahead', { pct: 60, resetsAt: FABLE_END }, FABLE_END],
  ]
  for (const [name, read, resetsAt] of reads) expect([name, fableMark(read, NOW)]).toEqual([name, { pct: 100, resetsAt }])
})

test('a fresh reading with its own Fable week replaces the stored one, whatever either says', () => {
  const five_hour = { utilization: 20, resets_at: LATER }
  for (const stored of [100, 30]) {
    for (const percent of [0, 40, 94, 95, 100]) {
      const fresh = readingFromUsage({ five_hour, limits: [fableRow('Fable 5.1', percent)] }, NOW)!
      const kept = keepFable(fresh, { fable: { pct: stored, resetsAt: FABLE_END }, at: NOW - 60_000 }, NOW)
      expect([stored, percent, kept.fable]).toEqual([stored, percent, { pct: percent, resetsAt: FABLE_END }])
    }
  }
})

test('the words for every Fable week spent give the next reset, none while any account has Fable room, and no time where none is known', () => {
  expect(fableSpentNotice(view({ '1': [20, 30, 100], '2': [10, 30, 100] }), NOW)).toBe('Every Claude account has used its Fable week; the next frees up in 4d 17h.')
  // The soonest of the weeks answers.
  const sooner = view({ '1': [20, 30, 100], '2': [10, 30, 100] })
  sooner.readings['2'] = { ...sooner.readings['2'], fable: { pct: 100, resetsAt: '2026-10-16T03:00:00Z' }, at: NOW }
  expect(fableSpentNotice(sooner, NOW)).toBe('Every Claude account has used its Fable week; the next frees up in 3d 17h.')
  // Any account with room, read below 95% or not read at all, or a week that has reset: nothing to say.
  expect(fableSpentNotice(view({ '1': [20, 30, 100], '2': [10, 30, 94] }), NOW)).toBeUndefined()
  expect(fableSpentNotice(view({ '1': [20, 30, 100], '2': [10, 30] }), NOW)).toBeUndefined()
  expect(fableSpentNotice(view({ '1': [20, 30, 100], '2': [10, 30, 100] }), Date.parse(FABLE_END) + 1)).toBeUndefined()
  expect(fableSpentNotice({ ...view({ '1': [20, 30, 100] }), accounts: [] }, NOW)).toBeUndefined()
  // Marked spent with no reset time known: the words without a time.
  const marked = view({ '1': [20, 30] })
  marked.readings['1'] = { ...marked.readings['1'], fable: { pct: 100 }, at: NOW }
  expect(fableSpentNotice(marked, NOW)).toBe('Every Claude account has used its Fable week.')
})

test('a stop that says the Fable limit was reached is told from any other', () => {
  expect(isFableStop("You've reached your Fable limit. Switch to another model to continue.")).toBe(true)
  expect(isFableStop("You've reached your Fable limit. Run /usage-credits to continue or switch models with /model.")).toBe(true)
  expect(isFableStop("You've hit your session limit")).toBe(false)
  expect(isFableStop(undefined)).toBe(false)
})

test('on a Fable stop the session leaves a login whose Fable week is spent, and only then', () => {
  const v = view({ '1': [20, 30, 100] })
  expect(shouldLeave(v, NOW)).toBe(false)
  expect(shouldLeave(v, NOW, 'fable')).toBe(true)
  expect(shouldLeave(view({ '1': [20, 30, 50] }), NOW, 'fable')).toBe(false)
  expect(shouldLeave(view({ '1': [20, 30] }), NOW, 'fable')).toBe(false)
  expect(shouldLeave(view({ '1': [90, 30] }), NOW, 'fable')).toBe(true)
})

test('moving for the Fable week skips a login whose Fable week is spent, takes one not read yet, and ranks by Fable room first', () => {
  const v = view({ '1': [20, 30, 100], '2': [10, 30, 100], '3': [50, 50] })
  expect(pickTarget(v, NOW)?.id).toBe('2')
  expect(pickTarget(v, NOW, 'fable')?.id).toBe('3')
  const rooms = view({ '1': [20, 30, 100], '2': [10, 30, 80], '3': [60, 30, 10] })
  expect(pickTarget(rooms, NOW)?.id).toBe('2')
  expect(pickTarget(rooms, NOW, 'fable')?.id).toBe('3')
  expect(pickTarget(view({ '1': [20, 30, 100], '2': [10, 30, 99] }), NOW, 'fable')).toBeUndefined()
})

test('moving for the Fable week takes a login with a Fable reading below 95% over one with none, whatever the rotation picks by', () => {
  const rotations: RotateTo[] = ['reset', 'room', 'order', 'off']
  for (const rotateTo of rotations) {
    // Login 2 is unread and has more of everything; login 3 is read, with less.
    const v = view({ '1': [20, 30, 100], '2': [30, 20], '3': [60, 60, 94] }, {}, rotateTo)
    expect([rotateTo, pickTarget(v, NOW, 'fable')?.id]).toEqual([rotateTo, '3'])
    // Without the need, the unread one still ranks as it did.
    expect([rotateTo, pickTarget(v, NOW)?.id]).toEqual([rotateTo, '2'])
  }
})

test('moving for the Fable week takes a login with no Fable reading only when no read login has room', () => {
  const rotations: RotateTo[] = ['reset', 'room', 'order', 'off']
  for (const rotateTo of rotations) {
    const v = view({ '1': [20, 30, 100], '2': [0, 0], '3': [60, 60, 95] }, {}, rotateTo)
    expect([rotateTo, pickTarget(v, NOW, 'fable')?.id]).toEqual([rotateTo, '2'])
    // Unread logins only: one is taken, and none is left once all are marked spent.
    const unread = view({ '1': [20, 30, 100], '2': [0, 0], '3': [0, 0] }, {}, rotateTo)
    expect(pickTarget(unread, NOW, 'fable')).toBeDefined()
    unread.readings['2'] = { ...unread.readings['2'], fable: { pct: 100 }, at: NOW }
    unread.readings['3'] = { ...unread.readings['3'], fable: { pct: 100 }, at: NOW }
    expect([rotateTo, pickTarget(unread, NOW, 'fable')]).toEqual([rotateTo, undefined])
  }
})

test('the next reset counts the Fable week, which alone can be what is spent', () => {
  const v = {
    ...view({ '1': [0, 0], '2': [0, 0] }),
    readings: {
      '1': { fable: { pct: 100, resetsAt: FABLE_END }, at: NOW },
      '2': { fable: { pct: 100, resetsAt: '2026-10-16T03:00:00Z' }, at: NOW },
    },
  }
  expect(nextReset(v, NOW)).toBe(Date.parse('2026-10-16T03:00:00Z'))
  // A Fable week not spent holds nothing back; asked for the Fable week, the 5-hour window does not answer.
  const mixed = view({ '1': [40, 10, 20], '2': [40, 10, 100] })
  mixed.readings['1'] = { ...mixed.readings['1'], fable: { pct: 20, resetsAt: '2026-10-14T03:00:00Z' }, at: NOW }
  expect(nextReset(mixed, NOW)).toBe(Date.parse(LATER))
  expect(nextReset(mixed, NOW, 'fable')).toBe(Date.parse(FABLE_END))
})

test('the line sent to carry on is kept when it is text of at most 500 characters, trimmed; anything else is ignored', () => {
  expect(continueTextFrom('Go on.')).toBe('Go on.')
  expect(continueTextFrom('  Go on.\n')).toBe('Go on.')
  expect(continueTextFrom('x'.repeat(500))).toBe('x'.repeat(500))
  expect(continueTextFrom('x'.repeat(501))).toBeUndefined()
  expect(continueTextFrom('   ')).toBeUndefined()
  expect(continueTextFrom('')).toBeUndefined()
  expect(continueTextFrom(42)).toBeUndefined()
  expect(continueTextFrom(undefined)).toBeUndefined()
})

test('a stored login whose refresh token ran out needs a sign-in', () => {
  const blob = (refreshTokenExpiresAt: number) =>
    JSON.stringify({ claudeAiOauth: { accessToken: 't', refreshToken: 'r', expiresAt: NOW + 1000, refreshTokenExpiresAt } })
  expect(healthOf(credentialFrom(blob(NOW - 1)), NOW)).toEqual({ kind: 'login-needed', why: 'sign-in expired' })
  expect(healthOf(credentialFrom(blob(NOW + 1000)), NOW).kind).toBe('ok')
  expect(healthOf(credentialFrom('not json'), NOW)).toEqual({ kind: 'login-needed', why: 'not signed in' })
})

test('reads who a token signs in from the profile endpoint body: its email and organization', () => {
  const body = {
    account: { uuid: 'a-1', email: 'you@example.com', full_name: 'You' },
    organization: { uuid: 'o-1', name: 'Acme', organization_type: 'claude_team', rate_limit_tier: 'default_raven', seat_tier: 'team_standard' },
  }
  expect(identityFromProfile(body)).toEqual({ email: 'you@example.com', orgId: 'o-1', orgName: 'Acme' })
  expect(identityFromProfile({ account: { email: 'you@example.com' } })).toEqual({ email: 'you@example.com' })
  expect(identityFromProfile({ organization: { uuid: 'o-1' } })).toBeUndefined()
  expect(identityFromProfile(null)).toBeUndefined()
})

test('a stored sign-in carries its plan, which Claude Code reads to tell a Team seat, and the refresh token a new sign-in replaces', () => {
  const text = JSON.stringify({ claudeAiOauth: { accessToken: 't', refreshToken: 'r', expiresAt: NOW, subscriptionType: 'team' } })
  expect(credentialFrom(text)).toEqual({ accessToken: 't', expiresAt: NOW, refreshToken: 'r', plan: 'team' })
})

test('names keychain entries as Claude Code does', async () => {
  expect(await keychainItem('')).toBe('Claude Code-credentials')
  // sha256("/Users/tester/.claude/accounts/2") starts with these 8 hex digits.
  expect(await keychainItem('/Users/tester/.claude/accounts/2')).toBe(`Claude Code-credentials-${EXPECTED_SLOT2_HASH}`)
})

const EXPECTED_SLOT2_HASH = 'a296c876'

test('names credentials files as Claude Code does where there is no keychain', () => {
  expect(credentialsFile('', '/home/tester')).toBe('/home/tester/.claude/.credentials.json')
  expect(credentialsFile('', undefined)).toBeUndefined()
  expect(credentialsFile('', '')).toBeUndefined()
  expect(credentialsFile('/home/tester/.claude/accounts/2', undefined)).toBe('/home/tester/.claude/accounts/2/.credentials.json')
  // Claude Code keeps it in the directory's NFC spelling, which Linux tells apart from others.
  expect(credentialsFile('/home/rene\u0301/.claude/accounts/2', undefined)).toBe('/home/ren\u00e9/.claude/accounts/2/.credentials.json')
})

test('room left is colored green with all of it, through yellow, to red with none', () => {
  expect(roomColor(100)).toBe('#36e236')
  expect(roomColor(50)).toBe('#e2e236')
  expect(roomColor(0)).toBe('#e23636')
})

test('a pie fills by quarters', () => {
  expect([0, 12, 13, 50, 87, 88, 100].map(pie)).toEqual(['○', '○', '◔', '◑', '◕', '●', '●'])
  expect(pie(undefined)).toBe('·')
})

test('a braille cell fills from one dot to eight', () => {
  expect([0, 14, 50, 93, 100].map(braille)).toEqual(['⡀', '⣀', '⣦', '⣿', '⣿'])
})

test('a stored footer look keeps what it knows and defaults the rest', () => {
  expect(footerStyleFrom({ session: 'pie', week: 'nope', weekPercent: false, active: 'bright', fill: 'used' })).toEqual({
    session: 'pie',
    week: 'bars',
    sessionPercent: true,
    weekPercent: false,
    active: 'lines',
    fill: 'used',
  })
  expect(footerStyleFrom(undefined)).toEqual({ session: 'braille', week: 'bars', sessionPercent: true, weekPercent: true, active: 'lines', fill: 'left' })
})

test('a switch Claude Code\'s security policy refuses is told from any other failure', () => {
  const refused = 'HooksError: account-rotator: $.env.set: env (managed): CLAUDE_SECURESTORAGE_CONFIG_DIR is not for plugins outside policy to change'
  expect(isPolicyRefusal(new Error(refused))).toBe(true)
  expect(isPolicyRefusal(refused)).toBe(true)
  expect(isPolicyRefusal(new Error('HooksError: account-rotator: $.env.set: timed out'))).toBe(false)
  expect(isPolicyRefusal(undefined)).toBe(false)
})

test('counts the browsers Claude in Chrome lists, and knows its words for none answering', () => {
  expect(browsersFrom('[{"deviceId":"d","name":"Browser 1","osPlatform":"macOS","isLocal":true}]')).toBe(1)
  expect(browsersFrom('[]')).toBe(0)
  expect(browsersFrom('Browser extension is not connected.')).toBeUndefined()
  expect(isNoBrowser('Browser extension is not connected. Please ensure the Claude browser extension is installed and running')).toBe(true)
  expect(isNoBrowser("[Claude in Chrome] Claude in Chrome isn't paired with your browser (reported by the extension, unverified: account_mismatch)")).toBe(true)
  expect(isNoBrowser('Tab 12 no longer exists')).toBe(false)
})

test('the notes about Claude in Chrome say what the mod does now and what to tell the user, never /login', () => {
  const accounts = [
    { id: '1', slot: '', email: 'one@example.com' },
    { id: '2', slot: '/h/.claude/accounts/2', email: 'two@example.com' },
  ]
  const base = { ...view({ '1': [10, 10], '2': [10, 10] }), accounts, chromeAccountId: '1', activeId: '2', sessionId: 'session-1' }
  const onTwo = { ...base, chrome: { as: '2', isPaired: false, hasFailed: true } }
  expect(chromeNote(onTwo, 'connecting')).toBe(
    'Claude in Chrome connected as Claude account 2 (two@example.com) and found no browser. ' +
      "The account-rotator mod is now connecting it as Claude account 1 (one@example.com), the account the user's Chrome extension is signed in to, which takes under a minute. " +
      "End your turn now: you'll get a message once it's connected. Don't suggest /login: it doesn't fix this.",
  )
  expect(chromeNote(base, 'held')).toMatch(/^The account-rotator mod is connecting Claude in Chrome as Claude account 1 \(one@example\.com\).* End your turn now/)
  expect(chromeNote(onTwo, 'no-browser')).toMatch(/^No Chrome extension answers as Claude account 1 \(one@example\.com\), the account picked for it in the Claude accounts panel: .* If it is another account, they press Use for Chrome or Try to connect next to it .* If it matches, they restart Chrome and press Connect above the prompt\./)
  const blocked = { ...onTwo, isSwitchBlocked: true }
  expect(chromeNote(blocked, 'blocked')).toMatch(/Claude Code doesn't let this session switch accounts\. Tell the user that to use Chrome, they quit Claude Code and run `claude --resume session-1` in this terminal/)
  // Connected as the extension's account in a session that can't move: no Connect to press, Chrome to open.
  expect(chromeNote({ ...blocked, chrome: { as: '1', isPaired: false } }, 'no-browser')).toMatch(/If it matches, they restart Chrome, then you try again\./)
  expect(chromeNote({ ...onTwo, chromeAccountId: undefined }, 'unset')).toMatch(/doesn't know which one that is\. Ask the user to press Use for Chrome or Try to connect next to it under Chrome in the Claude accounts panel/)
  for (const kind of ['held', 'connecting', 'no-browser', 'blocked', 'unset'] as const) expect(chromeNote(onTwo, kind)).not.toMatch(/Run \/login|run \/login/)
})

/** Claude Code's own way out of the Fable limit, which every notice of a stay ends on. */
const WAY_OUT = 'Run /usage-credits to continue or switch models with /model.'

/** A Fable stop on account 1 with Fable room on account 2: the session moves, so there is nothing to explain. */
const CAN_MOVE = () => view({ '1': [20, 30, 100], '2': [10, 30, 10] })

/** Each reason a Fable stop can end with the session where it was, and a view, the connect flag and the accounts skipped that stage it. */
const STAYS: { name: string; reason: string; view: View; isConnecting?: boolean; skip?: string[] }[] = [
  { name: 'Connect holds the session', reason: 'chrome', view: CAN_MOVE(), isConnecting: true },
  { name: 'rotation off', reason: 'off', view: { ...CAN_MOVE(), rotateTo: 'off' } },
  { name: 'Claude Code refuses switching', reason: 'blocked', view: { ...CAN_MOVE(), isSwitchBlocked: true } },
  { name: 'every Fable week spent', reason: 'fable-spent', view: view({ '1': [20, 30, 100], '2': [10, 30, 100] }) },
  { name: 'the other account has its 5-hour window full', reason: 'no-room', view: view({ '1': [20, 30, 100], '2': [95, 30, 10] }) },
  { name: 'the other account has its week full', reason: 'no-room', view: view({ '1': [20, 30, 100], '2': [10, 100, 10] }) },
  { name: 'the other account needs a sign-in', reason: 'no-room', view: view({ '1': [20, 30, 100], '2': [10, 30, 10] }, { '2': { kind: 'login-needed', why: 'not signed in yet' } }) },
  { name: 'the other account was tried and did not take', reason: 'no-room', view: CAN_MOVE(), skip: ['2'] },
]

test('a Fable stop that did not move gives the reason, one per cause the rotation can stay for', () => {
  expect(fableStay(CAN_MOVE(), NOW, false, new Set())).toBeUndefined()
  // A stop moves the session on from a switch still settling (maybeRotate lets it through), so that is no reason.
  expect(fableStay({ ...CAN_MOVE(), pending: { id: '2', from: '1', since: NOW } }, NOW, false, new Set())).toBeUndefined()
  for (const { name, reason, view: v, isConnecting = false, skip = [] } of STAYS) {
    expect([name, fableStay(v, NOW, isConnecting, new Set(skip))?.reason]).toEqual([name, reason])
  }
})

test('the reasons are told in the order maybeRotate checks them', () => {
  const all = { ...view({ '1': [20, 30, 100], '2': [95, 30, 100] }), rotateTo: 'off' as const, isSwitchBlocked: true, pending: { id: '2', from: '1', since: NOW } }
  let v: View = { ...all, rotateTo: 'off' }
  expect(fableStay(v, NOW, true, new Set())?.reason).toBe('chrome')
  expect(fableStay(v, NOW, false, new Set())?.reason).toBe('off')
  v = { ...v, rotateTo: 'room' }
  expect(fableStay(v, NOW, false, new Set())?.reason).toBe('blocked')
  v = { ...v, isSwitchBlocked: false }
  expect(fableStay(v, NOW, false, new Set())?.reason).toBe('fable-spent')
  v = { ...v, readings: { ...v.readings, '2': { ...v.readings['2'], fable: { pct: 10, resetsAt: FABLE_END }, at: NOW } } }
  expect(fableStay(v, NOW, false, new Set())?.reason).toBe('no-room')
})

test('every reason has its own words, naming the account and ending on Claude Code\'s way out; every Fable week spent keeps its words', () => {
  const texts = new Map<string, string>()
  for (const { name, reason, view: v, isConnecting = false, skip = [] } of STAYS) {
    const stay = fableStay(v, NOW, isConnecting, new Set(skip))
    expect(stay).toBeDefined()
    const text = stay?.text ?? ''
    if (reason === 'fable-spent') {
      expect([name, text]).toEqual([name, fableSpentNotice(v, NOW)])
      continue
    }
    expect([name, text.startsWith('Fable limit reached on account 1')]).toEqual([name, true])
    expect([name, text.endsWith(WAY_OUT)]).toEqual([name, true])
    expect(text.length).toBeLessThan(260)
    texts.set(reason, text)
  }
  // One text per reason, whatever stages it.
  expect([...texts.keys()].sort()).toEqual(['blocked', 'chrome', 'no-room', 'off'])
  expect(new Set(texts.values()).size).toBe(4)
})

// ---------------------------------------------------------------- one usage schedule per store

const MIN = 60_000

test('a read is due with no schedule, within the early window, and a back-off only once it has passed', () => {
  expect(isUsageDue(undefined, NOW)).toBe(true)
  expect(isUsageDue({ next: NOW + USAGE_EARLY_MS, fails: 0 }, NOW)).toBe(true)
  expect(isUsageDue({ next: NOW + USAGE_EARLY_MS + 1, fails: 0 }, NOW)).toBe(false)
  expect(isUsageDue({ next: NOW + 1, fails: 1 }, NOW)).toBe(false)
  expect(isUsageDue({ next: NOW, fails: 1 }, NOW)).toBe(true)
})

test('after a body the next read is in 10 minutes for a login in use and 30 for one no response read', () => {
  expect(afterUsage(undefined, { kind: 'ok', hasResponded: true }, NOW)).toEqual({ next: NOW + 10 * MIN, fails: 0, at: NOW, v })
  expect(afterUsage({ next: NOW, fails: 3, at: NOW - HOUR, retryAfter: 5 }, { kind: 'ok', hasResponded: false }, NOW)).toEqual({ next: NOW + 30 * MIN, fails: 0, at: NOW, v })
})

test('a failure waits its Retry-After or 2 minutes doubled per failure before, whichever is longer, at most an hour, keeping the last good read', () => {
  const at = NOW - HOUR
  expect(afterUsage({ next: NOW, fails: 0, at }, { kind: 'failed' }, NOW)).toEqual({ next: NOW + 2 * MIN, fails: 1, at, v })
  expect(afterUsage({ next: NOW, fails: 2, at }, { kind: 'failed' }, NOW)).toEqual({ next: NOW + 8 * MIN, fails: 3, at, v })
  expect(afterUsage({ next: NOW, fails: 0, at }, { kind: 'failed', retryAfter: 30 * MIN }, NOW)).toEqual({ next: NOW + 30 * MIN, fails: 1, at, retryAfter: 30 * MIN, v })
  expect(afterUsage({ next: NOW, fails: 9, at }, { kind: 'failed' }, NOW).next).toBe(NOW + USAGE_BACKOFF_MAX_MS)
  expect(afterUsage({ next: NOW, fails: 0, at }, { kind: 'failed', retryAfter: 2 * HOUR }, NOW).next).toBe(NOW + USAGE_BACKOFF_MAX_MS)
  // A rejected sign-in is no rate limit: no back-off, so a new sign-in reads at once.
  expect(afterUsage({ next: NOW, fails: 2, at }, { kind: 'rejected' }, NOW)).toEqual({ next: NOW + 10 * MIN, fails: 0, at, v })
})

/** The version every schedule this one writes carries. */
const v = WRITER_VERSION

test('an older version\'s schedule with no back-off gates no login this version holds no reading of; its back-off, and every schedule of this version, does', () => {
  const older = { next: NOW + 20 * MIN, fails: 0, at: NOW }
  expect(gatingDue(older, false)).toBeUndefined()
  expect(gatingDue(older, true)).toEqual(older)
  expect(gatingDue({ ...older, fails: 1 }, false)).toEqual({ ...older, fails: 1 })
  expect(gatingDue({ ...older, v }, false)).toEqual({ ...older, v })
  expect(usageDueFrom({ ...older, v })?.v).toBe(v)
})

test('a stop, /login or sign-in reads only past a minute since the last good read, with no back-off and no other session\'s read under way', () => {
  expect(mayForceUsage(undefined, 'me', NOW)).toBe(true)
  expect(mayForceUsage({ next: NOW + 9 * MIN, fails: 0, at: NOW - 30_000 }, 'me', NOW)).toBe(false)
  expect(mayForceUsage({ next: NOW + 9 * MIN, fails: 0, at: NOW - 2 * MIN }, 'me', NOW)).toBe(true)
  expect(mayForceUsage({ next: NOW + 9 * MIN, fails: 1, at: NOW - HOUR }, 'me', NOW)).toBe(false)
  expect(mayForceUsage({ next: NOW - 1, fails: 1, at: NOW - HOUR }, 'me', NOW)).toBe(true)
  expect(mayForceUsage({ next: NOW + 60_000, fails: 0, claim: 'other', at: NOW - HOUR }, 'me', NOW)).toBe(false)
  expect(mayForceUsage({ next: NOW + 60_000, fails: 0, claim: 'me', at: NOW - HOUR }, 'me', NOW)).toBe(true)
  // A claim whose session died mid-read frees the read once it runs out.
  expect(mayForceUsage({ next: NOW - 1, fails: 0, claim: 'other', at: NOW - HOUR }, 'me', NOW)).toBe(true)
})

test('Retry-After is read in seconds or as an HTTP date; none, 0 or junk is none', () => {
  expect(retryAfterFrom({ 'retry-after': '1800' }, NOW)).toBe(1800_000)
  expect(retryAfterFrom({ 'retry-after': new Date(NOW + 90_000).toUTCString() }, NOW)).toBe(90_000)
  expect(retryAfterFrom({ 'retry-after': '0' }, NOW)).toBeUndefined()
  expect(retryAfterFrom({ 'retry-after': 'soon' }, NOW)).toBeUndefined()
  expect(retryAfterFrom({}, NOW)).toBeUndefined()
})

test('a stored schedule is read field by field; one with no time is none', () => {
  expect(usageDueFrom({ next: NOW, fails: 2, claim: 's', at: NOW - 1, retryAfter: 5 })).toEqual({ next: NOW, fails: 2, claim: 's', at: NOW - 1, retryAfter: 5 })
  expect(usageDueFrom({ next: NOW, fails: -1 })).toEqual({ next: NOW, fails: 0 })
  expect(usageDueFrom({ fails: 0 })).toBeUndefined()
  expect(usageDueFrom('x')).toBeUndefined()
})

test('two week resets are one week within an hour of each other or a whole number of weeks apart, and not otherwise', () => {
  expect(isSameWeek(WEEK_END, WEEK_END)).toBe(true)
  expect(isSameWeek(WEEK_END, new Date(Date.parse(WEEK_END) + 59 * 60_000).toISOString())).toBe(true)
  expect(isSameWeek(WEEK_END, new Date(Date.parse(WEEK_END) - 7 * 24 * HOUR).toISOString())).toBe(true)
  expect(isSameWeek(WEEK_END, new Date(Date.parse(WEEK_END) + 2 * HOUR).toISOString())).toBe(false)
  expect(isSameWeek(WEEK_END, new Date(Date.parse(WEEK_END) - 24 * HOUR).toISOString())).toBe(false)
  expect(isSameWeek(undefined, WEEK_END)).toBe(false)
})

test('a response\'s week is every login whose stored week resets with it: one, none, or two that share a reset', () => {
  const at = NOW
  const week = (resetsAt: string) => ({ sevenDay: { pct: 10, resetsAt }, at })
  const other = '2026-10-17T05:00:00Z'
  const readings = { '1': week(WEEK_END), '2': week(other), '3': week(other) }
  expect(whoseWeek(week(WEEK_END), readings)).toEqual(['1'])
  expect(whoseWeek(week(other), readings)).toEqual(['2', '3'])
  expect(whoseWeek(week('2026-10-15T00:00:00Z'), readings)).toEqual([])
  expect(whoseWeek({ fiveHour: { pct: 10, resetsAt: LATER }, at }, readings)).toEqual([])
})

/** A store in memory, as the sessions on one Mac share it. */
function memoryStore(): { values: Map<string, unknown>; get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> } {
  const values = new Map<string, unknown>()
  return { values, get: async key => values.get(key), set: async (key, value) => void values.set(key, value) }
}

// Review codex-r1 LEASE [CLAIM-LEASE], the instance, adapted to the fix: the claim is renewed as each read starts,
// so a read that starts late in a long check still holds it against a session that claims a lease later.
test('a claim renewed as its read starts holds the read for a lease from the read, not from the check', async () => {
  const store = memoryStore()
  expect((await claimDueReads(store, ['1'], 'A', NOW, async () => {})).has('1')).toBe(true)
  // A's read of login 1 starts 80 s into its check.
  const renewed = renewClaim(usageDueFrom(store.values.get('usage-due:1')), 'A', NOW + 80_000)
  expect(renewed).toBeDefined()
  await store.set('usage-due:1', renewed)
  expect((await claimDueReads(store, ['1'], 'B', NOW + USAGE_CLAIM_MS, async () => {})).has('1')).toBe(false)
})

// Review codex-r1 LEASE [CLAIM-LEASE], the class: every position in a check's list, and every way a claim stops
// being this session's (it ran out and another took it, another's read finished).
test('a read renews only a claim still its own, at every position of the check', async () => {
  const ids = ['1', '2', '3', '4', '5']
  for (const id of ids) {
    const store = memoryStore()
    await claimDueReads(store, ids, 'A', NOW, async () => {})
    const at = NOW + 20_000 * Number(id)
    expect([id, renewClaim(usageDueFrom(store.values.get(`usage-due:${id}`)), 'A', at)?.claim]).toEqual([id, 'A'])
  }
  const lapsed = memoryStore()
  await claimDueReads(lapsed, ['1'], 'A', NOW, async () => {})
  await claimDueReads(lapsed, ['1'], 'B', NOW + USAGE_CLAIM_MS, async () => {})
  expect(renewClaim(usageDueFrom(lapsed.values.get('usage-due:1')), 'A', NOW + USAGE_CLAIM_MS + 1)).toBeUndefined()
  expect(renewClaim(afterUsage(undefined, { kind: 'ok', hasResponded: false }, NOW), 'A', NOW + 1)).toBeUndefined()
})

// Review codex-r1 BACKOFF [TICK-BOUND-WAIT], adapted to the fix: due-ness is judged on the minute's tick, so a
// capped back-off is read within one tick of its end, whatever the phase of the failure.
test('a capped back-off is read at the first minute tick after it ends, at every phase of the failure', () => {
  for (const phase of [1, 300, 30_000, 59_999, 5 * 60_000]) {
    const readAt = NOW + phase
    const due = afterUsage({ next: readAt, fails: 9 }, { kind: 'failed' }, readAt)
    expect(due.next).toBe(readAt + USAGE_BACKOFF_MAX_MS)
    const ticks = Array.from({ length: 70 }, (_, i) => NOW + (i + 1) * MIN)
    const firstRead = ticks.find(tick => isUsageDue(due, tick))
    expect([phase, firstRead === undefined ? Infinity : firstRead - readAt]).toEqual([phase, expect.any(Number)])
    expect(firstRead! - readAt).toBeLessThanOrEqual(USAGE_BACKOFF_MAX_MS + MIN)
    expect(firstRead! - readAt).toBeGreaterThanOrEqual(USAGE_BACKOFF_MAX_MS)
  }
})

test('a settling switch reads a login once: not past a good read since the switch, a back-off or another session\'s read', () => {
  const since = NOW - 2 * MIN
  expect(mayReadSince({ next: NOW + 9 * MIN, fails: 0, at: since - 1 }, 'me', NOW, since)).toBe(true)
  expect(mayReadSince({ next: NOW + 9 * MIN, fails: 0, at: since }, 'me', NOW, since)).toBe(true)
  expect(mayReadSince({ next: NOW + 9 * MIN, fails: 0, at: since + 1 }, 'me', NOW, since)).toBe(false)
  expect(mayReadSince({ next: NOW + 9 * MIN, fails: 1, at: since - 1 }, 'me', NOW, since)).toBe(false)
  expect(mayReadSince({ next: NOW + 60_000, fails: 0, claim: 'other', at: since - 1 }, 'me', NOW, since)).toBe(false)
})

/**
 * Sessions sharing one store, on a clock of the test's: each checks at its boot and every minute, claiming what is
 * due, as `checkAll` does, and reads the logins its claims hold. Scheduled reads only: no stop, /login or sign-in.
 * Answers the calls per login.
 */
async function simulate(boots: readonly number[], inUse: ReadonlySet<string>, span: number): Promise<Record<string, number>> {
  const store = new Map<string, unknown>()
  const shared = { get: async (key: string) => store.get(key), set: async (key: string, value: unknown) => void store.set(key, value) }
  const ids = ['1', '2', '3', '4', '5']
  const calls: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]))
  let now = NOW
  const waits: { at: number; resolve: () => void }[] = []
  const sleep = (ms: number) => new Promise<void>(resolve => waits.push({ at: now + ms, resolve }))
  const drain = () => new Promise(resolve => setTimeout(resolve, 0))
  const check = async (sid: string) => {
    const ours = await claimDueReads(shared, ids, sid, now, () => sleep(USAGE_CLAIM_WAIT_MS))
    for (const id of ours) {
      calls[id] = (calls[id] ?? 0) + 1
      const due = usageDueFrom(store.get(`usage-due:${id}`))
      store.set(`usage-due:${id}`, afterUsage(due, { kind: 'ok', hasResponded: inUse.has(id) }, now))
    }
  }
  const checks = boots.flatMap((boot, i) => Array.from({ length: Math.ceil(span / MIN) + 1 }, (_, k) => ({ at: NOW + boot + k * MIN, sid: `session-${i}` })))
  // From event to event, in time order: checks due at one time start together, as sessions do, then the claim waits.
  for (;;) {
    const t = Math.min(...checks.map(c => c.at), ...waits.map(w => w.at))
    if (!(t < NOW + span)) return calls
    now = t
    for (const c of checks.filter(c => c.at === t)) {
      checks.splice(checks.indexOf(c), 1)
      void check(c.sid)
    }
    await drain()
    for (const w of waits.filter(w => w.at <= t)) {
      waits.splice(waits.indexOf(w), 1)
      w.resolve()
    }
    await drain()
  }
}

test('five sessions on one store for an hour, two of them launched together: at most 6 calls for the login in use and 2 for each idle one', async () => {
  const calls = await simulate([0, 0, 1 * MIN, 3.5 * MIN, 7 * MIN], new Set(['1']), HOUR)
  expect(calls['1']).toBeLessThanOrEqual(6)
  expect(calls['1']).toBeGreaterThanOrEqual(5)
  for (const id of ['2', '3', '4', '5']) {
    expect([id, calls[id]]).toEqual([id, 2])
  }
})

// puma-eslxj.6 (C5): every plan fixture, by the order the plan's name is read in.
const PLAN_FIXTURES: [string, Parameters<typeof planName>[0], boolean, string | undefined][] = [
  ['the profile\'s name wins over all', { plan: 'max', planName: 'Ultra', tier: 'default_claude_max_5x' }, false, 'Ultra'],
  ['a Max 20x tier', { plan: 'max', tier: 'default_claude_max_20x' }, false, 'Ultra'],
  ['claude auth status\'s Max 20x tier', { plan: 'max', tier: 'max_20x' }, false, 'Ultra'],
  ['a Max 5x tier, even with no 5-hour window', { plan: 'max', tier: 'default_claude_max_5x' }, true, 'Max'],
  ['an unknown tier falls through to the plan word', { plan: 'max', tier: 'default_claude_galaxy' }, true, 'Ultra'],
  ['max with no 5-hour window', { plan: 'max' }, true, 'Ultra'],
  ['max with one', { plan: 'max' }, false, 'Max'],
  ['pro', { plan: 'pro' }, false, 'Pro'],
  ['team', { plan: 'team' }, false, 'Team'],
  ['enterprise', { plan: 'enterprise' }, false, 'Enterprise'],
  ['an unknown word, as it is', { plan: 'galaxy' }, false, 'galaxy'],
  ['nothing known', {}, true, undefined],
  ['an empty profile name is none', { plan: 'pro', planName: '' }, false, 'Pro'],
]
test('a plan is named by the profile, else the sign-in\'s tier, else its plan word with Ultra where max reports no 5-hour window', () => {
  const offenders = PLAN_FIXTURES.filter(([, a, noFive, want]) => planName(a, noFive) !== want).map(([name, a, noFive]) => `${name}: ${planName(a, noFive)}`)
  expect(offenders).toEqual([])
})

test('the Company is the organization unless it is the one named for the account\'s own email', () => {
  expect(companyOf({ email: 'a@b.c', orgName: "a@b.c's Organization" })).toBeUndefined()
  expect(companyOf({ email: 'a@b.c', orgName: 'Lutso Health' })).toBe('Lutso Health')
  expect(companyOf({ email: 'a@b.c', orgName: "x@y.z's Organization" })).toBe("x@y.z's Organization")
  expect(companyOf({ email: 'a@b.c' })).toBeUndefined()
})

// Opus advisory TIER-TWO-SPELLINGS: the tier has one source, the credential; claude auth status's planTier is not read.
test('the sign-in\'s tier comes from its rateLimitTier alone', () => {
  const text = JSON.stringify({ claudeAiOauth: { accessToken: 't', expiresAt: 1, subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } })
  expect(credentialFrom(text)?.tier).toBe('default_claude_max_20x')
  const status = JSON.stringify({ loggedIn: true, email: 'a@b.c', subscriptionType: 'max', planTier: 'max_20x' })
  expect(identityFromStatus(status)?.tier).toBeUndefined()
  const profile = { account: { email: 'a@b.c' }, organization: { uuid: 'o', name: 'N', plan_display_name: 'Ultra' } }
  expect(identityFromProfile(profile)?.planName).toBe('Ultra')
})

// Review codex-c5 CROSS-PLAN-TIER (Opus advisory TEAM-TIER-PRECEDENCE): a Max-shaped tier names only a max plan, or one with no word.
test('a Max tier never renames a Pro, Team, Enterprise or unknown plan', () => {
  const expected = { pro: 'Pro', team: 'Team', enterprise: 'Enterprise', galaxy: 'galaxy' } as const
  const bad = Object.entries(expected).flatMap(([plan, want]) =>
    ['default_claude_max_20x', 'default_claude_max_5x', 'max_20x', 'max_5x'].flatMap(tier => {
      const got = planName({ plan, tier }, false)
      return got === want ? [] : [`${plan}/${tier}: ${got}`]
    }))
  expect(bad).toEqual([])
  expect(planName({ tier: 'default_claude_max_20x' }, false)).toBe('Ultra')
})

// Review codex-c5 OWN-COMPANY-MATCH (Opus advisory COMPANY-EXACT-MATCH): the own organization matches whatever its spaces and the email's case.
test('the organization named for the account\'s own email is no Company, whatever its outer spaces or the email\'s case', () => {
  const names = [" a@b.c's Organization ", "A@B.C's Organization", "a@b.c's Organization ", "a@b.c's Organization"]
  expect(names.filter(orgName => companyOf({ email: 'a@b.c', orgName }) !== undefined)).toEqual([])
  expect(companyOf({ email: 'A@b.c', orgName: "a@b.c's Organization" })).toBeUndefined()
  expect(companyOf({ email: 'a@b.c', orgName: "a@b.c's Organization Team" })).toBe("a@b.c's Organization Team")
})

// C6 (puma-eslxj.7): the Fable week per account, and the mark a Fable stop leaves under its own key.

/** A usage body shaped as C0 captured one (puma-eslxj.1 item 3): no 5-hour window, the week, and its `limits` rows. */
const c0Body = (limits: unknown[]) => ({
  five_hour: null,
  seven_day: { utilization: 31, resets_at: WEEK_END },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: { utilization: 12, resets_at: WEEK_END },
  limits,
  spend: null,
  extra_usage: null,
  weekly_scoped_shares: [],
  seven_day_breakdown: [],
})
const c0Row = (model: string, percent: number) => ({ kind: 'weekly_scoped', group: 'weekly', percent, resets_at: FABLE_END, scope: { model: { display_name: model } } })

test('a C0-shaped usage body yields its Fable week, and one with no Fable row yields none: account 4 read from a response alone', () => {
  expect(readingFromUsage(c0Body([c0Row('Sonnet', 100), c0Row('Fable 5.1', 34)]), NOW)?.fable).toEqual({ pct: 34, resetsAt: FABLE_END })
  expect(readingFromUsage(c0Body([c0Row('Sonnet', 100)]), NOW)?.fable).toBeUndefined()
})

const fableAt = (pct: number, resetsAt = FABLE_END) => ({ at: NOW, sevenDay: { pct: 30, resetsAt: WEEK_END }, fable: { pct, resetsAt } })
const stopMark = (resetsAt = FABLE_END) => ({ pct: 100, resetsAt, at: NOW })

test('a Fable stop\'s mark lays its spent week on the reading until its reset, whatever lower percent a body of the same week reads', () => {
  expect(withFableMark(fableAt(80), stopMark(), NOW)?.fable).toEqual({ pct: 100, resetsAt: FABLE_END, isStop: true })
  expect(withFableMark(fableAt(80), stopMark(), Date.parse(FABLE_END))).toEqual(fableAt(80))
  expect(withFableMark(fableAt(80), undefined, NOW)).toEqual(fableAt(80))
  // A login with no reading takes the mark alone.
  expect(withFableMark(undefined, stopMark(), NOW)).toEqual({ at: NOW, fable: { pct: 100, resetsAt: FABLE_END, isStop: true } })
})

test('a body whose Fable week resets over an hour after the mark\'s reads a new week, which ends the mark', () => {
  const next = new Date(Date.parse(FABLE_END) + 2 * HOUR).toISOString()
  expect(withFableMark(fableAt(5, next), stopMark(), NOW)).toEqual(fableAt(5, next))
  const near = new Date(Date.parse(FABLE_END) + HOUR / 2).toISOString()
  expect(withFableMark(fableAt(5, near), stopMark(), NOW)?.fable?.pct).toBe(100)
})

test('a mark that guessed a week from the stop ends at the earlier reset a body of its week reads', () => {
  const guessed = new Date(NOW + 7 * 24 * HOUR).toISOString()
  expect(withFableMark(fableAt(40), stopMark(guessed), NOW)?.fable).toEqual({ pct: 100, resetsAt: FABLE_END, isStop: true })
  expect(withFableMark(fableAt(40), stopMark(guessed), Date.parse(FABLE_END))).toEqual(fableAt(40))
  // A body that lists no Fable week leaves the guess standing.
  expect(withFableMark({ at: NOW }, stopMark(guessed), NOW)?.fable?.resetsAt).toBe(guessed)
})

test('a stored Fable week that reset before the stop is an older week: it leaves the mark whole', () => {
  const guessed = new Date(NOW + 7 * 24 * HOUR).toISOString()
  const older = new Date(NOW - HOUR).toISOString()
  expect(withFableMark(fableAt(100, older), stopMark(guessed), NOW)?.fable).toEqual({ pct: 100, resetsAt: guessed, isStop: true })
})

// Review opus-c6 F1 [MARK-OUTLIVES-WEEK] (RULING 4481): a stop that guessed its week (no reset known) under an hour
// before the real reset holds the NEXT week spent; both mark functions, every lead before the reset.
const HOUR_LEADS = [60_000, HOUR / 2, HOUR - 60_000, HOUR + 60_000, 6 * HOUR, 24 * HOUR, 6 * 24 * HOUR]
const STORED_WEEKS = [undefined, { pct: 40, resetsAt: new Date(NOW - HOUR).toISOString() }]
const WEEK = 7 * 24 * HOUR

test('a mark that guessed its week ends once a body reads the week after the real reset, wherever in its week the stop fell', () => {
  const offenders: string[] = []
  let cases = 0
  for (const lead of HOUR_LEADS) {
    for (const read of STORED_WEEKS) {
      const realReset = NOW + lead
      const now = realReset + 60_000
      const next = new Date(realReset + WEEK).toISOString()
      const guessedFable = fableMark(read, NOW)
      const fable = withFableMark({ at: now, fable: { pct: 0, resetsAt: next } }, { pct: 100, resetsAt: guessedFable.resetsAt as string, at: NOW }, now)
      const guessedWeek = spentMark(read, NOW, WEEK)
      const week = withWeekMark({ at: now, sevenDay: { pct: 0, resetsAt: next } }, { pct: 100, resetsAt: guessedWeek.resetsAt as string, at: NOW }, now)
      const where = `stop ${lead / 60_000} min before the reset, stored ${read === undefined ? 'none' : 'a past week'}`
      cases += 1
      if (isFableSpent(fable, now)) offenders.push(`Fable: ${where}`)
      if (week?.sevenDay?.isStop === true) offenders.push(`week: ${where}`)
    }
  }
  expect(cases).toBe(HOUR_LEADS.length * STORED_WEEKS.length)
  expect(offenders).toEqual([])
})

test('a stop\'s mark stands over a lagging body of its own week, the week that began before the stop', () => {
  const now = NOW + HOUR
  expect(withFableMark(fableAt(40), stopMark(), now)?.fable?.pct).toBe(100)
  expect(withWeekMark({ at: now, sevenDay: { pct: 40, resetsAt: WEEK_END } }, { pct: 100, resetsAt: WEEK_END, at: NOW }, now)?.sevenDay?.isStop).toBe(true)
})

// Review opus-c6 F2 [UNDO-OWNERSHIP] (RULING 4481): a held mark that stands takes the later `at`, so a write that keeps
// it is no longer byte-equal to the provisional stop's own.
test('a held Fable mark that stands takes the later of the two marks\' times', () => {
  const held = { pct: 100, resetsAt: FABLE_END, at: NOW }
  expect(laterMark(held, { pct: 100, resetsAt: FABLE_END, at: NOW + 5 })).toEqual({ ...held, at: NOW + 5 })
  expect(laterMark(held, { pct: 100, resetsAt: '2026-10-16T03:00:00Z', at: NOW + 5 })).toEqual({ ...held, at: NOW + 5 })
})

test('of two Fable marks the one that ends later stands, and of one, that one', () => {
  const later = new Date(Date.parse(FABLE_END) + HOUR).toISOString()
  expect(laterMark(stopMark(), stopMark(later))).toEqual(stopMark(later))
  expect(laterMark(stopMark(later), stopMark())).toEqual(stopMark(later))
  expect(laterMark(undefined, stopMark())).toEqual(stopMark())
})

// C8 (puma-eslxj.9, problem g part 1): one row model, so the pane and the CLI cannot drift. The operator's row, from
// the epic's "The row, exactly": `<email> · <Company> · <Plan>  updated HH:MM`, then `Used <bar> N% Fable <bar> N%
// resets Nd Nh Nm`. The clock is fixed and the zone named: 16:34Z is 18:34 in Tallinn in November.
const ROW_NOW = Date.parse('2026-11-08T16:40:00Z')
const READ_AT = Date.parse('2026-11-08T16:34:00Z')
const FAILED_AT = Date.parse('2026-11-08T16:39:00Z')
const TALLINN = 'Europe/Tallinn'
const MINUTE = 60_000
/** A time `d` days, `h` hours and `m` minutes after the row's clock. */
const ahead = (d: number, h: number, m: number) => new Date(ROW_NOW + ((d * 24 + h) * 60 + m) * MINUTE).toISOString()
const ROW_WEEK_END = ahead(2, 3, 14)
const ANDRES = { id: '1', slot: '', email: 'andres@lutsohealth.com', orgName: 'Company', plan: 'max', tier: 'default_claude_max_20x' }
const HTTP_429 = { why: 'the usage call answered HTTP 429 (retry after 60 s)', at: FAILED_AT }

/** An Ultra login read at 18:34 Tallinn time: its week 31% used and its Fable week 38%, both resetting in 2d 3h 14m. */
function rowView(change: Partial<View> = {}, account: View['accounts'][number] = ANDRES): View {
  return {
    ...EMPTY_VIEW,
    accounts: [account],
    activeId: '1',
    health: { '1': { kind: 'ok' } },
    readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, fable: { pct: 38, resetsAt: ROW_WEEK_END }, noFiveHour: true, at: READ_AT, by: '1' } },
    noFiveHour: { '1': true },
    readAt: { '1': READ_AT },
    ...change,
  }
}
const rowLines = (v: View, timeZone = TALLINN) => rowText(rowOf(v, v.accounts[0] ?? ANDRES, ROW_NOW, timeZone))
const OPERATOR_LINE_2 = 'Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable ▰▰▰▰▱▱▱▱▱▱ 38%  resets 2d 3h 14m'

test('the row is the operator\'s two lines: who, Company and plan, the last good read\'s time, then the week and Fable used', () => {
  expect(rowLines(rowView())).toEqual(['andres@lutsohealth.com · Company · Ultra  updated 18:34', OPERATOR_LINE_2])
})

test('a failed read newer than the last good one ends line 1 with its time and status, and dims line 2', () => {
  const v = rowView({ checkErrors: { '1': HTTP_429 } })
  expect(rowLines(v)).toEqual(['andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (HTTP 429)', OPERATOR_LINE_2])
  const [line1, line2] = rowOf(v, ANDRES, ROW_NOW, TALLINN).lines
  expect(line1?.at(-1)).toEqual({ text: '18:39 Failed to update (HTTP 429)', tone: 'warning', runs: [{ clock: FAILED_AT }, ' Failed to update (HTTP 429)'] })
  expect(line2?.map(p => p.tone)).toEqual(line2?.map(() => 'dim'))
  expect(rowOf(rowView(), ANDRES, ROW_NOW, TALLINN).lines[1]?.some(p => p.tone === 'dim')).toBe(false)
})

test('a failure older than the last good read is past: line 1 says when the good read came', () => {
  expect(rowLines(rowView({ checkErrors: { '1': { ...HTTP_429, at: READ_AT - MINUTE } } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  updated 18:34')
})

test('a failure that names no HTTP status says it failed, with nothing in parentheses', () => {
  const v = rowView({ checkErrors: { '1': { why: 'the check failed (TypeError); the debug log has the rest', at: FAILED_AT } } })
  expect(rowLines(v)[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update')
})

test('the updated time is the last good usage read\'s, not a response\'s that rewrote the reading since', () => {
  const v = rowView()
  const bumped = { ...rowView(), readings: { '1': { ...v.readings['1'], at: ROW_NOW } } } as View
  expect(rowLines(bumped)[0]).toBe('andres@lutsohealth.com · Company · Ultra  updated 18:34')
})

test('a login with no good read known draws no updated time', () => {
  expect(rowLines(rowView({ readAt: {} }))[0]).toBe('andres@lutsohealth.com · Company · Ultra')
})

test('the time is the zone\'s: the same read is 16:34 in UTC', () => {
  expect(rowLines(rowView(), 'UTC')[0]).toBe('andres@lutsohealth.com · Company · Ultra  updated 16:34')
})

test('an organization named for the login\'s own email draws no Company', () => {
  expect(rowLines(rowView({}, { ...ANDRES, orgName: "andres@lutsohealth.com's Organization" }))[0]).toBe('andres@lutsohealth.com · Ultra  updated 18:34')
})

test('a login that needs a sign-in says so in place of the time, a failure standing or not', () => {
  const v = rowView({ health: { '1': { kind: 'login-needed', why: 'sign-in expired' } }, checkErrors: { '1': HTTP_429 } })
  expect(rowLines(v)[0]).toBe('andres@lutsohealth.com · Company · Ultra  ⚠ sign in needed')
})

test('a login never read draws an empty bar and says so, dim, on line 2', () => {
  const v = rowView({ readings: {}, readAt: {}, checkErrors: { '1': HTTP_429 } })
  expect(rowLines(v)).toEqual(['andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (HTTP 429)', 'Used ▱▱▱▱▱▱▱▱▱▱ no reading yet'])
  expect(rowOf(v, ANDRES, ROW_NOW, TALLINN).lines[1]).toEqual([{ text: 'Used ▱▱▱▱▱▱▱▱▱▱ no reading yet', tone: 'dim' }])
})

test('on Max and Ultra a Fable week no body listed is a dash; on other plans there is no Fable part', () => {
  const v = rowView()
  const noFable = { ...v.readings['1'], fable: undefined } as View['readings'][string]
  expect(rowLines({ ...v, readings: { '1': noFable } })[1]).toBe('Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable –  resets 2d 3h 14m')
  const pro = { ...ANDRES, plan: 'pro', tier: undefined }
  expect(rowLines({ ...rowView({}, pro), readings: { '1': noFable }, noFiveHour: {} })).toEqual(['andres@lutsohealth.com · Company · Pro  updated 18:34', 'Used ▰▰▰▱▱▱▱▱▱▱ 31%  resets 2d 3h 14m'])
})

test('a Fable week that resets at another time than the week says its own reset after the week\'s', () => {
  const v = rowView()
  const r = { ...v.readings['1'], fable: { pct: 38, resetsAt: ahead(1, 3, 14) } } as View['readings'][string]
  expect(rowLines({ ...v, readings: { '1': r } })[1]).toBe(`${OPERATOR_LINE_2} · Fable 1d 3h 14m`)
})

test('a reset under a day drops the days, and under an hour the hours', () => {
  const at = (resetsAt: string) => rowLines(rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt }, fable: { pct: 38, resetsAt }, noFiveHour: true, at: READ_AT, by: '1' } } }))[1]
  expect(at(ahead(0, 20, 27))).toBe('Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable ▰▰▰▰▱▱▱▱▱▱ 38%  resets 20h 27m')
  expect(at(ahead(0, 0, 27))).toBe('Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable ▰▰▰▰▱▱▱▱▱▱ 38%  resets 27m')
})

test('a week whose reset has passed is 0% used with no reset; a plan that reports no week is a dash', () => {
  const passed = rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ahead(0, 0, -1) }, noFiveHour: true, at: READ_AT, by: '1' } } })
  expect(rowLines(passed)[1]).toBe('Used ▱▱▱▱▱▱▱▱▱▱ 0% Fable –')
  const noWeek = rowView({ readings: { '1': { fable: { pct: 38, resetsAt: ROW_WEEK_END }, noFiveHour: true, at: READ_AT, by: '1' } } })
  expect(rowLines(noWeek)[1]).toBe('Used – Fable ▰▰▰▰▱▱▱▱▱▱ 38%  Fable resets 2d 3h 14m')
})

test('a login with a 5-hour window in its counted reading has a third line for it; one with none has two lines', () => {
  const max = { ...ANDRES, tier: 'default_claude_max_5x' }
  const r = { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, fable: { pct: 38, resetsAt: ROW_WEEK_END }, fiveHour: { pct: 50, resetsAt: ahead(0, 1, 20) }, at: READ_AT, by: '1' }
  const v = rowView({ readings: { '1': r }, noFiveHour: { '1': false } }, max)
  expect(rowLines(v)).toEqual(['andres@lutsohealth.com · Company · Max  updated 18:34', OPERATOR_LINE_2, '5h ▰▰▰▰▰▱▱▱▱▱ 50%  resets 1h 20m'])
  expect(rowLines(rowView())).toHaveLength(2)
})

// Review C8-R1 unreadable-body (Codex) [UPDATED-WITHOUT-READING] (RULING 4521): a 2xx answer whose body yields no
// reading is the outcome `empty`, which keeps the last good read's time. Codex's block passed `ok` for that body; the
// fix gives the body `empty`, so the block is kept with `empty`.
test('an answer whose body holds no usage keeps the last good read\'s time, and the row says it', () => {
  const PRO = { id: '1', slot: '', email: 'andres@lutsohealth.com', plan: 'pro' }
  expect(readingFromUsage({}, ROW_NOW)).toBeUndefined()
  const due = afterUsage({ next: READ_AT, fails: 0, at: READ_AT }, { kind: 'empty', hasResponded: false }, ROW_NOW)
  expect([due.at, due.fails, due.next]).toEqual([READ_AT, 0, ROW_NOW + USAGE_IDLE_MS])
  const v = rowView({ readAt: { '1': due.at as number }, noFiveHour: {} }, PRO)
  expect(rowText(rowOf({ ...v, readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, at: READ_AT, by: '1' } } }, PRO, ROW_NOW, 'UTC'))[0]).toBe('andres@lutsohealth.com · Pro  updated 16:34')
})

test('an empty answer on a login never read well makes no good read: the row has no updated time', () => {
  expect(readingFromUsage(null, ROW_NOW)).toBeUndefined()
  const due = afterUsage(undefined, { kind: 'empty', hasResponded: true }, ROW_NOW)
  expect([due.at, due.next]).toEqual([undefined, ROW_NOW + 10 * MINUTE])
  expect(rowLines(rowView({ readings: {}, readAt: due.at === undefined ? {} : { '1': due.at } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra')
})

// Review C8-R1 F1 class (c) (Opus) [UPDATED-WITHOUT-READING]: rowOf never pairs an updated time with no reading.
test('a login with no reading draws no updated time, whatever else the view holds', () => {
  const cases: [string, Partial<View>][] = [
    ['health ok', {}],
    ['no health', { health: {} }],
    ['an older failure', { checkErrors: { '1': { why: 'HTTP 429', at: READ_AT - 3 * MINUTE } } }],
    ['no-five-hour stored', { noFiveHour: { '1': true } }],
  ]
  const offenders = cases.filter(([, change]) => /updated/.test(rowLines(rowView({ readings: {}, ...change }))[0] ?? ''))
  expect(cases.length).toBeGreaterThan(0)
  expect(offenders.map(([name]) => name)).toEqual([])
})

// Review C8-R1 equal-time (Codex) [FAILURE-TIE-HIDDEN] (RULING 4521): a good read clears check-error, so a failure
// standing at the same millisecond as the good read came after it.
test('a failure at the same millisecond as the good read shows, with its status or without', () => {
  expect(rowLines(rowView({ checkErrors: { '1': { ...HTTP_429, at: READ_AT } } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:34 Failed to update (HTTP 429)')
  expect(rowLines(rowView({ checkErrors: { '1': { why: 'the usage call failed to connect', at: READ_AT } } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:34 Failed to update')
})

// C9 (puma-eslxj.10, problem g part 2): the row fitted to the pane's width, the buttons at a line's end. A login with
// Remove beside its slot ends in `[ Remove ]`, a gap and the slot `[ Use now ]`: 23 cells.
const ENDS = 23
/** The row fitted to `columns`: each line's text, the line the buttons end ('own' where they take a line of their own). */
function fitted(v: View, columns: number, account = v.accounts[0] ?? ANDRES) {
  const f = fitRow(rowOf(v, account, ROW_NOW, TALLINN), columns, ENDS)
  const lines = f.lines.map(line => line.map(p => p.text).join(''))
  return { lines, end: f.lines[f.endLine]?.length === 0 ? 'own' : f.endLine }
}
const L1 = 'andres@lutsohealth.com · Company · Ultra  updated 18:34'
const FAILED_L1 = 'andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (HTTP 429)'

test('at 82 columns the operator\'s row holds its buttons on line 1; at 64 they take a line of their own after line 2', () => {
  expect(fitted(rowView(), 82)).toEqual({ lines: [L1, OPERATOR_LINE_2], end: 0 })
  expect(fitted(rowView(), 64)).toEqual({ lines: [L1, OPERATOR_LINE_2, ''], end: 'own' })
})

test('with no Company the row is the same but for line 1, at 82 and at 64', () => {
  const own = { ...ANDRES, orgName: "andres@lutsohealth.com's Organization" }
  const l1 = 'andres@lutsohealth.com · Ultra  updated 18:34'
  expect(fitted(rowView({}, own), 82)).toEqual({ lines: [l1, OPERATOR_LINE_2], end: 0 })
  expect(fitted(rowView({}, own), 64)).toEqual({ lines: [l1, OPERATOR_LINE_2, ''], end: 'own' })
})

test('a failed read\'s longer line 1 moves the buttons to the end of line 2 where they fit, else to a line of their own', () => {
  const v = rowView({ checkErrors: { '1': HTTP_429 } })
  expect(fitted(v, 82)).toEqual({ lines: [FAILED_L1, OPERATOR_LINE_2, ''], end: 'own' })
  const short = rowView({ checkErrors: { '1': HTTP_429 }, readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, noFiveHour: true, at: READ_AT, by: '1' } } })
  expect(fitted(short, 82)).toEqual({ lines: [FAILED_L1, 'Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable –  resets 2d 3h 14m'], end: 1 })
})

test('a line 1 wider than the pane cuts the Company first, then the email\'s middle, never the state', () => {
  const v = rowView({ checkErrors: { '1': HTTP_429 } })
  // 75 cells: 2 over 73 come off the Company alone; 11 over 64 take the Company to one letter, then 6 from the email.
  expect(fitted(v, 73).lines[0]).toBe('andres@lutsohealth.com · Comp… · Ultra  18:39 Failed to update (HTTP 429)')
  expect(fitted(v, 64)).toEqual({ lines: ['andres@l…lth.com · C… · Ultra  18:39 Failed to update (HTTP 429)', OPERATOR_LINE_2, ''], end: 'own' })
  expect(fitted(v, 56).lines[0]).toBe('andr…com · C… · Ultra  18:39 Failed to update (HTTP 429)')
})

test('a login with no reading, no Fable row, a 5-hour window or a sign-in needed fits as the operator drew each, at 82 and 64', () => {
  const noReading = rowView({ readings: {}, readAt: {} })
  expect(fitted(noReading, 82)).toEqual({ lines: ['andres@lutsohealth.com · Company · Ultra', 'Used ▱▱▱▱▱▱▱▱▱▱ no reading yet'], end: 0 })
  expect(fitted(noReading, 64)).toEqual({ lines: ['andres@lutsohealth.com · Company · Ultra', 'Used ▱▱▱▱▱▱▱▱▱▱ no reading yet'], end: 1 })
  const noFable = rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, noFiveHour: true, at: READ_AT, by: '1' } } })
  expect(fitted(noFable, 82)).toEqual({ lines: [L1, 'Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable –  resets 2d 3h 14m'], end: 0 })
  expect(fitted(noFable, 64)).toEqual({ lines: [L1, 'Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable –  resets 2d 3h 14m', ''], end: 'own' })
  const max = { ...ANDRES, tier: 'default_claude_max_5x' }
  const five = rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, fable: { pct: 38, resetsAt: ROW_WEEK_END }, fiveHour: { pct: 50, resetsAt: ahead(0, 1, 20) }, at: READ_AT, by: '1' } }, noFiveHour: { '1': false } }, max)
  const maxL1 = 'andres@lutsohealth.com · Company · Max  updated 18:34'
  expect(fitted(five, 82)).toEqual({ lines: [maxL1, OPERATOR_LINE_2, '5h ▰▰▰▰▰▱▱▱▱▱ 50%  resets 1h 20m'], end: 0 })
  expect(fitted(five, 64)).toEqual({ lines: [maxL1, OPERATOR_LINE_2, '', '5h ▰▰▰▰▰▱▱▱▱▱ 50%  resets 1h 20m'], end: 'own' })
  const signIn = rowView({ health: { '1': { kind: 'login-needed', why: 'sign-in expired' } } })
  expect(fitted(signIn, 82)).toEqual({ lines: ['andres@lutsohealth.com · Company · Ultra  ⚠ sign in needed', OPERATOR_LINE_2, ''], end: 'own' })
  expect(fitted(signIn, 64)).toEqual({ lines: ['andres@lutsohealth.com · Company · Ultra  ⚠ sign in needed', OPERATOR_LINE_2, ''], end: 'own' })
})

test('the bars carry the percent used, so the pane colors them by the room left; labels and dashes carry none', () => {
  const [, line2] = rowOf(rowView(), ANDRES, ROW_NOW, TALLINN).lines
  expect(line2?.map(p => p.used)).toEqual([undefined, 31, undefined, 38, undefined])
})

// Review C8-R1 Opus advisory [STATUS-OF-ANOTHER-CALL] (RULING 4525, 4538): the row's HTTP status is the usage call's.
test('a failure of another call draws Failed to update with no status: the status is the usage call\'s alone', () => {
  const profile = { why: 'the profile call answered HTTP 403, so its usage is not read until it names the sign-in', at: FAILED_AT }
  expect(rowLines(rowView({ checkErrors: { '1': profile } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update')
})

test('the account the Chrome extension is signed in to says Chrome after its plan', () => {
  expect(rowLines(rowView({ chromeAccountId: '1' }))[0]).toBe('andres@lutsohealth.com · Company · Ultra · Chrome  updated 18:34')
})

// C10 (puma-eslxj.11; [STORED-RELATIVE-TIME], [WRITER-ZONE-PINGPONG], RULING 4566): `rows` stores each time as epoch
// ms, a time of day as {clock} and a reset as {until}, which the reader renders at its own clock and zone. The fixture
// is the Python suite's too (tests/test_account_rotator_cli.py), so the pane, the stored rows and the CLI agree.
const FIXTURE_VIEW = { ...EMPTY_VIEW, ...ROWS_FIXTURE.view } as View
const FIXTURE_LINES = ROWS_FIXTURE.lines as Record<string, string[]>
/** Each login's stored lines as a reader at `now` in the fixture's zone prints them. */
const storedLines = (v: View, now: number) => rowsOf(v, now).map(r => ({ id: r.id, lines: r.lines.map(l => storedLineText(l, now, ROWS_FIXTURE.zone)) }))

test('the merge stores the fixture\'s rows: text runs, each time of day and each reset as epoch ms', () => {
  expect(FIXTURE_VIEW.accounts).toEqual(ROWS_FIXTURE.store.accounts)
  expect(rowsOf(FIXTURE_VIEW, ROWS_FIXTURE.now)).toEqual(ROWS_FIXTURE.store.rows.rows)
})

test('the pane draws the fixture\'s lines, and the stored rows read at the same clock and zone are those lines', () => {
  const pane = FIXTURE_VIEW.accounts.map(a => ({ id: a.id, lines: rowText(rowOf(FIXTURE_VIEW, a, ROWS_FIXTURE.now, ROWS_FIXTURE.zone)) }))
  expect(pane).toEqual(Object.entries(FIXTURE_LINES).map(([id, lines]) => ({ id, lines })))
  expect(storedLines(FIXTURE_VIEW, ROWS_FIXTURE.now)).toEqual(pane)
})

test('the stored rows hold no minute and no zone: two sessions a minute apart in two zones store the same rows', () => {
  const stored = (now: number, timeZone: string) => FIXTURE_VIEW.accounts.map(a => rowOf(FIXTURE_VIEW, a, now, timeZone).lines.map(storedLine))
  expect(stored(ROWS_FIXTURE.now + MINUTE, 'America/New_York')).toEqual(stored(ROWS_FIXTURE.now, TALLINN))
  expect(stored(ROWS_FIXTURE.now, TALLINN)).toEqual(rowsOf(FIXTURE_VIEW, ROWS_FIXTURE.now).map(r => r.lines))
})

/** The fixture's view with login 2's Fable week resetting `offsetMs` after its week. */
function fableOffset(offsetMs: number): View {
  const r = FIXTURE_VIEW.readings['2']
  const fable = new Date(Date.parse(r?.sevenDay?.resetsAt ?? '') + offsetMs).toISOString()
  return { ...FIXTURE_VIEW, readings: { ...FIXTURE_VIEW.readings, '2': { ...r, fable: { pct: 10, resetsAt: fable } } as View['readings'][string] } }
}

// Review C10-R1 F1 (Opus) [ROW-AT-ANOTHER-NOW] (RULING 4574): whether the Fable reset shows beside the week's is
// decided on the two instants, so no stored row changes with the writer's second while no reset passes.
test('two sessions 45 s apart store the same rows for a Fable week 20 s after the week', () => {
  expect(JSON.stringify(rowsOf(fableOffset(20_000), ROWS_FIXTURE.now + 45_000))).toBe(JSON.stringify(rowsOf(fableOffset(20_000), ROWS_FIXTURE.now)))
})

test('no stored row changes with the writer\'s clock while no reset passes, at any Fable offset under a minute', () => {
  const offsets = [0, 1, 500, 5_000, 20_000, 30_000, 45_000, 59_999, -20_000]
  const phases = Array.from({ length: 12 }, (_, i) => i * 5_000)
  const offenders: string[] = []
  for (const off of offsets) {
    const first = JSON.stringify(rowsOf(fableOffset(off), ROWS_FIXTURE.now))
    for (const p of phases) if (JSON.stringify(rowsOf(fableOffset(off), ROWS_FIXTURE.now + p)) !== first) offenders.push(`Fable ${off} ms after the week, writer ${p} ms later`)
  }
  expect(offsets.length * phases.length).toBeGreaterThan(0)
  expect(offenders).toEqual([])
})

// Review C10-R1 F4 (Opus) [ROW-AT-ANOTHER-NOW]: a stored reset read after it passed says so, as bin/account-rotator does.
test('a stored reset read after it passed says passed, not 0m', () => {
  const line3 = rowsOf(FIXTURE_VIEW, ROWS_FIXTURE.now).find(r => r.id === '2')?.lines[2] ?? []
  expect(storedLineText(line3, ROWS_FIXTURE.now + 2 * 3_600_000, TALLINN)).toBe('5h ▰▰▰▰▰▱▱▱▱▱ 50%  resets passed')
})

test('a stored line read a minute later counts its resets down, and read in UTC says its times in UTC', () => {
  const [line1, line2] = rowsOf(FIXTURE_VIEW, ROWS_FIXTURE.now).find(r => r.id === '1')?.lines ?? []
  expect(storedLineText(line2 ?? [], ROWS_FIXTURE.now + MINUTE, TALLINN)).toBe('Used ▰▰▰▱▱▱▱▱▱▱ 31% Fable ▰▰▰▰▱▱▱▱▱▱ 38%  resets 2d 3h 13m · Fable 1d 3h 13m')
  expect(storedLineText(line1 ?? [], ROWS_FIXTURE.now, 'UTC')).toBe('andres@lutsohealth.com · Company · Ultra  updated 16:34')
})

// C11 (puma-eslxj.12, RULING 4593 and 4595): `account-rotator account select` drops a request file the installed
// sessions' minute tick applies; a request names the store it was read from by that store's `store-id`.
const SELECT = { kind: 'select', nonce: 'n0nce-1234', at: NOW, id: '2', store: 'store-abc' }

test('a select request is read back as it was written, while it is fresh', () => {
  expect(requestFrom(SELECT, NOW + REQUEST_TTL_MS)).toEqual(SELECT)
})

test('a request of another kind, shape or age is no request', () => {
  const cases: [string, unknown][] = [
    ['not an object', 'select'],
    ['another kind', { ...SELECT, kind: 'rm' }],
    ['no nonce', { ...SELECT, nonce: undefined }],
    ['a nonce that names a path', { ...SELECT, nonce: '../launch-slot' }],
    ['no account', { ...SELECT, id: 7 }],
    ['no store id', { ...SELECT, store: undefined }],
    ['no time', { ...SELECT, at: 'now' }],
    ['older than the time a request waits', { ...SELECT, at: NOW - REQUEST_TTL_MS - 1 }],
    ['from the future past that time', { ...SELECT, at: NOW + REQUEST_TTL_MS + 1 }],
  ]
  expect(cases.filter(([, value]) => requestFrom(value, NOW) !== undefined).map(([name]) => name)).toEqual([])
})

test('the requests live in the Claude config folder of the session, CLAUDE_CONFIG_DIR or ~/.claude', () => {
  expect([requestsDir('/cfg', '/home/x'), requestsDir(undefined, '/home/x')]).toEqual(['/cfg/account-rotator-requests', '/home/x/.claude/account-rotator-requests'])
})

// Review C11-R1 F5 (Opus) [REQUEST-FOLDER] (RULING 4607): Python's `or` in bin/account_rotator_store.py takes an empty value as unset.
test('an empty CLAUDE_CONFIG_DIR is the folder the CLI takes too, ~/.claude', () => {
  expect(requestsDir('', '/home/x')).toBe('/home/x/.claude/account-rotator-requests')
})
