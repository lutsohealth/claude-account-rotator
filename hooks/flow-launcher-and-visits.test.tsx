import { expect } from 'claude-code/testing'
import { test } from './flow-harness'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { View } from '../types'
import { EMPTY_VIEW, keychainItem } from './model'
import { COPY_DIR, FABLE_STOP, NOW, PLAIN, SLOT2, SLOT3, THREE_LOGINS, TWO_LOGINS, answerNextLate, blob, browse, carryEndedOf, clearSession, debugLines, fresh, isEnded, isOwedCarryOnLine, kept, loggedWorld, mountPane, pastOwed, ran, refusedOwedWorld, selectWorld, sent, settleReal, spentTwo, start, stopLogOf, untilTick, watchedView, whats, world } from './flow-harness'
import type { World } from './flow-harness'

const COPY = `${COPY_DIR}/claude`

const OLD_LAUNCHER = '#!/usr/bin/env python3\n# the 0.5.37 build\n'

const NEW_LAUNCHER = '#!/usr/bin/env python3\n# the 0.5.38 build\n'

/** A world that holds the mod's own launcher file and, where given, a copy of it at the README's place. */
async function launcherWorld($: Engine, on: On, copy: string | undefined, setup: (w: World) => void = () => undefined) {
  const w = fresh()
  w.ownLauncher = NEW_LAUNCHER
  if (copy !== undefined) w.files[COPY] = copy
  setup(w)
  return selectWorld($, on, [10, 20], [10, 20], w)
}

test('puma-9arph.26: a copy that differs from the mod\'s launcher is replaced at mode 755, and says so in one line', async ($, on) => {
  const { w } = await launcherWorld($, on, OLD_LAUNCHER)
  expect([w.files[COPY], w.modes?.[COPY], kept(w)]).toEqual([NEW_LAUNCHER, '755', [COPY]])
  expect(debugLines(w, 'launcher copy').length).toBe(1)
  // The commands, their flags and their order: the move comes last, after the executable check.
  expect(w.fileCommands).toEqual([`chmod 755 ${COPY}.new`, `test -x ${COPY}.new`, `mv -f ${COPY}.new ${COPY}`])
})

// Codex round 2: an equal copy is left alone whatever its text, an empty one included.
for (const own of [NEW_LAUNCHER, '']) {
  test(`puma-9arph.26: a copy equal to the mod's launcher is not written${own === '' ? ', both empty' : ''}`, async ($, on) => {
    const { w } = await launcherWorld($, on, own, world => { world.ownLauncher = own })
    expect([w.files[COPY], (w.writes ?? []).filter(path => path.startsWith(COPY_DIR)), w.fileCommands, debugLines(w, 'launcher copy')]).toEqual([own, [], undefined, []])
  })
}

test('puma-9arph.26: where no copy is installed, none is made', async ($, on) => {
  const { w } = await launcherWorld($, on, undefined)
  expect([kept(w), w.fileCommands]).toEqual([[], undefined])
})

test('puma-9arph.26: a link at the copy\'s place is left alone', async ($, on) => {
  const { w } = await launcherWorld($, on, OLD_LAUNCHER, world => { world.linkFiles = ['claude'] })
  expect([w.files[COPY], w.fileCommands]).toEqual([OLD_LAUNCHER, undefined])
})

test('puma-9arph.26: a move that fails leaves the old copy whole, no temporary file, and the session running', async ($, on) => {
  const { w, store } = await launcherWorld($, on, OLD_LAUNCHER, world => { world.fileCommandFails = 'mv' })
  expect([w.files[COPY], kept(w), debugLines(w, 'launcher copy not refreshed').length]).toEqual([OLD_LAUNCHER, [COPY], 1])
  expect(typeof store.get('store-id')).toBe('string')
})

test('puma-9arph.26: a managed policy that refuses the commands leaves the old copy whole and the session running', async ($, on) => {
  const { w, store } = await launcherWorld($, on, OLD_LAUNCHER, world => { world.fileCommandFails = 'refused' })
  // Codex r1 F2: a refused rm leaves the temporary file, and its name is ONE stable name, so a leftover is overwritten next boot.
  expect([w.files[COPY], kept(w).sort(), debugLines(w, 'launcher copy not refreshed').length]).toEqual([OLD_LAUNCHER, [COPY, `${COPY}.new`], 1])
  expect(typeof store.get('store-id')).toBe('string')
})

// RULING 6298: the temporary file is checked before the move, so a write or chmod that went wrong is never moved over the copy.
const BAD_TEMPORARY: [string, (world: World) => void][] = [
  ['a write that reads back other text', world => { world.temporaryStores = '#!/usr/bin/env python3\n# half a file\n' }],
  ['a write that reads back empty', world => { world.temporaryStores = '' }],
  ['a chmod that leaves the file not executable', world => { world.isChmodIgnored = true }],
  ['a launcher of the mod that is empty', world => { world.ownLauncher = '' }],
]

for (const [name, setup] of BAD_TEMPORARY) {
  test(`puma-9arph.26: ${name}: no move, the old copy whole, no temporary file`, async ($, on) => {
    const { w } = await launcherWorld($, on, OLD_LAUNCHER, setup)
    const isMoved = (w.fileCommands ?? []).some(command => command.startsWith('mv '))
    expect([w.files[COPY], kept(w), isMoved, debugLines(w, 'launcher copy not refreshed').length]).toEqual([OLD_LAUNCHER, [COPY], false, 1])
  })
}

// ---------------------------------------------------------------- puma-9arph.85: a terminal notice holds no stop and ends none

/** An answer the terminal never gives. */
const NEVER_ANSWERED = new Promise<void>(() => {})

const POLICY_NOTICE = /^Can't switch accounts in this session/

const LOCKOUT_NOTICE = /needs a sign-in/

const STAY_NOTICE = /\/usage-credits/

const STUCK_NOTICE = /is near its limit, and this window can't switch accounts/

const NO_LOGIN_NOTICE = /carries on by itself once one frees up\.$/

/**
 * After a stop whose notice waits, 20 s and a second stop: how many stops the stop-log heard, and whether the owed
 * resume's look wrote a line. The second stop's `stop heard` line and the look both wait for the stop path's lock, which
 * only the first stop's path holds.
 */
async function secondStopAndLook($: Engine, clock: MockClock, store: Map<string, unknown>, w: World): Promise<[number, boolean]> {
  await clock.settle()
  await clock.advance(20_000)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  const lines = whats(stopLogOf(store, w))
  return [lines.filter(x => x.startsWith('stop heard')).length, lines.some(x => x.startsWith('owed resume'))]
}

test('H1: a policy refusal\'s notice that gets no answer holds no later stop and no look (puma-9arph.85)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.refuseEnv = true
  w.notifyHold = NEVER_ANSWERED
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  const counts = await secondStopAndLook($, clock, store, w)
  expect([sent(w, POLICY_NOTICE), ...counts]).toEqual([true, 2, true])
})

test('H2: a rejected sign-in\'s notice that gets no answer holds no later stop (puma-9arph.85)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.notifyHold = NEVER_ANSWERED
  await $.classic.StopFailure({ error: 'authentication_failed' })
  const [heard] = await secondStopAndLook($, clock, store, w)
  expect([sent(w, LOCKOUT_NOTICE), heard]).toEqual([true, 2])
})

test('H3: a Fable stop that stays, its notice unanswered, holds no later stop and no look (puma-9arph.85)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w, { 'rotate-to': 'off' })
  await start($, clock)
  w.notifyHold = NEVER_ANSWERED
  await $.classic.StopFailure(FABLE_STOP)
  const counts = await secondStopAndLook($, clock, store, w)
  expect([sent(w, STAY_NOTICE), ...counts]).toEqual([true, 2, true])
})

test('H4: a window that can\'t switch, its stuck notice unanswered at a stop, holds no later stop and no look (puma-9arph.85)', async ($, on) => {
  const w = fresh()
  w.refuseEnv = true
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  // At the start the login in use has room: nothing stuck is told yet.
  expect(sent(w, STUCK_NOTICE)).toBe(false)
  w.notifyHold = NEVER_ANSWERED
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  const counts = await secondStopAndLook($, clock, store, w)
  expect([sent(w, STUCK_NOTICE), ...counts]).toEqual([true, 2, true])
})

