import { expect, test } from 'claude-code/testing'

import type { Reading, RotateTo, View } from '../types'
import { weekLeaveFrom, launchOnFrom, pickLaunch, isSessionStop, isWeeklyStop } from './model'
import { isSameWeek, stopResetAt, whoseReset, whoseWeek, wordingClass } from './model'
import { companyOf, identityFromStatus, planName } from './model'
import { laterMark, spentMark, withFableMark } from './model'
import { EMPTY_VIEW, USAGE_IDLE_MS, fitRow, hasRoom, rowOf, rowsOf, rowText, storedLine, storedLineText } from './model'
import ROWS_FIXTURE from '../tests/fixtures/rows'
import { REQUEST_TTL_MS, holdsLogin, isLoginOf, sameLogin, requestFrom, requestsDir, slotNumber } from './model'
import { ESCAPE_GAP_MS, NUDGE_LEAD_MS, NUDGE_TEXT, escapeAfterFill, escapeArgv, escapeHeldBack, isBoxFree, nudgeHeld, pickAfterStop, raisesLimitModal, renudgeDue } from './model'
import { mayWrite } from './model'
import * as modelExports from './model'
import { firstFreeAt, limitNotice } from './model'
import { OWN_CONTINUE_MARGIN_MS, isCountdownOnScreen, ownContinueAfterLook, ownContinueHeldBack, ownContinueResetAt, screenLinesFrom } from './model'
import { signInFromStatus } from './model'
import { endsFableMark } from './model'
import { USAGE_BACKOFF_MAX_MS, USAGE_CLAIM_MS, USAGE_CLAIM_WAIT_MS, USAGE_EARLY_MS, WRITER_VERSION, afterUsage, claimDueReads, gatingDue, isUsageDue, mayForceUsage, mayReadSince, renewClaim, retryAfterFrom, usageDueFrom } from './model'
import { DEFAULT_FOOTER, availableNow, claudeAccount, blockedAdvice, braille, browsersFrom, chromeNote, continueTextFrom, counted, fiveHourLimitFrom, credentialFrom, credentialsFile, fableMark, fableSpentNotice, fableStay, footerStyleFrom, healthOf, identityFromProfile, isFableSpent, isFableStop, isNoBrowser, isPolicyRefusal, keepFable, keychainItem, label, legacyMark, markFrom, nextReset, pickTarget, pie, readingFromUsage, restartSteps, rotateToFrom, shouldLeave, roomColor, stuckText, windowPct, withMark, withWeekMark } from './model'

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

/** `view` with login 2 unread: its usage read failed and it has no reading of its own. */
function unread2(readings: Parameters<typeof view>[0], rotateTo: RotateTo): View {
  const v = view(readings, {}, rotateTo)
  delete v.readings['2']
  v.checkErrors = { '2': { why: 'the usage call answered HTTP 429', at: NOW, isUsageRead: true } }
  return v
}

const PROFILE_FAILED = { why: 'the profile call answered HTTP 503, so its usage is not read until it names the sign-in', at: NOW }

test('Review PROFILE-1 instance: a login whose profile call named no sign-in is never a rotation target', () => {
  const v = unread2({ '1': [100, 50], '2': [0, 0] }, 'room')
  v.checkErrors = { '2': PROFILE_FAILED }
  expect(pickTarget(v, NOW)).toBeUndefined()
})

test('Review PROFILE-1 class: a check that failed before the sign-in was named, or failed generically, admits the login to no pick, in every rotation and caller', () => {
  const wrong: string[] = []
  const generic = { why: 'the check failed (TypeError); the debug log has the rest', at: NOW }
  for (const rotateTo of ROTATE_TOS) {
    for (const [what, failure] of [['profile', PROFILE_FAILED], ['generic', generic]] as const) {
      const v = unread2({ '1': [100, 50], '2': [0, 0] }, rotateTo)
      v.checkErrors = { '2': failure }
      const fable = unread2({ '1': [10, 50, 100], '2': [0, 0] }, rotateTo)
      fable.checkErrors = { '2': failure }
      if (pickTarget(v, NOW) !== undefined) wrong.push(`pickTarget ${rotateTo} ${what}`)
      if (pickTarget(fable, NOW, 'fable') !== undefined) wrong.push(`pickTarget fable ${rotateTo} ${what}`)
      if (fableStay(fable, NOW, false, new Set())?.reason !== (rotateTo === 'off' ? 'off' : 'no-room')) wrong.push(`fableStay ${rotateTo} ${what}`)
      if (stuckText({ ...v, isSwitchBlocked: true }, NOW) !== undefined) wrong.push(`stuckText ${rotateTo} ${what}`)
    }
  }
  expect(wrong).toEqual([])
})

const ROTATE_TOS: RotateTo[] = ['room', 'off', 'reset', 'order']

for (const rotateTo of ROTATE_TOS) {
  test(`a login whose usage check failed with no reading ranks after every read login with room (${rotateTo}; puma-4q7j2.8, RULING 4278)`, () => {
    // Login 2 is next in the list and reads as all room: a read login with room still goes first.
    expect(pickTarget(unread2({ '1': [95, 50], '2': [0, 0], '3': [0, 60] }, rotateTo), NOW)?.id).toBe('3')
  })

  test(`a login whose usage check failed with no reading is still tried when no read login has room (${rotateTo}; puma-9arph.34)`, () => {
    expect(pickTarget(unread2({ '1': [100, 50], '2': [0, 0] }, rotateTo), NOW)?.id).toBe('2')
    expect(pickTarget(unread2({ '1': [100, 50], '2': [0, 0], '3': [100, 100] }, rotateTo), NOW)?.id).toBe('2')
  })
}

test('after a Fable stop, a login whose usage check failed with no reading is tried when no read login has Fable room (puma-9arph.34)', () => {
  const v = unread2({ '1': [10, 50, 100], '2': [0, 0], '3': [10, 50, 100] }, 'room')
  expect(pickTarget(v, NOW, 'fable')?.id).toBe('2')
})

