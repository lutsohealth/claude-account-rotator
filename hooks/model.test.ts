import { expect, test } from 'claude-code/testing'

import type { RotateTo, View } from '../types'
import { weekLeaveFrom, launchOnFrom, pickLaunch, isSessionStop } from './model'
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
    holders: {},
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
  { name: 'a switch is still pending', reason: 'pending', view: { ...CAN_MOVE(), pending: { id: '2', from: '1', since: NOW } } },
  { name: 'every Fable week spent', reason: 'fable-spent', view: view({ '1': [20, 30, 100], '2': [10, 30, 100] }) },
  { name: 'the other account has its 5-hour window full', reason: 'no-room', view: view({ '1': [20, 30, 100], '2': [95, 30, 10] }) },
  { name: 'the other account has its week full', reason: 'no-room', view: view({ '1': [20, 30, 100], '2': [10, 100, 10] }) },
  { name: 'the other account needs a sign-in', reason: 'no-room', view: view({ '1': [20, 30, 100], '2': [10, 30, 10] }, { '2': { kind: 'login-needed', why: 'not signed in yet' } }) },
  { name: 'the other account was tried and did not take', reason: 'no-room', view: CAN_MOVE(), skip: ['2'] },
]

test('a Fable stop that did not move gives the reason, one per cause the rotation can stay for', () => {
  expect(fableStay(CAN_MOVE(), NOW, false, new Set())).toBeUndefined()
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
  expect(fableStay(v, NOW, false, new Set())?.reason).toBe('pending')
  v = { ...v, pending: undefined }
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
  expect([...texts.keys()].sort()).toEqual(['blocked', 'chrome', 'no-room', 'off', 'pending'])
  expect(new Set(texts.values()).size).toBe(5)
  expect(texts.get('pending')).toMatch(/switch to account 2 is still settling/)
})