test('H5: a policy refusal\'s notice at the start that gets no answer holds none of the start\'s own checks (puma-9arph.85)', async ($, on) => {
  const w = fresh()
  w.refuseEnv = true
  w.notifyHold = NEVER_ANSWERED
  const { clock } = await loggedWorld(on, w)
  await start($, clock)
  // Before the minute's tick: only the start's own check reads the usage.
  expect([sent(w, POLICY_NOTICE), w.usageCalls.length > 0]).toEqual([true, true])
})

/**
 * R1, the class: each site where the terminal refuses the notice, in a world of its own. Each answers 'none', or what
 * the refusal ended there. A site whose notice was never sent is an offender too, so no site passes on a world that
 * skipped it.
 */
const REFUSED_SITES: [string, ($: Engine, on: On) => Promise<string>][] = [
  [
    'blocked at a stop: the stop still says it stayed',
    async ($, on) => {
      const w = fresh()
      const { store, clock } = await loggedWorld(on, w)
      await start($, clock)
      w.refuseEnv = true
      w.isNotifyRefused = true
      w.usage['tok-1'] = [100, 41]
      await $.classic.StopFailure({ error: 'rate_limit' })
      await clock.settle()
      if (!sent(w, POLICY_NOTICE)) return 'notice never sent'
      if (isEnded(store, w)) return 'stop handling failed'
      return whats(stopLogOf(store, w)).includes('stayed: switching blocked') ? 'none' : 'no stayed line'
    },
  ],
  [
    'blocked at the start: the start runs on',
    async ($, on) => {
      const w = fresh()
      w.refuseEnv = true
      w.isNotifyRefused = true
      const { clock } = await loggedWorld(on, w)
      await start($, clock)
      if (!sent(w, POLICY_NOTICE)) return 'notice never sent'
      if (debugLines(w, 'start failed').length > 0) return 'start failed'
      return w.usageCalls.length > 0 ? 'none' : 'the start read no usage'
    },
  ],
  [
    'announceLockout at a stop: the session still moves and carries on',
    async ($, on) => {
      const w = fresh()
      const { store, clock } = await loggedWorld(on, w)
      await start($, clock)
      w.isNotifyRefused = true
      await $.classic.StopFailure({ error: 'authentication_failed' })
      await clock.settle()
      await clock.advance(36_000)
      if (!sent(w, LOCKOUT_NOTICE)) return 'notice never sent'
      if (isEnded(store, w)) return 'stop handling failed'
      return w.submitted.length === 1 ? 'none' : `carry-ons sent: ${w.submitted.length}`
    },
  ],
  [
    'announceLockout in a check: the check saves no failure',
    async ($, on) => {
      const w = fresh()
      w.isNotifyRefused = true
      // Login 2 has nothing in the keychain: the start's check finds it needing a sign-in.
      w.keychain['Claude Code-credentials'] = blob('tok-1')
      w.usage['tok-1'] = [20, 30]
      const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
      const clock = world(on, w, store)
      await start($, clock)
      if (!sent(w, LOCKOUT_NOTICE)) return 'notice never sent'
      const failed = store.get('check-error:2') as { why?: string } | undefined
      return failed?.why?.includes('the check failed') === true ? `check error saved: ${failed.why}` : 'none'
    },
  ],
  [
    'announceStay: the stop ends as it would',
    async ($, on) => {
      const w = fresh()
      const { store, clock } = await loggedWorld(on, w, { 'rotate-to': 'off' })
      await start($, clock)
      w.isNotifyRefused = true
      await $.classic.StopFailure(FABLE_STOP)
      await clock.settle()
      if (!sent(w, STAY_NOTICE)) return 'notice never sent'
      return isEnded(store, w) ? 'stop handling failed' : 'none'
    },
  ],
  [
    'the stuck notice at a stop: the stop still says it stayed',
    async ($, on) => {
      const w = fresh()
      w.refuseEnv = true
      const { store, clock } = await loggedWorld(on, w)
      await start($, clock)
      w.isNotifyRefused = true
      w.usage['tok-1'] = [100, 41]
      await $.classic.StopFailure({ error: 'rate_limit' })
      await clock.settle()
      if (!sent(w, STUCK_NOTICE)) return 'notice never sent'
      if (isEnded(store, w)) return 'stop handling failed'
      return whats(stopLogOf(store, w)).includes('stayed: switching blocked') ? 'none' : 'no stayed line'
    },
  ],
  [
    // A missing catch on the notice fails the FILE instead ("the file ran to its end": the kit's row for a rejection
    // nothing handles). This row holds where the refusal lands: in the notice's own catch, not the view write's.
    'awaitFreeLogin: the refusal lands in the notice\'s own catch, not the view write\'s, and the debt is owed',
    async ($, on) => {
      const w = fresh()
      const { store, clock } = await loggedWorld(on, w)
      w.usage['tok-2'] = [100, 41]
      await start($, clock)
      w.isNotifyRefused = true
      w.usage['tok-1'] = [100, 41]
      await $.classic.StopFailure({ error: 'rate_limit' })
      await clock.settle()
      if (!sent(w, NO_LOGIN_NOTICE)) return 'notice never sent'
      if (isEnded(store, w)) return 'stop handling failed'
      if (!whats(stopLogOf(store, w)).some(x => x.startsWith('no login left'))) return 'no debt owed'
      const caught = (w.logged ?? []).filter(line => line.startsWith('account-rotator: notice failed:')).length
      return caught === 1 ? 'none' : `notice refusals caught by the notice's own catch: ${caught}`
    },
  ],
]

for (const [site, run] of REFUSED_SITES) {
  test(`R1: a notice the terminal refuses ends nothing: ${site} (puma-9arph.85)`, async ($, on) => {
    expect(await run($, on)).toBe('none')
  })
}

// ---------------------------------------------------------------- puma-9arph.86: a debt the view lacks, and a Connect visit

/**
 * The test's one handler of state.get and state.set. `refuse(n)` refuses the next n view writes that put carryDue into a
 * view that lacks it, as an engine that refuses the write; `clear()` makes reads find the default view until the mod writes it, as /clear does;
 * `spendAfterClear()` makes every read after the next write that clears carryDue find logins 1 and 2 needing a sign-in,
 * so the check after that write, and every tick after, finds no login to carry on (`spendAfterClear(['1'])`: login 1
 * alone), and `spend(ids)` sets which read spent from then on; `holdNext()` holds the next such write that puts carryDue in, `holdNext(true)` the
 * next that clears it, until the release it answers is called; `refuseClears()` refuses every later write that clears
 * carryDue; `refuseReadAfterClear(gate?)` refuses the first view read after the next write that clears it, landed or
 * refused, as an engine read that fails, once the gate given settles; `view()` is what a read finds.
 */