test('a login whose stop marked it spent is not tried again, its usage check failing or not (puma-9arph.34)', () => {
  const v = unread2({ '1': [100, 50], '2': [0, 0] }, 'room')
  v.readings['2'] = { fiveHour: { pct: 100, resetsAt: LATER }, at: NOW }
  expect(pickTarget(v, NOW)).toBeUndefined()
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
  expect(on('account:4')).toMatchObject({ id: '2', why: 'account 4 (not signed in yet) has no room, and it is the next with room' })
  expect(on('account:1')?.id).toBe('2')
  // puma-9arph.28 item 2: a named id the list no longer holds opens its reason as "account <id>", never the bare id.
  expect(on('account:9')).toMatchObject({ id: '2', why: 'account 9 is not on the list, and it is the first with room' })
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

// puma-9arph.4 (reading R11): a week runs while nobody uses it, so a login at 0% ranks by its own reset.
test('soonest reset takes a login at 0% used whose week resets first, for a new session and for the rotation', () => {
  // Login 1, the one in use, has no room left, so a new session cannot start on it.
  const v = view({ '1': [100, 50], '2': [0, 0], '3': [0, 0] }, {}, 'reset')
  v.readings['2'] = weekOnly(0, '2026-10-12T20:00:00Z')
  v.readings['3'] = weekOnly(30, '2026-10-14T03:00:00Z')
  expect(pickLaunch({ ...v, launchOn: 'reset' }, NOW)).toMatchObject({ id: '2', why: 'its window resets soonest' })
  expect(pickTarget(v, NOW)?.id).toBe('2')
})

test('soonest reset puts last a login at 0% whose reading holds no reset to come: none, or one already past', () => {
  const v = view({ '1': [100, 50], '2': [0, 0], '3': [0, 0] }, {}, 'reset')
  v.readings['3'] = weekOnly(30, '2026-10-14T03:00:00Z')
  const rows: [string, Reading][] = [
    ['no reset time', { sevenDay: { pct: 0 }, at: NOW }],
    ['a reset already past', weekOnly(0, new Date(NOW - HOUR).toISOString())],
  ]
  const picks = rows.map(([name, read]) => {
    const w = { ...v, readings: { ...v.readings, '2': read } }
    return [name, pickLaunch({ ...w, launchOn: 'reset' }, NOW)?.id, pickTarget(w, NOW)?.id]
  })
  expect(picks).toEqual(rows.map(([name]) => [name, '3', '3']))
})

// Review F2 [INVALID-RESET], PR #69 round 1: a reset that does not parse is no reset to come.
test('Review F2 instance: an invalid reset at 0% cannot outrank a known upcoming reset', () => {
  const v = view({ '1': [100, 50], '2': [0, 0], '3': [0, 0] }, {}, 'reset')
  v.readings['2'] = weekOnly(0, 'invalid-reset')
  v.readings['3'] = weekOnly(30, '2026-10-14T03:00:00Z')
  expect(pickTarget(v, NOW)?.id).toBe('3')
})

test('Review F2 class: every reset picker puts a malformed reset after a known one, in either window, at any percent', () => {
  const offenders: string[] = []
  for (const site of ['launch', 'target'] as const) {
    for (const window of ['fiveHour', 'sevenDay'] as const) {
      for (const pct of [0, 30]) {
        for (const invalid of ['invalid-reset', '2026-99-99T00:00:00Z']) {
          const v = view({ '1': [100, 50], '2': [0, 0], '3': [0, 0] }, {}, 'reset')
          v.readings['2'] = window === 'sevenDay'
            ? weekOnly(pct, invalid)
            : { fiveHour: { pct, resetsAt: invalid }, sevenDay: { pct: 0, resetsAt: WEEK_END }, at: NOW }
          v.readings['3'] = weekOnly(30, '2026-10-14T03:00:00Z')
          const picked = site === 'launch' ? pickLaunch({ ...v, launchOn: 'reset' }, NOW)?.id : pickTarget(v, NOW)?.id
          if (picked !== '3') offenders.push(`${site}/${window}/${pct}%/${invalid}: ${picked}`)
        }
      }
    }
  }
  expect(offenders).toEqual([])
})

// Review F1 [LAUNCH-ADMITS-A-LEAVE], PR #69 round 1: a launch rule passes over a login the rotation would leave at once.
test('Review F1 instance: soonest reset starts no session on a login whose week has reached the leave line', () => {
  const v = view({ '1': [100, 50], '2': [0, 95], '3': [20, 0] }, {}, 'reset')
  v.weekLeave = 5
  v.readings['2'].fiveHour = { pct: 0, resetsAt: new Date(NOW + HOUR).toISOString() }
  v.readings['3'].fiveHour = { pct: 20, resetsAt: LATER }
  expect(pickLaunch({ ...v, launchOn: 'reset' }, NOW)?.id).toBe('3')
})

test('Review F1 class: no launch rule starts on a login the rotation would leave, at any week-leave', () => {
  const offenders: string[] = []
  for (const launchOn of ['reset', 'room', 'nonzero'] as const) {
    for (const weekLeave of [1, 5, 50, 99]) {
      // Login 2 is first in the list, holds the most room and resets soonest: each rule would take it but for the line.
      const v = view({ '1': [100, 50], '2': [0, 100 - weekLeave], '3': [20, 0] }, {}, 'reset')
      v.weekLeave = weekLeave
      v.readings['2'].fiveHour = { pct: 0, resetsAt: new Date(NOW + HOUR).toISOString() }
      v.readings['3'].fiveHour = { pct: 20, resetsAt: LATER }
      const picked = pickLaunch({ ...v, launchOn }, NOW)?.id
      if (picked !== '3') offenders.push(`${launchOn}, week-leave ${weekLeave}: picked ${picked}; the rotation takes ${pickTarget(v, NOW)?.id}`)
    }
  }
  expect(offenders).toEqual([])
})

// RULING 5280, condition 1: with every login past the rotation's line, a rule still picks among those with room.
test('a launch rule with every login past the leave line still picks, as it did before the line counted', () => {
  const v = view({ '1': [10, 96], '2': [20, 97], '3': [30, 98] }, {}, 'reset')
  v.weekLeave = 5
  v.readings['3'].fiveHour = { pct: 30, resetsAt: '2026-10-12T11:00:00Z' }
  const picks = (['room', 'nonzero', 'reset'] as const).map(launchOn => [launchOn, pickLaunch({ ...v, launchOn }, NOW)?.id])
  expect(picks).toEqual([['room', '1'], ['nonzero', '1'], ['reset', '3']])
})

// RULING 5280, condition 2: where no login is past the line, every rule picks as at origin/main cb92eb7.
test('a launch with no login past the leave line picks as before, by every rule and a named account', () => {
  const v = view({ '1': [10, 50], '2': [5, 20], '3': [60, 50] })
  v.weekLeave = 5
  v.readings['3'].fiveHour = { pct: 60, resetsAt: '2026-10-12T10:30:00Z' }
  const rules: View['launchOn'][] = ['room', 'nonzero', 'reset', 'account:3']
  const picks = rules.map(launchOn => [launchOn, pickLaunch({ ...v, launchOn }, NOW)?.id])
  expect(picks).toEqual([['room', '2'], ['nonzero', '1'], ['reset', '3'], ['account:3', '3']])
})

// RULING 5280, condition 3: README's New on skips a named account only at a limit with 0% left, so the line does not.
test('a named account past the leave line but with room is still where new sessions start', () => {
  const v = view({ '1': [10, 50], '2': [10, 97] })
  v.weekLeave = 5
  expect(pickLaunch({ ...v, launchOn: 'account:2' }, NOW)).toMatchObject({ id: '2', why: 'you picked it' })
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

test('a stop that says the Fable limit was hit, as Claude Code 2.1.325 and later words it, is a Fable stop', () => {
  expect(isFableStop("You've hit your Fable limit · resets Nov 18 at 3pm (Europe/Tallinn)")).toBe(true)
  expect(["You've hit your weekly limit · resets Nov 10", "You've hit your session limit", "You've hit your 5-hour limit"].map(isFableStop)).toEqual([false, false, false])
  // The noun is "your Fable limit": a message that only names Fable is not a stop of that limit.
  expect(isFableStop('Fable is available on your plan.')).toBe(false)
})

// The wordings of the rate_limit API error records on the host, counted by Claude Code version: the Fable stop says
// "reached" up to 2.1.322 and "hit" from 2.1.325, and no record joins two limits. Each stop is read as one kind only.
for (const [said, kinds] of [
  ["You've reached your Fable limit. Switch to another model to continue.", [true, false, false]],
  ["You've hit your Fable limit · resets Nov 18 at 3pm", [true, false, false]],
  ["You've hit your weekly limit · resets Nov 10 at 11am", [false, false, true]],
  ["You've hit your session limit · resets 3pm", [false, true, false]],
  ["You've hit your 5-hour limit · resets 3pm", [false, true, false]],
] as const) {
  test(`the matchers read "${said}" as [Fable, session, weekly] = ${JSON.stringify(kinds)}`, () => {
    expect([isFableStop(said), isSessionStop(said), isWeeklyStop(said)]).toEqual(kinds)
  })
}

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

// puma-9arph.35: when the session can carry on after every login is spent.
test('a login frees up at the latest reset of its own spent windows, the soonest such login answering, never at a reset that frees no login', () => {
  // One spent window a login: the soonest reset of any window is the answer (the bead's letter and this rule agree).
  expect(firstFreeAt(view({ '1': [100, 30], '2': [100, 40] }), NOW)).toBe(Date.parse(LATER))
  // Login 1's 5-hour window resets soonest, but its week stays spent; login 2's week resets before login 1's.
  const both = view({ '1': [100, 100], '2': [20, 100] })
  both.readings['2'] = { ...both.readings['2'], sevenDay: { pct: 100, resetsAt: '2026-10-15T03:00:00Z' }, at: NOW }
  expect(nextReset(both, NOW)).toBe(Date.parse(LATER))
  expect(firstFreeAt(both, NOW)).toBe(Date.parse('2026-10-15T03:00:00Z'))
  // A login that needs a sign-in, or one the session passes over, never frees up by a reset.
  const locked = view({ '1': [20, 100], '2': [100, 30] }, { '2': { kind: 'login-needed', why: 'sign-in rejected' } })
  expect(firstFreeAt(locked, NOW)).toBe(Date.parse(WEEK_END))
  expect(firstFreeAt(view({ '1': [20, 100], '2': [100, 30] }), NOW, new Set(['2']))).toBe(Date.parse(WEEK_END))
  // A spent window with no reset time known frees nothing.
  const unknown = view({ '1': [100, 30] })
  unknown.readings['1'] = { fiveHour: { pct: 100 }, sevenDay: { pct: 30 }, at: NOW }
  expect(firstFreeAt(unknown, NOW)).toBeUndefined()
  // A stale row, its reset passed with no read since, is spent no more: no time in the past is ever answered.
  expect(firstFreeAt(view({ '1': [100, 30], '2': [100, 40] }), Date.parse(LATER))).toBeUndefined()
  expect(firstFreeAt(view({ '1': [100, 30], '2': [100, 40] }), Date.parse(LATER) + 1)).toBeUndefined()
})

test('the words for every login near its limit name when the first one frees up, and no time where none is known', () => {
  expect(limitNotice(view({ '1': [100, 30], '2': [100, 40] }), NOW)).toBe('Every Claude account is near its limit; the next frees up in 2h 0m.')
  const unknown = view({ '1': [100, 30] })
  unknown.readings['1'] = { fiveHour: { pct: 100 }, sevenDay: { pct: 30 }, at: NOW }
  expect(limitNotice(unknown, NOW)).toBe('Every Claude account is near its limit.')
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

test('a session that can\'t switch says to stop a background session, which /exit leaves running, and to resume this conversation by its id', () => {
  const onSeat = { ...view({ '1': [10, 10], '2': [100, 30] }), activeId: '2', sessionId: 'session-1', isSwitchBlocked: true }
  expect(restartSteps(onSeat)).toBe('Quit (in a background session, /stop: /exit only detaches), then run: claude --resume session-1')
  expect(restartSteps({ ...onSeat, sessionId: undefined })).toMatch(/then run: claude --continue$/)
  expect(blockedAdvice(onSeat)).toMatch(/starts or reloads plugins\. Fix: Quit \(in a background session, \/stop: \/exit only detaches\), then run: claude --resume session-1\. Not \/restart/)
  expect(blockedAdvice(onSeat)).not.toMatch(/\/login/)
  // Started on a seat as Claude Code's login: a personal sign-in there first, or the new session starts on the seat again.
  const onLogin = { ...view({ '1': [100, 30], '2': [10, 10] }), sessionId: 'session-1', isSwitchBlocked: true }
  expect(blockedAdvice(onLogin)).toMatch(/Fix: \/login with your personal \(Pro or Max\) account\. Quit .*claude --resume session-1\.$/)
  // Spent where it can't leave, while another login has room: what to do.
  expect(stuckText(onSeat, NOW)).toBe(
    "The account in use is near its limit, and this window can't switch accounts. Quit (in a background session, /stop: /exit only detaches), then run: claude --resume session-1",
  )
  expect(stuckText(onLogin, NOW)).toMatch(/^The account in use is near its limit, and this window can't switch accounts\. \/login with your personal \(Pro or Max\) account\. Quit /)
  // Free to switch, with room, or with nowhere to go: nothing to say.
  expect(stuckText({ ...onSeat, isSwitchBlocked: false }, NOW)).toBeUndefined()
  expect(stuckText({ ...onSeat, activeId: '1' }, NOW)).toBeUndefined()
  expect(stuckText({ ...view({ '1': [95, 30], '2': [100, 30] }), activeId: '2', isSwitchBlocked: true }, NOW)).toBeUndefined()
})

test('a session that can\'t switch is told so once its week is down to the Week setting, as the rotation counts it', () => {
  const atLine = { ...view({ '1': [10, 10], '2': [10, 85] }), activeId: '2', sessionId: 'session-1', isSwitchBlocked: true, weekLeave: 20 }
  expect(stuckText(atLine, NOW)).toMatch(/^The account in use is near its limit, and this window can't switch accounts\./)
  expect(stuckText({ ...atLine, weekLeave: 0 }, NOW)).toBeUndefined()
})

/** Review F2 (PR #85, round 1): two signed-in logins, the session on login 2, which can't switch; login 1 has room. */
function stuckOn(five: number, week: number, weekLeave: number): View {
  const weekResets = '2026-10-18T03:00:00Z'
  return {
    ...EMPTY_VIEW,
    accounts: [{ id: '1', slot: '' }, { id: '2', slot: '/h/.claude/accounts/2' }],
    health: { '1': { kind: 'ok' }, '2': { kind: 'ok' } },
    readings: {
      '1': { fiveHour: { pct: 10, resetsAt: LATER }, sevenDay: { pct: 10, resetsAt: weekResets }, at: NOW, by: '1' },
      '2': { fiveHour: { pct: five, resetsAt: LATER }, sevenDay: { pct: week, resetsAt: weekResets }, at: NOW, by: '2' },
    },
    activeId: '2',
    sessionId: 'session-1',
    isSwitchBlocked: true,
    weekLeave,
  } as View
}

test('a stuck window whose login has 15% of its week left is told that login is near its limit, not out of usage', () => {
  // 85% of the week used at a Week setting of 20: past the line the rotation leaves at, with room left.
  const text = stuckText(stuckOn(10, 85, 20), NOW)
  expect(text, 'the line is still said at the Week setting').toMatch(/^The account in use is near its limit, and this window can't switch accounts\./)
  expect(text).not.toMatch(/out of usage/)
})

test('stuckText says a login is out of usage only where that login has no room left', () => {
  const offenders: string[] = []
  let said = 0
  for (const weekLeave of [0, 20, 50]) {
    for (const five of [0, 50, 89, 90, 95, 100]) {
      for (const week of [0, 50, 80, 85, 95, 100]) {
        const view = stuckOn(five, week, weekLeave)
        const text = stuckText(view, NOW)
        if (text === undefined) continue
        said += 1
        if (/out of usage/.test(text) && hasRoom(view.readings['2'], NOW)) offenders.push(`5h ${five}%, week ${week}%, Week setting ${weekLeave}`)
      }
    }
  }
  // The sweep inspected something.
  expect(said).toBeGreaterThan(0)
  expect(offenders, 'says "out of usage" for a login with room; word it as the leave line, or say it only at 100%').toEqual([])
})

test('counts the browsers Claude in Chrome lists, and knows its words for none answering', () => {
  expect(browsersFrom('[{"deviceId":"d","name":"Browser 1","osPlatform":"macOS","isLocal":true}]')).toBe(1)
  expect(browsersFrom('[]')).toBe(0)
  expect(browsersFrom('Browser extension is not connected.')).toBeUndefined()
  expect(isNoBrowser('Browser extension is not connected. Please ensure the Claude browser extension is installed and running')).toBe(true)
  expect(isNoBrowser("[Claude in Chrome] Claude in Chrome isn't paired with your browser (reported by the extension, unverified: account_mismatch)")).toBe(true)
  expect(isNoBrowser('Tab 12 no longer exists')).toBe(false)
})

test('puma-9arph.17: counts the list of a list_connected_browsers answer whose note block follows it, however the blocks are joined', () => {
  const list = '[{"deviceId":"device-a","name":"Browser 1","osPlatform":"macOS","connectedAt":1,"isLocal":true},{"deviceId":"device-b","name":"Browser 2","osPlatform":"macOS","connectedAt":2,"isLocal":true,"inUse":true}]'
  const note = '2 browsers are connected; "Browser 2" (deviceId device-b) is the one picked last and will be used. No question is needed unless the user wants a different browser (then select_browser with its deviceId, or switch_browser).'
  expect(browsersFrom(list + note)).toBe(2)
  expect(browsersFrom(`${list}\n${note}`)).toBe(2)
  expect(browsersFrom(`[]\n${note} [see the docs]`)).toBe(0)
  expect(browsersFrom("[Claude in Chrome] Claude in Chrome isn't paired with your browser")).toBeUndefined()
  expect(browsersFrom('] no list')).toBeUndefined()
  expect(browsersFrom('Error: none [here]')).toBeUndefined()
})

test('the notes about Claude in Chrome say what the mod does now and what to tell the user, never /login', () => {
  const accounts = [
    { id: '1', slot: '', email: 'one@example.com' },
    { id: '2', slot: '/h/.claude/accounts/2', email: 'two@example.com' },
  ]
  const base = { ...view({ '1': [10, 10], '2': [10, 10] }), accounts, chromeAccountId: '1', activeId: '2', sessionId: 'session-1' }
  const onTwo = { ...base, chrome: { as: '2', isPaired: false, hasFailed: true } }
  expect(chromeNote(onTwo, 'connecting')).toBe(
    'Claude in Chrome connected as Claude account two@example.com and found no browser. ' +
      "The account-rotator mod is now connecting it as Claude account one@example.com, the account the user's Chrome extension is signed in to, which takes under a minute. " +
      "End your turn now: you'll get a message once it's connected. Don't suggest /login: it doesn't fix this.",
  )
  expect(chromeNote(base, 'held')).toMatch(/^The account-rotator mod is connecting Claude in Chrome as Claude account one@example\.com.* End your turn now/)
  expect(chromeNote(onTwo, 'no-browser')).toMatch(/^No Chrome extension answers as Claude account one@example\.com, the account picked for it in the Claude accounts panel: .* If it is another account, they press Use for Chrome or Try to connect next to it .* If it matches, they restart Chrome and press Connect above the prompt\./)
  const blocked = { ...onTwo, isSwitchBlocked: true }
  expect(chromeNote(blocked, 'blocked')).toMatch(
    /Claude Code doesn't let this session switch accounts\. Tell the user that to use Chrome, they quit Claude Code \(in a background session, with \/stop: \/exit only detaches\) and run `claude --resume session-1` in a terminal/,
  )
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
    expect([name, text.startsWith("Fable limit reached on Claude Code's login")]).toEqual([name, true])
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
const NEXT_AT = FAILED_AT + 6 * 60_000
const FAILED_NEXT_L1 = 'andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (HTTP 429), next try 18:45'

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
const OPERATOR_LINE_2 = 'Used ▰▰▰▱▱▱▱▱▱▱  31% Fable ▰▰▰▰▱▱▱▱▱▱  38%  resets 2d 3h 14m'
/** A line with no Fable part keeps the Fable part's cells blank, so its "resets" stands where OPERATOR_LINE_2's does (puma-9arph.28). */
const NO_FABLE_GAP = ' '.repeat(24)
const PRO_LINE_2 = `Used ▰▰▰▱▱▱▱▱▱▱  31%${NO_FABLE_GAP}resets 2d 3h 14m`
const FIVE_HOUR_50 = `5h   ▰▰▰▰▰▱▱▱▱▱  50%${NO_FABLE_GAP}resets 1h 20m`

test('the row is the operator\'s two lines: who, Company and plan, the last good read\'s time, then the week and Fable used', () => {
  expect(rowLines(rowView())).toEqual(['andres@lutsohealth.com · Company · Ultra  updated 18:34', OPERATOR_LINE_2])
})

// The operator's order of 2026-11-14 20:17Z: each line under an account lines up, whatever its percents' digits.
test('the usage line pads each percent to three cells, so Fable and resets stand at one column from 0% to 100%', () => {
  const at = (week: number, fable: number) =>
    rowLines(rowView({ readings: { '1': { sevenDay: { pct: week, resetsAt: ahead(3, 16, 50) }, fable: { pct: fable, resetsAt: ahead(3, 16, 50) }, noFiveHour: true, at: READ_AT, by: '1' } } }))[1] ?? ''
  const lines = [at(0, 0), at(46, 38), at(100, 100)]
  expect(lines).toEqual([
    'Used ▱▱▱▱▱▱▱▱▱▱   0% Fable ▱▱▱▱▱▱▱▱▱▱   0%  resets 3d 16h 50m',
    'Used ▰▰▰▰▰▱▱▱▱▱  46% Fable ▰▰▰▰▱▱▱▱▱▱  38%  resets 3d 16h 50m',
    'Used ▰▰▰▰▰▰▰▰▰▰ 100% Fable ▰▰▰▰▰▰▰▰▰▰ 100%  resets 3d 16h 50m',
  ])
  expect(new Set(lines.map(line => line.indexOf('resets'))).size).toBe(1)
})

// puma-9arph.28 item 3: the lines line up across plans too: a Pro row has no Fable cells, and "5h" is shorter than "Used".
test('a Pro row, a Max row and a 5-hour line start their bars and "resets" at one column each', () => {
  const pro = { ...ANDRES, plan: 'pro', tier: undefined }
  const proLines = rowLines(rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, noFiveHour: true, at: READ_AT, by: '1' } } }, pro))
  const max = { ...ANDRES, tier: 'default_claude_max_5x' }
  const maxLines = rowLines(
    rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, fable: { pct: 38, resetsAt: ROW_WEEK_END }, fiveHour: { pct: 50, resetsAt: ahead(0, 1, 20) }, at: READ_AT, by: '1' } }, noFiveHour: { '1': false } }, max),
  )
  const lines = [proLines[1] ?? '', maxLines[1] ?? '', maxLines[2] ?? '']
  expect(lines.map(line => [line.search(/[▰▱]/), line.indexOf('resets')])).toEqual([[5, 44], [5, 44], [5, 44]])
  // A 5-hour window whose percent is unread draws its dash in the bar column too (RULING 5918).
  const unread = rowLines(
    rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, fable: { pct: 38, resetsAt: ROW_WEEK_END }, fiveHour: { resetsAt: ahead(0, 1, 20) } as never, at: READ_AT, by: '1' } }, noFiveHour: { '1': false } }, max),
  )[2] ?? ''
  expect(unread.indexOf('–')).toBe(5)
})