function carrySetRefusal(on: On) {
  let toRefuse = 0
  let refused = 0
  let isCleared = false
  let isSpentArmed = false
  let spentIds: string[] = []
  let spent: string[] = []
  let hold: Promise<void> | undefined
  let isHoldClear = false
  let held = 0
  let isClearRefused = false
  let clearsRefused = 0
  let isReadArmed = false
  let isReadRefused = false
  let readsRefused = 0
  let readGate: Promise<void> | undefined
  let last: View | undefined
  on('state.get', async (_$, e, next) => {
    if (isReadRefused && e.plugin === 'account-rotator' && e.key === 'view') {
      isReadRefused = false
      readsRefused += 1
      await readGate
      return { deny: 'state: read refused' } as unknown as Awaited<ReturnType<typeof next>>
    }
    const read = await next(e)
    if (e.plugin !== 'account-rotator' || e.key !== 'view') return read
    if (isCleared) return { value: { value: EMPTY_VIEW, version: read.value?.version ?? 0 } }
    if (spent.length === 0 || read.value === undefined) return read
    const view = read.value.value as View
    const rejected = { kind: 'login-needed', why: 'sign-in rejected' } as const
    const health = Object.fromEntries(spent.map(id => [id, rejected]))
    return { value: { ...read.value, value: { ...view, health: { ...view.health, ...health } } } }
  })
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    // A write that puts carryDue into a view that lacks it: every other view write spreads the view, the debt included.
    const isPut = key === 'view' && value.carryDue !== undefined && (isCleared ? EMPTY_VIEW : last)?.carryDue === undefined
    if (isPut && toRefuse > 0) {
      toRefuse -= 1
      refused += 1
      return { deny: 'state: refused' } as unknown as Awaited<ReturnType<typeof next>>
    }
    const isClear = key === 'view' && value.carryDue === undefined && (isCleared ? EMPTY_VIEW : last)?.carryDue !== undefined
    if (hold !== undefined && (isHoldClear ? isClear : isPut)) {
      const gate = hold
      hold = undefined
      held += 1
      await gate
    }
    // The read refused is the one after the clear's answer: armed before it, it would refuse the read a released write
    // makes again first.
    const armRead = () => {
      if (isClear && isReadArmed) {
        isReadArmed = false
        isReadRefused = true
      }
    }
    if (isClear && isClearRefused) {
      clearsRefused += 1
      armRead()
      return { deny: 'state: refused' } as unknown as Awaited<ReturnType<typeof next>>
    }
    if (isClear && isSpentArmed) {
      isSpentArmed = false
      spent = spentIds
    }
    if (key === 'view') {
      isCleared = false
      last = value
    }
    const result = await next(e)
    armRead()
    return result
  })
  return {
    refuse: (n: number) => {
      toRefuse = n
    },
    refused: () => refused,
    clear: () => {
      isCleared = true
    },
    spendAfterClear: (ids = ['1', '2']) => {
      isSpentArmed = true
      spentIds = ids
    },
    spend: (ids: string[]) => {
      spent = ids
    },
    refuseClears: () => {
      isClearRefused = true
    },
    clearsRefused: () => clearsRefused,
    refuseReadAfterClear: (gate?: Promise<void>) => {
      isReadArmed = true
      readGate = gate
    },
    readsRefused: () => readsRefused,
    holdNext: (isClearHeld = false) => {
      isHoldClear = isClearHeld
      let release = () => {}
      hold = new Promise<void>(resolve => {
        release = resolve
      })
      return release
    },
    held: () => held,
    view: () => (isCleared ? EMPTY_VIEW : last),
  }
}

/** Every login spent and a usage-limit stop on login 1: one carry-on owed at 12:00. `before` runs just before the stop. */
async function owedWithRefusals($: Engine, on: On, before?: (views: ReturnType<typeof carrySetRefusal>) => void) {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  const views = carrySetRefusal(on)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  before?.(views)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  return { w, store, clock, views }
}

test('86-B1: a carry-on owed whose first view write is refused is written into the view again at the next tick (puma-9arph.86)', async ($, on) => {
  const { store, clock, views, w } = await owedWithRefusals($, on, v => v.refuse(1))
  // The staging took: a debt is owed, and its one view write was refused.
  expect([whats(stopLogOf(store, w)).some(x => x.startsWith('no login left')), views.refused(), views.view()?.carryDue]).toEqual([true, 1, undefined])
  await untilTick(clock)
  expect(views.view()?.carryDue?.from).toBe('1')
})

test('86-B4: a carry-on owed whose write into the view again is refused too says so, stays owed, and is written at the tick after (puma-9arph.86)', async ($, on) => {
  const { clock, views, w } = await owedWithRefusals($, on, v => v.refuse(2))
  await untilTick(clock)
  expect([views.refused(), views.view()?.carryDue, debugLines(w, 'carry-on owed not written again').length]).toEqual([2, undefined, 1])
  await untilTick(clock)
  expect(views.view()?.carryDue?.from).toBe('1')
})

// A guard, green with no write-again: the refused write leaves the view unbound, and isBound, at the next tick's
// maybeRotate, runs rebindSession again, the debt included.
test('86-B3: a carry-on owed whose write after /clear is refused is back in the view at the next tick, as the rebind runs again (puma-9arph.86)', async ($, on) => {
  on('classic.SessionStart', () => ({}))
  const { clock, views } = await owedWithRefusals($, on)
  expect(views.view()?.carryDue?.from, 'the debt is in the view before /clear').toBe('1')
  // rebindSession's one view write, which puts the debt back after the reset, is refused.
  views.refuse(1)
  await clearSession($, clock, views.clear)
  expect([views.refused(), views.view()?.carryDue]).toEqual([1, undefined])
  await untilTick(clock)
  expect(views.view()?.carryDue?.from).toBe('1')
})

test('86-B2: a carry-on owed whose held write is refused, the login spent again after the clearing write, is written into the view again at the next tick (puma-9arph.86)', { timeoutMs: 30_000 }, async ($, on) => {
  const { store, clock, views, w } = await owedWithRefusals($, on)
  views.spendAfterClear()
  // The held branch's write, the next that puts the debt back into the view, is refused.
  views.refuse(1)
  const isHeld = () => whats(stopLogOf(store, w)).includes('carry-on held: the login moved')
  await clock.advance(Date.parse('2026-10-12T12:02:00Z') - clock.now())
  for (let i = 0; i < 5 && !isHeld(); i += 1) await untilTick(clock)
  // The staging took: the clearing write landed, the login read spent after it, and the held write was refused.
  expect([isHeld(), views.refused(), views.view()?.carryDue, w.submitted.length]).toEqual([true, 1, undefined, 0])
  await untilTick(clock)
  expect(views.view()?.carryDue?.from).toBe('1')
})

// RULING 7135 R2: the write-again is held in the engine's write, the debt is ended meanwhile, then the write lands.
test('86-E1: a carry-on owed that a press ends while its write into the view again is held is not left in the view (puma-9arph.86)', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock, views, w } = await owedWithRefusals($, on, v => v.refuse(1))
  const release = views.holdNext()
  await untilTick(clock)
  await settleReal(clock)
  expect(views.held(), 'the write-again is held').toBe(1)
  const pane = await mountPane($)
  let isPressed = false
  void pane.press({ key: 'use-2' }).then(() => {
    isPressed = true
  })
  await settleReal(clock)
  expect([isPressed, w.envSets.at(-1)?.value], 'the press ended the debt before the release').toEqual([true, SLOT2])
  release()
  await settleReal(clock)
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 10 * 60_000)
  await pane.unmount()
  expect([w.envSets.at(-1)?.value, views.view()?.carryDue, w.submitted.length]).toEqual([SLOT2, undefined, 0])
})

// It pins today's behaviour (no code for it, RULING 7135 R4): the store marks the debt ended before the submit, so a
// reload sends no second (puma-9arph.40's reload tests hold that half); the submit's rejection reaches the tick's catch,
// and nothing is tried again. Its RED: the mark written after the carry-on, not before.
test('86-C1: a carry-on owed whose submit rejects after a refused clear is marked ended, logged, and not tried again (puma-9arph.86)', async ($, on) => {
  const w = fresh()
  w.isSubmitThrown = true
  const { store, clock, seen } = await refusedOwedWorld($, on, w)
  await pastOwed(clock)
  expect(seen.refused, 'the clearing write was refused').toBeGreaterThan(0)
  expect([w.submitted.length, carryEndedOf(store, w), debugLines(w, 'carry-on once a login is free failed').length]).toEqual([1, { owedAt: seen.owed?.owedAt }, 1])
})

test('86-A1: a carry-on owed waits while a Connect visit runs, and goes once at the first tick after it (puma-9arph.86)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const view = watchedView(on)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  // Close to the time owed before the visit begins: every minute advanced while a slot write is held costs real time.
  await clock.advance(Date.parse('2026-10-12T11:58:00Z') - clock.now())
  // The visit's move waits at its slot write, so Connect holds the session through the time owed and its grace.
  let endVisit = () => {}
  const visit = new Promise<void>(resolve => {
    endVisit = resolve
  })
  w.beforeEnv = () => visit
  w.chrome.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-2' })
  // A held slot write keeps the kit's settle waiting: settle on real time instead, as the late-landing tests do.
  await settleReal(clock)
  await clock.advance(Date.parse('2026-10-12T12:06:00Z') - clock.now())
  // The staging took: the visit to login 2 is still under way. The ticks during it touch nothing: no clear, no hold.
  const isHeldLine = (what: string) => what === 'carry-on held: the login moved'
  const during = [w.submitted.length, view()?.carryDue?.from, view()?.chromeConnecting, whats(stopLogOf(store, w)).filter(isHeldLine).length]
  endVisit()
  await settleReal(clock)
  await clock.advance(10 * 60_000)
  await pane.unmount()
  expect([during, w.submitted.length, whats(stopLogOf(store, w)).filter(isOwedCarryOnLine).length]).toEqual([[0, '1', '2', 0], 1, 1])
})