test('the 5-hour line pads its percent the same way', () => {
  const max = { ...ANDRES, tier: 'default_claude_max_5x' }
  const five = (pct: number) =>
    rowLines(rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, fiveHour: { pct, resetsAt: ahead(0, 1, 20) }, at: READ_AT, by: '1' } }, noFiveHour: { '1': false } }, max))[2]
  expect([five(4), five(50), five(100)]).toEqual([`5h   ▱▱▱▱▱▱▱▱▱▱   4%${NO_FABLE_GAP}resets 1h 20m`, FIVE_HOUR_50, `5h   ▰▰▰▰▰▰▰▰▰▰ 100%${NO_FABLE_GAP}resets 1h 20m`])
})

test('a dash takes the cells of a bar and its percent, so what follows keeps its column, and one that ends a line leaves no blank after it', () => {
  const v = rowView()
  const noFable = { ...v.readings['1'], fable: undefined } as View['readings'][string]
  expect((rowLines({ ...v, readings: { '1': noFable } })[1] ?? '').indexOf('resets')).toBe((rowLines(v)[1] ?? '').indexOf('resets'))
  const passed = rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ahead(0, 0, -1) }, noFiveHour: true, at: READ_AT, by: '1' } } })
  expect(rowLines(passed)[1]).toBe('Used ▱▱▱▱▱▱▱▱▱▱   0% Fable –')
})

// The operator's order of 2026-11-14 20:17Z: an account is named by its email (+ org, if multiple orgs available).
test('label names an account by its email, with its organization only where that email is on more than one account', () => {
  const one = { id: '1', slot: '', email: 'one@example.com', orgName: 'Org' }
  const twoA = { id: '2', slot: '/s/2', email: 'two@example.com', orgName: 'Alpha' }
  const twoB = { id: '3', slot: '/s/3', email: 'two@example.com', orgName: 'Beta' }
  const unread = { id: '4', slot: '/s/4' }
  const all = [one, twoA, twoB, unread]
  expect(all.map(a => label(a, all))).toEqual(['one@example.com', 'two@example.com · Alpha', 'two@example.com · Beta', 'account 4 (not signed in yet)'])
  expect(label({ id: '1', slot: '' }, all)).toBe("Claude Code's login")
})

// Review R1 LABEL-PARITY (Codex gpt-6-sol at bcbfb83): the store is JSON another session wrote, so an email can be
// null; bin/account_rotator_store.py label takes only a string as an email, and so does label here.
test('a stored null email follows the no-email fallback', () => {
  const account = { id: '4', slot: '/s/4', email: null } as unknown as View['accounts'][number]
  expect(label(account, [account])).toBe('account 4 (not signed in yet)')
})

test('malformed stored emails never become an account name', () => {
  for (const email of [null, 42, false]) {
    const account = { id: '4', slot: '/s/4', email } as unknown as View['accounts'][number]
    expect(label(account, [account])).toBe('account 4 (not signed in yet)')
    expect(claudeAccount(account, [account])).toBe('account 4 (not signed in yet)')
  }
})

// Self-review of 5266c16: "Claude account ${label(...)}" read "Claude account account 4 (not signed in yet)".
test('a sentence names an account "Claude account <email>", and with no email by label alone, never "Claude account account"', () => {
  const one = { id: '1', slot: '', email: 'one@example.com' }
  const unread = { id: '4', slot: '/s/4' }
  const login = { id: '5', slot: '' }
  const all = [one, unread, login]
  expect(all.map(a => claudeAccount(a, all))).toEqual(['Claude account one@example.com', 'account 4 (not signed in yet)', "Claude Code's login"])
})

test('a failed read newer than the last good one ends line 1 with its time and status, and dims line 2', () => {
  const v = rowView({ checkErrors: { '1': HTTP_429 } })
  expect(rowLines(v)).toEqual(['andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (HTTP 429)', OPERATOR_LINE_2])
  const [line1, line2] = rowOf(v, ANDRES, ROW_NOW, TALLINN).lines
  expect(line1?.slice(-2)).toEqual([
    { text: '18:39 Failed to update', tone: 'warning', runs: [{ clock: FAILED_AT }, ' Failed to update'] },
    { text: ' (HTTP 429)', tone: 'warning', shrink: 'cause', forms: [' (HTTP 429)', ' (429)'] },
  ])
  expect(line2?.map(p => p.tone)).toEqual(line2?.map(() => 'dim'))
  expect(rowOf(rowView(), ANDRES, ROW_NOW, TALLINN).lines[1]?.some(p => p.tone === 'dim')).toBe(false)
})