// RULING 7135 R3: a visit that begins after the tick's visit check, while the clearing write is held.
test('86-A2: a carry-on owed whose clearing write is held while a Connect visit begins waits out the visit, and goes once after it (puma-9arph.86)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const views = carrySetRefusal(on)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(Date.parse('2026-10-12T12:02:00Z') - clock.now())
  w.chrome.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  let endVisit = () => {}
  const visit = new Promise<void>(resolve => {
    endVisit = resolve
  })
  w.beforeEnv = () => visit
  const releaseClear = views.holdNext(true)
  for (let i = 0; i < 5 && views.held() === 0; i += 1) {
    await clock.advance(60_000)
    await settleReal(clock)
  }
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(clock)
  releaseClear()
  await settleReal(clock)
  // The staging took: the clearing write was held, and the visit to login 2 is under way.
  const during = [views.held(), w.submitted.length, views.view()?.chromeConnecting]
  endVisit()
  await settleReal(clock)
  await clock.advance(10 * 60_000)
  await pane.unmount()
  expect([during, w.submitted.length]).toEqual([[1, 0, '2'], 1])
})

// ---------------------------------------------------------------- puma-9arph.87: no ended debt written, none lost to a throw

/** Presses Use now on login 2 and settles: answers whether the press finished and the slot the session is on. */
async function pressUse2($: Engine, clock: MockClock, w: World) {
  const pane = await mountPane($)
  let isPressed = false
  void pane.press({ key: 'use-2' }).then(() => {
    isPressed = true
  })
  await settleReal(clock)
  return { pane, pressed: [isPressed, w.envSets.at(-1)?.value] }
}

test('87-A: a carry-on owed that a press ends while awaitFreeLogin\'s first view write is held is not left in the view (puma-9arph.87)', { timeoutMs: 30_000 }, async ($, on) => {
  let release = () => {}
  const { clock, views, w } = await owedWithRefusals($, on, v => {
    release = v.holdNext()
  })
  await settleReal(clock)
  expect(views.held(), 'the first write is held').toBe(1)
  const { pane, pressed } = await pressUse2($, clock, w)
  expect(pressed, 'the press ended the debt before the release').toEqual([true, SLOT2])
  release()
  await settleReal(clock)
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 10 * 60_000)
  await pane.unmount()
  expect([views.view()?.carryDue, w.submitted.length]).toEqual([undefined, 0])
})

test('87-A2: a carry-on owed that a press ends while the held branch\'s write is held is not left in the view (puma-9arph.87)', { timeoutMs: 30_000 }, async ($, on) => {
  const { store, clock, views, w } = await owedWithRefusals($, on)
  // Both logins read spent after the clearing write, so the tick holds the debt and nothing rotates.
  views.spendAfterClear()
  const release = views.holdNext()
  await clock.advance(Date.parse('2026-10-12T12:02:00Z') - clock.now())
  for (let i = 0; i < 5 && views.held() === 0; i += 1) {
    await clock.advance(60_000)
    await settleReal(clock)
  }
  const isHeld = whats(stopLogOf(store, w)).includes('carry-on held: the login moved')
  expect([views.held(), isHeld], 'the held branch\'s write is held').toEqual([1, true])
  // Login 1 alone reads spent from here, so the pane offers Use now on login 2; no tick runs before the press.
  views.spend(['1'])
  const { pane, pressed } = await pressUse2($, clock, w)
  expect(pressed, 'the press ended the debt before the release').toEqual([true, SLOT2])
  release()
  await settleReal(clock)
  await clock.advance(10 * 60_000)
  await pane.unmount()
  expect([views.view()?.carryDue, w.submitted.length]).toEqual([undefined, 0])
})

test('87-B: a carry-on owed whose view read after the clear fails stays owed, and goes at a later tick (puma-9arph.87)', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock, views, w } = await owedWithRefusals($, on)
  views.refuseReadAfterClear()
  await pastOwed(clock)
  // The staging took: the one read after the clear was refused, and the tick's catch said so.
  expect([views.readsRefused(), debugLines(w, 'carry-on once a login is free failed').length]).toEqual([1, 1])
  expect(w.submitted).toHaveLength(1)
})

test('87-B2: a carry-on owed that a press ends during a refused clear, the read after it failing too, is marked ended (puma-9arph.87)', { timeoutMs: 30_000 }, async ($, on) => {
  const { store, clock, views, w } = await owedWithRefusals($, on)
  views.refuseClears()
  views.refuseReadAfterClear()
  const release = views.holdNext(true)
  await clock.advance(Date.parse('2026-10-12T12:02:00Z') - clock.now())
  for (let i = 0; i < 5 && views.held() === 0; i += 1) {
    await clock.advance(60_000)
    await settleReal(clock)
  }
  const { pane, pressed } = await pressUse2($, clock, w)
  expect([views.held(), ...pressed], 'the clear is held while the press ends the debt').toEqual([1, true, SLOT2])
  release()
  await settleReal(clock)
  await pane.unmount()
  // The staging took: the clear was refused, the read after it too, and the view still holds the ended debt.
  expect([views.clearsRefused() > 0, views.readsRefused(), views.view()?.carryDue !== undefined]).toEqual([true, 1, true])
  expect(carryEndedOf(store, w)).toEqual({ owedAt: views.view()?.carryDue?.owedAt })
})

test('87-B3: a carry-on owed that a press ends during a clear that lands, the read after it failing, is not owed again (puma-9arph.87)', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock, views, w } = await owedWithRefusals($, on)
  // The read after the clear waits until the press has ended the debt, then fails.
  let release = () => {}
  views.refuseReadAfterClear(
    new Promise<void>(resolve => {
      release = resolve
    }),
  )
  await clock.advance(Date.parse('2026-10-12T12:02:00Z') - clock.now())
  for (let i = 0; i < 5 && views.readsRefused() === 0; i += 1) {
    await clock.advance(60_000)
    await settleReal(clock)
  }
  const { pane, pressed } = await pressUse2($, clock, w)
  expect([views.view()?.carryDue, ...pressed], 'the clear landed, and the press ended the debt').toEqual([undefined, true, SLOT2])
  release()
  await settleReal(clock)
  await clock.advance(10 * 60_000)
  await pane.unmount()
  expect(views.readsRefused(), 'the read after the clear was refused').toBe(1)
  expect([views.view()?.carryDue, w.submitted.length]).toEqual([undefined, 0])
})

// ---------------------------------------------------------------- puma-9arph.88: a newer debt, and the carry-on around a Connect visit

test('88-A: a newer carry-on owed whose first write is refused, the view holding an older ended one, is written into the view (puma-9arph.88)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  let last: View | undefined
  let isClearRefused = false
  let isNewerRefused = false
  let refusedOwedAt: number | undefined
  let spent: string[] = []
  on('state.get', async (_$, e, next) => {
    const read = await next(e)
    if (e.plugin !== 'account-rotator' || e.key !== 'view' || spent.length === 0 || read.value === undefined) return read
    const view = read.value.value as View
    const health = Object.fromEntries(spent.map(id => [id, { kind: 'login-needed', why: 'sign-in rejected' } as const]))
    return { value: { ...read.value, value: { ...view, health: { ...view.health, ...health } } } }
  })
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key !== 'view') return next(e)
    const isClear = value.carryDue === undefined && last?.carryDue !== undefined
    const isNewer = value.carryDue !== undefined && last?.carryDue !== undefined && value.carryDue.owedAt !== last.carryDue.owedAt
    if (isClear && isClearRefused) return { deny: 'state: refused' } as unknown as Awaited<ReturnType<typeof next>>
    if (isNewer && isNewerRefused) {
      isNewerRefused = false
      refusedOwedAt = value.carryDue?.owedAt
      return { deny: 'state: refused' } as unknown as Awaited<ReturnType<typeof next>>
    }
    last = value
    return next(e)
  })
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const older = last?.carryDue
  // The older debt's carry-on goes while every clear is refused: the store marks it ended, the view keeps it.
  isClearRefused = true
  await pastOwed(clock)
  const ended = [w.submitted.length, carryEndedOf(store, w)?.owedAt === older?.owedAt, last?.carryDue?.owedAt === older?.owedAt]
  // A newer stop with no login left: its first write into the view is refused.
  w.usage['tok-1'] = [100, 100]
  w.usage['tok-2'] = [100, 100]
  isNewerRefused = true
  spent = ['2']
  await clock.advance(60_000)
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  const owedLines = whats(stopLogOf(store, w)).filter(x => x.startsWith('no login left')).length
  expect([ended, owedLines, typeof refusedOwedAt], 'the older debt ended and kept in the view, the newer one refused').toEqual([[1, true, true], 2, 'number'])
  await untilTick(clock)
  // A reload's boot owes the debt the view holds: the newer one now, which the store's mark of the older does not end.
  expect(last?.carryDue?.owedAt).toBe(refusedOwedAt)
})