test('a failure older than the last good read is past: line 1 says when the good read came', () => {
  expect(rowLines(rowView({ checkErrors: { '1': { ...HTTP_429, at: READ_AT - MINUTE } } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  updated 18:34')
})

test('a check that threw says (check failed), and the error\'s kind stays in the debug log', () => {
  const v = rowView({ checkErrors: { '1': { why: 'the check failed (TypeError); the debug log has the rest', at: FAILED_AT } }, nextAt: { '1': NEXT_AT } })
  expect(rowLines(v)[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (check failed)')
})

test('an idle login, its token run out, says when it was last read and idle, never Failed to update, though a failure stands', () => {
  // Another login is in use: the session's own login is never drawn idle.
  const idle = { activeId: '2', health: { '1': { kind: 'ok', isIdle: true } as const }, checkErrors: { '1': HTTP_429 }, nextAt: { '1': NEXT_AT } }
  expect(rowLines(rowView(idle))[0]).toBe('andres@lutsohealth.com · Company · Ultra  updated 18:34 · idle')
  expect(rowLines(rowView({ ...idle, readings: {} }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  idle')
})

// Review of 84bc902, LOW (b): the session's own login, its token run out, drew a failure from before the run-out.
test('the login this session runs on, its token run out, says when it was last read, neither idle nor Failed to update', () => {
  const v = rowView({ isBound: true, health: { '1': { kind: 'ok', isIdle: true } }, checkErrors: { '1': HTTP_429 }, nextAt: { '1': NEXT_AT } })
  expect(rowLines(v)[0]).toBe('andres@lutsohealth.com · Company · Ultra  updated 18:34')
})

// Review of 84bc902, LOW (c): before the session is bound, the view's activeId is a default, which spares no login its idle row.
test('before the session is bound, login 1, its token run out, reads idle', () => {
  expect(rowLines(rowView({ health: { '1': { kind: 'ok', isIdle: true } } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  updated 18:34 · idle')
})

test('a failed row names the next try, the time its schedule gives, in the zone\'s clock', () => {
  const v = rowView({ checkErrors: { '1': HTTP_429 }, nextAt: { '1': NEXT_AT } })
  expect(rowLines(v)[0]).toBe(FAILED_NEXT_L1)
  expect(rowLines(v, 'UTC')[0]).toBe('andres@lutsohealth.com · Company · Ultra  16:39 Failed to update (HTTP 429), next try 16:45')
  const [line1] = rowOf(v, ANDRES, ROW_NOW, TALLINN).lines
  expect(line1?.at(-1)).toEqual({ text: ', next try 18:45', tone: 'warning', shrink: 'next', forms: [', next try 18:45', ', next 18:45'], runs: [', next try ', { clock: NEXT_AT }] })
  // A row that did not fail names no next try, whatever its schedule says.
  expect(rowLines(rowView({ nextAt: { '1': NEXT_AT } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  updated 18:34')
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
  expect(rowLines({ ...v, readings: { '1': noFable } })[1]).toBe('Used ▰▰▰▱▱▱▱▱▱▱  31% Fable –                resets 2d 3h 14m')
  const pro = { ...ANDRES, plan: 'pro', tier: undefined }
  expect(rowLines({ ...rowView({}, pro), readings: { '1': noFable }, noFiveHour: {} })).toEqual(['andres@lutsohealth.com · Company · Pro  updated 18:34', PRO_LINE_2])
})

test('a Fable week that resets at another time than the week says its own reset after the week\'s', () => {
  const v = rowView()
  const r = { ...v.readings['1'], fable: { pct: 38, resetsAt: ahead(1, 3, 14) } } as View['readings'][string]
  expect(rowLines({ ...v, readings: { '1': r } })[1]).toBe(`${OPERATOR_LINE_2} · Fable 1d 3h 14m`)
})

test('a reset under a day drops the days, and under an hour the hours', () => {
  const at = (resetsAt: string) => rowLines(rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt }, fable: { pct: 38, resetsAt }, noFiveHour: true, at: READ_AT, by: '1' } } }))[1]
  expect(at(ahead(0, 20, 27))).toBe('Used ▰▰▰▱▱▱▱▱▱▱  31% Fable ▰▰▰▰▱▱▱▱▱▱  38%  resets 20h 27m')
  expect(at(ahead(0, 0, 27))).toBe('Used ▰▰▰▱▱▱▱▱▱▱  31% Fable ▰▰▰▰▱▱▱▱▱▱  38%  resets 27m')
})

test('a week whose reset has passed is 0% used with no reset; a plan that reports no week is a dash', () => {
  const passed = rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ahead(0, 0, -1) }, noFiveHour: true, at: READ_AT, by: '1' } } })
  expect(rowLines(passed)[1]).toBe('Used ▱▱▱▱▱▱▱▱▱▱   0% Fable –')
  const noWeek = rowView({ readings: { '1': { fable: { pct: 38, resetsAt: ROW_WEEK_END }, noFiveHour: true, at: READ_AT, by: '1' } } })
  expect(rowLines(noWeek)[1]).toBe('Used –               Fable ▰▰▰▰▱▱▱▱▱▱  38%  Fable resets 2d 3h 14m')
})

test('a login with a 5-hour window in its counted reading has a third line for it; one with none has two lines', () => {
  const max = { ...ANDRES, tier: 'default_claude_max_5x' }
  const r = { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, fable: { pct: 38, resetsAt: ROW_WEEK_END }, fiveHour: { pct: 50, resetsAt: ahead(0, 1, 20) }, at: READ_AT, by: '1' }
  const v = rowView({ readings: { '1': r }, noFiveHour: { '1': false } }, max)
  expect(rowLines(v)).toEqual(['andres@lutsohealth.com · Company · Max  updated 18:34', OPERATOR_LINE_2, FIVE_HOUR_50])
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

// puma-9arph.33 (the operator's order of 2026-11-14 about 20:17Z: every line under each account lines up): the buttons
// stand in one place on every row, a line of their own after line 2, whatever line 1's length or the pane's width.
test('every row, short, with no Company, or failed, holds its buttons on a line of their own after line 2, at 82 and at 64', () => {
  const own = { ...ANDRES, orgName: "andres@lutsohealth.com's Organization" }
  const rows = [
    ['short', rowView(), L1],
    ['no Company', rowView({}, own), 'andres@lutsohealth.com · Ultra  updated 18:34'],
    ['failed', rowView({ checkErrors: { '1': HTTP_429 } }), FAILED_L1],
  ] as const
  for (const [what, v, l1] of rows) {
    expect([what, fitted(v, 82)]).toEqual([what, { lines: [l1, OPERATOR_LINE_2, ''], end: 'own' }])
    const at64 = fitted(v, 64)
    expect([what, at64.lines.slice(1), at64.end]).toEqual([what, [OPERATOR_LINE_2, ''], 'own'])
  }
})

test('a Pro or a Max failed row holds its buttons on a line of their own too', () => {
  // A Pro login's line 2 keeps the Fable part's cells blank so its resets line up (puma-9arph.28), so at 82 its
  // buttons take a line of their own, as a Max row's do.
  const pro = { ...ANDRES, plan: 'pro', tier: undefined }
  const short = rowView({ checkErrors: { '1': HTTP_429 }, readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, noFiveHour: true, at: READ_AT, by: '1' } } }, pro)
  expect(fitted(short, 82)).toEqual({ lines: ['andres@lutsohealth.com · Company · Pro  18:39 Failed to update (HTTP 429)', PRO_LINE_2, ''], end: 'own' })
  // puma-9arph.28 item 4: a Max failed row whose usage lists no Fable week draws a dash in the Fable cells, and fits at 82.
  const max = { ...ANDRES, tier: 'default_claude_max_5x' }
  const dash = rowView({ checkErrors: { '1': HTTP_429 }, readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, at: READ_AT, by: '1' } } }, max)
  expect(fitted(dash, 82)).toEqual({ lines: ['andres@lutsohealth.com · Company · Max  18:39 Failed to update (HTTP 429)', 'Used ▰▰▰▱▱▱▱▱▱▱  31% Fable –                resets 2d 3h 14m', ''], end: 'own' })
})

test('a line 1 wider than the pane cuts the cause, then the Company, then the email\'s middle, never the state', () => {
  const v = rowView({ checkErrors: { '1': HTTP_429 } })
  // 75 cells: the cause's short form takes 5 off; 4 more over 66 come off the Company; 11 over 64 take the Company to
  // one letter, then 1 from the email.
  expect(fitted(v, 70).lines[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (429)')
  expect(fitted(v, 66).lines[0]).toBe('andres@lutsohealth.com · Co… · Ultra  18:39 Failed to update (429)')
  expect(fitted(v, 64)).toEqual({ lines: ['andres@lut…health.com · C… · Ultra  18:39 Failed to update (429)', OPERATOR_LINE_2, ''], end: 'own' })
  expect(fitted(v, 56).lines[0]).toBe('andres…th.com · C… · Ultra  18:39 Failed to update (429)')
})

test('a login with no reading, no Fable row, a 5-hour window or a sign-in needed holds its buttons on a line of their own, at 82 and 64', () => {
  const noReading = rowView({ readings: {}, readAt: {} })
  expect(fitted(noReading, 82)).toEqual({ lines: ['andres@lutsohealth.com · Company · Ultra', 'Used ▱▱▱▱▱▱▱▱▱▱ no reading yet', ''], end: 'own' })
  expect(fitted(noReading, 64)).toEqual({ lines: ['andres@lutsohealth.com · Company · Ultra', 'Used ▱▱▱▱▱▱▱▱▱▱ no reading yet', ''], end: 'own' })
  const noFable = rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, noFiveHour: true, at: READ_AT, by: '1' } } })
  expect(fitted(noFable, 82)).toEqual({ lines: [L1, 'Used ▰▰▰▱▱▱▱▱▱▱  31% Fable –                resets 2d 3h 14m', ''], end: 'own' })
  expect(fitted(noFable, 64)).toEqual({ lines: [L1, 'Used ▰▰▰▱▱▱▱▱▱▱  31% Fable –                resets 2d 3h 14m', ''], end: 'own' })
  const max = { ...ANDRES, tier: 'default_claude_max_5x' }
  const five = rowView({ readings: { '1': { sevenDay: { pct: 31, resetsAt: ROW_WEEK_END }, fable: { pct: 38, resetsAt: ROW_WEEK_END }, fiveHour: { pct: 50, resetsAt: ahead(0, 1, 20) }, at: READ_AT, by: '1' } }, noFiveHour: { '1': false } }, max)
  const maxL1 = 'andres@lutsohealth.com · Company · Max  updated 18:34'
  expect(fitted(five, 82)).toEqual({ lines: [maxL1, OPERATOR_LINE_2, '', FIVE_HOUR_50], end: 'own' })
  expect(fitted(five, 64)).toEqual({ lines: [maxL1, OPERATOR_LINE_2, '', FIVE_HOUR_50], end: 'own' })
  const signIn = rowView({ health: { '1': { kind: 'login-needed', why: 'sign-in expired' } } })
  expect(fitted(signIn, 82)).toEqual({ lines: ['andres@lutsohealth.com · Company · Ultra  ⚠ sign in needed', OPERATOR_LINE_2, ''], end: 'own' })
  expect(fitted(signIn, 64)).toEqual({ lines: ['andres@lutsohealth.com · Company · Ultra  ⚠ sign in needed', OPERATOR_LINE_2, ''], end: 'own' })
})

test('a failed row too wide for the pane cuts its cause to the short form before the Company and the email, never the next try', () => {
  const v = rowView({ checkErrors: { '1': HTTP_429 }, nextAt: { '1': NEXT_AT } })
  expect(fitted(v, 91).lines[0]).toBe(FAILED_NEXT_L1)
  // 91 cells: the cause's short form takes 5 off, so the Company gives the other 4 at 82.
  expect(fitted(v, 86).lines[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (429), next try 18:45')
  expect(fitted(v, 82).lines[0]).toBe('andres@lutsohealth.com · Co… · Ultra  18:39 Failed to update (429), next try 18:45')
  expect(fitted(v, 64).lines[0]).toBe('an…om · C… · Ultra  18:39 Failed to update (429), next try 18:45')
})

// Review C8-R1 Opus advisory [STATUS-OF-ANOTHER-CALL] (RULING 4525, 4538): the row's HTTP status is the usage call's.
test('a failure of the profile call says (profile HTTP 403): the status is the profile call\'s, never the usage call\'s', () => {
  const profile = { why: 'the profile call answered HTTP 403, so its usage is not read until it names the sign-in', at: FAILED_AT }
  // The schedule holds the usage read's next try; the 10-minute check retries the profile call, at a time no stored value holds.
  expect(rowLines(rowView({ checkErrors: { '1': profile }, nextAt: { '1': NEXT_AT } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (profile HTTP 403)')
})

test('a profile answer that names no email says so, and names no next try though the usage schedule has one', () => {
  const why = 'the profile answer named no email, so its usage is not read until it names the sign-in'
  expect(rowLines(rowView({ checkErrors: { '1': { why, at: FAILED_AT } }, nextAt: { '1': NEXT_AT } }))[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (profile named no email)')
})

test('a failure no writer words stays a bare Failed to update, with no next try though the schedule has one', () => {
  const v = rowView({ checkErrors: { '1': { why: 'the usage call failed to connect', at: FAILED_AT } }, nextAt: { '1': NEXT_AT } })
  expect(rowLines(v)[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update')
})

test('a usage call that threw says (usage call threw) and names the next try: its back-off is the schedule', () => {
  const why = 'the usage call threw (Error)'
  const v = rowView({ checkErrors: { '1': { why, at: FAILED_AT } }, nextAt: { '1': NEXT_AT } })
  expect(rowLines(v)[0]).toBe('andres@lutsohealth.com · Company · Ultra  18:39 Failed to update (usage call threw), next try 18:45')
})

const EVERY_WHY = [
  'the usage call answered HTTP 429 (retry after 60 s)',
  'the usage call threw (Error)',
  'the profile call answered HTTP 403, so its usage is not read until it names the sign-in',
  'the profile answer named no email, so its usage is not read until it names the sign-in',
  'the check failed (TypeError); the debug log has the rest',
]

test('a failed usage row with its next try fits 56 columns', () => {
  const v = rowView({ checkErrors: { '1': HTTP_429 }, nextAt: { '1': NEXT_AT } })
  const line = fitted(v, 56).lines[0] ?? ''
  expect(line).toBe('a…m · Ultra  18:39 Failed to update (429), next 18:45')
  expect([...line].length).toBeLessThanOrEqual(56)
})

test('every cause, with and without Chrome, fits every width the fit tests use, and keeps its time', () => {
  const offenders: string[] = []
  for (const why of EVERY_WHY)
    for (const chromeAccountId of [undefined, '1'])
      for (const columns of [56, 64, 82]) {
        const v = rowView({ checkErrors: { '1': { why, at: FAILED_AT } }, nextAt: { '1': NEXT_AT }, chromeAccountId })
        const line = fitted(v, columns).lines[0] ?? ''
        if ([...line].length > columns || !line.includes('18:39 Failed to update')) offenders.push(`${why.slice(0, 20)} chrome=${chromeAccountId} ${columns}: ${[...line].length} ${line}`)
      }
  expect(EVERY_WHY.length).toBeGreaterThan(0)
  expect(offenders).toEqual([])
})

test('every cause\'s short form keeps what the row needs: the status or the call', () => {
  const whys: [string, string, string][] = [
    ['the usage call answered HTTP 429 (retry after 60 s)', '(429), next try 18:45', 'usage'],
    ['the profile call answered HTTP 403, so its usage is not read until it names the sign-in', '(profile 403)', 'profile status'],
    ['the profile answer named no email, so its usage is not read until it names the sign-in', '(profile no email)', 'profile email'],
    ['the check failed (TypeError); the debug log has the rest', '(check error)', 'thrown check'],
  ]
  const shown = whys.map(([why, , name]) => [name, fitted(rowView({ checkErrors: { '1': { why, at: FAILED_AT } }, nextAt: { '1': NEXT_AT } }), 64).lines[0]?.split('18:39 ')[1]])
  expect(shown).toEqual(whys.map(([, end, name]) => [name, `Failed to update ${end}`]))
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
  expect(storedLineText(line3, ROWS_FIXTURE.now + 2 * 3_600_000, TALLINN)).toBe(`5h   ▰▰▰▰▰▱▱▱▱▱  50%${NO_FABLE_GAP}resets passed`)
})

test('a stored line read a minute later counts its resets down, and read in UTC says its times in UTC', () => {
  const [line1, line2] = rowsOf(FIXTURE_VIEW, ROWS_FIXTURE.now).find(r => r.id === '1')?.lines ?? []
  expect(storedLineText(line2 ?? [], ROWS_FIXTURE.now + MINUTE, TALLINN)).toBe('Used ▰▰▰▱▱▱▱▱▱▱  31% Fable ▰▰▰▰▱▱▱▱▱▱  38%  resets 2d 3h 13m · Fable 1d 3h 13m')
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
    ['another kind', { ...SELECT, kind: 'add' }],
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

// C12 (puma-eslxj.13, RULING 4624): `account use` aims at one session by the mark that session set in its Bash children's environment.
const USE = { kind: 'use', nonce: 'n0nce-5678', at: NOW, id: '2', store: 'store-abc', session: 'session-abc' }

test('a use request is read back with the mark of the session it is for', () => {
  expect(requestFrom(USE, NOW)).toEqual(USE)
})

test('a use request names a session or is no request, and a select request carries none', () => {
  const cases: [string, unknown][] = [
    ['no mark', { ...USE, session: undefined }],
    ['an empty mark', { ...USE, session: '' }],
    ['a mark that is no string', { ...USE, session: 7 }],
    ['another kind with a mark', { ...USE, kind: 'add' }],
  ]
  expect(cases.filter(([, value]) => requestFrom(value, NOW) !== undefined).map(([name]) => name)).toEqual([])
  expect(requestFrom({ ...SELECT, session: 'session-abc' }, NOW)).toEqual(SELECT)
})

test('an rm request is read back with what the CLI saw of the account, and it carries no mark', () => {
  const RM = { kind: 'rm', nonce: 'n0nce-9012', at: NOW, id: '2', store: 'store-abc', slot: '/slot/2', email: 'two@example.com' }
  expect(requestFrom(RM, NOW)).toEqual(RM)
  expect(requestFrom({ ...RM, session: 'session-abc' }, NOW)).toEqual(RM)
  const { email: _email, ...noEmail } = RM
  expect(requestFrom(noEmail, NOW), 'an account not signed in yet has no email').toEqual(noEmail)
  expect(requestFrom({ ...RM, orgId: 'org-a' }, NOW)).toEqual({ ...RM, orgId: 'org-a' })
  const cases: [string, unknown][] = [
    ['no slot', { ...RM, slot: undefined }],
    ['a slot that is no string', { ...RM, slot: 7 }],
    ['an email that is no string', { ...RM, email: 7 }],
    ['an organization that is no string', { ...RM, orgId: 7 }],
  ]
  expect(cases.filter(([, value]) => requestFrom(value, NOW) !== undefined).map(([name]) => name)).toEqual([])
})

// Review C12-rm-R2 EMAIL-FILL and ORG-REUSE (Codex) [RM-TARGET-NOT-SEEN]: a login is one email in one organization (sameLogin); what the mod learned since the read is no other login.
test('an account holds the login a request read: another slot, email or organization is another login, and what was learned since is not', () => {
  const A = { slot: '/slot/2', email: 'a@example.com', orgId: 'org-a' }
  const cases: [string, Parameters<typeof holdsLogin>[0], Parameters<typeof holdsLogin>[1], boolean][] = [
    ['all the same', A, { id: '2', ...A }, true],
    ['the email learned since', { slot: A.slot }, { id: '2', ...A }, true],
    ['the organization learned since', { slot: A.slot, email: A.email }, { id: '2', ...A }, true],
    ['another slot', { ...A, slot: '/slot/9' }, { id: '2', ...A }, false],
    ['another email', { ...A, email: 'b@example.com' }, { id: '2', ...A }, false],
    ['another organization under one email', { ...A, orgId: 'org-b' }, { id: '2', ...A }, false],
    ['an email the store no longer holds', A, { id: '2', slot: A.slot }, false],
    ['an organization the store no longer holds', A, { id: '2', slot: A.slot, email: A.email }, false],
  ]
  expect(cases.filter(([, seen, account, expected]) => holdsLogin(seen, account) !== expected).map(([name]) => name)).toEqual([])
})

// puma-9arph.28 item 5: the store is JSON another session wrote, so an email stored as null is no email, not one shared.
test('two stored accounts whose email is null are two logins to sameLogin and isLoginOf', () => {
  const [one, two] = JSON.parse('[{"id":"1","slot":"/slot/1","email":null},{"id":"2","slot":"/slot/2","email":null}]')
  expect(sameLogin(one, two)).toBe(false)
  expect(isLoginOf(one, two)).toBe(false)
})

test('the requests live in the Claude config folder of the session, CLAUDE_CONFIG_DIR or ~/.claude', () => {
  expect([requestsDir('/cfg', '/home/x'), requestsDir(undefined, '/home/x')]).toEqual(['/cfg/account-rotator-requests', '/home/x/.claude/account-rotator-requests'])
})

// Review C11-R1 F5 (Opus) [REQUEST-FOLDER] (RULING 4607): Python's `or` in bin/account_rotator_store.py takes an empty value as unset.
test('an empty CLAUDE_CONFIG_DIR is the folder the CLI takes too, ~/.claude', () => {
  expect(requestsDir('', '/home/x')).toBe('/home/x/.claude/account-rotator-requests')
})

// C13 `add` (puma-eslxj.14, RULING 4660).
const ADD = { kind: 'add', nonce: 'n0nce-1234', at: NOW, id: '7', store: 'store-abc', slot: '/home/x/.claude/accounts/7' }

test('an add request is read back as it was written, while it is fresh', () => {
  expect(requestFrom(ADD, NOW + REQUEST_TTL_MS)).toEqual(ADD)
})

test('an add with no slot it can name is no request', () => {
  const cases: [string, unknown][] = [
    ['no slot', { ...ADD, slot: undefined }],
    ['an empty slot, Claude Code own login', { ...ADD, slot: '' }],
    ['a slot of another type', { ...ADD, slot: 7 }],
    ['stale', { ...ADD, at: NOW - REQUEST_TTL_MS - 1 }],
  ]
  expect(cases.filter(([, value]) => requestFrom(value, NOW) !== undefined).map(([name]) => name)).toEqual([])
})

test('a slot has a number only as a folder directly under the accounts folder, its name a number from 1 up', () => {
  const home = '/home/x'
  const root = `${home}/.claude/accounts`
  expect(slotNumber(`${root}/7`, home)).toBe('7')
  expect(slotNumber(`${root}/12`, home)).toBe('12')
  // Review C13-R1 F7 [INPUT-EDGES]: the CLI's expanduser strips a HOME's trailing slash.
  expect(slotNumber(`${root}/7`, `${home}/`)).toBe('7')
  const bad = ['', root, `${root}/`, `${root}/0`, `${root}/007`, `${root}/abc`, `${root}/7/`, `${root}/7/8`, `${root}/../2`, `/other${root}/7`, `/home/y/.claude/accounts/7`]
  expect(bad.filter(slot => slotNumber(slot, home) !== undefined)).toEqual([])
})

// puma-9arph.34 C (RULINGS 6008, 6034), v4 s.3: the look's Escape for a queued carry-on goes only when nothing below holds it back.
test('row g: with prompts queued under the dialog and no turn, the look\'s Escape releases them and the resume enters', () => {
  const modal: Parameters<typeof escapeHeldBack>[0] = {
    isCarryOnInFlight: true,
    isLimitStopLast: raisesLimitModal('rate_limit'),
    openTurns: 0,
    isSettling: false,
    isHeld: false,
    escapes: 0,
    budget: 8,
    pane: 'term_a',
    fill: { refusal: 'dialog' },
  }
  // Under the engine's own 'dialog' with no turn open in any loop, the key goes.
  expect(escapeHeldBack(modal)).toBeUndefined()
  // Before the fill is asked, only what the session knows without asking.
  expect(escapeHeldBack({ ...modal, fill: undefined })).toBeUndefined()
  const rows: [string, Parameters<typeof escapeHeldBack>[0], string][] = [
    ['no carry-on in flight', { ...modal, isCarryOnInFlight: false }, 'no carry-on in flight'],
    ['no limit stop since the last turn began', { ...modal, isLimitStopLast: false }, 'no limit stop before it'],
    // puma-9arph.36: a rejected sign-in raises no modal, so even under the engine's own dialog it gets no key.
    ['a rejected sign-in before it', { ...modal, isLimitStopLast: raisesLimitModal('authentication_failed') }, 'no limit stop before it'],
    ['a turn open in some loop', { ...modal, openTurns: 1 }, 'a turn is open'],
    ['a switch settling', { ...modal, isSettling: true }, 'the switch is settling'],
    ['a switch held', { ...modal, isHeld: true }, 'a switch is held'],
    // Review CALL1 [UNPROVEN-DIALOG]: a hook's refusal carries no cause and proves no dialog.
    ['a refusal with its cause left out', { ...modal, fill: {} }, 'no dialog holds it'],
    ['a session with no box', { ...modal, fill: { refusal: 'no_composer' } }, 'no dialog holds it'],
    ['no Orca pane (C4)', { ...modal, pane: undefined }, 'no Orca pane'],
    ['an empty Orca handle', { ...modal, pane: '' }, 'no Orca pane'],
  ]
  expect(rows.map(([name, s]) => [name, escapeHeldBack(s)])).toEqual(rows.map(([name, , why]) => [name, why]))
})

// puma-9arph.57: the refresh nudge's own carry-on goes under a held switch; any other carry-on still waits for it.
test('row v: a held switch holds back every Escape but the refresh nudge\'s', () => {
  const look: Parameters<typeof escapeHeldBack>[0] = { isCarryOnInFlight: true, isLimitStopLast: true, openTurns: 0, isSettling: false, isHeld: true, escapes: 0, budget: 10, pane: 'term_a', fill: { refusal: 'dialog' } }
  expect([escapeHeldBack(look), escapeHeldBack({ ...look, isNudge: true })]).toEqual(['a switch is held', undefined])
})

// puma-9arph.71: the screens of the reading (Claude Code 2.1.326), the countdown's footer standing and gone.
const COUNTDOWN_SCREEN = [
  '⏺ Usage limit reached · continuing automatically at 1:11am · esc to cancel',
  '──────────',
  '❯ ',
  '──────────',
  '  ⚠ Usage limit reached · limit resets 1:11am',
  '    Continuing automatically at 1:11am · Esc to cancel',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
]
const CANCELLED_SCREEN = [
  '⏺ Usage limit reached · continuing automatically at 1:11am · esc to cancel',
  '⏺ Automatic continue cancelled · /rate-limit-options to re-arm',
  '──────────',
  '❯ ',
  '──────────',
  '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
]

test('row ow: the countdown counts as on screen only by its footer under the prompt box (puma-9arph.71)', () => {
  const shortly = COUNTDOWN_SCREEN.map(l => l.replace('Continuing automatically at 1:11am', 'Continuing shortly'))
  // The transcript keeps the stop's own line, in lower case, after a cancel: it is no footer.
  const footerAbove = ['    Continuing automatically at 1:11am · Esc to cancel', '❯ ', '  ⏵⏵ bypass permissions on']
  expect([isCountdownOnScreen(COUNTDOWN_SCREEN), isCountdownOnScreen(shortly), isCountdownOnScreen(CANCELLED_SCREEN), isCountdownOnScreen(footerAbove), isCountdownOnScreen([])]).toEqual([true, true, false, false, false])
})

test('row ow: screenLinesFrom takes only a rendered screen from `orca terminal read --screen --json` (puma-9arph.71)', () => {
  const json = (terminal: unknown) => JSON.stringify({ result: { terminal } })
  expect([
    screenLinesFrom(json({ source: 'screen', tail: ['a', 'b'] })),
    screenLinesFrom(json({ source: 'stream', tail: ['a'] })),
    screenLinesFrom(json({ source: 'screen-unavailable', tail: ['a'] })),
    screenLinesFrom(json({ source: 'screen', tail: 'a' })),
    screenLinesFrom(json({ source: 'screen', tail: ['a', 2] })),
    screenLinesFrom('not json'),
  ]).toEqual([['a', 'b'], undefined, undefined, undefined, undefined, undefined])
})

// puma-9arph.71 (the reading R0 to R8, RULING 6578): the Escape that cancels Claude Code's own continue goes only at an
// idle, empty prompt with the countdown's footer on screen, after the mod's own carry-on answered.
test('row ow: ownContinueHeldBack keys only the states the reading shows safe, and names why for every other', () => {
  const now = 1_000_000
  const idle: Parameters<typeof ownContinueHeldBack>[0] = {
    isArmed: true,
    isSent: false,
    openTurns: 0,
    isPromptEntering: false,
    isCarryOnQueued: false,
    isSettling: false,
    isHeld: false,
    isPanelShown: false,
    now,
    resetAt: now + 60_000,
    pane: 'term_a',
    box: { text: '' },
    fill: { isFilled: true, text: '' },
    screen: { lines: COUNTDOWN_SCREEN },
  }
  // R1, R6: the key goes. Each stage not asked yet holds nothing back: the look asks it next.
  expect([
    ownContinueHeldBack(idle),
    ownContinueHeldBack({ ...idle, screen: undefined }),
    ownContinueHeldBack({ ...idle, fill: undefined, screen: undefined }),
    ownContinueHeldBack({ ...idle, box: undefined, fill: undefined, screen: undefined }),
    ownContinueHeldBack({ ...idle, resetAt: undefined }),
    ownContinueHeldBack({ ...idle, now: now + 60_000 + OWN_CONTINUE_MARGIN_MS - 1 }),
  ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined])
  const rows: [string, Parameters<typeof ownContinueHeldBack>[0], string][] = [
    ['R0, R7: no carry-on of the mod answered', { ...idle, isArmed: false }, 'no carry-on answered'],
    ['R8: the one key went', { ...idle, isSent: true }, 'Escape sent already'],
    ['R3, R4: a turn or a tool call running', { ...idle, openTurns: 1 }, 'a turn is open'],
    ['a prompt still entering, any origin (puma-9arph.80 KEY-QUEUED)', { ...idle, isPromptEntering: true }, 'a prompt is entering'],
    ['R5: a permission dialog, its turn open', { ...idle, openTurns: 1, fill: { isFilled: false, refusal: 'dialog', text: '' } }, 'a turn is open'],
    ['R5 alone: a dialog holds the keys', { ...idle, fill: { isFilled: false, refusal: 'dialog', text: '' } }, 'the fill was refused: dialog'],
    ["a hook's refusal, its cause left out", { ...idle, fill: { isFilled: false, text: '' } }, 'the fill was refused: no cause'],
    ['a session with no box', { ...idle, fill: { isFilled: false, refusal: 'no_composer', text: '' } }, 'the fill was refused: no_composer'],
    ['a carry-on queued or armed', { ...idle, isCarryOnQueued: true }, 'a carry-on is queued'],
    ['a switch settling', { ...idle, isSettling: true }, 'the switch is settling'],
    ['a switch held', { ...idle, isHeld: true }, 'a switch is held'],
    ['the accounts panel open', { ...idle, isPanelShown: true }, 'the accounts panel is shown'],
    ['at the reset plus the margin', { ...idle, now: now + 60_000 + OWN_CONTINUE_MARGIN_MS }, "past the own continue's deadline"],
    ['no Orca pane', { ...idle, pane: undefined }, 'no Orca pane'],
    ['an empty Orca handle', { ...idle, pane: '' }, 'no Orca pane'],
    ['a box read with no answer', { ...idle, box: { text: undefined } }, 'the box is unreadable'],
    ['R2: a draft in the box', { ...idle, box: { text: 'a draft typed by the stand-in' } }, 'the prompt box holds a draft'],
    ['a draft the fill shows and the read missed', { ...idle, fill: { isFilled: true, text: 'typed meanwhile' } }, 'the prompt box holds a draft'],
    // Round 1 F1 [UNVERIFIED-EMPTY]: a fill that answers no text proves no empty box.
    ['an accepted fill with no text', { ...idle, fill: { isFilled: true } }, 'the fill gave no text'],
    ['a screen read with no answer', { ...idle, screen: { lines: undefined } }, 'the screen is unreadable'],
    ['R7: no countdown on screen (a cancel, a menu, a picker)', { ...idle, screen: { lines: CANCELLED_SCREEN } }, 'no countdown on screen'],
  ]
  expect(rows.map(([name, s]) => [name, ownContinueHeldBack(s)])).toEqual(rows.map(([name, , why]) => [name, why]))
  // The order: a look that fails at two gates names the earlier.
  expect([
    ownContinueHeldBack({ ...idle, isArmed: false, isSent: true }),
    ownContinueHeldBack({ ...idle, openTurns: 1, box: { text: 'draft' } }),
    ownContinueHeldBack({ ...idle, pane: undefined, box: { text: 'draft' } }),
  ]).toEqual(['no carry-on answered', 'a turn is open', 'no Orca pane'])
})

// puma-9arph.77 (px's reading of puma-9arph.75): a weekly stop writes only week-mark and a Fable stop only fable-mark,
// so an arm that read mark alone held no deadline after either.
test("row ow: ownContinueResetAt holds the reset of the stopped login's newest stop mark, whatever window it marks", () => {
  const at = NOW - HOUR
  const five = { pct: 100, resetsAt: LATER, at }
  const week = { pct: 100, resetsAt: WEEK_END, at }
  const fable = { pct: 100, resetsAt: FABLE_END, at }
  const rows: [string, Parameters<typeof ownContinueResetAt>[0], number | undefined][] = [
    ['a 5-hour stop writes mark', { marks: { a: five } }, Date.parse(LATER)],
    ['a weekly stop writes week-mark only', { weekMarks: { a: week } }, Date.parse(WEEK_END)],
    ['a Fable stop writes fable-mark only', { fableMarks: { a: fable } }, Date.parse(FABLE_END)],
    ["an older 5-hour mark beside the stop's week mark", { marks: { a: five }, weekMarks: { a: { ...week, at: at + 1 } } }, Date.parse(WEEK_END)],
    ["an older Fable mark beside the stop's 5-hour mark", { marks: { a: { ...five, at: at + 1 } }, fableMarks: { a: fable } }, Date.parse(LATER)],
    ['no mark on the stopped login', { marks: { b: five } }, undefined],
    ['a mark whose reset does not parse', { marks: { a: { ...five, resetsAt: 'soon' } } }, undefined],
  ]
  expect(rows.map(([name, v]) => [name, ownContinueResetAt(v, 'a')])).toEqual(rows.map(([name, , reset]) => [name, reset]))
  expect(ownContinueResetAt({ marks: { a: five } }, undefined)).toEqual(undefined)
  // Codex round 1 MARK_ORIGIN [STOP-IDENTITY-BY-ORDER]: another session can write a newer mark of another window before
  // the carry-on answers, so the window this stop judged decides, never the marks' order.
  const later = at + 1
  const judged: [string, Parameters<typeof ownContinueResetAt>[0], Parameters<typeof ownContinueResetAt>[2], number][] = [
    ['a weekly stop, a newer 5-hour mark', { weekMarks: { a: week }, marks: { a: { ...five, at: later } } }, 'week', Date.parse(WEEK_END)],
    ['a Fable stop, a newer week mark', { fableMarks: { a: fable }, weekMarks: { a: { ...week, at: later } } }, 'fable', Date.parse(FABLE_END)],
    ['a 5-hour stop, a newer Fable mark', { marks: { a: five }, fableMarks: { a: { ...fable, at: later } } }, 'five-hour', Date.parse(LATER)],
  ]
  expect(judged.map(([name, v, kind]) => [name, ownContinueResetAt(v, 'a', kind)])).toEqual(judged.map(([name, , , reset]) => [name, reset]))
})

test('row ow: ownContinueAfterLook re-reads the turns with no await before the key (puma-9arph.71)', () => {
  const look: Parameters<typeof ownContinueAfterLook>[0] = {
    isArmed: true,
    isSent: false,
    openTurns: 0,
    isPromptEntering: false,
    isCarryOnQueued: false,
    isSettling: false,
    isHeld: false,
    isPanelShown: false,
    now: 0,
    pane: 'term_a',
    box: { text: '' },
    fill: { isFilled: true, text: '' },
    screen: { lines: COUNTDOWN_SCREEN },
  }
  const same = { isSameArm: true, openTurns: 0, mainTurnsSince: 0 }
  expect([
    ownContinueAfterLook(look, same),
    ownContinueAfterLook({ ...look, box: { text: 'x' } }, same),
    ownContinueAfterLook({ ...look, screen: undefined }, same),
    ownContinueAfterLook(look, { ...same, isSameArm: false }),
    ownContinueAfterLook(look, { ...same, openTurns: 1 }),
    ownContinueAfterLook(look, { ...same, mainTurnsSince: 1 }),
  ]).toEqual([
    { escape: true },
    { why: 'the prompt box holds a draft' },
    { why: 'not looked' },
    { why: 'the arm ended during the look' },
    { why: 'a turn began during the look' },
    { why: 'a main turn began during the look' },
  ])
  // Round 1 F1, its class: a stage that answered nothing never reads as empty, so it never keys.
  expect([
    ownContinueAfterLook({ ...look, box: { text: undefined } }, same),
    ownContinueAfterLook({ ...look, fill: { isFilled: true } }, same),
    ownContinueAfterLook({ ...look, fill: { isFilled: true, text: undefined } }, same),
    ownContinueAfterLook({ ...look, screen: { lines: undefined } }, same),
  ].every(act => 'why' in act)).toBe(true)
  // The first Escape (RULING 6036) is not widened: an accepted fill still gives it no key.
  expect(escapeHeldBack({ isCarryOnInFlight: true, isLimitStopLast: true, openTurns: 0, isSettling: false, isHeld: false, escapes: 0, budget: 8, pane: 'term_a', fill: {} })).toBe('no dialog holds it')
})

// puma-9arph.57 (council B1 to B5): one nudge an episode, under a held stop switch, NUDGE_LEAD_MS before the expiry.
test('row v: nudgeHeld sends only for a held stop switch, no turn, no carry-on, an empty box and a token due within NUDGE_LEAD_MS', () => {
  const due: Parameters<typeof nudgeHeld>[0] = { hasHeldCarry: true, isNudged: false, isLimitStopLast: true, openTurns: 0, isCarryOnQueued: false, isBoxEmpty: true, isTokenOk: true, expiresInMs: NUDGE_LEAD_MS }
  expect([NUDGE_LEAD_MS, nudgeHeld(due)]).toEqual([240_000, undefined])
  const rows: [string, Parameters<typeof nudgeHeld>[0], string][] = [
    ['no stop switch held', { ...due, hasHeldCarry: false }, 'no stop switch held'],
    ['nudged already this episode', { ...due, isNudged: true }, 'nudged already'],
    ['a turn began since the stop', { ...due, isLimitStopLast: false }, 'no limit stop before it'],
    ['a turn open in some loop', { ...due, openTurns: 1 }, 'a turn is open'],
    ['a carry-on queued or armed', { ...due, isCarryOnQueued: true }, 'a carry-on is queued'],
    ['B5: a draft in the box', { ...due, isBoxEmpty: false }, 'the prompt box holds a draft'],
    ['no token that can refresh', { ...due, isTokenOk: false }, 'the token cannot refresh'],
    ['no stored token', { ...due, expiresInMs: undefined }, 'the token cannot refresh'],
    ['1 ms before the lead', { ...due, expiresInMs: NUDGE_LEAD_MS + 1 }, 'the token is not due'],
  ]
  expect(rows.map(([name, s]) => [name, nudgeHeld(s)])).toEqual(rows.map(([name, , why]) => [name, why]))
})

// puma-9arph.65 case B (a): the box counts as empty for the mod's own lines, which a queued carry-on can leave in it.
test('puma-9arph.65: isBoxFree holds for an empty box and each of the mod\'s own lines, exactly, and for nothing else', () => {
  const own = [NUDGE_TEXT, 'Continue where you left off.', undefined, 'Go on on Fable-free ground.']
  const rows: [string, string | undefined, boolean][] = [
    ['the empty box', '', true],
    ['the nudge\'s line', NUDGE_TEXT, true],
    ['the carry-on\'s line', 'Continue where you left off.', true],
    ['the kept Fable line', 'Go on on Fable-free ground.', true],
    ['the nudge\'s line, one character more', `${NUDGE_TEXT}.`, false],
    ['the nudge\'s line, one character less', NUDGE_TEXT.slice(0, -1), false],
    ['the carry-on\'s line, one character more', 'Continue where you left off. ', false],
    ['the carry-on\'s line, one character less', 'Continue where you left off', false],
    ['the kept Fable line, one character more', 'Go on on Fable-free ground.!', false],
    ['the kept Fable line, one character less', 'Go on on Fable-free ground', false],
    ['a person\'s text', 'half a thought', false],
    ['a box the read could not show', undefined, false],
  ]
  expect(rows.map(([name, text]) => [name, isBoxFree(text, own)])).toEqual(rows.map(([name, , free]) => [name, free]))
  // No line kept for Fable: an undefined own line frees nothing, not even an undefined box.
  expect([isBoxFree(undefined, [undefined]), isBoxFree('', [])]).toEqual([false, true])
})

// puma-9arph.65 case A: one more nudge once the token it was sent for has run out unrefreshed.
test('puma-9arph.65: renudgeDue holds once, for the same token past its expiry, and for nothing else', () => {
  const due: Parameters<typeof renudgeDue>[0] = { isRenudged: false, firstExpiresAt: NOW, expiresAt: NOW, now: NOW, firstToken: 'token-a', token: 'token-a' }
  expect(renudgeDue(due)).toBe(true)
  const rows: [string, Parameters<typeof renudgeDue>[0], boolean][] = [
    ['a replacement token with the same expiry (Review r65 F3)', { ...due, token: 'token-b' }, false],
    ['no token digest on record for the first nudge', { ...due, firstToken: undefined }, false],
    ['the second already went', { ...due, isRenudged: true }, false],
    ['1 ms before the expiry', { ...due, now: NOW - 1 }, false],
    ['a token refreshed to a later expiry', { ...due, expiresAt: NOW + HOUR, now: NOW + 2 * HOUR }, false],
    ['no stored token', { ...due, expiresAt: undefined }, false],
    ['no first nudge on record', { ...due, firstExpiresAt: undefined }, false],
    ['long past the expiry', { ...due, now: NOW + HOUR }, true],
  ]
  expect(rows.map(([name, s]) => [name, renudgeDue(s)])).toEqual(rows.map(([name, , want]) => [name, want]))
})

test('row k: a carry-on still in flight 30 s after its Escape gets another, within the budget 2 x logins + 2, then stuck', () => {
  const logins = 3
  const budget = 2 * logins + 2
  const look = (escapes: number, sinceEscapeMs: number | undefined): string | undefined =>
    escapeHeldBack({ isCarryOnInFlight: true, isLimitStopLast: true, openTurns: 0, isSettling: false, isHeld: false, escapes, budget, sinceEscapeMs, pane: 'term_a', fill: { refusal: 'dialog' } })
  // The gap: 1 ms short of ESCAPE_GAP_MS holds the key, the gap itself lets it go.
  expect([look(1, ESCAPE_GAP_MS - 1), look(1, ESCAPE_GAP_MS)]).toEqual(['too soon after the last Escape', undefined])
  // The budget: every Escape up to it goes, one gap apart; the next is 'Escapes spent'.
  const answers = Array.from({ length: budget + 1 }, (_, spent) => look(spent, spent === 0 ? undefined : ESCAPE_GAP_MS))
  expect(answers).toEqual([...Array.from({ length: budget }, () => undefined), 'Escapes spent'])
})

test('row k: the first Escape of an episode goes with lastEscapeAt unset', () => {
  // No Escape yet: sinceEscapeMs is undefined, and the gap does not hold the first key.
  expect(escapeHeldBack({ isCarryOnInFlight: true, isLimitStopLast: true, openTurns: 0, isSettling: false, isHeld: false, escapes: 0, budget: 8, sinceEscapeMs: undefined, pane: 'term_a', fill: { refusal: 'dialog' } })).toBeUndefined()
})

// Review M403 B: the Escape after the fill, the one place that counts it, times it and reads the session again before it.
test('row k: an Escape after a dialog fill counts one and stamps its time, and a turn, entry or end during the fill sends none', () => {
  const look = { isCarryOnInFlight: true, isLimitStopLast: true, openTurns: 0, isSettling: false, isHeld: false, escapes: 2, budget: 8, sinceEscapeMs: ESCAPE_GAP_MS, pane: 'term_a' }
  const still = { openTurns: 0, isLimitStopLast: true, isCarryOnInFlight: true, isSameEpisode: true, isPromptEntering: false, isSettling: false, isHeld: false }
  const rows: [string, string | undefined, typeof still, ReturnType<typeof escapeAfterFill>][] = [
    ['a dialog, nothing changed', 'dialog', still, { escapes: 3, lastEscapeAt: NOW }],
    ['no dialog', undefined, still, { why: 'no dialog holds it' }],
    ['the episode ended during the fill', 'dialog', { ...still, isSameEpisode: false }, { why: 'the episode ended during the fill' }],
    ['a turn began during the fill', 'dialog', { ...still, openTurns: 1 }, { why: 'a turn began during the fill' }],
    ['a main-loop turn began during the fill', 'dialog', { ...still, isLimitStopLast: false }, { why: 'a main-loop turn began during the fill' }],
    ['the carry-on entered during the fill', 'dialog', { ...still, isCarryOnInFlight: false }, { why: 'the carry-on entered during the fill' }],
    // puma-9arph.81: the gates the look read before its fill, read again after it; each is named before the fill's answer.
    ['a prompt began entering during the fill', 'dialog', { ...still, isPromptEntering: true }, { why: 'a prompt began entering during the fill' }],
    ['the switch moved during the fill', 'dialog', { ...still, isSettling: true }, { why: 'the switch moved during the fill' }],
    ['a switch was held during the fill', 'dialog', { ...still, isHeld: true }, { why: 'a switch was held during the fill' }],
    ['a gate read after the fill, named before the fill found no dialog', undefined, { ...still, isHeld: true }, { why: 'a switch was held during the fill' }],
  ]
  expect(rows.map(([name, refusal, after]) => [name, escapeAfterFill(look, refusal, after, NOW)])).toEqual(rows.map(([name, , , act]) => [name, act]))
  // The refresh nudge's own carry-on goes past a held switch, after the fill as before it.
  expect(escapeAfterFill({ ...look, isHeld: true, isNudge: true }, 'dialog', { ...still, isHeld: true }, NOW)).toEqual({ escapes: 3, lastEscapeAt: NOW })
})

// puma-9arph.81: a prompt still entering holds the owed Escape, before the fill as after it.
test('row k2: a prompt still entering holds the owed Escape back', () => {
  const look = { isCarryOnInFlight: true, isLimitStopLast: true, openTurns: 0, isSettling: false, isHeld: false, escapes: 0, budget: 8, pane: 'term_a' }
  expect([escapeHeldBack({ ...look, isPromptEntering: true }), escapeHeldBack(look)]).toEqual(['a prompt is entering', undefined])
})

// v4 s.1, row a: the pick after a stop judges each login on its own stored read, and a read is fresh within FRESH_READ_MS.
test('row a: the case\'s shape: a week-old reading with a run-out token and a fresh reading with room, the move goes to the fresh one', () => {
  // Login 1 is in use and spent; login 2, next in the list, was last read a week ago, its windows long reset (so it reads as
  // room); login 3 was read just now and has room. The tick's pick takes login 2 by order; the pick after a stop takes login 3.
  const v = view({ '1': [100, 50], '2': [0, 0], '3': [30, 40] }, {}, 'order')
  v.readings['2'] = { fiveHour: { pct: 100, resetsAt: '2026-10-05T15:00:00Z' }, sevenDay: { pct: 100, resetsAt: '2026-10-05T03:00:00Z' }, at: NOW - 7 * 24 * HOUR }
  const picked = pickAfterStop(v, v.readings, NOW, undefined, ['1'], new Set())
  expect([pickTarget(v, NOW)?.id, picked?.account.id, picked?.tier]).toEqual(['2', '3', 'fresh'])
})

// Review R1 F1: the spent-old tier is ordered by when each login frees for the need, the latest reset of what spends it.
test('row a: the spent-old tier goes to the login that frees first for the need, not the one whose other window resets first', () => {
  const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString()
  // Read two hours ago, so stale: [5-hour pct, its reset in h, week pct, its reset in h, Fable pct, its reset in h].
  const read = (w: [number, number, number, number, number, number]): Reading => ({
    fiveHour: { pct: w[0], resetsAt: at(w[1]) },
    sevenDay: { pct: w[2], resetsAt: at(w[3]) },
    fable: { pct: w[4], resetsAt: at(w[5]) },
    at: NOW - 2 * HOUR,
  })
  const cases: [string, 'fable' | undefined, Reading, Reading, Partial<View>, string][] = [
    ['Fable week spent: its reset, not the 5-hour one', 'fable', read([20, 4, 20, 100, 100, 1]), read([20, 1, 20, 100, 100, 2]), {}, '2'],
    ['week spent: its reset, not the 5-hour one', undefined, read([20, 1, 100, 3, 0, 9]), read([20, 5, 100, 2, 0, 9]), {}, '3'],
    ['a week mark in force: its reset, not the read\'s 5-hour one', undefined, read([20, 1, 20, 100, 0, 9]), read([20, 5, 100, 3, 0, 9]), { weekMarks: { '2': { pct: 100, resetsAt: at(6), at: NOW } } }, '3'],
    ['5-hour and week both spent: the later of the two', undefined, read([95, 1, 100, 5, 0, 9]), read([95, 2, 100, 3, 0, 9]), {}, '3'],
    ['a Fable mark in force, for the Fable week: its reset', 'fable', read([20, 1, 20, 100, 20, 1]), read([20, 5, 20, 100, 100, 3]), { fableMarks: { '2': { pct: 100, resetsAt: at(6), at: NOW } } }, '3'],
    ['a Fable mark, for no need: it frees nothing, so not its reset', undefined, read([20, 1, 20, 100, 0, 9]), read([20, 5, 100, 3, 0, 9]), { fableMarks: { '2': { pct: 100, resetsAt: at(10), at: NOW } } }, '2'],
    // Review M403 C: a spending window with no reset known frees at no known time, so after every one that does.
    ['week spent with no reset known: last, not by its 5-hour reset', undefined, { ...read([20, 1, 100, 0, 0, 9]), sevenDay: { pct: 100 } }, read([20, 5, 100, 3, 0, 9]), {}, '3'],
  ]
  const wrong: string[] = []
  for (const [name, need, second, third, marks, wanted] of cases) {
    for (const rotateTo of ['room', 'reset', 'order'] as RotateTo[]) {
      const v: View = { ...view({ '1': [100, 50], '2': [0, 0], '3': [0, 0] }, {}, rotateTo), ...marks }
      v.readings['2'] = second
      v.readings['3'] = third
      const got = pickAfterStop(v, v.readings, NOW, need, ['1'], new Set())
      if (got?.account.id !== wanted || got?.tier !== 'spent-old') wrong.push(`${name}, ${rotateTo}: wanted ${wanted}, got ${got?.account.id}/${got?.tier}`)
    }
  }
  expect(wrong).toEqual([])
})

// puma-9arph.109.3: a login read live in this stop is judged on that read: spent counts as its try, a mark standing or not.
test('row a: a login read live and spent counts as tried even with a mark standing; read live with room it keeps the mark, and a login not read live is tried blind', () => {
  const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString()
  const spent = (read: number): Reading => ({ fiveHour: { pct: 100, resetsAt: at(1) }, sevenDay: { pct: 100, resetsAt: at(48) }, at: read })
  const room = (read: number): Reading => ({ fiveHour: { pct: 10, resetsAt: at(1) }, sevenDay: { pct: 10, resetsAt: at(48) }, at: read })
  const marked = (reading: Reading): View => {
    const v: View = { ...view({ '1': [100, 50], '2': [0, 0], '3': [0, 0] }), weekMarks: { '2': { pct: 100, resetsAt: at(48), at: NOW - 3 * HOUR } } }
    v.readings['2'] = reading
    return v
  }
  const tier = (v: View, tried: string[], live: string[]) => {
    const got = pickAfterStop(v, v.readings, NOW, undefined, tried, new Set(), new Set(live))
    return got === undefined ? undefined : `${got.account.id}/${got.tier}`
  }
  expect(tier(marked(spent(NOW)), ['1', '3'], ['2']), 'read live, spent: its try').toBeUndefined()
  expect(tier(marked(spent(NOW)), ['1', '3'], []), 'not read live: the mark sends it to the blind try').toBe('2/spent-old')
  expect(tier(marked(room(NOW)), ['1', '3'], ['2']), 'read live with room under a mark: the mark stands').toBe('2/spent-old')
  // The logins the blind try would choose among, for the live reads before it.
  const v = marked(spent(NOW - 2 * HOUR))
  v.readings['3'] = spent(NOW - 2 * HOUR)
  const got = pickAfterStop(v, v.readings, NOW, undefined, ['1'], new Set())
  expect([got?.tier, got?.spentOld?.map(a => a.id).sort()]).toEqual(['spent-old', ['2', '3']])
})

// puma-9arph.109.4: the pick says its Fable-room proof, and the carry-on line follows it.
test('row a: only a fresh read that lists the Fable week with room proves Fable room; a spent-old pick says when it frees', () => {
  const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString()
  const window = (pct: number, hours: number) => ({ pct, resetsAt: at(hours) })
  const proof = (r: Reading, need: 'fable' | undefined = 'fable') => {
    const v = view({ '1': [100, 50], '2': [0, 0] })
    v.readings['2'] = r
    const got = pickAfterStop(v, v.readings, NOW, need, ['1'], new Set())
    return got === undefined ? undefined : { tier: got.tier, hasFableRoom: got.hasFableRoom, freesAt: got.freesAt, readAgeMs: got.readAgeMs }
  }
  expect(proof({ fiveHour: window(10, 1), sevenDay: window(10, 48), fable: window(10, 48), at: NOW - 60_000 })).toEqual({ tier: 'fresh', hasFableRoom: true, freesAt: undefined, readAgeMs: 60_000 })
  expect(proof({ fiveHour: window(10, 1), sevenDay: window(10, 48), at: NOW - 60_000 })?.hasFableRoom, 'a fresh read that lists no Fable week').toBe(false)
  expect(proof({ fiveHour: window(10, 1), sevenDay: window(10, 48), fable: window(10, 48), at: NOW - 3 * HOUR })).toMatchObject({ tier: 'stale', hasFableRoom: false, readAgeMs: 3 * HOUR })
  expect(proof({ fiveHour: window(10, 1), sevenDay: window(10, 48), fable: window(100, 30), at: NOW - 3 * HOUR })).toMatchObject({ tier: 'spent-old', hasFableRoom: false, freesAt: NOW + 30 * HOUR })
})

test('fableCarryOnNote: no note where a fresh read proved Fable room; otherwise the read age or the reset believed spent until', () => {
  const note = modelExports.fableCarryOnNote
  expect(note({ tier: 'fresh', hasFableRoom: true, readAgeMs: 60_000 })).toBeUndefined()
  expect(note({ tier: 'fresh', hasFableRoom: false, readAgeMs: 60_000 })).toBe('Its usage lists no Fable week, so room on it is not confirmed.')
  expect(note({ tier: 'stale', hasFableRoom: false, readAgeMs: 2 * HOUR })).toBe('Its Fable week was last read 120 min ago, so room on it is not confirmed.')
  expect(note({ tier: 'unread', hasFableRoom: false })).toBe('Its usage could not be read, so Fable room on it is not confirmed.')
  expect(note({ tier: 'spent-old', hasFableRoom: false, freesAt: Date.parse('2026-10-14T12:00:00Z') })).toBe('Its Fable week was believed spent until 2026-10-14 12:00 UTC; it is tried in case that was reset or freed elsewhere.')
  expect(note({ tier: 'spent-old', hasFableRoom: false })).toBe('Its Fable week was believed spent; it is tried in case it was reset or freed elsewhere.')
  // No pick behind the carry-on (a retry that lost it, a nudge's): nothing proves room.
  expect(note(undefined)).toBe('Its Fable room is not confirmed.')
})

// puma-9arph.109.5 (Council Q10): a same-window body read that falls 5 points or more below the previous read of that window
// ends the window's marks and kept rows at once; with no earlier read of the window, a read at or below 5% does. The reset
// time does not move on a manual reset, so it is never relied on.
{
  const markAt = (minutesAgo: number, resetsAt = FABLE_END) => ({ pct: 100, resetsAt, at: NOW - minutesAgo * 60_000 })
  const win = (pct: number, resetsAt = FABLE_END) => ({ pct, resetsAt })
  // [name, read, previous read of the window, mark, ends]
  const cases: [string, ReturnType<typeof win> | undefined, ReturnType<typeof win> | undefined, ReturnType<typeof markAt>, boolean][] = [
    ['0% after a read of 100, the mark 10 min old', win(0), win(100), markAt(10), true],
    ['0% with no earlier read, the mark 10 min old', win(0), undefined, markAt(10), true],
    ['5% with no earlier read', win(5), undefined, markAt(10), true],
    ['6% with no earlier read', win(6), undefined, markAt(10), false],
    ['a fall of exactly 5 points', win(55), win(60), markAt(10), true],
    ['a fall of 4 points', win(56), win(60), markAt(10), false],
    ['a lagging 97% after a stop at a read of 96', win(97), win(96), markAt(5), false],
    ['a lagging 97% with no earlier read', win(97), undefined, markAt(5), false],
    ['a lagging 97% after a read of 99 (a fall of 2)', win(97), win(99), markAt(5), false],
    ['a fall inside another window than the mark\'s', win(0, '2026-10-24T03:00:00Z'), win(100, '2026-10-24T03:00:00Z'), markAt(10), false],
    ['a previous read of another window: 0% reads as no earlier read', win(0), win(100, '2026-10-10T03:00:00Z'), markAt(10), true],
    ['a window the body does not list', undefined, win(100), markAt(10), false],
  ]
  for (const [name, read, before, mark, ends] of cases) {
    test(`endsFableMark (Q10): ${name} ${ends ? 'ends' : 'keeps'} the mark`, () => {
      expect(endsFableMark(read, NOW, mark, before)).toBe(ends)
    })
    test(`endsWeekMark (Q10): ${name} ${ends ? 'ends' : 'keeps'} the mark`, () => {
      expect(modelExports.endsWeekMark?.(read, mark, before)).toBe(ends)
    })
    test(`endsFiveHourMark (Q10): ${name} ${ends ? 'ends' : 'keeps'} the mark`, () => {
      expect(modelExports.endsFiveHourMark?.(read, mark, before)).toBe(ends)
    })
  }
}

test('endsFableMark: the 30-minute lag rule still ends a mark whose week reads below 100 with no fall and no low read', () => {
  const mark = { pct: 100, resetsAt: FABLE_END, at: NOW - 40 * 60_000 }
  expect(endsFableMark({ pct: 60, resetsAt: FABLE_END }, NOW, mark, { pct: 60, resetsAt: FABLE_END })).toBe(true)
  expect(endsFableMark({ pct: 60, resetsAt: FABLE_END }, NOW, { ...mark, at: NOW - 10 * 60_000 }, { pct: 60, resetsAt: FABLE_END })).toBe(false)
})

test('keepFable keeps no row older than a counter fall: the fresh week fell 5 points or more inside the stored one\'s window', () => {
  const fresh: Reading = { sevenDay: { pct: 0, resetsAt: WEEK_END }, at: NOW }
  const stored = (week: number, weekEnd = WEEK_END): Reading => ({ sevenDay: { pct: week, resetsAt: weekEnd }, fable: { pct: 100, resetsAt: FABLE_END }, at: NOW - 20 * 60_000 })
  expect(keepFable(fresh, stored(100), NOW), 'a fall of 100 drops the row').toEqual(fresh)
  expect(keepFable({ ...fresh, sevenDay: { pct: 55, resetsAt: WEEK_END } }, stored(60), NOW), 'a fall of 5 drops it').toEqual({ ...fresh, sevenDay: { pct: 55, resetsAt: WEEK_END } })
  expect(keepFable({ ...fresh, sevenDay: { pct: 56, resetsAt: WEEK_END } }, stored(60), NOW).fable, 'a fall of 4 keeps it').toEqual({ pct: 100, resetsAt: FABLE_END })
  expect(keepFable({ ...fresh, sevenDay: { pct: 97, resetsAt: WEEK_END } }, stored(96), NOW).fable, 'a lagging 97 keeps it').toEqual({ pct: 100, resetsAt: FABLE_END })
  expect(keepFable(fresh, stored(100, '2026-10-11T03:00:00Z'), NOW).fable, 'a fall across two windows is no reset: the row stays').toEqual({ pct: 100, resetsAt: FABLE_END })
})

test('the Escape goes to the one pane named, by a fixed argv with no shell (puma-9arph.34 C1)', () => {
  expect(escapeArgv('term_a')).toEqual(['orca', 'terminal', 'send', '--terminal', 'term_a', '--text', '\u001b', '--json'])
})

// puma-9arph.41: the one place that decides who may write the fields that name the switch.
const settling = { id: '2', from: '1', since: 1000 }
for (const [name, view, by, isAllowed] of [
  ['the switch running writes by its own token', { owner: { token: 7 } }, { owner: 7 }, true],
  ['a switch taken over writes nothing', { owner: { token: 8 } }, { owner: 7 }, false],
  ['a claim with none running applies', {}, { claim: undefined }, true],
  ['a claim made while a switch runs does not', { owner: { token: 7 } }, { claim: undefined }, false],
  ['a take-over applies over the token it waited on', { owner: { token: 7 } }, { claim: 7 }, true],
  ['a second take-over over the same token does not', { owner: { token: 9 } }, { claim: 7 }, false],
  ['a proof of the settling switch it examined applies', { pending: settling }, { pending: 1000 }, true],
  ['a proof of an older switch does not', { pending: { ...settling, since: 2000 } }, { pending: 1000 }, false],
  ['a proof while a switch runs does not', { pending: settling, owner: { token: 7 } }, { pending: 1000 }, false],
  ['an idle writer with none running applies', {}, { idle: true }, true],
  ['an idle writer while a switch runs does not', { owner: { token: 7 } }, { idle: true }, false],
] as const) {
  test(`mayWrite: ${name} (puma-9arph.41)`, () => {
    expect(mayWrite({ ...EMPTY_VIEW, ...view } as View, by)).toBe(isAllowed)
  })
}

// puma-9arph.48: exit 0 is logged in, exit 1 with authMethod 'none' is not, and nothing else says either
// (https://code.claude.com/docs/en/cli-reference: 'Exits with code 0 if logged in, 1 if not').
for (const [name, exitCode, stdout, read] of [
  ['exit 1, authMethod none', 1, '{"loggedIn":false,"authMethod":"none"}', 'out'],
  ['exit 0, authMethod claude.ai', 0, '{"loggedIn":true,"authMethod":"claude.ai"}', 'in'],
  ['exit 0 with authMethod none', 0, '{"authMethod":"none"}', 'in'],
  ['exit 1, another authMethod', 1, '{"authMethod":"api_key"}', 'unknown'],
  ['exit 1 with no JSON', 1, '', 'unknown'],
  ['exit 1 with JSON that is no object', 1, 'null', 'unknown'],
  ['exit 2', 2, '{"authMethod":"none"}', 'unknown'],
  ['no exit code, as a timeout gives', null, '{"authMethod":"none"}', 'unknown'],
] as const) {
  test(`signInFromStatus: ${name} (puma-9arph.48)`, () => {
    expect(signInFromStatus(exitCode, stdout)).toBe(read)
  })
}

// F1 defense: a limit stop's own words give the reset of the window that ran out, and each login's stored window has
// its own. The Fable stop master438 heard at 04:24:56 said "resets 3pm" while the mod believed login 1 was in use.
const STOP_NOW = Date.parse('2026-11-22T04:24:56Z')
const STOP_ZONE = '(Europe/Tallinn)'
for (const [said, now, at] of [
  [`You've hit your Fable limit · resets Nov 25 at 3pm ${STOP_ZONE}`, STOP_NOW, '2026-11-25T13:00:00Z'],
  [`You've hit your Fable limit · resets 3pm ${STOP_ZONE}`, STOP_NOW, '2026-11-22T13:00:00Z'],
  [`You've hit your Fable limit · resets Nov 23 at 7am ${STOP_ZONE}`, STOP_NOW, '2026-11-23T05:00:00Z'],
  [`You've hit your session limit · resets 3:30pm ${STOP_ZONE}`, STOP_NOW, '2026-11-22T13:30:00Z'],
  [`You've hit your session limit · resets 12am ${STOP_ZONE}`, STOP_NOW, '2026-11-22T22:00:00Z'],
  // The time of day passed today: the next one is tomorrow's.
  [`You've hit your session limit · resets 3pm ${STOP_ZONE}`, Date.parse('2026-11-22T14:00:00Z'), '2026-11-23T13:00:00Z'],
  // A date this year has passed: next year's, in the summer time of that date.
  [`You've hit your weekly limit · resets Jul 1 at 3pm ${STOP_ZONE}`, STOP_NOW, '2027-07-01T12:00:00Z'],
] as const) {
  test(`stopResetAt reads "${said.slice(said.indexOf('resets'))}" at ${new Date(now).toISOString()} as ${at}`, () => {
    expect(stopResetAt(said, now)).toBe(Date.parse(at))
  })
}

// The weekday form the docs list ("resets Mon 12:00am", https://code.claude.com/docs/en/errors.md): its next occurrence in the
// zone at or after now. 2026-11-22 is a Sunday, 2026-11-23 a Monday; Tallinn is UTC+2 then.
for (const [said, now, at] of [
  [`You've hit your weekly limit · resets Mon 12:00am ${STOP_ZONE}`, STOP_NOW, '2026-11-22T22:00:00Z'],
  [`You've hit your weekly limit · resets Mon 12am ${STOP_ZONE}`, STOP_NOW, '2026-11-22T22:00:00Z'],
  [`You've hit your weekly limit · resets Monday 3:45pm ${STOP_ZONE}`, STOP_NOW, '2026-11-23T13:45:00Z'],
  // A Monday, before the time: that Monday. After it: the next.
  [`You've hit your weekly limit · resets Mon 3:45pm ${STOP_ZONE}`, Date.parse('2026-11-23T06:00:00Z'), '2026-11-23T13:45:00Z'],
  [`You've hit your weekly limit · resets Mon 3:45pm ${STOP_ZONE}`, Date.parse('2026-11-23T14:00:00Z'), '2026-11-30T13:45:00Z'],
  // The same weekday as today, past by minutes only: still that reset.
  [`You've hit your weekly limit · resets Sun 6:20am ${STOP_ZONE}`, STOP_NOW, '2026-11-22T04:20:00Z'],
  // A month word that starts like a weekday's is still a month.
  [`You've hit your Fable limit · resets Mar 3 at 3pm ${STOP_ZONE}`, STOP_NOW, '2027-03-03T13:00:00Z'],
] as const) {
  test(`stopResetAt reads "${said.slice(said.indexOf('resets'))}" at ${new Date(now).toISOString()} as ${at}`, () => {
    expect(stopResetAt(said, now)).toBe(Date.parse(at))
  })
}

// https://code.claude.com/docs/en/errors.md lists "You've hit your Opus limit · resets 3:45pm" and the Sonnet one: each
// applies only to requests to that model family, so neither is the week or the 5-hour window spent.
for (const [said, class_] of [
  ["You've hit your Opus limit · resets 3:45pm", 'model'],
  ["You've hit your Sonnet limit · resets 3:45pm", 'model'],
  ["You've hit your Fable limit · resets 3:45pm", 'fable'],
  ["You've hit your session limit · resets 3:45pm", 'session'],
  ["You've hit your weekly limit · resets Mon 12:00am", 'weekly'],
  ['Claude usage limit reached.', 'unknown'],
  [undefined, 'none'],
] as const) {
  test(`wordingClass reads "${said}" as ${class_}`, () => {
    expect(wordingClass(said)).toBe(class_)
  })
}

test('stopResetAt: a weekday with no zone names no reset', () => {
  expect(stopResetAt("You've hit your weekly limit · resets Mon 12:00am", STOP_NOW)).toBeUndefined()
})

for (const [name, said] of [
  ['no words', undefined],
  ['words that name no reset', "You've hit your Fable limit"],
  ['a reset that names no zone', "You've hit your Fable limit · resets Nov 25 at 3pm"],
  ['a zone Intl does not know', "You've hit your Fable limit · resets Nov 25 at 3pm (Mars/Olympus)"],
  ['a day the month lacks', `You've hit your Fable limit · resets Nov 31 at 3pm ${STOP_ZONE}`],
  ['an hour no clock has', `You've hit your Fable limit · resets 13pm ${STOP_ZONE}`],
] as const) {
  test(`stopResetAt answers undefined for ${name}`, () => {
    expect(stopResetAt(said, STOP_NOW)).toBeUndefined()
  })
}

/** Logins whose windows reset at the given times, as the stored readings carry them (seconds included). */
function resetView(rows: Record<string, { fable?: string; week?: string; five?: string }>): View {
  const accounts = Object.keys(rows).map(id => ({ id, slot: id === '1' ? '' : `/h/.claude/accounts/${id}` }))
  const window = (resetsAt: string | undefined) => (resetsAt === undefined ? {} : { pct: 50, resetsAt })
  const readings = Object.fromEntries(
    Object.entries(rows).map(([id, r]) => [
      id,
      {
        at: STOP_NOW,
        ...(r.five === undefined ? {} : { fiveHour: window(r.five) }),
        ...(r.week === undefined ? {} : { sevenDay: window(r.week) }),
        ...(r.fable === undefined ? {} : { fable: window(r.fable) }),
      },
    ]),
  )
  return { ...EMPTY_VIEW, accounts, readings } as unknown as View
}

const INCIDENT = resetView({
  '1': { fable: '2026-11-24T09:00:00Z', week: '2026-11-24T09:00:00Z', five: '2026-11-22T08:00:00Z' },
  '3': { fable: '2026-11-25T13:00:00Z', week: '2026-11-25T13:00:00Z', five: '2026-11-22T08:30:00Z' },
  '4': { fable: '2026-11-22T13:00:00Z', week: '2026-11-22T13:00:00Z', five: '2026-11-22T09:00:00Z' },
  '5': { fable: '2026-11-25T12:59:59Z', week: '2026-11-25T12:59:59Z', five: '2026-11-22T09:20:00Z' },
})

test('whoseReset: "resets 3pm" on 2026-11-22 is login 4 alone (04:24:56)', () => {
  const at = stopResetAt(`You've hit your Fable limit · resets 3pm ${STOP_ZONE}`, STOP_NOW)
  expect(at).toBe(Date.parse('2026-11-22T13:00:00Z'))
  expect(whoseReset(INCIDENT, at as number, 'fable')).toEqual(['4'])
})

test('whoseReset: "Nov 25 at 3pm" is logins 3 and 5 sharing it, so it proves neither', () => {
  const at = stopResetAt(`You've hit your Fable limit · resets Nov 25 at 3pm ${STOP_ZONE}`, STOP_NOW)
  expect(whoseReset(INCIDENT, at as number, 'fable')).toEqual(['3', '5'])
})

test('whoseReset reads the window the stop names: the week row for a weekly stop, the 5-hour row for a session stop', () => {
  const view = resetView({
    '1': { fable: '2026-11-26T09:00:00Z', week: '2026-11-24T09:00:00Z', five: '2026-11-22T08:00:00Z' },
    '2': { fable: '2026-11-24T09:00:00Z', week: '2026-11-27T09:00:00Z', five: '2026-11-22T11:00:00Z' },
  })
  const at = Date.parse('2026-11-24T09:00:00Z')
  expect([whoseReset(view, at, 'fable'), whoseReset(view, at, 'week'), whoseReset(view, at, 'session')]).toEqual([['2'], ['1'], []])
  expect(whoseReset(view, Date.parse('2026-11-22T11:00:00Z'), 'session')).toEqual(['2'])
})

test('whoseReset: a reset an hour and a second from every stored one names no login', () => {
  expect(whoseReset(INCIDENT, Date.parse('2026-11-22T14:00:01Z'), 'fable')).toEqual([])
  expect(whoseReset(INCIDENT, Date.parse('2026-11-22T14:00:00Z'), 'fable')).toEqual(['4'])
})