/**
 * Connect visits from here on: a world on two logins, or three, Claude in Chrome's extension on login 1, whose view writes
 * `state.set` sees; `atVisitEnd()` is how many carry-ons were submitted when the first visit's write ended it (a trial
 * no browser answers connects again as the extension's account, a second visit), `visits()` how many began;
 * `refuseNote()` refuses the next write that notes what Chrome answered as login 2, so the visit throws after its wait,
 * and `holdNote()` holds that write until the release it answers, so the visit stays open past its wait.
 */
async function chromeVisitWorld($: Engine, on: On, isThree = false) {
  const w = fresh()
  w.chrome = { extensions: [''] }
  if (isThree) {
    w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
    w.usage['tok-3'] = [10, 30]
  }
  const { store, clock } = await loggedWorld(on, w, { ...(isThree ? THREE_LOGINS : {}), 'chrome-account': '1' })
  let last: View | undefined
  let atVisitEnd: number | undefined
  let isNoteRefused = false
  let notesRefused = 0
  let noteHold: Promise<void> | undefined
  let visits = 0
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key !== 'view') return next(e)
    const isNote = value.chrome?.as === '2' && last?.chrome?.as !== '2'
    if (isNote && isNoteRefused) {
      isNoteRefused = false
      notesRefused += 1
      return { deny: 'state: refused' } as unknown as Awaited<ReturnType<typeof next>>
    }
    if (isNote && noteHold !== undefined) {
      const gate = noteHold
      noteHold = undefined
      await gate
    }
    if (last?.chromeConnecting === undefined && value.chromeConnecting !== undefined) visits += 1
    if (last?.chromeConnecting !== undefined && value.chromeConnecting === undefined) atVisitEnd ??= w.submitted.length
    last = value
    return next(e)
  })
  await start($, clock)
  return {
    w,
    store,
    clock,
    last: () => last,
    atVisitEnd: () => atVisitEnd,
    visits: () => visits,
    refuseNote: () => {
      isNoteRefused = true
    },
    notesRefused: () => notesRefused,
    holdNote: () => {
      let release = () => {}
      noteHold = new Promise<void>(resolve => {
        release = resolve
      })
      return release
    },
  }
}

/** A usage-limit stop on login 1 that moves to login 2 and arms its carry-on, then the pane open on Chrome's other accounts. */
async function stopThenPane($: Engine, world: Awaited<ReturnType<typeof chromeVisitWorld>>) {
  world.w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await settleReal(world.clock)
  const armed = [world.last()?.activeId, whats(stopLogOf(world.store, world.w)).includes('carry-on armed')]
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await settleReal(world.clock)
  await pane.redraw()
  return { pane, armed }
}

test('88-B1: a stop\'s carry-on armed before a Connect visit that does not move waits out the visit, and goes once after it (puma-9arph.88)', async ($, on) => {
  const world = await chromeVisitWorld($, on)
  const { pane, armed } = await stopThenPane($, world)
  // The visit's note of what Chrome answered waits, so the visit is still open when the carry-on's timer fires.
  const release = world.holdNote()
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(world.clock)
  await world.clock.advance(60_000)
  await settleReal(world.clock)
  const during = [world.last()?.chromeConnecting, world.w.submitted.length]
  release()
  await settleReal(world.clock)
  await world.clock.advance(2 * 60_000)
  await settleReal(world.clock)
  await pane.unmount()
  expect(armed, 'the carry-on armed on login 2').toEqual(['2', true])
  expect([during, world.atVisitEnd(), world.w.submitted.length]).toEqual([['2', 0], 0, 1])
})

test('88-B2: a stop\'s carry-on armed before a Connect visit that moves is not lost: it goes once after the visit (puma-9arph.88)', async ($, on) => {
  const world = await chromeVisitWorld($, on, true)
  const { pane, armed } = await stopThenPane($, world)
  void pane.press({ key: 'chrome-try-3' })
  await settleReal(world.clock)
  const during = world.last()?.chromeConnecting
  await world.clock.advance(2 * 60_000)
  await settleReal(world.clock)
  await pane.unmount()
  expect([armed, during], 'the carry-on armed on login 2, a visit to login 3 under way').toEqual([['2', true], '3'])
  expect([world.atVisitEnd(), world.w.submitted.length]).toEqual([0, 1])
})

test('88-B3: a carry-on held for a Connect visit that throws goes once, and a later visit sends none (puma-9arph.88)', async ($, on) => {
  const world = await chromeVisitWorld($, on)
  const { pane } = await stopThenPane($, world)
  world.refuseNote()
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(world.clock)
  await world.clock.advance(2 * 60_000)
  await settleReal(world.clock)
  const held = whats(stopLogOf(world.store, world.w)).includes('carry-on held: Claude in Chrome is connecting')
  expect([world.notesRefused(), held], 'the visit took the carry-on, then threw').toEqual([1, true])
  expect(world.w.submitted).toHaveLength(1)
  // The hold the throw ended is not left for the next visit: that one cut nothing, and sends nothing. The carry-on's turn
  // starts first, so a second would not wait queued behind it.
  await $.turn.start({ text: world.w.submitted[0] ?? '', turnId: 'thrown-visit-carry-on' })
  await settleReal(world.clock)
  const before = world.visits()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(world.clock)
  await world.clock.advance(2 * 60_000)
  await settleReal(world.clock)
  await pane.unmount()
  expect([world.visits() > before, world.w.submitted.length], 'a later visit began, and sent nothing').toEqual([true, 1])
})

/**
 * puma-9arph.91: a debt owed, a Connect visit a second stop cuts, then the debt's carry-on submitted at the free time and
 * answered late, past the visit's own line, which sendCarryOn turns away as one is queued (the staging of 88-L).
 * `meanwhile` runs after the turn-away, before the late answer.
 */
async function heldBehindQueued($: Engine, on: On, answer: 'drop' | 'reject' | 'resolve', drops = 1, meanwhile?: () => Promise<void>) {
  const w = fresh()
  w.chrome = { extensions: [''] }
  // Both logins free up at 10:20, so the staging below (two minutes short of it, then six minutes past) takes few ticks.
  w.fiveHourResets = { 'tok-1': '2026-10-12T10:20:00Z', 'tok-2': '2026-10-12T10:20:00Z' }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(Date.parse('2026-10-12T10:18:00Z') - clock.now())
  let endVisit = () => {}
  const visit = new Promise<void>(resolve => {
    endVisit = resolve
  })
  w.beforeEnv = () => visit
  w.chrome.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-2' })
  await clock.settle()
  await clock.advance(2 * 60_000)
  void $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(Date.parse('2026-10-12T10:26:00Z') - clock.now())
  const settle = answerNextLate(w, answer, drops)
  w.beforeEnv = undefined
  endVisit()
  await clock.settle()
  for (let i = 0; i < 12; i += 1) {
    await clock.advance(10_000)
    await clock.settle()
  }
  const heldSubmits = w.submitted.length
  const isTurnedAway = whats(stopLogOf(store, w)).includes('carry-on not sent again: one is queued')
  await meanwhile?.()
  settle()
  await clock.settle()
  return { w, store, clock, pane, heldSubmits, isTurnedAway }
}

/** Ten minutes of ticks, with no stop, switch or visit. */
async function tenMinutes(clock: MockClock): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    await clock.advance(10_000)
    await clock.settle()
  }
}

for (const answer of ['drop', 'reject'] as const) {
  test(`91-${answer === 'drop' ? 'A' : 'B'}: a carry-on turned away behind a queued submit the engine then ${answer === 'drop' ? 'drops' : 'refuses'} is sent once in its place (puma-9arph.91)`, async ($, on) => {
    const r = await heldBehindQueued($, on, answer)
    await tenMinutes(r.clock)
    await r.pane.unmount()
    expect([r.heldSubmits, r.isTurnedAway], 'one submit held, the visit line turned away behind it').toEqual([1, true])
    const log = whats(stopLogOf(r.store, r.w))
    expect([r.w.submitted.length, log.at(-1)]).toEqual([2, 'carry-on resolved'])
  })
}

test('91-C: a carry-on turned away behind a queued submit that goes through is not sent again, nor after a later drop (puma-9arph.91)', async ($, on) => {
  const r = await heldBehindQueued($, on, 'resolve')
  // The queued one's turn starts, so a second submit would not hide behind it as queued.
  await $.turn.start({ text: r.w.submitted[0] ?? '', turnId: '91-C-carry-on' })
  await tenMinutes(r.clock)
  const after = r.w.submitted.length
  // A later line of the mod's own, which the engine drops: Claude in Chrome comes back as no browser's account, and the
  // reconnect tells Claude to carry on. The one turned away before is not sent for it.
  answerNextLate(r.w, 'drop')()
  if (r.w.chrome !== undefined) r.w.chrome.as = 'a slot no browser answers as'
  await browse($, 'navigate', { url: 'https://example.com' })
  await settleReal(r.clock)
  await tenMinutes(r.clock)
  await r.pane.unmount()
  expect([r.heldSubmits, r.isTurnedAway, after]).toEqual([1, true, 1])
  expect([r.w.submitted.at(-1)?.startsWith('Claude in Chrome is connected'), r.w.submitted.length]).toEqual([true, 2])
  expect(whats(stopLogOf(r.store, r.w)).filter(what => what === 'carry-on drop')).toEqual(['carry-on drop'])
})

test('91-F: a carry-on turned away behind a queued submit is not sent where a main turn began before the drop (puma-9arph.91)', async ($, on) => {
  const r = await heldBehindQueued($, on, 'drop', 1, async () => {
    await $.turn.start({ text: 'a turn of the person', turnId: '91-F-turn' })
  })
  await tenMinutes(r.clock)
  await r.pane.unmount()
  expect([r.heldSubmits, r.isTurnedAway]).toEqual([1, true])
  expect([r.w.submitted.length, whats(stopLogOf(r.store, r.w)).at(-1)]).toEqual([1, 'carry-on drop'])
})

test('91-G: a carry-on sent in place of a dropped one, and dropped too, is not sent a third time (puma-9arph.91)', async ($, on) => {
  const r = await heldBehindQueued($, on, 'drop', 2)
  await tenMinutes(r.clock)
  await r.pane.unmount()
  expect([r.heldSubmits, r.isTurnedAway]).toEqual([1, true])
  const log = whats(stopLogOf(r.store, r.w))
  expect([r.w.submitted.length, log.filter(what => what === 'carry-on drop').length]).toEqual([2, 2])
})

/**
 * puma-9arph.91: a stop on login 1 moves to login 2 and its carry-on goes, answered late (dropped); a second stop moves
 * on to login 3, and its carry-on is turned away behind the first. The view's note of what Chrome answered as login 3
 * can be held, and then refused.
 */
async function turnedAwayOnThree($: Engine, on: On) {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  const note: { hold?: Promise<void>; isRefused: boolean; end?: 'lands' | 'refused' } = { isRefused: false }
  // Each visit's end as `<account it connected>@<login in use>:<submits gone by then>`.
  const visitEnds: string[] = []
  let last: View | undefined
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key !== 'view') return next(e)
    if (value.chrome?.as === '3' && last?.chrome?.as !== '3' && note.hold !== undefined) {
      const gate = note.hold
      note.hold = undefined
      await gate
      note.end = note.isRefused ? 'refused' : 'lands'
      if (note.isRefused) return { deny: 'state: refused' } as unknown as Awaited<ReturnType<typeof next>>
    }
    if (last?.chromeConnecting !== undefined && value.chromeConnecting === undefined) visitEnds.push(`${last.chromeConnecting}@${value.activeId}:${w.submitted.length}`)
    last = value
    return next(e)
  })
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  const settle = answerNextLate(w, 'drop')
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(36_000)
  await clock.settle()
  const first = [last?.activeId, w.submitted.length]
  w.usage['tok-2'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(36_000)
  await clock.settle()
  const isTurnedAway = whats(stopLogOf(store, w)).includes('carry-on not sent again: one is queued')
  return { w, store, clock, settle, note, visitEnds, first, isTurnedAway, last: () => last }
}

test('91-E: a carry-on turned away behind a queued submit is not sent where a stop with no login left owes the carry-on before the drop (puma-9arph.91)', async ($, on) => {
  const r = await turnedAwayOnThree($, on)
  r.w.usage['tok-3'] = [100, 41]
  // Login 2 cannot be tried (a wordless stop makes a login tried only at its second): none is left for this stop.
  r.store.set('health:2', { kind: 'login-needed', why: 'its sign-in has run out' })
  await $.classic.StopFailure(PLAIN)
  await r.clock.settle()
  const isOwed =whats(stopLogOf(r.store, r.w)).some(what => what.startsWith('no login left'))
  r.settle()
  await r.clock.settle()
  await r.clock.advance(60_000)
  await r.clock.settle()
  expect([r.first, r.last()?.activeId, r.isTurnedAway, isOwed], 'held on 2, turned away on 3, then no login left').toEqual([['2', 1], '3', true, true])
  expect([r.w.submitted.length, r.last()?.carryDue !== undefined], 'nothing sent at the drop, the carry-on owed').toEqual([1, true])
})

test('91-E: a carry-on turned away behind a queued submit is not sent where the tried list itself leaves no login (puma-9arph.91)', async ($, on) => {
  const r = await turnedAwayOnThree($, on)
  r.w.usage['tok-3'] = [100, 41]
  // A wordless stop on a login whose switch no response proved makes it tried only at its second: the run of stops that
  // follows (3, then 2, then 3 again) leaves login 1, 2 and 3 all tried, so no login is left with every login healthy.
  for (let i = 0; i < 3; i += 1) {
    await r.clock.advance(36_000)
    await $.classic.StopFailure(PLAIN)
    await r.clock.settle()
  }
  const log = whats(stopLogOf(r.store, r.w))
  expect(log, 'the tried list alone ends the stop').toContain('stayed: no untried login (tried 1, 2, 3)')
  const isOwed = log.some(what => what.startsWith('no login left'))
  r.settle()
  await r.clock.settle()
  await r.clock.advance(60_000)
  await r.clock.settle()
  expect([r.last()?.activeId, r.isTurnedAway, isOwed], 'turned away on 3, then no login left').toEqual(['3', true, true])
  expect([r.w.submitted.length, r.last()?.carryDue !== undefined], 'nothing sent at the drop, the carry-on owed').toEqual([1, true])
})

/**
 * puma-9arph.91: the world above, then a Connect trial on login 3, which moves nothing and pairs no browser, its note of
 * what Chrome answered held, so the visit is open when the first submit is dropped. `end` is how that note ends.
 */
async function droppedDuringVisit($: Engine, on: On, end: 'lands' | 'refused') {
  const { w, store, clock, settle, note, visitEnds, first, isTurnedAway, last } = await turnedAwayOnThree($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  let release = () => {}
  note.hold = new Promise<void>(resolve => {
    release = resolve
  })
  void pane.press({ key: 'chrome-try-3' })
  await clock.settle()
  settle()
  await clock.settle()
  await clock.advance(60_000)
  await clock.settle()
  const during = [last()?.chromeConnecting, w.submitted.length]
  note.isRefused = end === 'refused'
  release()
  await clock.settle()
  await clock.advance(2 * 60_000)
  await clock.settle()
  await pane.unmount()
  return { w, store, first, active: last()?.activeId, isTurnedAway, during, noteEnd: note.end, isConnecting: last()?.chromeConnecting !== undefined, visitEnds }
}

for (const end of ['lands', 'refused'] as const) {
  const what = end === 'lands' ? 'ends goes once, after the visit closes' : 'throws goes once, after the visit closes'
  test(`91-D${end === 'lands' ? '1' : '2'}: a carry-on turned away behind a submit dropped during a Connect visit that ${what} (puma-9arph.91)`, async ($, on) => {
    const r = await droppedDuringVisit($, on, end)
    expect([r.first, r.active, r.isTurnedAway], 'the first carry-on held on login 2, the second turned away on login 3').toEqual([['2', 1], '3', true])
    // The held note landed, or was refused so the visit threw; either way the visit is over.
    expect([r.noteEnd, r.isConnecting], 'how the visit ended').toEqual([end, false])
    // No browser answered as login 3: a paired visit would send its own connected line, whatever was turned away.
    expect(r.w.submitted.some(text => text.startsWith('Claude in Chrome is connected')), 'the visit paired').toBe(false)
    expect([r.during, r.w.submitted.length], 'none while the visit waits, one in all').toEqual([['3', 1], 2])
    // Where the visit to login 3 (which moves nothing) ends: on login 3, the carry-on not yet gone, whether it ended or
    // threw: a thrown visit sends from the same place as one that ends, after it closes (puma-9arph.89).
    expect(r.visitEnds.filter(at => at.startsWith('3@')), 'the visit\'s end against the send').toEqual(['3@3:1'])
  })
}

/**
 * puma-9arph.89: chromeVisitWorld with three logins, the view's note of what Chrome answered as `noteAs` refusable or
 * held, the visit's closing write (chromeConnecting cleared) refusable or held, and the move back off `noteAs` refusable.
 * Each submit is logged as the login whose slot is set when it goes, `+visit` where a visit's view is open then.
 */
async function visitTailWorld($: Engine, on: On, noteAs: '2' | '3') {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  const k = {
    last: undefined as View | undefined,
    isNoteRefused: false,
    noteHold: undefined as Promise<void> | undefined,
    isCloseRefused: false,
    closeHold: undefined as Promise<void> | undefined,
    isBackRefused: false,
    backHold: undefined as Promise<void> | undefined,
    isBacked: false,
    ends: 0,
    sends: [] as string[],
    sentAt: [] as number[],
    backAt: undefined as number | undefined,
  }
  const loginOf = (slot: string | undefined) => ({ [SLOT2]: '2', [SLOT3]: '3' })[slot ?? ''] ?? '1'
  Object.defineProperty(w, 'submitHold', {
    configurable: true,
    get: () => {
      if (k.sends.length < w.submitted.length) {
        k.sends.push(`${loginOf(w.envSets.at(-1)?.value)}${k.last?.chromeConnecting === undefined ? '' : '+visit'}`)
        k.sentAt.push(clock.now())
      }
      return undefined
    },
  })
  const deny = { deny: 'state: refused' }
  const gated = async (hold: Promise<void> | undefined) => {
    if (hold !== undefined) await hold
  }
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key !== 'view') return next(e)
    if (value.chrome?.as === noteAs && k.last?.chrome?.as !== noteAs) {
      const hold = k.noteHold
      k.noteHold = undefined
      await gated(hold)
      if (k.isNoteRefused) {
        k.isNoteRefused = false
        return deny as unknown as Awaited<ReturnType<typeof next>>
      }
    }
    const isClose = k.last?.chromeConnecting !== undefined && value.chromeConnecting === undefined
    if (isClose) {
      const hold = k.closeHold
      k.closeHold = undefined
      await gated(hold)
      if (k.isCloseRefused) {
        k.isCloseRefused = false
        return deny as unknown as Awaited<ReturnType<typeof next>>
      }
      k.ends += 1
    }
    const isBack = k.last?.activeId === noteAs && value.activeId !== noteAs
    if (isBack && k.isBackRefused) {
      k.isBackRefused = false
      return deny as unknown as Awaited<ReturnType<typeof next>>
    }
    k.last = value
    const written = await next(e)
    if (isBack) k.backAt = clock.now()
    // Once the move back's write has landed, before the switch that made it goes on.
    if (isBack && k.backHold !== undefined) {
      const hold = k.backHold
      k.backHold = undefined
      k.isBacked = true
      await hold
    }
    return written
  })
  await start($, clock)
  // A stop on login 1 moves to login 2; its carry-on goes and its turn starts, so the visit below starts owing nothing.
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.advance(60_000)
  await settleReal(clock)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: '89-first-carry-on' })
  await settleReal(clock)
  await pane.redraw()
  const log = () => whats(stopLogOf(store, w))
  const minutes = async (n: number) => {
    for (let i = 0; i < 4 * n; i += 1) {
      await clock.advance(15_000)
      await settleReal(clock)
    }
  }
  return { w, clock, k, pane, log, minutes, loginOf, before: w.submitted.length }
}

/** A gate a test opens: the promise, and what opens it. */
function gate89(): { p: Promise<void>; open: () => void } {
  let open = () => {}
  const p = new Promise<void>(resolve => {
    open = resolve
  })
  return { p, open }
}

test('89-B: a Connect visit that moves and throws sends the carry-on a stop handed it once, back on the login it left, after the visit (puma-9arph.89)', async ($, on) => {
  const r = await visitTailWorld($, on, '3')
  r.k.isNoteRefused = true
  void r.pane.press({ key: 'chrome-try-3' })
  await settleReal(r.clock)
  // The stop comes while the visit's switch to login 3 settles: the visit takes its carry-on.
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  await r.minutes(3)
  await r.pane.unmount()
  expect(r.w.toasts.some(text => text.startsWith('Something went wrong')), 'the visit threw').toBe(true)
  expect([r.k.sends.slice(r.before), r.loginOf(r.w.envSets.at(-1)?.value)], 'one, on login 2, the session back there').toEqual([['2'], '2'])
  // Once the move back lands: SETTLE_MS after its write, as after a visit that ends.
  expect((r.k.sentAt.at(-1) ?? 0) - (r.k.backAt ?? Infinity), 'sent SETTLE_MS after the move back').toBeGreaterThanOrEqual(35_000)
})

test('89-H: a carry-on a visit that moves held is not sent during the visit Use for Chrome starts after it (puma-9arph.89)', async ($, on) => {
  const r = await visitTailWorld($, on, '3')
  void r.pane.press({ key: 'chrome-try-3' })
  await settleReal(r.clock)
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  // No browser answers as login 3: Claude in Chrome connects again as login 1, a second visit, during the first's wait.
  await r.minutes(3)
  await r.pane.unmount()
  // The second visit was open at the first's send: it took the carry-on, and sent it after it ended.
  expect(r.log(), 'held for the second visit').toContain('carry-on held: Claude in Chrome is connecting')
  expect(r.k.sends.slice(r.before), 'one, on login 2, with no visit open').toEqual(['2'])
})

test('89-C: a Connect visit that throws, its closing write refused too, still sends the carry-on it held once (puma-9arph.89)', async ($, on) => {
  const r = await visitTailWorld($, on, '2')
  const note = gate89()
  r.k.noteHold = note.p
  r.k.isNoteRefused = true
  r.k.isCloseRefused = true
  void r.pane.press({ key: 'chrome-try-2' })
  await settleReal(r.clock)
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  note.open()
  await r.minutes(3)
  await r.pane.unmount()
  expect(r.log(), 'the visit took it').toContain('stayed: Claude in Chrome is connecting')
  expect(r.w.submitted.length - r.before).toBe(1)
})

test('89-D: a Connect visit that ends, its closing write refused, still sends the carry-on it held once (puma-9arph.89)', async ($, on) => {
  const r = await visitTailWorld($, on, '2')
  const note = gate89()
  r.k.noteHold = note.p
  r.k.isCloseRefused = true
  void r.pane.press({ key: 'chrome-try-2' })
  await settleReal(r.clock)
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  note.open()
  await r.minutes(3)
  await r.pane.unmount()
  expect(r.log(), 'the visit took it').toContain('stayed: Claude in Chrome is connecting')
  expect(r.w.submitted.length - r.before).toBe(1)
})

test('89-E: a stop during a thrown Connect visit\'s move back is carried on once, not skipped as another switch (puma-9arph.89)', async ($, on) => {
  const r = await visitTailWorld($, on, '3')
  r.k.isNoteRefused = true
  void r.pane.press({ key: 'chrome-try-3' })
  await settleReal(r.clock)
  const back = gate89()
  r.k.backHold = back.p
  // The visit's own wait out, then the throw. The stop comes once the move back's write has landed, where one runs.
  await r.clock.advance(36_000)
  await settleReal(r.clock)
  r.w.usage['tok-3'] = [100, 41]
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  back.open()
  await r.minutes(3)
  await r.pane.unmount()
  expect(r.log(), 'the stop\'s carry-on').not.toContain('carry-on skipped: another switch since')
  expect(r.w.submitted.length - r.before).toBe(1)
})

test('89-F: a carry-on owed as a thrown Connect visit closes waits out a visit begun meanwhile (puma-9arph.89)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await visitTailWorld($, on, '2')
  r.k.isNoteRefused = true
  const close = gate89()
  r.k.closeHold = close.p
  void r.pane.press({ key: 'chrome-try-2' })
  await r.minutes(1)
  // Visit 2: a browser call that finds no browser connects Claude in Chrome as login 1; its move there is held.
  const move = gate89()
  r.w.beforeEnv = () => move.p
  if (r.w.chrome !== undefined) r.w.chrome.as = 'a slot no browser answers as'
  await browse($, 'navigate', { url: 'https://example.com' })
  await r.minutes(1)
  r.w.usage['tok-2'] = [100, 41]
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  const isCut = r.log().includes('stayed: Claude in Chrome is connecting')
  close.open()
  await r.minutes(1)
  const whileOpen = r.w.submitted.length - r.before
  r.w.beforeEnv = undefined
  move.open()
  await r.minutes(3)
  await r.pane.unmount()
  expect([isCut, whileOpen], 'visit 2 cut the stop, and nothing went while it was open').toEqual([true, 0])
  expect(r.w.submitted.length - r.before, 'visit 2\'s line, once').toBe(1)
})

test('89-G: a thrown Connect visit whose move back is refused sends the carry-on it held once, on the login it stays on (puma-9arph.89)', async ($, on) => {
  const r = await visitTailWorld($, on, '3')
  r.k.isNoteRefused = true
  r.k.isBackRefused = true
  void r.pane.press({ key: 'chrome-try-3' })
  await settleReal(r.clock)
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  await r.minutes(3)
  await r.pane.unmount()
  // A limit (RULING 7178): sent on the login the failed move back left the session on, not kept owed.
  expect(r.k.sends.slice(r.before)).toEqual(['3'])
})

test('89-I: a stop during the wait after a thrown Connect visit that moved carries on, at most twice, never on the login visited (puma-9arph.89)', async ($, on) => {
  const r = await visitTailWorld($, on, '3')
  r.k.isNoteRefused = true
  void r.pane.press({ key: 'chrome-try-3' })
  await settleReal(r.clock)
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  let isStopped = false
  for (let i = 0; i < 12; i += 1) {
    await r.clock.advance(15_000)
    await settleReal(r.clock)
    if (!isStopped && r.k.ends > 1) {
      isStopped = true
      void $.classic.StopFailure(PLAIN)
      await settleReal(r.clock)
    }
  }
  await r.pane.unmount()
  const sends = r.k.sends.slice(r.before)
  expect([isStopped, sends.length >= 1 && sends.length <= 2, sends.filter(at => at.startsWith('3'))], 'a stop after the close, 1 or 2 sent, none on 3').toEqual([true, true, []])
})

/**
 * puma-9arph.94: a Connect visit to login 3 that a stop cuts and that then throws, with one step of its tail held on a
 * gate: the move back's slot write (`back`, held from just after the forward move landed) or the visit's closing view
 * write (`close`). The engine and the store set no limit on either, so the gate stands for one that never answers.
 */
async function hungTail94($: Engine, on: On, hold: 'back' | 'close') {
  const r = await visitTailWorld($, on, '3')
  r.k.isNoteRefused = true
  const held = gate89()
  if (hold === 'close') r.k.closeHold = held.p
  const pressedAt = r.clock.now()
  void r.pane.press({ key: 'chrome-try-3' })
  await settleReal(r.clock)
  const forward = r.loginOf(r.w.envSets.at(-1)?.value)
  if (hold === 'back') r.w.beforeEnv = () => held.p
  void $.classic.StopFailure(PLAIN)
  await settleReal(r.clock)
  await r.minutes(3)
  return { r, held, pressedAt, forward }
}

test('94-A: a thrown Connect visit whose move back never answers sends the carry-on once within the bound, and closes the visit (puma-9arph.94)', async ($, on) => {
  const { r, held, pressedAt, forward } = await hungTail94($, on, 'back')
  const sends = r.k.sends.slice(r.before)
  const closed = r.k.last?.chromeConnecting
  // The visit flag cleared: a later Connect visits again.
  await r.pane.redraw()
  void r.pane.press({ key: 'chrome-try-3' })
  await settleReal(r.clock)
  const again = r.k.last?.chromeConnecting
  held.open()
  await r.minutes(1)
  await r.pane.unmount()
  expect(forward, 'the forward move landed before the hold').toBe('3')
  // On login 3: the move back never landed, so the send goes where a failed move back leaves the session (89-G).
  expect([sends, closed], 'one carry-on, on login 3, the visit closed').toEqual([['3'], undefined])
  // The visit's own wait (35 s), the move back's bound and the tail's (30 s each), the settle (35 s), one 15 s step.
  expect((r.k.sentAt[r.before] ?? Infinity) - pressedAt, 'sent within the bounds').toBeLessThanOrEqual(145_000)
  // Login 3 or, where no browser answers as it, the account picked before (tryChromeAccount): a visit opened either way.
  expect(again, 'a later Connect opens a visit').not.toBe(undefined)
})

test('94-B: a thrown Connect visit whose closing write never answers sends the carry-on once (puma-9arph.94)', async ($, on) => {
  const { r, held } = await hungTail94($, on, 'close')
  const sends = r.k.sends.slice(r.before)
  held.open()
  await r.minutes(3)
  await r.pane.unmount()
  expect(sends, 'one carry-on, back on login 2, the closing write still held').toEqual(['2+visit'])
  expect(r.w.submitted.length - r.before, 'none more once the closing write lands late').toBe(1)
})

test('94-C: a thrown Connect visit\'s move back that answers after the bound lands late and sends nothing more (puma-9arph.94)', async ($, on) => {
  const { r, held } = await hungTail94($, on, 'back')
  const before = r.k.sends.slice(r.before)
  held.open()
  await r.minutes(3)
  await r.pane.unmount()
  const after = [r.k.sends.slice(r.before), r.loginOf(r.w.envSets.at(-1)?.value), r.k.last?.chromeConnecting]
  expect([before, after], 'one carry-on on login 3; then the late move back lands on login 2, the visit still closed').toEqual([['3'], [['3'], '2', undefined]])
})

/**
 * puma-9arph.89 (Codex round 1, PairedTailRead): a browser call that found no browser connects Claude in Chrome as login
 * 2, which pairs; every view read after the visit's close is refused, and with `isCloseRefused` the close too. The
 * tail's maybeRotate reads the view first, so these tests also hold its catch: either catch removed, nothing is sent.
 */
async function pairedTailUnread($: Engine, on: On, isCloseRefused: boolean) {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  await spentTwo(w)
  const spent = { fiveHour: { pct: 100, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW - 60_000, by: '2', v: 1, src: 'body' }
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2', 'chrome-accounts': ['2'], 'usage:2': spent })
  let last: View | undefined
  let isWatched = false
  let isClosed = false
  let isReadRefused = false
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key !== 'view') return next(e)
    const isClose = isWatched && last?.chromeConnecting !== undefined && value.chromeConnecting === undefined
    if (isClose) {
      isClosed = true
      if (isCloseRefused) {
        isReadRefused = true
        return { deny: 'state: close refused' } as unknown as Awaited<ReturnType<typeof next>>
      }
    }
    const written = await next(e)
    last = value
    if (isClose) isReadRefused = true
    return written
  })
  on('state.get', (_$, e, next) => (isReadRefused && e.key === 'view' ? ({ deny: 'state: read refused' } as unknown as ReturnType<typeof next>) : next(e)))
  await start($, clock)
  await clock.advance(36_000)
  isWatched = true
  await browse($, 'navigate', { url: 'https://example.com' })
  for (let i = 0; i < 3; i += 1) {
    await clock.settle()
    await clock.advance(36_000)
  }
  await clock.settle()
  return { w, isClosed }
}

for (const isCloseRefused of [false, true]) {
  test(`89-${isCloseRefused ? 'K' : 'J'}: a paired Connect visit carries on once where the view read after its close${isCloseRefused ? ', and its close,' : ''} is refused (puma-9arph.89)`, async ($, on) => {
    const { w, isClosed } = await pairedTailUnread($, on, isCloseRefused)
    expect([isClosed, w.chromeAsked.includes(SLOT2)], 'the visit to login 2 asked there and closed').toEqual([true, true])
    expect(w.submitted).toHaveLength(1)
  })
}

// ---------------------------------------------------------------- puma-9arph.90: one carry-on after a visit that cut a stop
