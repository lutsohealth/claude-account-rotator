import { expect } from 'claude-code/testing'
import { test } from './flow-harness'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { View } from '../types'
import { NUDGE_TEXT, USAGE_CLAIM_WAIT_MS, USAGE_FORCE_AFTER_MS, keychainItem } from './model'
import { DAY, FABLE_RESET, FABLE_STOP, FILE1, HOUR, NOTE, NOW, OTHER_WEEK, PANE_PROPS, PLAIN, PLAIN_STOPS, SETTLE_WAIT, SLOT2, SLOT3, THREE_LOGINS, TWO_LOGINS, WEEK_RESET, answerNextLate, blob, browse, callsWith, carryEndedOf, clearSession, clearable, debugLines, fresh, isSwitchedToast, kept, limitsOf, loggedWorld, markStands, mountPane, owedWorld, painted, pastNextRead, queuedWorld, refresh, reloadedWorld, respond, resumeAnswers, sent, settleReal, slots, start, stopDuringSwitch, stopLogOf, turnStops, useNow, watchedView, whats, world } from './flow-harness'
import { mountBand } from './flow-harness'
import type { World } from './flow-harness'

/** The CONTINUE text, which the one owed and the Connect visit's line share: a text check cannot say which sent it (a reset's own line and a connected line differ). */
const CONTINUE_90 = /^Claude Code switched to another of your Claude accounts .* Continue where you left off\.$/

/**
 * Tags each submit as the kit takes it, before it can throw, `<time> on <login>[+visit]`, `+visit` while a visit is open.
 * Answers the tags and whether a submit is made to throw (the kit's `isSubmitThrown`, which the tag rides on).
 */
function tagSends90(w: World, clock: MockClock, view: () => View | undefined) {
  const sends: string[] = []
  let isThrown = false
  Object.defineProperty(w, 'isSubmitThrown', {
    configurable: true,
    get: () => {
      if (sends.length < w.submitted.length) {
        const v = view()
        sends.push(`${new Date(clock.now()).toISOString().slice(11, 19)} on ${v?.activeId}${v?.chromeConnecting === undefined ? '' : '+visit'}`)
      }
      return isThrown
    },
    set: (value: boolean) => {
      isThrown = value
    },
  })
  return { sends, isThrown: () => isThrown }
}

/** Nothing went while a Connect visit was open: the carry-on owed waits for it, and the visit's line is its own. */
const visitSends90 = (sends: string[]) => sends.filter(s => s.endsWith('+visit'))

const FREE_90 = 'a login is free: carry-on on'

/**
 * The path that sent each submit, read from the stop-log in order: every submit writes one `carry-on queued`. The
 * carry-on owed writes `a login is free` before it, at once or through `carry-on armed` (`owed`); a stop's own armed
 * carry-on writes `carry-on armed` alone (`stop`); an armed one held or skipped, and one owed that is turned away
 * (`carry-on not sent again: one is queued`), send nothing; one sent in place of
 * one turned away writes `carry-on sent in place of the one queued` (`resent`); the refresh nudge has its own text
 * (`nudge`). Connect's line writes no line of its own, so a submit with none of these before it is `visit`, but after
 * a nudge, where the carry-on after the nudge writes none either (`unknown`). The kit cannot read a submit's call site:
 * its hook's stack holds the kit's frames and the engine's alone.
 */
function sendersOf90(log: readonly string[], submitted: readonly string[]): string[] {
  const senders: string[] = []
  const armed: string[] = []
  let owed = 0
  let resent = 0
  let isNudged = false
  log.forEach((what, i) => {
    if (what.startsWith(FREE_90)) {
      if (log[i + 1] === 'carry-on armed') armed.push('owed')
      else if (log[i + 1] !== 'carry-on not sent again: one is queued') owed += 1
    } else if (what === 'carry-on armed') {
      if (!log[i - 1]?.startsWith(FREE_90)) armed.push('stop')
    } else if (what === 'carry-on skipped: another switch since' || (what === 'carry-on held: Claude in Chrome is connecting' && armed.length > 0)) {
      armed.shift()
    } else if (what === 'carry-on sent in place of the one queued') {
      resent += 1
    } else if (what === 'carry-on queued') {
      if (submitted[senders.length] === NUDGE_TEXT) {
        isNudged = true
        senders.push('nudge')
      } else if (resent > 0) {
        resent -= 1
        senders.push('resent')
      } else if (owed > 0) {
        owed -= 1
        senders.push('owed')
      } else {
        senders.push(armed.shift() ?? (isNudged ? 'unknown' : 'visit'))
      }
    }
  })
  return senders
}

/**
 * Every login spent and a carry-on owed at 12:00; a Connect visit held from `from` to `to`, to login 2 (or, `isThree`,
 * to login 3, so its move back lands on login 2, freed by then); its cut turn begins two minutes in and stops on the
 * limit. Then every submit is tagged `<time> on <login>[+visit]` as the 10 s loop meets it and its turn starts, but for
 * the first one after the visit with `refuse` (`thrown` or `dropped`), after which `isPersonTurn` begins a person's turn.
 * With `isFine` the loop steps 1 s from 12:00:30 to 12:01:10, so a send is tagged to the second.
 */
async function owedVisit90($: Engine, on: On, from: string, to: string, o: { refuse?: 'thrown' | 'dropped'; isPersonTurn?: boolean; isThree?: boolean; isFine?: boolean } = {}) {
  const w = fresh()
  w.chrome = { extensions: [''] }
  if (o.isThree === true) {
    w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
    w.usage['tok-3'] = [100, 30]
  }
  const { store, clock } = await loggedWorld(on, w, { ...(o.isThree === true ? THREE_LOGINS : {}), 'chrome-account': '1' })
  const { sends, isThrown } = tagSends90(w, clock, watchedView(on))
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(Date.parse(`2026-10-12T${from}Z`) - clock.now())
  let endVisit = () => {}
  const visit = new Promise<void>(resolve => {
    endVisit = resolve
  })
  w.beforeEnv = () => visit
  w.chrome.extensions.push(o.isThree === true ? SLOT3 : SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: o.isThree === true ? 'chrome-try-3' : 'chrome-try-2' })
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  await $.turn.start({ text: 'a turn the limit stops', turnId: '90-cut-turn' })
  void $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  const isCut = whats(stopLogOf(store, w)).includes('stayed: Claude in Chrome is connecting')
  await clock.advance(Date.parse(`2026-10-12T${to}Z`) - clock.now())
  w.isSubmitThrown = o.refuse === 'thrown'
  if (o.refuse === 'dropped') w.submitDrop = 'a Stop stands'
  endVisit()
  await settleReal(clock)
  let seen = 0
  while (clock.now() < Date.parse('2026-10-12T12:25:00Z')) {
    const isFineStep = o.isFine === true && clock.now() >= Date.parse('2026-10-12T12:00:30Z') && clock.now() < Date.parse('2026-10-12T12:01:10Z')
    await clock.advance(isFineStep ? 1_000 : 10_000)
    await clock.settle()
    while (seen < w.submitted.length) {
      seen += 1
      if (isThrown() || w.submitDrop !== undefined) {
        w.isSubmitThrown = false
        w.submitDrop = undefined
        if (o.isPersonTurn === true) await $.turn.start({ text: 'a prompt of the person', turnId: '90-person' })
        continue
      }
      await $.turn.start({ text: w.submitted[seen - 1] ?? '', turnId: `90-${seen}` })
      await clock.settle()
    }
  }
  await pane.unmount()
  const log = whats(stopLogOf(store, w))
  expect([isCut, visitSends90(sends)], 'the visit cut the stop, and nothing went while one was open').toEqual([true, []])
  // The tick logs `a login is free` once for the one owed. Every submit logs `carry-on queued`, so their count is the
  // count of submits; `carry-on sent in place of the one queued` logs a submit made in place of one turned away.
  const owed = log.filter(what => what.startsWith('a login is free: carry-on on')).length
  return {
    sends,
    submitted: [...w.submitted],
    log,
    owed,
    queued: log.filter(what => what === 'carry-on queued').length,
    isResent: log.includes('carry-on sent in place of the one queued'),
    isStoodDown: log.includes('carry-on not sent: the one owed went'),
    waits: log.filter(what => what === 'carry-on waits on the one owed').length,
  }
}

test('90-A: a carry-on owed and a stop a Connect visit cut carry on once, the one owed going first (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:00')
  expect(sendersOf90(r.log, r.submitted), 'the path of each submit: the one owed alone').toEqual(['owed'])
  expect([r.sends.length, r.owed, r.isStoodDown], 'one went, the one owed; the line stood down').toEqual([1, 1, true])
  expect(r.submitted, 'one submit, with the CONTINUE text').toEqual([expect.stringMatching(CONTINUE_90)])
})

test('90-B: a carry-on owed and a stop a Connect visit cut carry on once, the visit\'s line due first (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:30')
  expect(sendersOf90(r.log, r.submitted), 'the path of each submit: the one owed alone').toEqual(['owed'])
  expect([r.sends.length, r.waits, r.owed, r.isStoodDown], 'one went, the one owed; the line waited once, then stood down').toEqual([1, 1, 1, true])
  expect(r.submitted, 'one submit, with the CONTINUE text').toEqual([expect.stringMatching(CONTINUE_90)])
})

test('90-Y: a Connect visit\'s line waiting on the carry-on owed, which is dropped, looks again a minute after its last look, not sooner or later (puma-9arph.96)', { timeoutMs: 30_000 }, async ($, on) => {
  // The line looks 35 s after the visit ends, then each minute; the loop steps 1 s around the look, so no send is tagged
  // before the second of the look (12:00:49 reads none) and the line is tagged at it.
  const r = await owedVisit90($, on, '11:50:00', '11:55:40', { refuse: 'dropped', isFine: true })
  expect(r.sends.map(s => s.slice(0, 8)), 'the carry-on owed at 12:00:00, dropped; the line at the next minute look, 12:00:50, to the second').toEqual(['12:00:00', '12:00:50'])
})

test('90-C: a carry-on owed still goes once a login frees up after a Connect visit that ended with none free (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await owedVisit90($, on, '11:50:00', '11:55:00')
  expect([r.sends.filter(s => s >= '12:00').length, r.log.includes('a login is free: carry-on on 2')], 'the one owed went').toEqual([1, true])
})

test('90-D: a Connect visit that ended with no login free sends nothing on the spent login, and says it waits once (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await owedVisit90($, on, '11:50:00', '11:55:00')
  expect([r.sends.filter(s => s < '12:00'), r.waits]).toEqual([[], 1])
})

test('90-E: where the carry-on owed is dropped, the Connect visit\'s line goes after it (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:30', { refuse: 'dropped' })
  expect(sendersOf90(r.log, r.submitted), 'the path of each submit: the one owed, then the visit\'s line').toEqual(['owed', 'visit'])
  expect([r.sends.length, r.log.includes('carry-on drop'), r.owed, r.isStoodDown], 'the one owed, dropped, then the line').toEqual([2, true, 1, false])
  expect([r.queued, r.isResent], 'two carry-on queued log lines, and no carry-on sent in place of the one queued').toEqual([2, false])
})

test('90-F: where the carry-on owed is dropped and a person\'s turn begins, the Connect visit\'s line still goes (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:30', { refuse: 'dropped', isPersonTurn: true })
  expect(sendersOf90(r.log, r.submitted), 'the path of each submit: the one owed, then the visit\'s line').toEqual(['owed', 'visit'])
  expect([r.sends.length, r.owed, r.isStoodDown], 'the one owed, dropped, then the line').toEqual([2, 1, false])
  expect([r.queued, r.isResent], 'two carry-on queued log lines, and no carry-on sent in place of the one queued').toEqual([2, false])
})

test('90-G: where the carry-on owed is refused, the Connect visit\'s line goes after it (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:00', { refuse: 'thrown' })
  expect(sendersOf90(r.log, r.submitted), 'the path of each submit: the one owed, then the visit\'s line').toEqual(['owed', 'visit'])
  expect([r.sends.length, r.owed, r.isStoodDown], 'the one owed, refused, then the line').toEqual([2, 1, false])
  expect([r.queued, r.isResent], 'two carry-on queued log lines, and no carry-on sent in place of the one queued').toEqual([2, false])
})

test('90-H: a Connect visit whose move back lands on a login just freed carries on once, not with the one the tick armed too (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:00', { isThree: true })
  expect(sendersOf90(r.log, r.submitted), 'the path of each submit: the one owed, armed by the tick, alone').toEqual(['owed'])
  expect([r.log.includes('carry-on armed'), r.sends.length, r.owed, r.isStoodDown], 'one went, the one the tick armed; the line stood down').toEqual([true, 1, 1, true])
  expect(r.submitted, 'one submit, with the CONTINUE text').toEqual([expect.stringMatching(CONTINUE_90)])
})

/**
 * puma-9arph.90 (Codex round 1, LATE_REFUSAL): every login spent, a Connect visit to login 3 that a stop cuts ends at
 * `end`, before login 2 frees; the carry-on owed goes once it frees, its own turn starts, and only then does the engine
 * drop it. Answers how many submits went in all.
 */
async function lateDrop90($: Engine, on: On, end: string): Promise<number> {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [100, 30]
  const { clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const endAt = Date.parse(`2026-10-12T${end}Z`)
  await clock.advance(endAt - 5 * 60_000 - clock.now())
  let releaseVisit = () => {}
  const visit = new Promise<void>(resolve => {
    releaseVisit = resolve
  })
  w.beforeEnv = () => visit
  w.chrome.extensions.push(SLOT3)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-3' })
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  await $.turn.start({ text: 'a turn the limit stops', turnId: '90-late-cut' })
  void $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  await clock.advance(endAt - clock.now())
  w.beforeEnv = undefined
  releaseVisit()
  await settleReal(clock)
  await clock.advance(40_000)
  await settleReal(clock)
  // The base sent the visit's line by here: its turn starts.
  if (w.submitted.length > 0) await $.turn.start({ text: w.submitted[0] ?? '', turnId: '90-early-visit-line' })
  const dropLate = answerNextLate(w, 'drop')
  const before = w.submitted.length
  while (w.submitted.length === before && clock.now() < Date.parse('2026-10-12T12:04:00Z')) {
    await clock.advance(10_000)
    await clock.settle()
  }
  expect(w.submitted.length, 'the carry-on owed went once login 2 freed').toBe(before + 1)
  await $.turn.start({ text: w.submitted.at(-1) ?? '', turnId: '90-late-owed-line' })
  await clock.advance(2 * 60_000)
  await settleReal(clock)
  dropLate()
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  await settleReal(clock)
  await pane.unmount()
  return w.submitted.length
}

for (const end of ['11:55:00', '11:56:00']) {
  test(`90-${end === '11:55:00' ? 'I' : 'J'}: a carry-on owed dropped after its turn began, a Connect visit ending ${end} before, still leaves the visit's line to go (puma-9arph.90)`, { timeoutMs: 30_000 }, async ($, on) => {
    expect(await lateDrop90($, on, end), 'the one owed, dropped late, and the line').toBe(2)
  })
}

/** The view as last written, and a hold on the write that opens a Connect visit (one state.set handler per test). */
function views90(on: On) {
  let last: View | undefined
  let openHold: Promise<void> | undefined
  let opened = 0
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key !== 'view') return next(e)
    const isOpen = last?.chromeConnecting === undefined && value.chromeConnecting !== undefined
    last = value
    if (isOpen) {
      opened += 1
      const gate = openHold
      openHold = undefined
      if (gate !== undefined) await gate
    }
    return next(e)
  })
  return {
    view: () => last,
    opened: () => opened,
    holdOpen: () => {
      let release = () => {}
      openHold = new Promise<void>(resolve => {
        release = resolve
      })
      return release
    },
  }
}

async function steps90(clock: MockClock, ms: number, step = 10_000): Promise<void> {
  const until = clock.now() + ms
  while (clock.now() < until) {
    await clock.advance(step)
    await clock.settle()
  }
}

/** Each submit's turn starts as the 10 s loop meets it, for `ms`. */
async function turnsFor90($: Engine, clock: MockClock, w: World, ms: number): Promise<void> {
  let started = w.submitted.length
  const until = clock.now() + ms
  while (clock.now() < until) {
    await clock.advance(10_000)
    await clock.settle()
    if (w.submitted.length > started) {
      started = w.submitted.length
      await $.turn.start({ text: w.submitted.at(-1) ?? '', turnId: `90-turn-${started}` })
      await clock.settle()
    }
  }
}

/**
 * owedVisit90's first half: every login spent and a carry-on owed at 12:00, a Connect visit to login 2 held open from
 * 11:58 and cut by a stop two minutes in. Answers the pane, what ends the visit, and whether the visit cut the stop.
 */
async function owedVisitStart90($: Engine, w: World, store: Map<string, unknown>, clock: MockClock) {
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(Date.parse('2026-10-12T11:58:00Z') - clock.now())
  let endVisit = () => {}
  const visit = new Promise<void>(resolve => {
    endVisit = resolve
  })
  w.beforeEnv = () => visit
  w.chrome?.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  await $.turn.start({ text: 'a turn the limit stops', turnId: '90-start-cut' })
  void $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  const isCut = whats(stopLogOf(store, w)).includes('stayed: Claude in Chrome is connecting')
  await clock.advance(Date.parse('2026-10-12T12:06:30Z') - clock.now())
  w.beforeEnv = undefined
  return { pane, endVisit, isCut }
}

test('90-K: a person\'s turn begun after the tick cleared the carry-on owed and before its submit: the Connect visit\'s line goes, and the one owed is turned away behind it as one is queued (puma-9arph.90, puma-9arph.111)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const { sends } = tagSends90(w, clock, views90(on).view)
  // Holds carryOnWhenFree's read after its clear: the first view read without the debt after one that held it.
  let sawDue = false
  let isArmed = false
  let isHeld = false
  let release = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  on('state.get', async (_$, e, next) => {
    const read = await next(e)
    if (e.plugin !== 'account-rotator' || e.key !== 'view') return read
    const v = read.value?.value as View | undefined
    if (v === undefined) return read
    if (v.carryDue !== undefined) sawDue = true
    else if (isArmed && sawDue && !isHeld) {
      isHeld = true
      await gate
    }
    return read
  })
  const { pane, endVisit, isCut } = await owedVisitStart90($, w, store, clock)
  isArmed = true
  endVisit()
  await settleReal(clock)
  while (!isHeld && clock.now() < Date.parse('2026-10-12T12:10:00Z')) await steps90(clock, 5_000, 5_000)
  await $.turn.start({ text: 'a prompt of the person', turnId: '90-K-person' })
  // The line looks while the read is held: the clear left nothing owed, so it goes.
  await steps90(clock, 70_000)
  // A drop for a submit of the one owed: none is made, so none is dropped.
  w.submitDrop = 'a Stop stands'
  const before = w.submitted.length
  release()
  await settleReal(clock)
  // Released, the tick logs its free line, and the one owed is turned away: the line's submit is queued.
  await steps90(clock, 40_000)
  const dropped = w.submitted.length - before
  w.submitDrop = undefined
  await steps90(clock, 60_000)
  await pane.unmount()
  const log = whats(stopLogOf(store, w))
  expect(sendersOf90(log, w.submitted), 'the path of each submit: the visit\'s line alone').toEqual(['visit'])
  expect([dropped, log.includes('carry-on not sent again: one is queued')], 'nothing dropped; the one owed turned away as one is queued').toEqual([0, true])
  expect([isCut, isHeld, visitSends90(sends)], 'the visit cut the stop; the read after the clear was held; nothing went while a visit was open').toEqual([true, true, []])
  expect(w.submitted.length - dropped, 'carry-ons that went and were not dropped').toBe(1)
  expect(w.submitted.at(-1), 'the last submit has the CONTINUE text').toMatch(CONTINUE_90)
})

test('90-L: a later Connect visit open as the line looks again, after the carry-on owed went and its turn began, sends no second line (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const views = views90(on)
  const { sends } = tagSends90(w, clock, views.view)
  const { pane, endVisit, isCut } = await owedVisitStart90($, w, store, clock)
  endVisit()
  await settleReal(clock)
  while (w.submitted.length === 0 && clock.now() < Date.parse('2026-10-12T12:10:00Z')) await steps90(clock, 1_000, 1_000)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: '90-L-owed' })
  await clock.settle()
  // A later visit: the reconnect a browser tool starts where Claude in Chrome answers as no browser's account (91-C), with
  // no browser answering at all, so it ends unconnected and cut nothing; its opening write held past the line's look.
  const before = views.opened()
  const releaseOpen = views.holdOpen()
  if (w.chrome !== undefined) {
    w.chrome.as = 'a slot no browser answers as'
    w.chrome.extensions = []
  }
  const browsing = browse($, 'navigate', { url: 'https://example.com' })
  await settleReal(clock)
  const isOpen = views.opened() > before
  await steps90(clock, 2 * 60_000)
  releaseOpen()
  await settleReal(clock)
  await turnsFor90($, clock, w, 4 * 60_000)
  await pane.unmount()
  await browsing
  const log = whats(stopLogOf(store, w))
  expect(sendersOf90(log, w.submitted), 'the path of each submit: the one owed alone').toEqual(['owed'])
  expect([isCut, isOpen, visitSends90(sends)], 'the first visit cut the stop; a second visit opened after the owed one went; nothing went while a visit was open').toEqual([true, true, []])
  // The line stood down for the one owed, not held for the second visit, which would send it once that visit ended.
  expect([log.includes('carry-on held: Claude in Chrome is connecting'), log.includes('carry-on not sent: the one owed went')], 'the line stood down; it was not held for the visit').toEqual([false, true])
  expect(w.submitted, 'one submit in all, with the CONTINUE text').toEqual([expect.stringMatching(CONTINUE_90)])
})

test('90-M: after a carry-on submit that throws, a later Connect visit with a carry-on owed stands its line down once that one went (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [100, 30]
  w.fiveHourResets = { 'tok-2': '2026-10-12T12:30:00Z', 'tok-3': '2026-10-12T12:30:00Z' }
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  const { sends } = tagSends90(w, clock, views90(on).view)
  await start($, clock)
  // A stop on login 1 moves to login 2 and arms its carry-on, whose submit throws: answered, as sendCarryOn's catch counts.
  w.isSubmitThrown = true
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  await steps90(clock, 60_000)
  w.isSubmitThrown = false
  const thrown = w.submitted.length
  // Login 2 spent too, its window resetting after login 1's: a stop there owes a carry-on for 12:00 on login 1.
  w.usage['tok-2'] = [100, 30]
  await $.turn.start({ text: 'a turn on login 2', turnId: '90-M-on-2' })
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  await clock.advance(Date.parse('2026-10-12T11:58:00Z') - clock.now())
  let endVisit = () => {}
  const visit = new Promise<void>(resolve => {
    endVisit = resolve
  })
  w.beforeEnv = () => visit
  w.chrome.extensions.push(SLOT3)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-3' })
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  await $.turn.start({ text: 'a turn the limit stops', turnId: '90-M-cut' })
  void $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  const isCut = whats(stopLogOf(store, w)).includes('stayed: Claude in Chrome is connecting')
  await clock.advance(Date.parse('2026-10-12T12:06:00Z') - clock.now())
  w.beforeEnv = undefined
  endVisit()
  await settleReal(clock)
  await turnsFor90($, clock, w, 6 * 60_000)
  await pane.unmount()
  const log = whats(stopLogOf(store, w))
  expect(sendersOf90(log, w.submitted), 'the path of each submit: the first stop\'s own carry-on, thrown, then the one owed').toEqual(['stop', 'owed'])
  expect([thrown, isCut], 'one submit threw; the visit cut the stop').toEqual([1, true])
  expect([w.submitted.length - thrown, log.includes('carry-on not sent: the one owed went'), visitSends90(sends)], 'one went after the throw, the one owed; the line stood down; nothing went while a visit was open').toEqual([1, true, []])
  expect(w.submitted.slice(thrown), 'one submit, with the CONTINUE text').toEqual([expect.stringMatching(CONTINUE_90)])
})

test('90-N: a person\'s turn after a Connect visit, the carry-on owed unanswered as the line looks, its own turn begun, then dropped: the line still goes (puma-9arph.90)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const { sends } = tagSends90(w, clock, views90(on).view)
  const { pane, endVisit, isCut } = await owedVisitStart90($, w, store, clock)
  endVisit()
  await settleReal(clock)
  // Once the visit's end is read and the line has looked once, a person's turn begins.
  await steps90(clock, 40_000)
  await $.turn.start({ text: 'a prompt of the person', turnId: '90-N-person' })
  await clock.settle()
  // The carry-on owed goes, its answer held; the line looks at least once while it is out.
  const dropLate = answerNextLate(w, 'drop')
  while (w.submitted.length === 0 && clock.now() < Date.parse('2026-10-12T12:10:00Z')) await steps90(clock, 1_000, 1_000)
  const owed = w.submitted.length
  await steps90(clock, 2 * 60_000)
  // Its own turn begins, then the engine drops it.
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: '90-N-owed' })
  await clock.settle()
  dropLate()
  await settleReal(clock)
  await turnsFor90($, clock, w, 4 * 60_000)
  await pane.unmount()
  expect(sendersOf90(whats(stopLogOf(store, w)), w.submitted), 'the path of each submit: the one owed, dropped late, then the visit\'s line').toEqual(['owed', 'visit'])
  expect([isCut, owed, visitSends90(sends)], 'the visit cut the stop; the carry-on owed went once before the drop; nothing went while a visit was open').toEqual([true, 1, []])
  expect(w.submitted, 'two submits, in this order, each with the CONTINUE text').toEqual([expect.stringMatching(CONTINUE_90), expect.stringMatching(CONTINUE_90)])
})

const at95 = (hms: string) => Date.parse(`2026-10-12T${hms}Z`)

/**
 * puma-9arph.95: a Connect visit to login 2 from 10:04, cut by a stop at 10:06, ending at 10:09; `beforeEnd` runs just
 * before its end. Answers the pane and whether the visit cut the stop.
 */
async function cutVisit95($: Engine, w: World, store: Map<string, unknown>, clock: MockClock, beforeEnd = async () => {}) {
  await clock.advance(at95('10:04:00') - clock.now())
  let endVisit = () => {}
  const visit = new Promise<void>(resolve => {
    endVisit = resolve
  })
  w.beforeEnv = () => visit
  w.chrome?.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  await $.turn.start({ text: 'a turn the limit stops', turnId: '95-cut-turn' })
  void $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  await $.turn.complete({ turnId: '95-cut-turn', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  const isCut = whats(stopLogOf(store, w)).includes('stayed: Claude in Chrome is connecting')
  await clock.advance(at95('10:09:00') - clock.now())
  await beforeEnd()
  w.beforeEnv = undefined
  endVisit()
  await settleReal(clock)
  return { pane, isCut }
}

/**
 * puma-9arph.95: the refresh nudge goes on login 1 while the first stop's switch is held; its turn ends with no answer,
 * the token refreshes and the held switch lands. Answers the hold on that switch's carry-on, set before it goes.
 */
async function nudgeFirst95($: Engine, w: World, clock: MockClock) {
  while (!w.submitted.includes(NUDGE_TEXT) && clock.now() < at95('10:02:00')) {
    await clock.advance(10_000)
    await clock.settle()
  }
  await $.turn.start({ text: NUDGE_TEXT, turnId: '95-nudge' })
  await $.turn.complete({ turnId: '95-nudge', reason: 'aborted', answer: '', durationMs: 1, isAborted: true })
  await clock.settle()
  const answerOld = answerNextLate(w, 'resolve')
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 8 * HOUR)
  await steps90(clock, 60_000)
  return answerOld
}

/**
 * puma-9arph.95 F1: every login's 5-hour window resets at 10:20. A stop on login 1 moves to login 3, and that carry-on's
 * submit never answers (its turn never starts). A stop on login 3 owes one carry-on at 10:20. The visit (cutVisit95)
 * ends with it owed, and a person's turn begins at 10:12. `press`: Use now on login 1 at 10:15 ends the debt with no
 * carry-on. `zero`: the debt's own submit at 10:20 stays queued, the old submit answers, then the engine drops the
 * queued one. `turned`: as `zero`, and the queued one's own turn starts after the line has looked, before the drop.
 * `quiet`: as `zero` with no person's turn, and the old submit answers before the line's first look after the debt's
 * own submit goes. `never`: no person's turn, and the old submit never answers; the debt's own submit goes at 10:20 and is
 * answered clean, its turn never started. `dropped`: as `zero`, and the old submit never answers. `isNudgedFirst`: the first
 * stop's switch is held and the refresh nudge goes first (nudgeFirst95). Answers the carry-ons after the visit's end that
 * were not dropped, and the stop-log.
 */
async function oldSubmitVisit95($: Engine, on: On, ending: 'press' | 'zero' | 'turned' | 'quiet' | 'never' | 'dropped', isNudgedFirst = false) {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.fiveHourResets = { 'tok-1': '2026-10-12T10:20:00Z', 'tok-2': '2026-10-12T10:20:00Z', 'tok-3': '2026-10-12T10:20:00Z' }
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  if (isNudgedFirst) {
    // Login 1's token refreshes at 10:05, so the guard holds the first stop's switch; the nudge's look needs a pane.
    w.keychain['Claude Code-credentials'] = blob('tok-1', at95('10:05:00'))
    w.env.ORCA_TERMINAL_HANDLE = 'term_test-pane'
    on('process.spawn', async function* (_$, e) {
      w.spawned.push(e)
      yield* []
      return { value: { code: 0, signal: null } }
    })
  }
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  let answerOld = isNudgedFirst ? () => {} : answerNextLate(w, 'resolve')
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  if (isNudgedFirst) answerOld = await nudgeFirst95($, w, clock)
  await steps90(clock, 60_000)
  const old = w.submitted.length
  // The person's turn on login 3 takes that one out of flight; it stops too, and no login is left.
  w.usage['tok-3'] = [100, 30]
  await $.turn.start({ text: 'a turn on login 3', turnId: '95-on-3' })
  await $.classic.StopFailure(PLAIN)
  await $.turn.complete({ turnId: '95-on-3', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await settleReal(clock)
  const { pane, isCut } = await cutVisit95($, w, store, clock)
  const atEnd = w.submitted.length
  await steps90(clock, 3 * 60_000, 60_000)
  if (ending !== 'quiet' && ending !== 'never') {
    await $.turn.start({ text: 'a prompt of the person', turnId: '95-person' })
    await clock.settle()
  }
  const isQueuedOwed = ending !== 'press' && ending !== 'never'
  const dropOwed = isQueuedOwed ? answerNextLate(w, 'drop') : () => {}
  const oldLook = ending === 'quiet' ? 1 : ending === 'dropped' ? Infinity : 3
  const owedAt = w.submitted.length + 1
  let isPressed = false
  let looks = 0
  let started = w.submitted.length
  while (clock.now() < at95(isQueuedOwed ? '10:24:00' : ending === 'never' ? '10:23:00' : '10:21:00')) {
    await clock.advance(clock.now() < at95('10:19:00') ? 60_000 : 10_000)
    await clock.settle()
    if (ending === 'press' && !isPressed && clock.now() >= at95('10:15:00')) {
      isPressed = true
      await pane.redraw()
      void pane.press({ key: 'use-1' })
      await settleReal(clock)
    }
    if (isQueuedOwed && w.submitted.length >= owedAt) {
      looks += 1
      if (looks === oldLook || looks === 15) {
        if (looks === oldLook) answerOld()
        else dropOwed()
        await settleReal(clock)
      }
      // After the line's look at 10:21:10: the queued one's own turn starts.
      if (looks === 10 && ending === 'turned') {
        await $.turn.start({ text: w.submitted[owedAt - 1] ?? '', turnId: '95-owed' })
        await clock.settle()
      }
    }
    while (started < w.submitted.length) {
      started += 1
      // The debt's own submit stays queued (`zero`), starts its turn above (`turned`) or never starts it (`never`).
      if ((isQueuedOwed || ending === 'never') && started === owedAt) continue
      await $.turn.start({ text: w.submitted[started - 1] ?? '', turnId: `95-${started}` })
      await clock.settle()
    }
  }
  await pane.unmount()
  const dropped = isQueuedOwed && looks >= 15 ? 1 : 0
  return { old, isCut, notDropped: w.submitted.length - atEnd - dropped, log: whats(stopLogOf(store, w)) }
}

test('90-Y3: a submit that never answers, a person\'s turn, then the carry-on owed dropped: the line still goes, not held on the one that never answers (puma-9arph.96)', async ($, on) => {
  const r = await oldSubmitVisit95($, on, 'dropped')
  expect([r.old, r.isCut], 'one submit never answers; the visit cut the stop').toEqual([1, true])
  expect(r.notDropped, 'carry-ons after the visit ended that were not dropped').toBe(1)
})

test('90-Y2: a submit that never answers, then a Connect visit with a carry-on owed that goes and is answered clean: the line does not stand down on it (puma-9arph.96)', async ($, on) => {
  const r = await oldSubmitVisit95($, on, 'never')
  expect([r.old, r.isCut], 'one submit never answers; the visit cut the stop').toEqual([1, true])
  expect([r.log.includes('carry-on not sent: the one owed went'), r.log.includes('carry-on not sent again: one is queued')], 'the line looked with a submit unanswered: it did not stand down, it went and was turned away').toEqual([false, true])
})

test('90-O: a submit that never answers, then a Connect visit with a carry-on owed, a person\'s turn and a press that ends the debt: the line still goes (puma-9arph.95)', async ($, on) => {
  const r = await oldSubmitVisit95($, on, 'press')
  expect([r.old, r.isCut], 'one submit never answers; the visit cut the stop').toEqual([1, true])
  expect(r.notDropped, 'carry-ons after the visit ended').toBe(1)
})

test('90-P: a submit out at a Connect visit\'s end answers while the carry-on owed is queued, which then drops: the line still goes (puma-9arph.95)', async ($, on) => {
  const r = await oldSubmitVisit95($, on, 'zero')
  expect([r.old, r.isCut], 'one submit out at the visit end; the visit cut the stop').toEqual([1, true])
  expect(r.notDropped, 'carry-ons after the visit ended that were not dropped').toBe(1)
})

test('90-R: a submit out at a Connect visit\'s end answers while the carry-on owed is queued, whose own turn starts and then drops: the line still goes (puma-9arph.95)', async ($, on) => {
  const r = await oldSubmitVisit95($, on, 'turned')
  expect([r.old, r.isCut], 'one submit out at the visit end; the visit cut the stop').toEqual([1, true])
  expect(r.notDropped, 'carry-ons after the visit ended that were not dropped').toBe(1)
})

test('90-S: a submit out at a Connect visit\'s end answers after the carry-on owed goes, with no main turn since, and the queued one drops: the line still goes (puma-9arph.95)', async ($, on) => {
  const r = await oldSubmitVisit95($, on, 'quiet')
  expect([r.old, r.isCut], 'one submit out at the visit end; the visit cut the stop').toEqual([1, true])
  expect(r.notDropped, 'carry-ons after the visit ended that were not dropped').toBe(1)
})

test('90-T: a refresh nudge earlier in the session, then 90-R\'s world: the line still goes (puma-9arph.95)', async ($, on) => {
  const r = await oldSubmitVisit95($, on, 'turned', true)
  expect([r.old, r.isCut], 'the nudge and one submit out at the visit end; the visit cut the stop').toEqual([2, true])
  expect(r.notDropped, 'carry-ons after the visit ended that were not dropped').toBe(1)
})

test('90-Q: a refresh nudge after a Connect visit, its held switch dropped, the debt ended by a press: one carry-on of the work still goes (puma-9arph.95)', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.fiveHourResets = { 'tok-1': '2026-10-12T10:12:00Z', 'tok-2': '2026-10-12T10:20:00Z', 'tok-3': '2026-10-12T10:20:00Z' }
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  // The owed-resume look, under whose lock the nudge goes, runs only with an Orca pane for its Escape.
  w.env.ORCA_TERMINAL_HANDLE = 'term_test-pane'
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield* []
    return { value: { code: 0, signal: null } }
  })
  const view = watchedView(on)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  // A stop on login 1 moves to login 3 and carries on; that turn stops on login 3 too: one carry-on owed at 10:12.
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  await steps90(clock, 60_000)
  w.usage['tok-3'] = [100, 30]
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: '95-Q-carry' })
  await $.classic.StopFailure(PLAIN)
  await $.turn.complete({ turnId: '95-Q-carry', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await settleReal(clock)
  // The session stays on login 2 after the visit; its token expires at 10:16, so the guard holds a switch from it.
  const { pane, isCut } = await cutVisit95($, w, store, clock, async () => {
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2', at95('10:16:00'))
  })
  const atEnd = w.submitted.length
  let phase = 'visit ended'
  let started = w.submitted.length
  while (clock.now() < at95('10:19:00')) {
    await clock.advance(10_000)
    await clock.settle()
    // Login 1 frees at 10:12: a stop at 10:13 finds it, and the refresh guard holds that switch.
    if (phase === 'visit ended' && clock.now() >= at95('10:13:00')) {
      phase = 'stopped'
      await $.classic.StopFailure(PLAIN)
      await settleReal(clock)
    }
    while (started < w.submitted.length) {
      started += 1
      const text = w.submitted[started - 1] ?? ''
      await $.turn.start({ text, turnId: `95-Q-${started}` })
      // The nudge's turn ends with no answer (the person stops it): an answer would drop the hold and carry on.
      if (text === NUDGE_TEXT) await $.turn.complete({ turnId: `95-Q-${started}`, reason: 'aborted', answer: '', durationMs: 1, isAborted: true })
      await clock.settle()
      if (text === NUDGE_TEXT && phase === 'stopped') {
        phase = 'nudged'
        await pane.redraw()
        await pane.press({ key: 'rotate-to-off' })
        await settleReal(clock)
      }
    }
    // Rotation off: the minute's retry drops the held switch. The token refreshed, a press on login 1 ends the debt.
    if (phase === 'nudged' && view()?.held === undefined) {
      phase = 'dropped'
      w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW + 8 * HOUR)
    }
    if (phase === 'dropped' && clock.now() >= at95('10:17:00')) {
      phase = 'pressed'
      await pane.redraw()
      void pane.press({ key: 'use-1' })
      await settleReal(clock)
    }
  }
  await pane.unmount()
  const after = w.submitted.slice(atEnd)
  expect(after.filter(text => text !== NUDGE_TEXT), 'carry-ons of the work after the visit ended').toHaveLength(1)
  expect([isCut, after.includes(NUDGE_TEXT), phase], 'the visit cut the stop; the nudge went; the debt ended by the press').toEqual([true, true, 'pressed'])
})

/**
 * puma-9arph.100 K1: every login's 5-hour window resets at 10:20. A stop on login 1 moves to login 3, whose carry-on's
 * turn stops there too: one carry-on owed at 10:20. The visit (cutVisit95) ends with it owed; a person's turn at 10:12.
 * At 10:20 the tick sends the debt's own carry-on S1, held. A person's turn takes S1 out of flight and stops on login 2,
 * whose token runs out in 5 minutes, so the refresh guard holds the switch. The refresh nudge goes, then S1 answers as
 * `s1End` says (the kit reads the drop after the hold, so it is set only while S1 answers). The nudge's turn is
 * aborted and rotation off drops the held switch. Answers the guards and the carry-ons of the work after the visit's
 * end that went through: the nudge, and S1 unless answered clean, left out.
 */
async function nudgedDebt100($: Engine, on: On, s1End: 'drop' | 'clean' | 'reject') {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.fiveHourResets = { 'tok-1': '2026-10-12T10:20:00Z', 'tok-2': '2026-10-12T10:20:00Z', 'tok-3': '2026-10-12T10:20:00Z' }
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  // The owed-resume look, under whose lock the nudge goes, runs only with an Orca pane for its Escape.
  w.env.ORCA_TERMINAL_HANDLE = 'term_test-pane'
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield* []
    return { value: { code: 0, signal: null } }
  })
  const view = watchedView(on)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  await steps90(clock, 60_000)
  w.usage['tok-3'] = [100, 30]
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: '100-carry' })
  await $.classic.StopFailure(PLAIN)
  await $.turn.complete({ turnId: '100-carry', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await settleReal(clock)
  const { pane, isCut } = await cutVisit95($, w, store, clock)
  const atEnd = w.submitted.length
  await steps90(clock, 3 * 60_000, 60_000)
  // A main turn since the visit's end: the line then waits while a carry-on of the work waits on its answer.
  await $.turn.start({ text: 'a prompt of the person', turnId: '100-person-1' })
  await $.turn.complete({ turnId: '100-person-1', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.settle()
  const s1 = w.submitted.length + 1
  let isDropping = false
  let endS1 = () => {}
  const heldS1 = new Promise<void>((resolve, reject) => {
    endS1 = s1End === 'reject' ? () => reject(new Error('submission refused')) : resolve
  })
  heldS1.catch(() => undefined)
  Object.defineProperty(w, 'submitHold', { configurable: true, get: () => (w.submitted.length === s1 ? heldS1 : undefined) })
  Object.defineProperty(w, 'submitDrop', { configurable: true, get: () => (isDropping ? 'a Stop stands' : undefined) })
  let phase = 'owed'
  let started = w.submitted.length
  let isS1Answered = false
  while (clock.now() < at95('10:32:00')) {
    await clock.advance(10_000)
    await clock.settle()
    if (phase === 'owed' && w.submitted.length >= s1) {
      phase = 'S1 sent'
      started = Math.max(started, s1)
      w.usage['tok-2'] = [100, 30]
      w.fiveHourResets = { ...w.fiveHourResets, 'tok-2': '2026-10-12T15:20:00Z' }
      w.keychain[await keychainItem(SLOT2)] = blob('tok-2', clock.now() + 5 * 60_000)
      await $.turn.start({ text: 'a second prompt of the person', turnId: '100-person-2' })
      await $.classic.StopFailure(PLAIN)
      await $.turn.complete({ turnId: '100-person-2', reason: 'error', answer: '', durationMs: 1, isAborted: false })
      await settleReal(clock)
    }
    while (started < w.submitted.length) {
      started += 1
      if (started === s1) continue
      const text = w.submitted[started - 1] ?? ''
      if (text === NUDGE_TEXT && phase === 'S1 sent') {
        phase = 'nudged'
        isDropping = s1End === 'drop'
        endS1()
        isS1Answered = true
        await settleReal(clock)
        isDropping = false
      }
      await $.turn.start({ text, turnId: `100-${started}` })
      if (text === NUDGE_TEXT) await $.turn.complete({ turnId: `100-${started}`, reason: 'aborted', answer: '', durationMs: 1, isAborted: true })
      else await $.turn.complete({ turnId: `100-${started}`, reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
      await clock.settle()
      if (text === NUDGE_TEXT && phase === 'nudged') {
        phase = 'rotation off'
        await pane.redraw()
        await pane.press({ key: 'rotate-to-off' })
        await settleReal(clock)
      }
    }
    if (phase === 'rotation off' && view()?.held === undefined) {
      phase = 'hold dropped'
      w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW + 8 * HOUR)
    }
  }
  await pane.unmount()
  const nudgeAt = w.submitted.indexOf(NUDGE_TEXT, atEnd) + 1
  const carried = w.submitted.filter((text, i) => i >= atEnd && text !== NUDGE_TEXT && (s1End === 'clean' || i + 1 !== s1)).length
  return { isCut, isNudgeAfterS1: nudgeAt > s1, isS1Answered, phase, log: whats(stopLogOf(store, w)), carried, refused: debugLines(w, 'carry-on once a login is free failed') }
}

test('90-U: the carry-on owed after a Connect visit, dropped once a later refresh nudge went: the line still goes (puma-9arph.100)', async ($, on) => {
  const r = await nudgedDebt100($, on, 'drop')
  expect([r.isCut, r.isNudgeAfterS1, r.isS1Answered, r.log.includes('carry-on drop'), r.phase], 'the visit cut the stop; the nudge after the owed one, which dropped; the hold dropped').toEqual([true, true, true, true, 'hold dropped'])
  expect(r.carried, 'carry-ons of the work after the visit ended that went through').toBe(1)
  // puma-9arph.105: the stop-log shows the visit ended with a carry-on owed, then what the backup line did.
  const owed = r.log.findIndex(what => what.startsWith('visit ended with a carry-on owed'))
  expect(r.log.filter(what => what.startsWith('visit ended with a carry-on owed')), 'one line, with the counters at the visit end').toEqual([
    'visit ended with a carry-on owed: 2 turns, 1 submits, 0 nudges, 0 refusals',
  ])
  expect(owed, 'the visit line stands before the backup line waits').toBeLessThan(r.log.indexOf('carry-on waits on the one owed'))
  expect(r.log.lastIndexOf('carry-on queued'), 'the backup line went after the owed one dropped').toBeGreaterThan(r.log.indexOf('carry-on drop'))
})

test('90-V: the carry-on owed after a Connect visit, answered once a later refresh nudge went: no second line (puma-9arph.100)', async ($, on) => {
  const r = await nudgedDebt100($, on, 'clean')
  expect([r.isCut, r.isNudgeAfterS1, r.isS1Answered, r.log.includes('carry-on drop'), r.phase], 'the visit cut the stop; the nudge after the owed one, which answered; the hold dropped').toEqual([true, true, true, false, 'hold dropped'])
  expect(r.carried, 'carry-ons of the work after the visit ended that went through').toBe(1)
})

test('90-X: the carry-on owed after a Connect visit, refused once a later refresh nudge went: the line still goes (puma-9arph.100)', async ($, on) => {
  const r = await nudgedDebt100($, on, 'reject')
  expect([r.isCut, r.isNudgeAfterS1, r.refused.length, r.log.includes('carry-on drop'), r.phase], 'the visit cut the stop; the nudge after the owed one, which was refused (the catch path says so once); the hold dropped').toEqual([true, true, 1, false, 'hold dropped'])
  expect(r.carried, 'carry-ons of the work after the visit ended that went through').toBe(1)
})

test('90-U2: a Connect visit that pairs for a browser call it held, with a carry-on owed at its end, logs the visit too (puma-9arph.105)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const { pane, endVisit, isCut } = await owedVisitStart90($, w, store, clock)
  // A browser tool call while the visit runs is held, and waits on the visit: it connects as the visit's account.
  const browsing = browse($, 'navigate', { url: 'https://example.com' })
  await settleReal(clock)
  endVisit()
  await settleReal(clock)
  await turnsFor90($, clock, w, 4 * 60_000)
  await pane.unmount()
  await browsing
  const log = whats(stopLogOf(store, w))
  expect(isCut, 'the visit cut the stop').toBe(true)
  expect(w.submitted.some(text => text.startsWith('Claude in Chrome is connected')), 'the visit paired and sent its connected line').toBe(true)
  // The connected line is never held for the carry-on owed: it goes first, with no wait, and the one owed goes once after it.
  expect(w.submitted, 'the connected line, then the carry-on owed once').toEqual([expect.stringMatching(/^Claude in Chrome is connected as /), expect.stringMatching(CONTINUE_90)])
  expect([log.includes('carry-on waits on the one owed'), log.filter(what => what.startsWith('a login is free: carry-on on')).length], 'the connected line did not wait; the owed one went once').toEqual([false, 1])
  expect(log.filter(what => what.startsWith('visit ended with a carry-on owed')), 'one line, though the visit connected, and it says so').toEqual([
    expect.stringMatching(/^visit ended with a carry-on owed, connected: \d+ turns, \d+ submits, \d+ nudges, \d+ refusals$/),
  ])
})

test('90-U3: a connect the refresh guard ends before a visit opens, with a carry-on owed, logs no visit (puma-9arph.105)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const owed = whats(stopLogOf(store, w)).some(what => what.startsWith('no login left'))
  // The login in use refreshes its token in 5 minutes: the guard holds a connect to another account.
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 5 * 60_000)
  w.chrome.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(clock)
  await steps90(clock, 2 * 60_000)
  await pane.unmount()
  const log = whats(stopLogOf(store, w))
  expect(owed, 'a carry-on is owed').toBe(true)
  expect(log.some(what => what.includes('Claude in Chrome visit')), 'no visit opened').toBe(false)
  expect(log.filter(what => what.startsWith('visit ended with a carry-on owed')), 'no line for a visit that never opened').toEqual([])
})

// puma-9arph.110 A1: a guarded connect waits on the read of the login in use's token. A stop whose words name the other
// login's reset points the session there while it waits: a move the visit did not make, with a carry-on already owed.
async function guardedConnectWithStop110($: Engine, on: On) {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [100, 30, 100]
  w.fableResetsBy = { 'tok-1': FABLE_RESET, 'tok-2': FABLE_RESET_2 }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'chrome-account': '1' }))
  const clock = world(on, w, store)
  await start($, clock)
  // Every login is spent: the first stop owes a carry-on.
  w.usage['tok-1'] = [100, 41, 100]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  // The login in use refreshes its token in 5 minutes: the guard holds a connect to another account.
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 5 * 60_000)
  w.chrome.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  let reads = 0
  w.beforeKeychain = () => (reads++ === 0 ? gate : Promise.resolve())
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(clock)
  void $.classic.StopFailure(STOP_NAMING_2)
  await settleReal(clock)
  const staged = whats(stopLogOf(store, w))
  open()
  await settleReal(clock)
  await steps90(clock, 2 * 60_000)
  await pane.unmount()
  return { staged, log: whats(stopLogOf(store, w)) }
}

test('90-U4: a move the visit did not make lands while a guarded connect waits on its read, with a carry-on owed, and logs no visit (puma-9arph.110)', { timeoutMs: 30_000 }, async ($, on) => {
  const { staged, log } = await guardedConnectWithStop110($, on)
  expect(staged.some(what => what.startsWith('moved to 2 (by a point-back')), 'a stop pointed the session back while the connect waited').toBe(true)
  expect(staged.some(what => what.startsWith('no login left')), 'a carry-on is owed').toBe(true)
  expect(staged.at(-1), 'the stop met the connect under way').toBe('stayed: Claude in Chrome is connecting')
  expect(log.some(what => what.includes('Claude in Chrome visit')), 'no visit opened').toBe(false)
  expect(log.filter(what => what.startsWith('visit ended with a carry-on owed')), 'no line for a visit that never opened').toEqual([])
})

test('90-U6: a Connect visit whose forward move landed and which then throws, with a carry-on owed, still logs its line once (puma-9arph.110)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  // The view's note of what Chrome answered as login 2 is refused once: the visit throws after it moved.
  let isNoted = false
  let isRefused = false
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view' && value.chrome?.as === '2' && !isNoted) {
      isNoted = true
      isRefused = true
      return { deny: 'state: refused' } as unknown as Awaited<ReturnType<typeof next>>
    }
    return next(e)
  })
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const owed = whats(stopLogOf(store, w)).some(what => what.startsWith('no login left'))
  w.chrome.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(clock)
  await steps90(clock, 2 * 60_000)
  await pane.unmount()
  const log = whats(stopLogOf(store, w))
  expect(owed, 'a carry-on is owed').toBe(true)
  expect(isRefused, 'the visit threw').toBe(true)
  expect(log.filter(what => what.startsWith('moved to 2 (by a Claude in Chrome visit')), 'the visit moved forward').toHaveLength(1)
  expect(log.filter(what => what.startsWith('visit ended with a carry-on owed')), 'one line for the visit that threw').toEqual([expect.stringMatching(/^visit ended with a carry-on owed: \d+ turns, \d+ submits, \d+ nudges, \d+ refusals$/)])
})

test('90-U5: a connect on the account in use moves nothing, so with a carry-on owed it logs no visit (puma-9arph.110, ruling 8777)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  // No browser answers as it opens, so the band offers Connect; one answers by the time it is pressed.
  w.chrome = { extensions: [] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const owed = whats(stopLogOf(store, w)).some(what => what.startsWith('no login left'))
  await clock.advance(36_000)
  await browse($, 'tabs_context_mcp')
  await clock.settle()
  w.chrome.extensions.push('')
  const asked = w.chromeAsked.length
  const band = await mountBand($)
  void band.press({ key: 'chrome-connect-band' })
  await settleReal(clock)
  await steps90(clock, 2 * 60_000)
  await band.unmount()
  const log = whats(stopLogOf(store, w))
  expect(owed, 'a carry-on is owed').toBe(true)
  expect(w.chromeAsked.slice(asked), 'the connect ran, on the login in use').toEqual([''])
  expect(log.filter(what => what.startsWith('moved to ')), 'it moved nothing').toEqual([])
  expect(log.filter(what => what.startsWith('visit ended with a carry-on owed')), 'no line for a connect that opened no visit').toEqual([])
})

test('111-D: a Connect visit that ends with no carry-on owed sends its line, though a stop owes one before the line looks (puma-9arph.111)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const view = watchedView(on)
  await start($, clock)
  // A Connect visit to login 2, its forward move held, cuts a stop on login 1: login 2 has room, so nothing is owed.
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
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  w.usage['tok-1'] = [100, 41]
  await $.turn.start({ text: 'a turn the limit stops', turnId: '111-D-cut' })
  void $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  const isCut = whats(stopLogOf(store, w)).includes('stayed: Claude in Chrome is connecting')
  w.beforeEnv = undefined
  endVisit()
  await settleReal(clock)
  // The visit waits out its forward move's settle, then ends; its line looks SETTLE_MS after that.
  while (view()?.chromeConnecting !== undefined && clock.now() < Date.parse('2026-10-12T11:00:00Z')) await steps90(clock, 1_000, 1_000)
  const endLog = whats(stopLogOf(store, w))
  // Before that look: the cut turn's resume answers, which ends its episode, and a stop on login 2, spent too, owes one.
  await $.turn.complete({ turnId: '111-D-cut', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await resumeAnswers($, clock, '111-D-resume')
  w.usage['tok-2'] = [100, 30]
  await $.turn.start({ text: 'a later turn the limit stops', turnId: '111-D-later' })
  await $.classic.StopFailure(PLAIN)
  await $.turn.complete({ turnId: '111-D-later', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await settleReal(clock)
  const owedLog = whats(stopLogOf(store, w)).slice(endLog.length)
  await steps90(clock, 3 * 60_000)
  await pane.unmount()
  const log = whats(stopLogOf(store, w))
  // The line looks once the debt is owed: with no debt at the visit's end, nothing holds it.
  expect([sendersOf90(log, w.submitted), log.filter(what => what === 'carry-on waits on the one owed')], 'the visit\'s line went, and did not wait on the later debt').toEqual([['visit'], []])
  expect([isCut, endLog.some(what => what.startsWith('visit ended with a carry-on owed')), owedLog.filter(what => what.startsWith('no login left'))], 'the visit cut the stop and ended with nothing owed; the later stop owed one').toEqual([true, false, ['no login left: one carry-on at 2026-10-12T12:00:00.000Z']])
  expect(w.submitted, 'one submit, with the CONTINUE text').toEqual([expect.stringMatching(CONTINUE_90)])
})

test('111-T: the debt\'s own login, the debt ended by a turn that ran since the stop, then a person\'s turn: the Connect visit\'s line still goes (ruling 7197 test 1, puma-9arph.111)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const view = watchedView(on)
  // Every login spent: a carry-on owed from login 1, which frees at 12:00.
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  // A Connect visit to login 2 from 11:50, its forward move held; its cut turn stops at 11:52, before login 1 frees.
  await clock.advance(Date.parse('2026-10-12T11:50:00Z') - clock.now())
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
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  await $.turn.start({ text: 'a turn the limit stops', turnId: '111-T-cut' })
  void $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  const isCut = whats(stopLogOf(store, w)).includes('stayed: Claude in Chrome is connecting')
  // Held past 12:00 and the grace after it, so the move back lands on login 1, which owes the carry-on and serves again.
  await clock.advance(Date.parse('2026-10-12T12:06:00Z') - clock.now())
  w.beforeEnv = undefined
  endVisit()
  await settleReal(clock)
  while (view()?.chromeConnecting !== undefined && clock.now() < Date.parse('2026-10-12T12:10:00Z')) await steps90(clock, 1_000, 1_000)
  const endLog = whats(stopLogOf(store, w))
  // A main turn that is no carry-on, then each submit's own turn as the 10 s loop meets it.
  await $.turn.start({ text: 'a prompt of the person', turnId: '111-T-person' })
  await clock.settle()
  await turnsFor90($, clock, w, 5 * 60_000)
  await pane.unmount()
  const log = whats(stopLogOf(store, w))
  const after = log.slice(endLog.length).filter(what => what === 'a turn ran since the stop: no carry-on' || what === 'carry-on queued')
  expect([sendersOf90(log, w.submitted), after], 'the debt ended with no carry-on of its own, then the visit\'s line went').toEqual([['visit'], ['a turn ran since the stop: no carry-on', 'carry-on queued']])
  expect([isCut, view()?.activeId, endLog.filter(what => what.startsWith('moved to ')), endLog.some(what => what.startsWith('visit ended with a carry-on owed'))], 'the visit cut the stop, moved to login 2 and back to login 1, and ended with the carry-on owed').toEqual([true, '1', ['moved to 2 (by a Claude in Chrome visit)', 'moved to 1 (by a Claude in Chrome visit)'], true])
  expect(w.submitted, 'one submit, with the CONTINUE text').toEqual([expect.stringMatching(CONTINUE_90)])
})

test('111-R: a Connect visit whose forward move the policy refuses opens no visit, so with a carry-on owed it logs none (puma-9arph.111)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const owed = whats(stopLogOf(store, w)).some(what => what.startsWith('no login left'))
  // Claude Code's policy refuses each switch from here: the forward move to login 2 fails, inside connectingChrome.
  w.refuseEnv = true
  w.chrome.extensions.push(SLOT2)
  const sets = w.envSets.length
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  void pane.press({ key: 'chrome-try-2' })
  await settleReal(clock)
  await steps90(clock, 2 * 60_000)
  await pane.unmount()
  const log = whats(stopLogOf(store, w))
  expect(log.filter(what => what.startsWith('visit ended with a carry-on owed')), 'no line for a connect whose forward move was refused').toEqual([])
  expect([owed, w.envSets.length - sets, log.filter(what => what.startsWith('moved to '))], 'a carry-on is owed; the move was refused, so nothing moved').toEqual([true, 0, []])
})

/**
 * puma-9arph.100 D1: as oldSubmitVisit95's world, with a submit S0 out at the visit's end, a person's turn, then the
 * debt's own carry-on S1 answered at once, and S0 answered after it. Answers the submits after the visit's end when
 * S0 answered, and the carry-ons after the visit's end: each went through.
 */
async function oldCleanVisit100($: Engine, on: On) {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.fiveHourResets = { 'tok-1': '2026-10-12T10:20:00Z', 'tok-2': '2026-10-12T10:20:00Z', 'tok-3': '2026-10-12T10:20:00Z' }
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  const answerOld = answerNextLate(w, 'resolve')
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  await steps90(clock, 60_000)
  const old = w.submitted.length
  w.usage['tok-3'] = [100, 30]
  await $.turn.start({ text: 'a turn on login 3', turnId: '100-on-3' })
  await $.classic.StopFailure(PLAIN)
  await $.turn.complete({ turnId: '100-on-3', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await settleReal(clock)
  const { pane, isCut } = await cutVisit95($, w, store, clock)
  const atEnd = w.submitted.length
  await steps90(clock, 3 * 60_000, 60_000)
  await $.turn.start({ text: 'a prompt of the person', turnId: '100-person' })
  await clock.settle()
  const owedAt = w.submitted.length + 1
  let looks = 0
  let oldAnsweredAt = 0
  let started = w.submitted.length
  while (clock.now() < at95('10:24:00')) {
    await clock.advance(clock.now() < at95('10:19:00') ? 60_000 : 10_000)
    await clock.settle()
    if (w.submitted.length >= owedAt) {
      looks += 1
      if (looks === 3) {
        oldAnsweredAt = w.submitted.length - atEnd
        answerOld()
        await settleReal(clock)
      }
    }
    while (started < w.submitted.length) {
      started += 1
      await $.turn.start({ text: w.submitted[started - 1] ?? '', turnId: `100-${started}` })
      await clock.settle()
    }
  }
  await pane.unmount()
  return { old, isCut, oldAnsweredAt, carried: w.submitted.length - atEnd }
}

test('90-W: a submit out at a Connect visit\'s end answers after the carry-on owed was answered: no second line (puma-9arph.100)', async ($, on) => {
  const r = await oldCleanVisit100($, on)
  expect([r.old, r.isCut, r.oldAnsweredAt], 'one submit out at the visit end, answered after the owed one; the visit cut the stop').toEqual([1, true, 1])
  expect(r.carried, 'carry-ons after the visit ended').toBe(1)
})

// ---------------------------------------------------------------- no leaving a login while the session works on it

/** The one stop-log line a hold writes, once for as long as the hold lasts. */
const HELD_ONE = 'held on login 1: the session is answering, its stored usage says leave'

/** A response from login 1: its 5-hour window and week as login 1's own. */
const goodResponse = ($: Engine, w: World, five = 20, week = 30) => {
  w.limits = [
    { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: week, resetsAt: WEEK_RESET },
  ]
  return $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
}

test('a tick does not move a session whose turn is open off a login whose stored week reads 100 (master438 06:40:35)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  await start($, clock, true)
  await clock.advance(29 * 60_000)
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  // The next check of login 1 stores a week at 100, as a login's stale stored reading does.
  w.usage['tok-1'] = [20, 100]
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(w.envSets, 'the session moved off a login that was working').toEqual([])
  expect(whats(stopLogOf(store, w))).toEqual([HELD_ONE])
})

test('a response does not move the session off the login it came from', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  // Two weeks that differ, so a response's week names login 1 and the response is stored.
  w.weekResets = { 'tok-2': OTHER_WEEK }
  await start($, clock, true)
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  // The response itself reads 95% of the 5-hour window, which leaves the login on its numbers alone.
  await goodResponse($, w, 95, 30)
  await clock.settle()
  expect(w.envSets, 'a response moved a session that is not failed').toEqual([])
})

test('a usage-limit stop still moves a working session', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  await start($, clock, true)
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  await goodResponse($, w)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

// Orca shows an agent red (failed) on the main loop's StopFailure; the next main turn clears it. A tick or a response moves
// a session only while it is red.
test('a turn open for over 30 minutes is not moved by a tick off a login whose stored week reads 100 (WRONG-SWITCH)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  await start($, clock, true)
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  w.usage['tok-1'] = [20, 100]
  await clock.advance(45 * 60_000)
  await clock.settle()
  expect(w.envSets, 'a tick moved a session whose turn was still open').toEqual([])
})

test("a sub-agent's usage-limit stop does not end the parent's hold (only the main loop)", async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  await start($, clock, true)
  await clock.advance(29 * 60_000)
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  await $.classic.StopFailure({ error: 'rate_limit', agent_id: 'agent-1', agent_type: 'Explore' })
  await clock.settle()
  w.usage['tok-1'] = [20, 100]
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(w.envSets, "a sub-agent's stop moved the parent").toEqual([])
})

test("after the main loop's StopFailure (any error), a tick moves the session: failed is red", async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  await start($, clock, true)
  await clock.advance(29 * 60_000)
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  await $.classic.StopFailure({ error: 'server_error' })
  await clock.settle()
  w.usage['tok-1'] = [20, 100]
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

/** A main turn that dies on a failed stop: it starts, the stop is heard, the turn ends on the error. */
async function mainTurnFails($: Engine, clock: MockClock, error = 'server_error'): Promise<void> {
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  await $.classic.StopFailure({ error })
  await $.turn.complete({ turnId: 'work-1', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
}

test('after that failure, a new main turn clears it and a tick holds again', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  await start($, clock, true)
  await clock.advance(29 * 60_000)
  await mainTurnFails($, clock)
  await $.turn.start({ text: 'try again', turnId: 'work-2' })
  w.usage['tok-1'] = [20, 100]
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(w.envSets, 'a new main turn did not clear the failure').toEqual([])
})

test("a sub-agent's turn start does not clear the main loop's failure", async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  await start($, clock, true)
  await clock.advance(29 * 60_000)
  await mainTurnFails($, clock)
  await $.turn.start({ text: 'look around', turnId: 'sub-1', agentId: 'agent-1' })
  w.usage['tok-1'] = [20, 100]
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

test("an idle session that finished cleanly (no failure) is held on a tick: only red moves", async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30]
  await start($, clock, true)
  await clock.advance(10 * 60_000)
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  await $.turn.complete({ turnId: 'work-1', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.settle()
  w.usage['tok-1'] = [20, 100]
  await clock.advance(30 * 60_000)
  await clock.settle()
  expect(w.envSets, 'a clean idle session was moved on its stored week').toEqual([])
  expect(whats(stopLogOf(store, w))).toEqual([HELD_ONE])
})

test('a fresh session holds at boot and on every tick until its main loop fails, then a tick moves it (BOOT_NONFAILED)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 100]
  await start($, clock, true)
  expect(w.envSets, 'boot moved a session that had not failed').toEqual([])
  await clock.advance(31 * 60_000)
  await clock.settle()
  expect(w.envSets, 'a tick moved a session that had not failed').toEqual([])
  expect(whats(stopLogOf(store, w))).toEqual([HELD_ONE])
  await $.classic.StopFailure({ error: 'server_error' })
  await clock.settle()
  await clock.advance(60_000)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

test('a login marked as needing a sign-in does not move a session whose main loop has not failed (LOGIN_NEEDED_BYPASS)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock, true)
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  store.set('health:1', { kind: 'login-needed', why: 'sign-in rejected', at: NOW })
  await clock.advance(5 * 60_000)
  await clock.settle()
  expect(w.envSets, 'a sign-in mark moved a session that had not failed').toEqual([])
})

test('a held rotation does not land once a main turn has cleared the failure (HELD_AFTER_CLEAR)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  // Login 1 spent from the start, its token about to refresh: the red session's rotation is held for login 2.
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  expect(w.toasts.filter(isSwitchedToast)).toHaveLength(0)
  // A main turn starts: the session is no longer red. The token refreshes, and the minute's retry would land the switch.
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  refresh(w)
  for (let i = 0; i < 4; i += 1) {
    await clock.advance(60_000)
    await settleReal(clock)
  }
  expect(w.envSets, 'a held rotation landed on a session that was no longer red').toEqual([])
})

test("a main turn starting while a tick's switch waits on the keychain keeps the login (RACE)", async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  const view = watchedView(on)
  w.usage['tok-1'] = [20, 30]
  await start($, clock)
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  // Once the switch owns the session, its keychain read waits: the check that began it passed the red test already.
  w.beforeKeychain = () => (view()?.owner === undefined ? Promise.resolve() : gate)
  w.usage['tok-1'] = [20, 100]
  await pastNextRead(clock)
  await settleReal(clock)
  expect(view()?.owner, 'the tick started a switch and waits').toBeDefined()
  await $.turn.start({ text: 'work on it', turnId: 'work-1' })
  open()
  await settleReal(clock)
  expect(w.envSets, 'a switch landed against a session a new turn had cleared').toEqual([])
})

// ---------------------------------------------------------------- F1 defense: a stop's owner is the login its reset names

/** Login 2's Fable week resets here, 3pm in Tallinn (UTC+3 on this date); login 1's is FABLE_RESET. */
const FABLE_RESET_2 = '2026-10-14T12:00:00Z'

const STOP_NAMING_2 = { error: 'rate_limit', last_assistant_message: "You've hit your Fable limit · resets Oct 14 at 3pm (Europe/Tallinn)" }

const STOP_NAMING_1 = { error: 'rate_limit', last_assistant_message: "You've hit your Fable limit · resets Oct 17 at 6am (Europe/Tallinn)" }

const NOT_LANDED = "stop names login 2's reset, not login 1's: the move to 1 has not landed"

const slotValues = (w: World) => w.envSets.map(e => e.value)

/** Login 1 has Fable room, login 2's Fable week is spent; the session starts on login `on`, with no switch pending. */
async function fableOnTwo($: Engine, on: On, startsOn: '1' | '2', beforeStart?: (w: World) => void): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 21]
  w.usage['tok-2'] = [10, 30, 100]
  w.fableResetsBy = { 'tok-1': FABLE_RESET, 'tok-2': FABLE_RESET_2 }
  if (startsOn === '2') w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  beforeStart?.(w)
  await start($, clock)
  return { w, store, clock }
}

/** The stop on login 2 that moves the session to login 1, then 35 s on, when the carry-on goes out, the stop login 2's reset names. */
async function movedToOneThenStoppedOnTwo($: Engine, ctx: { w: World; clock: MockClock }): Promise<void> {
  await $.classic.StopFailure(STOP_NAMING_2)
  await ctx.clock.settle()
  expect(slotValues(ctx.w), 'the first stop moves the session to login 1').toEqual([undefined])
  await ctx.clock.advance(35_000)
  await $.classic.StopFailure(STOP_NAMING_2)
  await ctx.clock.settle()
}

test('a Fable stop whose reset is login 2\'s, 35 s after a move to login 1, marks nothing on login 1, leaves it untried, and points the session back to login 2 (master438 04:24:21)', async ($, on) => {
  const ctx = await fableOnTwo($, on, '2')
  const { w, store } = ctx
  await movedToOneThenStoppedOnTwo($, ctx)
  expect(store.get('fable-mark:1'), 'no mark on the login the move never reached').toBeUndefined()
  const log = whats(stopLogOf(store, w))
  expect(log).toContain(NOT_LANDED)
  // Login 1 is picked both times: it was never tried.
  expect(log.filter(line => line.startsWith('picked '))).toEqual([expect.stringMatching(/^picked 1: .*; tried 2$/), expect.stringMatching(/^picked 1: .*; tried 2$/)])
  // Back to login 2, then the one untried login with Fable room again.
  expect(slotValues(w)).toEqual([undefined, SLOT2, undefined])
})

test('a second move to login 1 that does not land stops the rotation trying it this session, and says so once', async ($, on) => {
  const ctx = await fableOnTwo($, on, '2')
  const { w, store, clock } = ctx
  await movedToOneThenStoppedOnTwo($, ctx)
  expect(w.toasts.filter(t => /did not land/.test(t))).toEqual([])
  await clock.advance(35_000)
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  // The point-back, and no third move to login 1.
  expect(slotValues(w)).toEqual([undefined, SLOT2, undefined, SLOT2])
  expect(whats(stopLogOf(store, w)).filter(line => line === NOT_LANDED)).toHaveLength(2)
  expect(w.toasts.filter(t => /did not land/.test(t))).toHaveLength(1)
  expect(store.get('fable-mark:1')).toBeUndefined()
  await clock.advance(35_000)
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(w.toasts.filter(t => /did not land/.test(t)), 'said once').toHaveLength(1)
  expect(slotValues(w)).toEqual([undefined, SLOT2, undefined, SLOT2])
})

test('a stop with no switch pending whose reset names another login moves the view to that login (master438 01:15:55)', async ($, on) => {
  const { w, store, clock } = await fableOnTwo($, on, '1')
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  const log = whats(stopLogOf(store, w))
  expect(log).toContain(NOT_LANDED)
  expect(slotValues(w)[0], 'the view moves to the login the reset names').toBe(SLOT2)
  expect(store.get('fable-mark:1')).toBeUndefined()
})

test('guard: a stop whose reset names the login in use goes as before (passes before the change too)', async ($, on) => {
  const { w, store, clock } = await fableOnTwo($, on, '1')
  await $.classic.StopFailure(STOP_NAMING_1)
  await clock.settle()
  expect(store.get('fable-mark:1')).toBeDefined()
  expect(whats(stopLogOf(store, w)).filter(line => /has not landed/.test(line))).toEqual([])
  // Login 2's Fable week is spent: nowhere to go, nothing pointed back.
  expect(slotValues(w)).toEqual([])
})

test('a wordless stop on an unproven switch adds the login moved to to tried only at its second stop', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w)).toEqual([SLOT2])
  // Past the settle, no response since: the stop may have gone out on login 1.
  await clock.advance(40_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain('stayed: no untried login (tried 1)')
  await clock.advance(10_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain('stayed: no untried login (tried 1, 2)')
})

// Codex round 1 on the first PR2 commit.
test('F1: a unique reset owner wins inside the 35 s settle window too: a stop 10 s after a move to login 1 naming login 2 points back to 2 and counts one non-landing for 1', async ($, on) => {
  const ctx = await fableOnTwo($, on, '2')
  const { w, store, clock } = ctx
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(slotValues(w), 'the first stop moves the session to login 1').toEqual([undefined])
  await clock.advance(10_000)
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain(NOT_LANDED)
  expect(store.get('fable-mark:1')).toBeUndefined()
  // Back to login 2, then the one untried login with Fable room again: login 1 was never tried.
  expect(slotValues(w)).toEqual([undefined, SLOT2, undefined])
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('picked '))).toEqual([expect.stringMatching(/^picked 1: .*; tried 2$/), expect.stringMatching(/^picked 1: .*; tried 2$/)])
  expect(w.toasts.filter(t => /did not land/.test(t)), 'one non-landing is no toast').toEqual([])
  // The second non-landing, again inside the window of the second move, leaves login 1 be.
  await clock.advance(10_000)
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(w.toasts.filter(t => /did not land/.test(t))).toHaveLength(1)
  expect(slotValues(w)).toEqual([undefined, SLOT2, undefined, SLOT2])
})

test('F2: a response whose week two logins share proves neither: a wordless stop after it adds no login to tried', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  // Both logins' weeks reset at WEEK_RESET: a response carrying it is login 1's and login 2's alike.
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(slotValues(w)).toEqual([SLOT2])
  await clock.advance(40_000)
  w.limits = limitsOf(50, 40)
  await respond($, clock, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  // Nobody is charged: login 1 was tried at the first stop, login 2 is in use and no response proved it the stopper.
  expect(whats(stopLogOf(store, w))).toContain('stayed: no untried login (tried 1)')
})

/** A view read that answers late, once: the next one after `arm()` waits for `release()` and then answers what it read. */
function gateNextViewRead(on: On): { arm: () => void; isPaused: () => boolean; release: () => void } {
  let state: 'idle' | 'armed' | 'paused' | 'fired' = 'idle'
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  on('state.get', async (_$, e, next) => {
    const read = await next(e)
    if (state !== 'armed' || e.plugin !== 'account-rotator' || e.key !== 'view') return read
    state = 'paused'
    await gate
    state = 'fired'
    return read
  })
  return { arm: () => void (state = 'armed'), isPaused: () => state === 'paused', release: open }
}

/** Login 2 is spent for Fable and the session starts on it; stop 1 moves it to login 1; the second stop, 35 s on, is held at its first read of the view. */
async function heldSecondStop($: Engine, on: On) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30, 21]
  w.usage['tok-2'] = [10, 30, 100]
  w.usage['tok-3'] = [10, 30, 100]
  w.fableResetsBy = { 'tok-1': FABLE_RESET, 'tok-2': FABLE_RESET_2, 'tok-3': '2026-10-15T12:00:00Z' }
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  const store = new Map<string, unknown>(Object.entries(THREE_LOGINS))
  const clock = world(on, w, store)
  const gate = gateNextViewRead(on)
  await start($, clock)
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(slotValues(w), 'the first stop moves the session to login 1').toEqual([undefined])
  await clock.advance(35_000)
  gate.arm()
  const stopping = $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(gate.isPaused(), 'the second stop waits on its read of the view').toBe(true)
  return { w, store, clock, gate, stopping }
}

test('F3: a point-back acts only on the switch it examined: a press that moved the session to login 3 meanwhile stands', async ($, on) => {
  const { w, store, clock, gate, stopping } = await heldSecondStop($, on)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-3' })
  await clock.settle()
  await pane.unmount()
  gate.release()
  await stopping
  await clock.settle()
  expect(slotValues(w), 'the press to login 3 stands').toEqual([undefined, SLOT3])
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
})

test('F3: a point-back acts only on a failed turn: a main turn that began meanwhile clears it, and the stop is dropped', async ($, on) => {
  const { w, store, clock, gate, stopping } = await heldSecondStop($, on)
  await $.turn.start({ text: 'go on by hand', turnId: 'by-hand' })
  gate.release()
  await stopping
  await clock.settle()
  expect(slotValues(w), 'no point-back to login 2').toEqual([undefined])
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
})

// Codex round 2 on the second PR2 commit: the owner decision as one function.
test('OWNER-RESPONSE: a response since the switch that uniquely proves login 1, then a wordless stop on login 2, points the session back to login 1', async ($, on) => {
  const last = [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-12T12:00:00Z' }, { kind: 'seven_day', percentUsed: 41, resetsAt: WEEK_RESET }]
  const { w, store } = await stopDuringSwitch($, on, 61_000, 'Claude usage limit reached.', last)
  expect(whats(stopLogOf(store, w))).toContain("a response since the switch is login 1's, not login 2's: the move to 2 has not landed")
  expect(slots(w), 'login 2 by the press, back to login 1 by the stop').toEqual([SLOT2, ''])
})

// puma-9arph.109.13: the first stop-log line is written before the stop's owner is known, so it says the login BELIEVED in use.
test("STOP-LOG-OWNER: the second stop, heard 35 s after a move to login 1 and naming login 2's reset, does not call login 1 the login in use", async ($, on) => {
  const { w, store, clock } = await fableOnTwo($, on, '2')
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(slotValues(w), 'the first stop moves the session to login 1').toEqual([undefined])
  await clock.advance(35_000)
  await clock.settle()
  expect(w.submitted, 'the carry-on was sent after the first stop').toHaveLength(1)
  // The carry-on turn enters on login 1, as the harness models a submitted carry-on, and that turn is the one that stops.
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await $.classic.StopFailure(STOP_NAMING_2)
  await $.turn.complete({ turnId: 'turn-carry', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  const second = whats(stopLogOf(store, w)).filter(line => line.startsWith('stop heard'))[1]
  expect(second, 'the second stop wrote its first line').toBeDefined()
  expect(second).not.toMatch(/login 1 in use/)
  expect(second).toMatch(/login 1 believed in use/)
})

/**
 * `want` is the test's own input: the owner the stop's sequence resolves to (`null`: nobody's stop) and the login the
 * mod believed in use. Where they differ the stop must have written a point-back naming the owner (none for nobody);
 * every line that claims a login "in use" names the owner (none for nobody); line one of the last stop says `believed`.
 */
function expectEveryInUseClaimNamesOwner(store: Map<string, unknown>, w: World, want: { owner: string | null; believed: string }): void {
  const lines = whats(stopLogOf(store, w))
  const lineOne = lines.filter(line => line.startsWith('stop heard:')).at(-1)
  expect(lineOne, 'the stop wrote its first line').toBeDefined()
  expect(lineOne, 'line one names the believed login').toMatch(new RegExp(`login ${want.believed} (?:believed )?in use`))
  expect(lineOne, 'line one never claims the login is in use').toMatch(/believed in use/)
  const pointBacks = lines.map(line => /login (\S+)'s(?: reset)?, not login (\S+)'s: the move to/.exec(line)).filter(m => m !== null)
  if (want.owner !== null && want.owner !== want.believed) expect(pointBacks.at(-1)?.[1], 'a point-back names the owner').toBe(want.owner)
  else expect(pointBacks, 'no point-back where the stop is the believed login\'s or nobody\'s').toEqual([])
  const claims = lines.map(line => /login (\S+) in use/.exec(line)).filter(m => m !== null)
  for (const claim of claims) expect(claim[1], `a line claims login ${claim[1]} in use`).toBe(want.owner)
}

const CLASS_TITLE = 'STOP-LOG-OWNER class: every stop-log line that claims a login in use names the stop\'s resolved owner, on every path of the stop handler'

/** The carry-on a stop's switch sent, entering as a turn on the login moved to: asserted sent, then started. */
async function startCarryOnTurn($: Engine, w: World): Promise<void> {
  expect(w.submitted, 'the carry-on was sent after the first stop').toHaveLength(1)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
}

/** The carry-on turn dying, as the real failed turn ends. */
const endCarryOnTurn = ($: Engine) => $.turn.complete({ turnId: 'turn-carry', reason: 'error', answer: '', durationMs: 1, isAborted: false })

test(`${CLASS_TITLE}: reset names the other login`, async ($, on) => {
  const ctx = await fableOnTwo($, on, '2')
  await $.classic.StopFailure(STOP_NAMING_2)
  await ctx.clock.settle()
  expect(slotValues(ctx.w), 'the first stop moves the session to login 1').toEqual([undefined])
  await ctx.clock.advance(35_000)
  await ctx.clock.settle()
  await startCarryOnTurn($, ctx.w)
  await $.classic.StopFailure(STOP_NAMING_2)
  await endCarryOnTurn($)
  await ctx.clock.settle()
  expectEveryInUseClaimNamesOwner(ctx.store, ctx.w, { owner: '2', believed: '1' })
})

test(`${CLASS_TITLE}: a response since the switch proves the other login`, async ($, on) => {
  const last = [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-12T12:00:00Z' }, { kind: 'seven_day', percentUsed: 41, resetsAt: WEEK_RESET }]
  const { w, store } = await stopDuringSwitch($, on, 61_000, 'Claude usage limit reached.', last)
  // The switch is a press, no stop before it: no carry-on exists to start.
  expect(w.submitted).toEqual([])
  expectEveryInUseClaimNamesOwner(store, w, { owner: '1', believed: '2' })
})

test(`${CLASS_TITLE}: a wordless stop on an unproven switch`, async ($, on) => {
  const { w, store } = await stopDuringSwitch($, on, 61_000, 'Claude usage limit reached.')
  // The switch is a press, no stop before it: no carry-on exists to start.
  expect(w.submitted).toEqual([])
  expectEveryInUseClaimNamesOwner(store, w, { owner: '2', believed: '2' })
})

test(`${CLASS_TITLE}: a response both logins fit alike makes the stop nobody's`, async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  // Both logins' weeks reset at WEEK_RESET: a response carrying it is login 1's and login 2's alike.
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(slotValues(w), 'the first stop moves the session to login 2').toEqual([SLOT2])
  await clock.advance(40_000)
  await startCarryOnTurn($, w)
  w.limits = limitsOf(50, 40)
  await respond($, clock, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await endCarryOnTurn($)
  await clock.settle()
  expect(slotValues(w), 'no point-back: the stop is nobody\'s').toEqual([SLOT2])
  expect(['mark:2', 'week-mark:2', 'fable-mark:2'].map(key => store.get(key)), 'no mark on the login believed in use').toEqual([undefined, undefined, undefined])
  // The first stop's line one is login 1's, believed; only the last stop's lines are judged against nobody.
  const lines = whats(stopLogOf(store, w))
  expect(lines.filter(line => /login 1 in use/.test(line)), 'no line claims login 1 in use').toEqual([])
  expectEveryInUseClaimNamesOwner(store, w, { owner: null, believed: '2' })
})

test(`${CLASS_TITLE}: a stop on an owed resume`, async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await turnStops($, clock)
  await clock.advance(36_000)
  // The resume enters on login 2 and dies at once on the limit.
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(whats(stopLogOf(store, w)), 'the owed-resume line was reached').toContain('stop on owed resume: login 2 in use, no response since its switch, no mark')
  expectEveryInUseClaimNamesOwner(store, w, { owner: '2', believed: '2' })
})

test(`${CLASS_TITLE}: no switch pending`, async ($, on) => {
  const { w, store, clock } = await fableOnTwo($, on, '1')
  await $.classic.StopFailure(STOP_NAMING_1)
  await clock.settle()
  expect(store.get('fable-mark:1'), 'the stop marked its owner').toBeDefined()
  expectEveryInUseClaimNamesOwner(store, w, { owner: '1', believed: '1' })
})

test(`${CLASS_TITLE}: authentication_failed`, async ($, on) => {
  const { w, store, clock } = await fableOnTwo($, on, '1')
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expectEveryInUseClaimNamesOwner(store, w, { owner: '1', believed: '1' })
})

test('POINTBACK-TURN: a main turn that begins while the point-back writes the slot stands: nothing is published, the slot goes back to the login the view names', async ($, on) => {
  const { w, store, clock } = await fableOnTwo($, on, '2')
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  await clock.advance(35_000)
  expect(slotValues(w)).toEqual([undefined])
  let isHeld = false
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  w.beforeEnv = async () => {
    isHeld = true
    await gate
  }
  const stopping = $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(isHeld, "the point-back's slot write waits").toBe(true)
  await $.turn.start({ text: 'go on by hand', turnId: 'by-hand' })
  w.beforeEnv = undefined
  open()
  await stopping
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('picked ')), 'the dropped stop picks nothing more').toHaveLength(1)
  expect(slotValues(w).at(-1), 'the slot is back on login 1, the one the view names').toBeUndefined()
})

test('PROOF-COUNT: a proof whose write did not apply (a press replaced the switch) leaves the login\'s non-landing count: its second non-landing still leaves it be', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30, 21]
  w.usage['tok-2'] = [10, 30, 100]
  w.usage['tok-3'] = [10, 30, 100]
  w.fableResetsBy = { 'tok-1': FABLE_RESET, 'tok-2': FABLE_RESET_2, 'tok-3': '2026-10-15T12:00:00Z' }
  w.weekResets = { 'tok-1': '2026-10-18T03:00:00Z', 'tok-2': '2026-10-19T03:00:00Z', 'tok-3': '2026-10-20T03:00:00Z' }
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  const store = new Map<string, unknown>(Object.entries(THREE_LOGINS))
  const clock = world(on, w, store)
  // The write that ends the pending switch (a proof's) waits once, armed.
  let isArmed = false
  let isHeld = false
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  let last: View | undefined
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view' && isArmed && last?.pending !== undefined && value.pending === undefined) {
      isArmed = false
      isHeld = true
      await gate
    }
    if (key === 'view') last = value
    return next(e)
  })
  await start($, clock)
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  await clock.advance(35_000)
  // The first non-landing of login 1; the stop goes on to move to login 1 again.
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(slotValues(w)).toEqual([undefined, SLOT2, undefined])
  await clock.advance(40_000)
  // A response with login 1's week proves the move to login 1; its write waits, and a press moves the session to login 3.
  w.limits = limitsOf(30, 30, '2026-10-18T03:00:00Z')
  isArmed = true
  const responding = $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  expect(isHeld, "the proof's write waits").toBe(true)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const pressing = pane.press({ key: 'use-3' })
  await clock.settle()
  open()
  await responding
  await pressing
  await clock.settle()
  // Login 1 again, and a stop that names login 2 again: the second non-landing of login 1 in this session.
  await pane.press({ key: 'use-1' })
  await clock.settle()
  await pane.unmount()
  await clock.advance(35_000)
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  expect(w.toasts.filter(t => /did not land/.test(t))).toHaveLength(1)
})

// Codex round 3: a stop reads state, awaits, then acts on what it read. The failure epoch and the staged charge.
test('TURN-EPOCH: an old stop paused while a new main turn starts and fails does not point back against the new failure', async ($, on) => {
  const { w, store, clock, gate, stopping } = await heldSecondStop($, on)
  await $.turn.start({ text: 'go on by hand', turnId: 'by-hand' })
  // The new turn fails too: red again, a different failure.
  await $.classic.StopFailure({ error: 'server_error' })
  await clock.settle()
  gate.release()
  await stopping
  await clock.settle()
  expect(slotValues(w), 'no point-back for the old stop').toEqual([undefined])
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
})

test('STALE-CHARGE: a stop dropped because a press moved the session leaves the episode as it found it: a later stop can still pick the login it would have tried', async ($, on) => {
  const held: { gate?: ReturnType<typeof gateNextViewRead> } = {}
  const { w, store, clock } = await fableOnTwo($, on, '1', () => void (held.gate = gateNextViewRead(on)))
  const gate = held.gate
  if (gate === undefined) throw new Error('the gate was not registered')
  gate.arm()
  const stopping = $.classic.StopFailure(STOP_NAMING_1)
  await clock.settle()
  expect(gate.isPaused(), 'the stop waits on its read of the view').toBe(true)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  await pane.unmount()
  gate.release()
  await stopping
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
  await clock.advance(36_000)
  await $.classic.StopFailure(STOP_NAMING_2)
  await clock.settle()
  // The dropped stop charged login 1 nothing: it is still untried for this stop.
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('picked '))).toEqual([expect.stringMatching(/^picked 1: .*; tried 2$/)])
})

// Codex round 4.
/** The stop names login 1 (the owner is the login in use); its forced usage read is held, once armed. */
async function stopHeldOnItsRead($: Engine, on: On) {
  const held = { armed: false, paused: false, open: () => {} }
  const gate = new Promise<void>(resolve => {
    held.open = resolve
  })
  const { w, store, clock } = await fableOnTwo($, on, '1', () => {
    // Registered before the start: the world's own fetch answers after this one.
  })
  w.beforeFetch = async () => {
    if (!held.armed) return
    held.armed = false
    held.paused = true
    await gate
  }
  await clock.advance(USAGE_FORCE_AFTER_MS + 1000)
  held.armed = true
  const stopping = $.classic.StopFailure(STOP_NAMING_1)
  await clock.settle()
  expect(held.paused, "the stop's forced usage read waits").toBe(true)
  return { w, store, clock, held, stopping }
}

test('STALE-AFTER-CHECK: a main turn that starts during the stop\'s usage read leaves no mark, no charge and no move', async ($, on) => {
  const { w, store, clock, held, stopping } = await stopHeldOnItsRead($, on)
  await $.turn.start({ text: 'go on by hand', turnId: 'by-hand' })
  held.open()
  await stopping
  await clock.settle()
  expect(store.get('fable-mark:1'), 'no mark').toBeUndefined()
  expect(slotValues(w), 'no move').toEqual([])
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
})

test('STALE-AFTER-CHECK: a press that lands during the stop\'s usage read leaves no mark and no second move', async ($, on) => {
  const { w, store, clock, held, stopping } = await stopHeldOnItsRead($, on)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  await pane.unmount()
  held.open()
  await stopping
  await clock.settle()
  expect(store.get('fable-mark:1'), 'no mark').toBeUndefined()
  expect(slotValues(w), 'the press alone moved the session').toEqual([SLOT2])
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
})

test('PROVISIONAL-LOST: a mark a stop left on a login moved to unproven, then moved on from, is given back when a later stop shows that move never landed', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [60, 40, 21]
  w.usage['tok-2'] = [10, 41]
  w.usage['tok-3'] = [5, 10]
  w.fableResetsBy = { 'tok-1': FABLE_RESET }
  w.weekResets = { 'tok-1': '2026-10-18T03:00:00Z', 'tok-2': '2026-10-19T03:00:00Z', 'tok-3': '2026-10-20T03:00:00Z' }
  const store = new Map<string, unknown>(Object.entries({ ...THREE_LOGINS, 'rotate-to': 'room' }))
  const clock = world(on, w, store)
  await start($, clock)
  // A to B by Use now: no response proves it. 40 s on, a wordless stop marks B provisionally and moves to C.
  await useNow($, clock, '2')
  await clock.advance(40_000)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(store.get('mark:2'), "the wordless stop marks login 2 provisionally").toBeDefined()
  expect(slotValues(w), 'and moves on to login 3').toEqual([SLOT2, SLOT3])
  await clock.advance(36_000)
  // A later stop whose reset is login 1's: requests were going out on login 1 all along.
  await $.classic.StopFailure(STOP_NAMING_1)
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain("stop names login 1's reset, not login 3's: the move to 3 has not landed")
  expect(store.get('mark:2'), "login 2 never received a request: its mark is given back").toBeUndefined()
})

// Codex round 5: the class "a stop reads, awaits, then writes or moves". The check goes last, and a write or a move follows it
// with no await between.
/** The first read of store key `read` after a write of `after` answers late: a stop paused inside its own read of the store. */
function gateStoreRead(w: World, read: string, after: string): { arm: () => void; isPaused: () => boolean; release: () => void } {
  let state: 'idle' | 'armed' | 'written' | 'paused' | 'fired' = 'idle'
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  w.onStoreSet = key => {
    if (state === 'armed' && key === after) state = 'written'
  }
  w.afterStoreGet = async key => {
    if (state !== 'written' || key !== read) return
    state = 'paused'
    await gate
    state = 'fired'
  }
  return { arm: () => void (state = 'armed'), isPaused: () => state === 'paused', release: open }
}

/** The session starts on login `startsOn`; the stop's own forced read of it is saved, and the stop is held at its first read of `read` after the write of `after`. */
async function stopHeldOnStoreRead($: Engine, on: On, startsOn: '1' | '2', stop: typeof STOP_NAMING_1, read: string, after: string) {
  const held: { gate?: ReturnType<typeof gateStoreRead> } = {}
  const { w, store, clock } = await fableOnTwo($, on, startsOn, w => void (held.gate = gateStoreRead(w, read, after)))
  const gate = held.gate
  if (gate === undefined) throw new Error('the gate was not registered')
  await clock.advance(USAGE_FORCE_AFTER_MS + 1000)
  gate.arm()
  const stopping = $.classic.StopFailure(stop)
  await clock.settle()
  expect(gate.isPaused(), `the stop waits on its read of ${read}`).toBe(true)
  return { w, store, clock, gate, stopping }
}

test('STALE-MARK: a main turn that starts while the stop reads the stored reading before its mark leaves no mark and no move', async ($, on) => {
  const { w, store, clock, gate, stopping } = await stopHeldOnStoreRead($, on, '1', STOP_NAMING_1, 'usage:1', 'usage:1')
  await $.turn.start({ text: 'go on by hand', turnId: 'by-hand' })
  gate.release()
  await stopping
  await clock.settle()
  expect(store.get('fable-mark:1'), 'no mark').toBeUndefined()
  expect(slotValues(w), 'no move').toEqual([])
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
})

test('STALE-MARK: a press that lands while the stop reads the stored reading before its mark leaves no mark and no second move', async ($, on) => {
  const { w, store, clock, gate, stopping } = await stopHeldOnStoreRead($, on, '1', STOP_NAMING_1, 'usage:1', 'usage:1')
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  await pane.unmount()
  gate.release()
  await stopping
  await clock.settle()
  expect(store.get('fable-mark:1'), 'no mark').toBeUndefined()
  expect(slotValues(w), 'the press alone moved the session').toEqual([SLOT2])
  expect(whats(stopLogOf(store, w))).toContain('stop dropped: the switch or the failed turn it examined has changed since')
})

/** The stop on login 2 (its Fable week already read spent: no mark to write) picks login 1; its read of login 1's stored reading, inside the pick, is held. */
const stopHeldInThePick = ($: Engine, on: On) => stopHeldOnStoreRead($, on, '2', STOP_NAMING_2, 'usage:1', 'usage:2')

test('STALE-ROTATE: a main turn that starts while the stop picks its target moves nothing and sends no carry-on', async ($, on) => {
  const { w, store, clock, gate, stopping } = await stopHeldInThePick($, on)
  await $.turn.start({ text: 'go on by hand', turnId: 'by-hand' })
  gate.release()
  await stopping
  await clock.settle()
  await clock.advance(60_000)
  expect(slotValues(w), 'the session stays where it runs').toEqual([])
  expect(w.submitted, 'no carry-on').toEqual([])
  expect(whats(stopLogOf(store, w)), 'the stop says it moved nothing').toContain('stop switch dropped: the failed turn it examined has changed since')
})

test('STALE-ROTATE: a newer failed main turn that starts while the stop picks its target is not moved by the older stop', async ($, on) => {
  const { w, clock, gate, stopping } = await stopHeldInThePick($, on)
  // The newer failure is no limit stop: nothing but the older stop could move the session.
  await $.turn.start({ text: 'go on by hand', turnId: 'by-hand' })
  await $.classic.StopFailure({ error: 'server_error' })
  gate.release()
  await stopping
  await clock.settle()
  await clock.advance(60_000)
  expect(slotValues(w), 'the older stop cannot move the newer failure').toEqual([])
  expect(w.submitted, 'no carry-on').toEqual([])
})

test('guard: a press moves a session whose failure a main turn cleared (a press is exempt from the failure epoch)', async ($, on) => {
  const { w, clock } = await fableOnTwo($, on, '2')
  await $.turn.start({ text: 'go on by hand', turnId: 'by-hand' })
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-1' })
  await clock.settle()
  await pane.unmount()
  expect(slotValues(w)).toEqual([undefined])
})

// ---------------------------------------------------------------- puma-9arph.109.2: a Fable stop's need reaches every pick path

/**
 * Three logins, rotation by room. Login 1 (in use) has its Fable week spent, as login 2 does, with the most 5-hour room;
 * login 3 has the Fable room. A pick that forgets the Fable need takes login 2.
 */
async function fableNeedWorld($: Engine, on: On, options: { unique?: boolean; one?: [number, number, number]; three?: [number, number, number] } = {}) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = options.one ?? [20, 30, 100]
  w.usage['tok-2'] = [5, 30, 100]
  w.usage['tok-3'] = options.three ?? [10, 30, 21]
  // Every login's week resets together unless the test needs a response to prove one login.
  if (options.unique) w.weekResets = { 'tok-1': '2026-10-18T03:00:00Z', 'tok-2': '2026-10-19T03:00:00Z', 'tok-3': '2026-10-20T03:00:00Z' }
  const store = new Map<string, unknown>(Object.entries({ ...THREE_LOGINS, 'rotate-to': 'room' }))
  const clock = world(on, w, store)
  await start($, clock)
  return { w, store, clock }
}

test('NEED-OWNER-UNDEFINED: a Fable stop whose owner no response proves keeps the Fable need: the pick never takes a login whose Fable week is spent', async ($, on) => {
  const { w, clock } = await fableNeedWorld($, on)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w), 'the first stop moves to login 3, the one with Fable room').toEqual([SLOT3])
  await clock.advance(40_000)
  // A response whose week all three logins share proves none of them: the second stop has no owner.
  w.limits = limitsOf(50, 40)
  await respond($, clock, w)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w), 'no move to login 2, whose Fable week is spent').toEqual([SLOT3])
})

test('NEED-OWED-RESUME: a Fable stop on an owed resume takes its own need, though the episode held none before it', async ($, on) => {
  const { w, clock } = await fableNeedWorld($, on, { one: [100, 30, 21], three: [10, 30, 100] })
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] })
  await clock.settle()
  expect(slotValues(w), 'the plain stop moves to login 2, the most 5-hour room').toEqual([SLOT2])
  await clock.advance(40_000)
  // Past the settle, no response since the switch: a stop on an owed resume, now a Fable one. Login 3's Fable week is spent.
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w), 'no move to login 3, whose Fable week is spent').toEqual([SLOT2])
})

test('NEED-STICKY: a wordless stop of the same episode that has no owner keeps the Fable need an earlier stop set', async ($, on) => {
  const { w, clock } = await fableNeedWorld($, on)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w)).toEqual([SLOT3])
  await clock.advance(40_000)
  w.limits = limitsOf(50, 40)
  await respond($, clock, w)
  // The week all three logins share proves none: no owner, no mark, and the words say nothing of the Fable week.
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(slotValues(w), 'the episode still needs the Fable week: login 2 has none').toEqual([SLOT3])
})

test('guard: a plain stop after a Fable stop, one that marks its own window, judges its own need and moves to any login with room', async ($, on) => {
  const { w, clock } = await fableNeedWorld($, on, { unique: true })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w)).toEqual([SLOT3])
  await clock.advance(40_000)
  w.limits = limitsOf(10, 30, '2026-10-20T03:00:00Z')
  await respond($, clock, w)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] })
  await clock.settle()
  expect(slotValues(w), 'a 5-hour stop needs no Fable room: login 2 has the most room').toEqual([SLOT3, SLOT2])
})

// https://code.claude.com/docs/en/errors.md: "The Opus and Sonnet limits each apply only to requests to that model family".
for (const family of ['Opus', 'Sonnet']) {
  for (const [name, one] of [['with a 5-hour window', [20, 30, 21]], ['that reports no 5-hour window', [null, 30, 21]]] as const) {
    test(`MODEL-LIMIT: a ${family} limit on a login ${name} marks neither its 5-hour window, its week nor its Fable week, and the session moves on`, async ($, on) => {
      const w = fresh()
      w.keychain['Claude Code-credentials'] = blob('tok-1')
      w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
      w.usage['tok-1'] = [...one]
      w.usage['tok-2'] = [10, 30, 21]
      const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
      const clock = world(on, w, store)
      await start($, clock)
      await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: `You've hit your ${family} limit · resets 3:45pm` })
      await clock.settle()
      expect([store.get('mark:1'), store.get('week-mark:1'), store.get('fable-mark:1')], 'no mark of any window').toEqual([undefined, undefined, undefined])
      expect(slotValues(w), 'the model family is spent here, so the session tries the next login').toEqual([SLOT2])
    })
  }
}

// ---------------------------------------------------------------- puma-9arph.109.3: read the candidates live before a spent-old pick

/**
 * Login 1 is in use with its Fable week spent. Logins 2 and 3 hold stored readings two hours old that show their Fable
 * week and week spent (login 2 frees first), and the usage endpoint says what each is now: `live`. Login 2's token has
 * run out where `isTwoIdle`. The schedule does not read either login before the stop. Login 1's token refreshes in 7
 * minutes where `isNudged`, so the refresh guard holds the stop's switch and the refresh nudge goes (an Orca pane, its
 * Escape look and every submit queued, as in queuedWorld).
 */
async function oldReadings($: Engine, on: On, live: { two: [number, number, number]; three: [number, number, number] }, options: { isTwoIdle?: boolean; isThreeRead?: boolean; isTwoRoomy?: boolean; isNudged?: boolean; text?: string; failing?: Record<string, number> } = {}) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', options.isTwoIdle ? NOW - HOUR : undefined)
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = live.two
  w.usage['tok-3'] = live.three
  w.fableResetsBy = { 'tok-1': FABLE_RESET, 'tok-2': FABLE_RESET_2, 'tok-3': FABLE_RESET }
  w.weekResets = { 'tok-1': '2026-10-18T03:00:00Z', 'tok-2': '2026-10-14T03:00:00Z', 'tok-3': '2026-10-18T03:00:00Z' }
  if (options.failing !== undefined) w.failing = options.failing
  const old = (id: string, week: string, fable: string, pct = 100) => ({
    fiveHour: { pct: 10, resetsAt: '2026-10-12T12:00:00Z' },
    sevenDay: { pct, resetsAt: week },
    fable: { pct, resetsAt: fable },
    at: NOW - 2 * HOUR,
    by: id,
    v: 1,
    src: 'body',
  })
  const store = new Map<string, unknown>(
    Object.entries({
      ...THREE_LOGINS,
      'rotate-to': 'room',
      ...(options.text === undefined ? {} : { 'fable-continue-text': options.text }),
      'usage:2': old('2', '2026-10-14T03:00:00Z', FABLE_RESET_2, options.isTwoRoomy ? 10 : 100),
      'usage-due:2': { next: NOW + HOUR, fails: 0, at: NOW - 2 * HOUR, v: 1 },
      // Login 3 holds an old reading too, unless the test has the boot read it.
      ...(options.isThreeRead ? {} : { 'usage:3': old('3', '2026-10-18T03:00:00Z', FABLE_RESET), 'usage-due:3': { next: NOW + HOUR, fails: 0, at: NOW - 2 * HOUR, v: 1 } }),
    }),
  )
  if (options.isNudged) queuedWorld(on, w)
  const clock = world(on, w, store)
  await start($, clock)
  if (options.isNudged) w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 7 * 60_000)
  return { w, store, clock }
}

test('READ-BEFORE-SPENT-OLD: a candidate whose stored reading says spent but whose live read shows room is picked, not the spent one that frees first (06:42:05)', async ($, on) => {
  const { w, store, clock } = await oldReadings($, on, { two: [100, 100, 100], three: [0, 0, 0] })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w), 'login 3, live 0, not login 2').toEqual([SLOT3])
  const log = whats(stopLogOf(store, w))
  expect(log).toContain('read live before spent-old: 2 (100/100), 3 (0/0)')
  expect(log.filter(line => line.startsWith('picked '))).toEqual([expect.stringMatching(/^picked 3: fresh, read 0 min ago; tried 1$/)])
})

test('READ-BEFORE-SPENT-OLD: every candidate read live is spent: each counts as its try, and the session stays, saying when the next frees', async ($, on) => {
  const { w, store, clock } = await oldReadings($, on, { two: [100, 100, 100], three: [100, 100, 100] })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w), 'no blind try of a login the read shows spent').toEqual([])
  expect(whats(stopLogOf(store, w))).toContain('stayed: no untried login (tried 1)')
})

test('READ-BEFORE-SPENT-OLD: a login that could not be read (its token idle) goes into the blind try, and the log says it was not read live (06:11:51)', async ($, on) => {
  const { w, store, clock } = await oldReadings($, on, { two: [100, 100, 100], three: [100, 100, 100] }, { isTwoIdle: true })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w), 'login 2, idle: tried on its old reading').toEqual([SLOT2])
  const log = whats(stopLogOf(store, w))
  expect(log).toContain('read live before spent-old: 3 (100/100)')
  expect(log).toContain('not read live: token idle: 2')
  expect(log.filter(line => line.startsWith('picked '))).toEqual([expect.stringMatching(/^picked 2: spent-old \(idle token\), read 120 min ago; tried 1$/)])
})

test('READ-BEFORE-SPENT-OLD: a read that fails keeps the old reading, and that login goes into the blind try (a 429)', async ($, on) => {
  const { w, store, clock } = await oldReadings($, on, { two: [100, 100, 100], three: [100, 100, 100] }, { failing: { 'tok-3': 429 } })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w), 'login 3: login 2 read spent, login 3 not read').toEqual([SLOT3])
  const log = whats(stopLogOf(store, w))
  expect(log).toContain('read live before spent-old: 2 (100/100)')
  expect(log).toContain('not read live: usage read failed: 3')
})

test('guard: a stop with a fresh login with room makes no live read of the others', async ($, on) => {
  // Login 3's schedule is due: the boot reads it, so it is fresh with room by the stop.
  const { w, clock } = await oldReadings($, on, { two: [100, 100, 100], three: [0, 0, 0] }, { isThreeRead: true })
  w.usageCalls.length = 0
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w)).toEqual([SLOT3])
  expect(w.usageCalls.filter(token => token === 'tok-2'), 'login 2 is not read').toEqual([])
})

// ---------------------------------------------------------------- puma-9arph.109.4: the carry-on line is honest per pick

const STORED_LINE = 'Go on on Fable-free ground.'

test('HONEST-CARRY-ON: a stale pick (read 2 h ago) never sends the stored line: the mod\'s own line says room is not confirmed and when it was read', async ($, on) => {
  const { w, clock } = await oldReadings($, on, { two: [10, 10, 10], three: [100, 100, 100] }, { isTwoRoomy: true, text: STORED_LINE })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slotValues(w), 'login 2, stale with room').toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).not.toBe(STORED_LINE)
  expect(w.submitted[0]).toMatch(/Fable week was last read 120 min ago, so room on it is not confirmed/)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
  expect(w.asUser, 'under the mod\'s name').toEqual([false])
})

test('HONEST-CARRY-ON: a spent-old pick sends the mod\'s own line naming the reset it was believed spent until, never the stored line', async ($, on) => {
  const { w, clock } = await oldReadings($, on, { two: [100, 100, 100], three: [100, 100, 100] }, { isTwoIdle: true, text: STORED_LINE })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slotValues(w), 'login 2, idle, tried blind').toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).not.toBe(STORED_LINE)
  expect(w.submitted[0]).toMatch(/Fable week was believed spent until 2026-10-14 12:00 UTC; it is tried in case that was reset or freed elsewhere/)
  expect(w.asUser).toEqual([false])
})

test('HONEST-CARRY-ON: a fresh read that lists no Fable week proves no room, so the stored line is not sent either', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'fable-continue-text': STORED_LINE })
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slotValues(w)).toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/lists no Fable week, so room on it is not confirmed/)
  expect(w.asUser).toEqual([false])
})

/** The mod's own carry-on, as it opens and closes; a note about the pick sits between them. */
const OWN_LEAD = 'Claude Code switched to another of your Claude accounts because the previous one hit its usage limit or lost its sign-in.'
const OWN_TAIL = 'Continue where you left off.'
const STALE_NOTE = 'Its Fable week was last read 120 min ago, so room on it is not confirmed.'

/**
 * A Fable stop on login 1 moves to the login the pick names (login 2 stale with room, or `fresh`: login 3 read live with
 * room), and its carry-on is armed. Before that switch lands a person presses Use now on the other login, a switch that
 * carries nothing and settles for 35 s. A second Fable stop of the same episode in that window rides the settling switch
 * and arms its own carry-on (the settling branch of onStopFailure), and the person's turn answers before it is due, which
 * ends the episode: the words that carry-on goes with are then the ones the rider itself was armed with, never the
 * episode's (the fallback of carryOnAfterSettle reads the episode, which is gone).
 */
async function riderOnSettling($: Engine, on: On, pick: 'stale' | 'fresh') {
  const isStale = pick === 'stale'
  const { w, store, clock } = await oldReadings($, on, isStale ? { two: [10, 10, 10], three: [100, 100, 100] } : { two: [100, 100, 100], three: [0, 0, 0] }, { isTwoRoomy: isStale, text: STORED_LINE })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w), 'the first stop moved to the pick').toEqual([isStale ? SLOT2 : SLOT3])
  // Seconds on, so the press's switch is another one by its time (`pending.since`), as a stop on the same instant is not.
  await clock.advance(5_000)
  await useNow($, clock, isStale ? '3' : '2')
  expect(slotValues(w), 'the press moved the session again, carrying nothing').toEqual(isStale ? [SLOT2, SLOT3] : [SLOT3, SLOT2])
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(whats(stopLogOf(store, w)).filter(line => line === 'carry-on armed'), 'the rider armed a second carry-on').toHaveLength(2)
  await resumeAnswers($, clock)
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('work resumed')), 'the episode ended before the rider is due').toHaveLength(1)
  await clock.advance(SETTLE_WAIT)
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('carry-on skipped')), 'the first stop\'s carry-on was overtaken by the press').toHaveLength(1)
  return w
}

test('HONEST-CARRY-ON: a stop that rides a settling Fable switch carries on with the words the stale pick armed, not the mod\'s unproven line, though the episode has ended', async ($, on) => {
  const w = await riderOnSettling($, on, 'stale')
  expect(w.submitted).toEqual([`${OWN_LEAD} ${STALE_NOTE} ${OWN_TAIL}`])
  expect(w.asUser, 'under the mod\'s name').toEqual([false])
})

test('HONEST-CARRY-ON: a stop that rides a settling Fable switch carries on with the stored line when the pick it carries on from read Fable room fresh, though the episode has ended', async ($, on) => {
  const w = await riderOnSettling($, on, 'fresh')
  expect(w.submitted).toEqual([STORED_LINE])
  expect(w.asUser, 'as the person\'s own words').toEqual([true])
})

/**
 * A Fable stop on login 1 whose switch the refresh guard holds (login 1's token refreshes in 7 minutes); the refresh nudge
 * goes, and login 1 answers it, so the hold is dropped and the person's turn is carried on once. No switch lands, so the
 * armed carry-on of a landing (carryOnAfterSettle) is not on this path: the words come from what the held pick armed.
 */
async function nudgeAnswered($: Engine, on: On, pick: 'stale' | 'fresh') {
  const isStale = pick === 'stale'
  const { w, store, clock } = await oldReadings($, on, isStale ? { two: [10, 10, 10], three: [100, 100, 100] } : { two: [100, 100, 100], three: [0, 0, 0] }, { isTwoRoomy: isStale, isNudged: true, text: STORED_LINE })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain(`held for ${isStale ? 2 : 3}: the token in use refreshes soon`)
  await clock.advance(3 * 60_000 + 15_000)
  expect(w.submitted, 'the nudge is out').toEqual([NUDGE_TEXT])
  await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
  await $.turn.complete({ turnId: 'turn-nudge', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(whats(stopLogOf(store, w)), 'the answer dropped the hold').toContain('held switch dropped: the refresh nudge answered on login 1')
  expect(slotValues(w), 'no switch landed').toEqual([])
  return w
}

test('HONEST-CARRY-ON: the carry-on after a refresh nudge goes with the words the held stale pick armed, never the stored line', async ($, on) => {
  const w = await nudgeAnswered($, on, 'stale')
  expect(w.submitted).toEqual([NUDGE_TEXT, `${OWN_LEAD} ${STALE_NOTE} ${OWN_TAIL}`])
  expect(w.asUser.at(-1), 'under the mod\'s name').toBe(false)
})

test('HONEST-CARRY-ON: the carry-on after a refresh nudge sends the stored line when the held pick read Fable room fresh', async ($, on) => {
  const w = await nudgeAnswered($, on, 'fresh')
  expect(w.submitted).toEqual([NUDGE_TEXT, STORED_LINE])
  expect(w.asUser.at(-1), 'as the person\'s own words').toBe(true)
})

// ---------------------------------------------------------------- puma-9arph.109.5: a window's marks end on a counter fall

/**
 * Login 1 is in use with its Fable week spent, login 2 is spent. Login 3 was stopped 15 minutes ago: its mark stands and its
 * stored body said `before` (week, Fable, 5-hour). Then the operator reset its usage by hand, and the endpoint says `live`
 * with every reset time as before (seen live: the reset time does not move). Its read is due in three minutes.
 */
async function manualResetOnThree($: Engine, on: On, kind: 'fable' | 'week' | 'five', before: { week: number; fable: number; five: number }, live: [number, number, number], isHeld = false) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [100, 100, 100]
  w.usage['tok-3'] = live
  const FIVE_RESET = '2026-10-12T12:00:00Z'
  const WEEK_3 = '2026-10-20T03:00:00Z'
  w.fableResetsBy = { 'tok-1': FABLE_RESET, 'tok-2': FABLE_RESET_2, 'tok-3': FABLE_RESET }
  w.weekResets = { 'tok-1': '2026-10-18T03:00:00Z', 'tok-2': '2026-10-19T03:00:00Z', 'tok-3': WEEK_3 }
  const at = NOW - 15 * 60_000
  const marks = {
    fable: { 'fable-mark:3': { pct: 100, resetsAt: FABLE_RESET, at } },
    week: { 'week-mark:3': { pct: 100, resetsAt: WEEK_3, at } },
    five: { 'mark:3': { pct: 100, resetsAt: FIVE_RESET, at } },
  }[kind]
  const store = new Map<string, unknown>(
    Object.entries({
      ...THREE_LOGINS,
      'rotate-to': 'room',
      ...marks,
      'usage:3': { fiveHour: { pct: before.five, resetsAt: FIVE_RESET }, sevenDay: { pct: before.week, resetsAt: WEEK_3 }, fable: { pct: before.fable, resetsAt: FABLE_RESET }, at, by: '3', v: 1, src: 'body' },
      'usage-due:3': { next: NOW + 3 * 60_000, fails: 0, at, v: 1 },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  const key = Object.keys(marks)[0] ?? ''
  if (isHeld) {
    // Login 3's body is answered, then waits before the mod reads it: another session's body can land meanwhile.
    const held = { isPaused: false, release: () => {} }
    const gate = new Promise<void>(resolve => {
      held.release = resolve
    })
    w.afterUsageBody = async token => {
      if (token !== 'tok-3' || held.isPaused) return
      held.isPaused = true
      await gate
    }
    // In steps, so the wait of a read stays inside the mod's 10-second limit on an answer.
    for (let waited = 0; waited < 10 * 60_000 && !held.isPaused; waited += 1_000) await clock.advance(1_000)
    expect(held.isPaused, 'the read of login 3 waits after its answer').toBe(true)
    return { w, store, clock, key, held }
  }
  // The schedule reads login 3: five minutes on, the read is due and claimed.
  await clock.advance(5 * 60_000)
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
  await clock.settle()
  return { w, store, clock, key }
}

const FIVE_RESET_3 = '2026-10-12T12:00:00Z'

const WEEK_RESET_3 = '2026-10-20T03:00:00Z'

/** The row another session saves for login 3: its body at `pct`, read at `at`. */
const bodyRowOfThree = (pct: number, at: number) => ({
  fiveHour: { pct, resetsAt: FIVE_RESET_3 },
  sevenDay: { pct, resetsAt: WEEK_RESET_3 },
  fable: { pct, resetsAt: FABLE_RESET },
  at,
  by: '3',
  v: 1,
  src: 'body',
})

for (const kind of ['fable', 'week', 'five'] as const) {
  test(`RESET-ORDER: a body that began before the stored body was saved ends no ${kind} mark and does not overwrite the newer row (A reads 90, B saves 96)`, async ($, on) => {
    const { store, clock, key, held } = await manualResetOnThree($, on, kind, { week: 100, fable: 100, five: 100 }, [90, 90, 90], true)
    await clock.advance(1_000)
    // Session B read the same login after A's request began, and saved 96 first.
    store.set('usage:3', bodyRowOfThree(96, clock.now()))
    held.release()
    await clock.settle()
    expect(store.get(key), 'A\'s older 90 is no counter fall: the mark stands').toBeDefined()
    expect((store.get('usage:3') as { sevenDay?: { pct: number } }).sevenDay?.pct, 'B\'s newer 96 stays').toBe(96)
  })

  test(`RESET-ORDER: a body that began before the ${kind} mark was written ends nothing`, async ($, on) => {
    const { store, clock, key, held } = await manualResetOnThree($, on, kind, { week: 100, fable: 100, five: 100 }, [0, 0, 0], true)
    await clock.advance(1_000)
    // A stop marks the window after A's request began: A's numbers are from before the stop.
    store.set(key, { ...(store.get(key) as object), at: clock.now() })
    held.release()
    await clock.settle()
    expect(store.get(key), 'the mark is newer than the body').toBeDefined()
  })
}

for (const [kind, stop] of [['fable', FABLE_STOP], ['week', { error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] }], ['five', { error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] }]] as const) {
  test(`MARKS-END-ON-FALL: a manual reset of login 3 (100 to 0, the same reset times) ends its ${kind} mark at the next read, and the next stop picks it fresh`, async ($, on) => {
    const { w, store, clock, key } = await manualResetOnThree($, on, kind, { week: 100, fable: 100, five: 100 }, [0, 0, 0])
    expect(markStands(store, key), 'the mark ended at the read, though it is 20 minutes old').toBe(false)
    await $.classic.StopFailure(stop)
    await clock.settle()
    const row = store.get('usage:3') as { fiveHour?: { pct: number }; sevenDay?: { pct: number }; fable?: { pct: number } } | undefined
    expect([row?.sevenDay?.pct, row?.fable?.pct, row?.fiveHour?.pct], 'the stored row of login 3 reads the manual reset (week, Fable, 5-hour), not its old 100').toEqual([0, 0, 0])
    expect(slotValues(w), 'the stop moves to login 3').toEqual([SLOT3])
    expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('picked '))).toEqual([expect.stringMatching(/^picked 3: fresh, read \d+ min ago; tried 1$/)])
  })

  test(`guard: a lagging read that sits near its stop (96 then 97) keeps the ${kind} mark`, async ($, on) => {
    const { store, key } = await manualResetOnThree($, on, kind, { week: 96, fable: 96, five: 96 }, [97, 97, 97])
    expect(store.get(key), 'the mark stands').toBeDefined()
  })
}

test('SPENT-OLD-GATE: a body 30 s old that the minute gate keeps from being read again is no live read: the login is tried blind, not counted spent', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  // Login 2's usage was reset since its last body, which said 100 thirty seconds before the stop.
  w.usage['tok-2'] = [0, 0, 0]
  w.fableResetsBy = { 'tok-1': FABLE_RESET, 'tok-2': FABLE_RESET_2 }
  const at = NOW - 30_000
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'usage:2': { fiveHour: { pct: 100, resetsAt: '2026-10-12T12:00:00Z' }, sevenDay: { pct: 100, resetsAt: WEEK_RESET }, fable: { pct: 100, resetsAt: FABLE_RESET_2 }, at, by: '2', v: 1, src: 'body' },
      'usage-due:2': { next: NOW + HOUR, fails: 0, at, v: 1 },
      'fable-mark:2': { pct: 100, resetsAt: FABLE_RESET_2, at },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(w.usageCalls.filter(token => token === 'tok-2'), 'the gate kept the read from being made').toEqual([])
  expect(whats(stopLogOf(store, w))).toContain('not read live: read gate: 2')
  expect(slotValues(w), 'login 2 is the only candidate and is tried').toEqual([SLOT2])
})

// ---------------------------------------------------------------- Codex final round 2

/**
 * The session runs on login 3, whose last body read `first` percent of every window, with a mark standing 10 minutes old on
 * `kind`. A response then stores `response` percent over that row; the next body, due in ten minutes, reads `live`.
 */
/** What the body path keeps of a body read, under its session's own key `usage-body:<id>:<session mark>`: its time and its windows. */
const THREE_BY = 'three@example.com|org-three@example.com'

const bodyOfThree = (pct: number, at: number) => ({ at, by: THREE_BY, fiveHour: { pct, resetsAt: FIVE_RESET_3 }, sevenDay: { pct, resetsAt: WEEK_RESET_3 }, fable: { pct, resetsAt: FABLE_RESET } })

async function markedOnThree($: Engine, on: On, kind: 'week' | 'five' | 'fable', first: number, live: number) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT3
  w.usage['tok-1'] = [20, 30, 21]
  w.usage['tok-2'] = [20, 30, 21]
  w.usage['tok-3'] = [live, live, live]
  w.fableResetsBy = { 'tok-1': FABLE_RESET, 'tok-2': FABLE_RESET_2, 'tok-3': FABLE_RESET }
  w.weekResets = { 'tok-1': '2026-10-18T03:00:00Z', 'tok-2': '2026-10-19T03:00:00Z', 'tok-3': WEEK_RESET_3 }
  const marks = {
    week: { 'week-mark:3': { pct: 100, resetsAt: WEEK_RESET_3, at: NOW - 10 * 60_000 } },
    five: { 'mark:3': { pct: 100, resetsAt: FIVE_RESET_3, at: NOW - 10 * 60_000 } },
    fable: { 'fable-mark:3': { pct: 100, resetsAt: FABLE_RESET, at: NOW - 10 * 60_000 } },
  }
  const mark = marks[kind]
  const store = new Map<string, unknown>(
    Object.entries({
      ...THREE_LOGINS,
      ...mark,
      'usage:3': bodyRowOfThree(first, NOW - 15 * 60_000),
      'usage-body:3:session-other': bodyOfThree(first, NOW - 15 * 60_000),
      'usage-due:3': { next: NOW + 10 * 60_000, fails: 0, at: NOW - 15 * 60_000, v: 1 },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock, true)
  await clock.advance(60_000)
  return { w, store, clock, key: Object.keys(mark)[0] ?? '' }
}

async function responseBetweenBodies($: Engine, on: On, kind: 'week' | 'five', first: number, response: number, live: number) {
  const { w, store, clock, key } = await markedOnThree($, on, kind, first, live)
  w.limits = limitsOf(response, response, WEEK_RESET_3)
  await respond($, clock, w)
  expect((store.get('usage:3') as { src?: string }).src, 'a response is stored over the body row').toBe('response')
  for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
  await clock.settle()
  expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
  return { store, key }
}

for (const kind of ['week', 'five'] as const) {
  test(`BODY-BASELINE-RACE: a response saved over a newer body does not bring the older body back as the baseline (96, 94 saved during the response, 91): the ${kind} mark stands`, async ($, on) => {
    const { w, store, clock, key } = await markedOnThree($, on, kind, 96, 91)
    // The response save reads login 3's row (body 96) and waits there.
    const held = { isArmed: true, isPaused: false, open: () => {} }
    const gate = new Promise<void>(resolve => {
      held.open = resolve
    })
    w.afterStoreGet = async storeKey => {
      if (!held.isArmed || storeKey !== 'usage:3') return
      held.isArmed = false
      held.isPaused = true
      await gate
    }
    w.limits = limitsOf(100, 100, WEEK_RESET_3)
    const responding = $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
    await clock.advance(1_000)
    expect(held.isPaused, 'the response save waits after reading the row').toBe(true)
    // Another session's body 94 is saved meanwhile, as the body path saves it: the row and its own baseline key.
    store.set('usage:3', bodyRowOfThree(94, clock.now()))
    store.set('usage-body:3:session-y', bodyOfThree(94, clock.now()))
    held.open()
    await responding
    await clock.settle()
    w.afterStoreGet = undefined
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
    expect(store.get(key), 'body to body is 94 to 91: no reset').toBeDefined()
  })
}

for (const kind of ['week', 'five'] as const) {
  test(`BODY-BASELINE: a body that fell 2 points from the previous body ends no ${kind} mark, though a response stored 100 between them (96, response 100, 94)`, async ($, on) => {
    const { store, key } = await responseBetweenBodies($, on, kind, 96, 100, 94)
    expect(store.get(key), 'body to body is a fall of 2').toBeDefined()
  })

  test(`guard: a fall from the previous body ends the ${kind} mark, a response between them or not (100, response 98, 0)`, async ($, on) => {
    const { store, key } = await responseBetweenBodies($, on, kind, 100, 98, 0)
    expect(markStands(store, key)).toBe(false)
  })
}

// A model-family limit marks no window and counts as the login's try. With no login free it owes the ordinary carry-on debt,
// dated at the reset its words name; with no usable reset it owes nothing and says so once. A freed login is used only at
// the next stop or Use now.
const OPUS_AT_4PM = { error: 'rate_limit', last_assistant_message: "You've hit your Opus limit · resets 4pm (Europe/Tallinn)" }

const OPUS_AT_6PM = { error: 'rate_limit', last_assistant_message: "You've hit your Opus limit · resets 6pm (Europe/Tallinn)" }

const OPUS_NO_ZONE = { error: 'rate_limit', last_assistant_message: "You've hit your Opus limit · resets 3:45pm" }

/** 4pm in Tallinn is 13:00Z on the test's day, three hours on, and 6pm is 15:00Z. */
const AT_1PM_Z = Date.parse('2026-10-12T13:00:00Z')

/** Login 1 in use; login 2 is spent until 11:00Z, an hour on, so it has freed well before the model family's reset. */
async function modelStopWithTwoSpent(on: On, stop: { error: string; last_assistant_message: string }, $: Engine) {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30, 21]
  w.usage['tok-2'] = [100, 30, 21]
  w.fiveHourResets = { 'tok-2': '2026-10-12T11:00:00Z' }
  let last: View | undefined
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view') last = value
    return next(e)
  })
  await start($, clock)
  await $.classic.StopFailure(stop)
  await clock.settle()
  return { w, store, clock, view: () => last }
}

/** Ticks in `step` minutes until `clock` passes `until` (epoch ms). */
async function tickUntil(clock: MockClock, until: number, step = 5): Promise<void> {
  while (clock.now() < until) {
    await clock.advance(step * 60_000)
    await clock.settle()
  }
}

test('MODEL-DEBT-RELOAD: a model stop with a known reset owes the ordinary persisted debt dated at that reset, and sends nothing before it', { timeoutMs: 30_000 }, async ($, on) => {
  const { w, clock, view } = await modelStopWithTwoSpent(on, OPUS_AT_4PM, $)
  // The record a reload restores is the view's carryDue: dated at the family's reset, not at the hour login 2 frees.
  expect(view()?.carryDue, 'what a reload restores').toMatchObject({ at: AT_1PM_Z, from: '1' })
  await tickUntil(clock, AT_1PM_Z - 5 * 60_000)
  expect(w.submitted, 'login 2 freed at 11:00Z: no move, no carry-on before the reset').toEqual([])
  expect(slotValues(w)).toEqual([])
  await tickUntil(clock, AT_1PM_Z + 10 * 60_000)
  expect(w.submitted, 'at the reset it carries on, on the same login').toHaveLength(1)
  expect(slotValues(w)).toEqual([])
})

test('MODEL-UNKNOWN-RESET: a model stop whose words give no usable reset owes no carry-on, and says so once', { timeoutMs: 30_000 }, async ($, on) => {
  const { w, clock, view } = await modelStopWithTwoSpent(on, OPUS_NO_ZONE, $)
  expect(view()?.carryDue, 'nothing owed').toBeUndefined()
  expect(w.toasts.filter(t => /model limit/.test(t) && /reset/.test(t)), 'told once').toHaveLength(1)
  await tickUntil(clock, AT_1PM_Z + HOUR)
  expect(w.submitted, 'no retry loop').toEqual([])
  expect(slotValues(w)).toEqual([])
})

test('MODEL-DEBT-STALE: a later model stop on the same login moves the debt\'s date later, and nothing goes at the earlier one', { timeoutMs: 30_000 }, async ($, on) => {
  const { w, clock, view } = await modelStopWithTwoSpent(on, OPUS_AT_4PM, $)
  await clock.advance(30 * 60_000)
  await $.classic.StopFailure(OPUS_AT_6PM)
  await clock.settle()
  expect(view()?.carryDue, 'the date moved later').toMatchObject({ at: Date.parse('2026-10-12T15:00:00Z'), from: '1' })
  await tickUntil(clock, AT_1PM_Z + 20 * 60_000)
  expect(w.submitted, 'nothing at the earlier reset').toEqual([])
  await tickUntil(clock, Date.parse('2026-10-12T15:00:00Z') + 10 * 60_000)
  expect(w.submitted).toHaveLength(1)
  // An earlier date later never moves it back.
})

test('GREEN-TICK-MOVE: after a model stop, a person\'s new turn and then a freed login: no tick move and no second carry-on', { timeoutMs: 30_000 }, async ($, on) => {
  const { w, clock } = await modelStopWithTwoSpent(on, OPUS_AT_4PM, $)
  await clock.advance(5 * 60_000)
  await $.turn.start({ text: 'working by hand', turnId: 'by-hand' })
  await tickUntil(clock, AT_1PM_Z + 30 * 60_000)
  expect(slotValues(w), 'the freed login is not moved to by a tick').toEqual([])
  expect(w.submitted, 'the carry-on is not sent over the person\'s own work').toEqual([])
})

// ---------------------------------------------------------------- PR A follow-ups: the two BLOCKs of Codex's last round on #161
// https://code.claude.com/docs/en/plugins/mods/interface.md: "A `get` followed by a `set` isn't atomic": no two sessions write one key.

/**
 * Login 3's body, read by this session, answers `live` where `first` was the last body's percent (another session's key),
 * and waits after it read its baseline, for a test that saves another session's newer body then. A mark stands 10 minutes old.
 */
async function heldBody($: Engine, on: On, kind: 'week' | 'five', first: number, live: number) {
  const { w, store, clock, key } = await markedOnThree($, on, kind, first, live)
  const held = { isPaused: false, open: () => {} }
  const gate = new Promise<void>(resolve => {
    held.open = resolve
  })
  const written: string[] = []
  w.onStoreSet = storeKey => {
    if (storeKey.startsWith('usage-body:3')) written.push(storeKey)
  }
  w.afterStoreGet = async storeKey => {
    if (held.isPaused || !storeKey.startsWith('usage-body:3')) return
    held.isPaused = true
    await gate
  }
  for (let waited = 0; waited < 12 * 60_000 && !held.isPaused; waited += 1_000) await clock.advance(1_000)
  expect(held.isPaused, 'the body of login 3 waits after reading its baseline').toBe(true)
  await clock.advance(1_000)
  return { w, store, clock, key, written, release: () => { w.afterStoreGet = undefined; held.open() } }
}

for (const kind of ['week', 'five'] as const) {
  test(`BODY-WRITE-ORDER: a body (96) that waits after reading its baseline (98) while another session saves a newer one (94) leaves 94 the baseline of the next body (91): the ${kind} mark stands`, async ($, on) => {
    const { w, store, clock, key, release } = await heldBody($, on, kind, 98, 96)
    store.set('usage-body:3:session-y', bodyOfThree(94, clock.now()))
    store.set('usage:3', bodyRowOfThree(94, clock.now()))
    release()
    await clock.settle()
    const heldAt = (store.get('usage:3') as { at: number }).at
    w.usage['tok-3'] = [91, 91, 91]
    // No response since the held body: the schedule reads login 3 again 30 minutes after it.
    for (let waited = 0; waited < 35 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { at: number; sevenDay?: { pct: number } }).sevenDay?.pct, 'the next body, 91, is stored').toBe(91)
    expect((store.get('usage:3') as { at: number }).at).toBeGreaterThan(heldAt)
    expect(store.get(key), 'body to body is 94 to 91: no reset').toBeDefined()
  })

  // Codex pr-b-r3: a key is written once, named by the time of its body and its session, and never rewritten by anyone.
  test(`BODY-WRITE-ORDER class: the ${kind} body path writes each body under a new key of its read time and its session, and no key twice`, async ($, on) => {
    const { w, store, clock, written, release } = await heldBody($, on, kind, 98, 96)
    store.set('usage-body:3:session-y', bodyOfThree(94, clock.now()))
    release()
    await clock.settle()
    // The next body, 30 minutes on with no response between.
    for (let waited = 0; waited < 35 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect(written.length, 'two bodies were saved').toBeGreaterThanOrEqual(2)
    expect(new Set(written).size, 'no key was written twice').toBe(written.length)
    const own = new RegExp(`^usage-body:3:\\d+:${w.otherEnv.ACCOUNT_ROTATOR_SESSION}$`)
    expect(written.filter(key => !own.test(key)), 'every key is this session\'s own, named by its time').toEqual([])
  })
}

for (const kind of ['week', 'five'] as const) {
  test(`guard: of two other sessions' bodies the newest is the baseline, so a fall from it ends the ${kind} mark (100 at -15 min, 50 at -3 h, then 0)`, async ($, on) => {
    const { w, store, clock, key } = await markedOnThree($, on, kind, 100, 0)
    // Before the next body, due in nine minutes.
    store.set('usage-body:3:session-old', bodyOfThree(50, NOW - 3 * HOUR))
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
    expect(markStands(store, key), 'the mark ended: 100 to 0').toBe(false)
    void w
  })
}

// Council store-races: a mark ends only on the newest visible body of the SAME account identity and the SAME window, 5 or more
// points higher. https://code.claude.com/docs/en/plugins/mods/interface.md: "A `get` followed by a `set` isn't atomic".
const OTHER_BY = 'other@example.com|org-other@example.com'

/** A body of login 3 whose windows reset a week and a day on from the mark's own: another window of each kind. */
const bodyOfAnotherWindow = (pct: number, at: number, by: string = THREE_BY) => ({
  at,
  by,
  fiveHour: { pct, resetsAt: '2026-10-12T17:00:00Z' },
  sevenDay: { pct, resetsAt: '2026-10-27T03:00:00Z' },
  fable: { pct, resetsAt: '2026-10-24T03:00:00Z' },
})

for (const kind of ['week', 'five'] as const) {
  for (const why of ['another account', 'no identity'] as const) {
    test(`BODY-IDENTITY: a body read under ${why} is no baseline, so a lower read (100, then 94) ends no ${kind} mark`, async ($, on) => {
      const { store, clock, key } = await markedOnThree($, on, kind, 100, 94)
      const { by: _by, ...unnamed } = bodyOfThree(100, NOW - 15 * 60_000)
      store.set('usage-body:3:session-other', why === 'no identity' ? unnamed : { ...unnamed, by: OTHER_BY })
      for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
      await clock.settle()
      expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
      expect(store.get(key), 'a fall of 6 from no account\'s own body: the mark stands').toBeDefined()
    })
  }

  test(`BODY-WINDOW: the baseline is the newest body that holds the kind, whatever its window: a newer body of another window leaves a lagging read of the older one (96, new window 20, then 90) no proof, so the ${kind} mark stands`, async ($, on) => {
    const { store, clock, key } = await markedOnThree($, on, kind, 96, 90)
    store.set('usage-body:3:session-newer', bodyOfAnotherWindow(20, NOW - 5 * 60_000))
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
    expect(store.get(key), 'the newest body is of another window: no baseline, no proof').toBeDefined()
  })

  test(`guard: a newer body that lacks the kind does not hide an older body that holds it, so 100 then 94 ends the ${kind} mark`, async ($, on) => {
    const { store, clock, key } = await markedOnThree($, on, kind, 100, 94)
    store.set('usage-body:3:session-newer', { at: NOW - 5 * 60_000, by: THREE_BY, fable: { pct: 20, resetsAt: FABLE_RESET } })
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
    expect(markStands(store, key), 'a fall of 6 from the body that holds the kind').toBe(false)
  })

  test(`guard: a lower read of another window than the only body's ends no ${kind} mark (100 of another window, then 94)`, async ($, on) => {
    const { store, clock, key } = await markedOnThree($, on, kind, 100, 94)
    store.set('usage-body:3:session-other', bodyOfAnotherWindow(100, NOW - 15 * 60_000))
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
    expect(store.get(key)).toBeDefined()
  })

  test(`guard: after a real reset and a new stop the newest body, not the highest, is the baseline, so a lagging read (2 at -15 min, 100 at -3 h, then 90) ends no ${kind} mark`, async ($, on) => {
    const { store, clock, key } = await markedOnThree($, on, kind, 2, 90)
    store.set('usage-body:3:session-old', bodyOfThree(100, NOW - 3 * HOUR))
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
    expect(store.get(key), 'a rise from the newest body, a fall only from the highest').toBeDefined()
  })

  test(`guard: a completed read whose key is not visible only delays the ${kind} mark's end to the next read (visible 98, invisible 100, reads 94 then 80)`, async ($, on) => {
    const { w, store, clock, key } = await markedOnThree($, on, kind, 98, 94)
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect(store.get(key), 'a fall of 4 from the visible body: delayed, not ended').toBeDefined()
    w.usage['tok-3'] = [80, 80, 80]
    for (let waited = 0; waited < 35 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect(markStands(store, key), 'the next read falls from the body the last one wrote').toBe(false)
  })

  test(`guard: the shared row is no baseline, so a row written out of order (100) over the newest body (96) leaves a read of 94 to end no ${kind} mark`, async ($, on) => {
    const { store, clock, key } = await markedOnThree($, on, kind, 96, 94)
    store.set('usage:3', bodyRowOfThree(100, NOW - 14 * 60_000))
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { src?: string }).src, 'the next body is stored').toBe('body')
    expect(store.get(key), 'a fall of 2 from the newest body').toBeDefined()
  })
}

// Codex pr-b-r7 B1: ending a proven mark deletes or rewrites no key another session could have just written: it writes a
// record naming that exact mark (`mark-end:<kind>:<id>:<mark.at>`), which a mark of another `at` never meets.
const NEW_WINDOW_MARK_RESET = { week: '2026-10-27T03:00:00Z', five: '2026-10-12T17:00:00Z', fable: '2026-10-24T03:00:00Z' }

const VIEW_MARKS = { week: 'weekMarks', five: 'marks', fable: 'fableMarks' } as const

for (const kind of ['week', 'five', 'fable'] as const) {
  test(`MARK-END: the ${kind} mark another session writes for a new window while a proven end of the old one is under way stands`, async ($, on) => {
    const { w, store, clock, key } = await markedOnThree($, on, kind, 100, 0)
    const newMark = { pct: 100, resetsAt: NEW_WINDOW_MARK_RESET[kind], at: NOW + 8 * 60_000 }
    const written = { isDone: false }
    const writeNew = () => {
      if (written.isDone) return
      written.isDone = true
      store.set(key, newMark)
    }
    // Session B writes its mark right after this session's check read the old one and the bodies, as the end is under way.
    const seen = { hasBodies: false }
    w.afterStoreGet = async storeKey => {
      if (storeKey.startsWith('usage-body:3:')) seen.hasBodies = true
      else if (seen.hasBodies && storeKey === key) writeNew()
    }
    for (let waited = 0; waited < 12 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    w.afterStoreGet = undefined
    writeNew()
    for (let waited = 0; waited < 3 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { src?: string }).src, 'the body is stored').toBe('body')
    expect(store.get(key), 'the new window\'s mark is whole').toEqual(newMark)
    expect([...store.keys()].filter(k => k.startsWith('mark-end:') && k.endsWith(`:${newMark.at}`)), 'and no end names it').toEqual([])
  })

  test(`guard: a proven end of the ${kind} mark removes it from the view across the merge of the minute's tick`, async ($, on) => {
    let last: View | undefined
    on('state.set', async (_$, e, next) => {
      const { key, value } = e as unknown as { key: string; value: View }
      if (key === 'view') last = value
      return next(e)
    })
    const { clock } = await markedOnThree($, on, kind, 100, 0)
    expect(last?.[VIEW_MARKS[kind]]?.['3'], 'the mark is in the view before the end').toBeDefined()
    for (let waited = 0; waited < 15 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect(last?.[VIEW_MARKS[kind]]?.['3'], 'the view no longer holds the ended mark').toBeUndefined()
  })
}

test('MARK-END: a proven end is a record naming the mark, and the end records whose reset has passed go with the next body', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30, 21]
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'mark-end:week:1:100': { resetsAt: '2026-10-05T03:00:00Z' },
      'mark-end:week:1:200': { resetsAt: '2026-10-20T03:00:00Z' },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  expect([store.has('mark-end:week:1:100'), store.has('mark-end:week:1:200')]).toEqual([false, true])
})

test('MARK-END: a sign-in as another account keeps the end records, so an ended mark stays ended and a new mark stands', async ($, on) => {
  let last: View | undefined
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view') last = value
    return next(e)
  })
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30, 40]
  const ended = { pct: 100, resetsAt: '2026-10-20T03:00:00Z', at: NOW - HOUR }
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'holder:1': { token: 'a-token-that-is-not-this-one', who: { email: 'nine@example.com' } },
      'week-mark:1': ended,
      [`mark-end:week:1:${ended.at}`]: { resetsAt: ended.resetsAt },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.has(`mark-end:week:1:${ended.at}`), 'the record stays until its reset has passed').toBe(true)
  expect(last?.weekMarks?.['1'], 'the ended mark does not come back on the new account').toBeUndefined()
  const fresher = { pct: 100, resetsAt: '2026-10-21T03:00:00Z', at: NOW + 60_000 }
  store.set('week-mark:1', fresher)
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(last?.weekMarks?.['1'], 'a new mark stands').toEqual(fresher)
})

test('MARK-END: removing a login deletes the end records of it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'mark:2': { pct: 100, resetsAt: '2026-10-20T03:00:00Z', at: 5 },
      'mark-end:five:2:5': { resetsAt: '2026-10-20T03:00:00Z' },
      'mark-end:week:1:5': { resetsAt: '2026-10-20T03:00:00Z' },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  expect([store.has('mark-end:five:2:5'), store.has('mark:2'), store.has('mark-end:week:1:5')], 'its marks and their end records go, another login\'s record stays').toEqual([false, false, true])
  await pane.unmount()
})

test('BODY-IDENTITY: the key a body read writes names the account, never a token', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30, 21]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS }))
  const clock = world(on, w, store)
  await start($, clock)
  const own = [...store.entries()].filter(([k]) => k.startsWith('usage-body:1:'))
  expect(own).toHaveLength(1)
  const by = (own[0]?.[1] as { by?: unknown }).by
  expect([typeof by, String(by).includes('example.com'), String(by).includes('tok-1')]).toEqual(['string', true, false])
})

test('BODY-KEYS: a refused write of the body key is logged and the read stands, with no check error and the health stored', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30, 21]
  w.storeWriteFails = 'usage-body:'
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS }))
  const clock = world(on, w, store)
  await start($, clock)
  expect((store.get('usage:1') as { sevenDay?: { pct: number } } | undefined)?.sevenDay?.pct, 'the read is stored').toBe(30)
  expect(store.get('check-error:1'), 'no failed check').toBeUndefined()
  expect(store.has('health:1'), 'the check went on to store the health').toBe(true)
  expect((w.logged ?? []).filter(line => line.includes('body key') && line.includes('not written'))).toHaveLength(1)
})

test('BODY-KEYS: a body check deletes the body keys of a login that are over a week old and keeps the newer ones', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30, 21]
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'usage-body:1:session-old': { at: NOW - 8 * DAY, sevenDay: { pct: 5, resetsAt: '2026-10-05T03:00:00Z' } },
      'usage-body:1:session-recent': { at: NOW - HOUR, sevenDay: { pct: 5, resetsAt: WEEK_RESET } },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  const keys = [...store.keys()].filter(k => k.startsWith('usage-body:1:'))
  const own = new RegExp(`^usage-body:1:\\d+:${w.otherEnv.ACCOUNT_ROTATOR_SESSION}$`)
  expect([keys.includes('usage-body:1:session-old'), keys.includes('usage-body:1:session-recent'), keys.filter(k => own.test(k)).length]).toEqual([false, true, 1])
})

test('BODY-KEYS: removing a login deletes every session\'s body key of it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(
    // `usage-body:2` is the key part A's first version wrote, with no session in it.
    Object.entries({ ...TWO_LOGINS, 'usage-body:2': { at: NOW - HOUR }, 'usage-body:2:session-a': { at: NOW - HOUR }, 'usage-body:2:session-b': { at: NOW - HOUR }, 'usage-body:1:session-a': { at: NOW - HOUR } }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  expect([...store.keys()].filter(k => k.startsWith('usage-body:2'))).toEqual([])
  expect(store.has('usage-body:1:session-a'), 'another login\'s key stays').toBe(true)
  await pane.unmount()
})

/**
 * A Fable stop's twin: login 1's Opus limit with login 2 spent owes a carry-on dated 13:00Z. A tick at that time begins to
 * clear it, and its write of the view waits, while a later Opus stop owes one for 15:00Z.
 */
test('MODEL-DEBT-CLEAR: a tick clearing the model debt it read sends nothing when a later model stop owes a later debt during the clear', { timeoutMs: 30_000 }, async ($, on) => {
  // modelStopWithTwoSpent's world, with a view write that can wait: a hook is registered before the first call on `$`.
  const w = fresh()
  const { clock, store } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30, 21]
  // Login 2 stays spent past the later stop, so that stop finds no login to move to and owes a debt of its own.
  w.usage['tok-2'] = [100, 30, 21]
  w.fiveHourResets = { 'tok-2': '2026-10-12T17:00:00Z' }
  let last: View | undefined
  const held = { isPaused: false, open: () => {} }
  const gate = new Promise<void>(resolve => {
    held.open = resolve
  })
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key !== 'view') return next(e)
    last = value
    if (!held.isPaused && value.carryDue === undefined && clock.now() >= AT_1PM_Z) {
      held.isPaused = true
      await gate
    }
    return next(e)
  })
  const view = () => last
  await start($, clock)
  await $.classic.StopFailure(OPUS_AT_4PM)
  await clock.settle()
  await tickUntil(clock, AT_1PM_Z - 3 * 60_000)
  for (let waited = 0; waited < 20 * 60_000 && !held.isPaused; waited += 1_000) await clock.advance(1_000)
  expect(held.isPaused, 'the tick at the debt\'s date waits while it clears the debt').toBe(true)
  await $.classic.StopFailure(OPUS_AT_6PM)
  await clock.settle()
  held.open()
  await clock.settle()
  // Past the settle a carry-on takes before it is submitted.
  await clock.advance(60_000)
  await clock.settle()
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('moved to')), 'no login to move to').toEqual([])
  expect(w.submitted, 'the debt the tick read is not sent: a later one stands').toEqual([])
  expect(view()?.carryDue, 'the later debt stands').toMatchObject({ at: Date.parse('2026-10-12T15:00:00Z'), from: '1' })
  await tickUntil(clock, Date.parse('2026-10-12T15:00:00Z') + 10 * 60_000)
  expect(w.submitted, 'the later debt goes at its own date').toHaveLength(1)
})

/**
 * MODEL-DEBT-CLEAR's world with its one tick at the debt's date held at `where`, while a later Opus stop owes a later debt:
 * 'after-read' holds the view read that follows the clear, 'mark' the view read markCarryEnded makes (the clear is refused,
 * so the debt is marked ended), 'carry-read' the second view read after the clear, which carryOn makes before it submits.
 */
async function laterDebtDuringTick($: Engine, on: On, where: 'clear' | 'after-read' | 'mark' | 'carry-read' | 'moved', isTurnRun = false, isEnded = false) {
  const w = fresh()
  const { clock, store } = await loggedWorld(on, w)
  w.usage['tok-1'] = [20, 30, 21]
  w.usage['tok-2'] = [100, 30, 21]
  w.fiveHourResets = { 'tok-2': '2026-10-12T17:00:00Z' }
  let last: View | undefined
  let readsSinceClear = 0
  let isClearSeen = false
  const held = { isPaused: false, open: () => {} }
  const gate = new Promise<void>(resolve => {
    held.open = resolve
  })
  const pause = async () => {
    if (held.isPaused) return
    held.isPaused = true
    await gate
  }
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key !== 'view') return next(e)
    const isClear = !isClearSeen && value.carryDue === undefined && last?.carryDue !== undefined && clock.now() >= AT_1PM_Z
    if (isClear) isClearSeen = true
    if (isClear && (where === 'mark' || where === 'moved')) return { deny: 'state: refused' } as unknown as Awaited<ReturnType<typeof next>>
    last = value
    if (isClear && where === 'clear') await pause()
    return next(e)
  })
  on('state.get', async (_$, e, next) => {
    const read = await next(e)
    if (e.plugin !== 'account-rotator' || e.key !== 'view' || !isClearSeen || held.isPaused) return read
    readsSinceClear += 1
    if (readsSinceClear === (where === 'after-read' || where === 'moved' ? 1 : 2)) await pause()
    // 'moved': the read after the clear finds the session on login 2, as after a move that left the debt owed.
    if (where === 'moved' && readsSinceClear === 1 && read.value !== undefined) {
      return { value: { ...read.value, value: { ...(read.value.value as View), activeId: '2' } } }
    }
    return read
  })
  await start($, clock)
  await $.classic.StopFailure(OPUS_AT_4PM)
  await clock.settle()
  // A main turn since the stop: the tick's own line for the debt says so, and sends nothing.
  if (isTurnRun) await $.turn.start({ text: 'working by hand', turnId: 'by-hand' })
  await tickUntil(clock, AT_1PM_Z - 3 * 60_000)
  for (let waited = 0; waited < 20 * 60_000 && !held.isPaused; waited += 1_000) await clock.advance(1_000)
  expect(held.isPaused, `the tick at the debt's date waits at its ${where}`).toBe(true)
  await $.classic.StopFailure(OPUS_AT_6PM)
  await clock.settle()
  // A person's Use now of login 2 ends the later debt, while the tick still holds the old one.
  if (isEnded) await useNow($, clock, '2')
  held.open()
  await clock.settle()
  // Past the settle a carry-on takes before it is submitted.
  await clock.advance(60_000)
  await clock.settle()
  if (!isEnded) expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('moved to')), 'no login to move to').toEqual([])
  return { w, clock, store, view: () => last }
}

/** Sends nothing at the earlier date, keeps the later debt in the view, and sends one carry-on at its own date. */
async function expectLaterDebtStands({ w, clock, view }: Awaited<ReturnType<typeof laterDebtDuringTick>>) {
  expect(w.submitted, 'the debt the tick read is not sent: a later one stands').toEqual([])
  expect(view()?.carryDue, 'the later debt stands').toMatchObject({ at: Date.parse('2026-10-12T15:00:00Z'), from: '1' })
  await tickUntil(clock, Date.parse('2026-10-12T15:00:00Z') + 10 * 60_000)
  expect(w.submitted, 'the later debt goes at its own date').toHaveLength(1)
}

// puma-9arph.109.11: the four awaits of carryOnWhenFree after `const owed = due`. (1) the clear: MODEL-DEBT-CLEAR above.
test('MODEL-DEBT-AFTER-READ guard: a later model stop owing a later debt while the tick reads the view after the clear sends nothing of the old debt', { timeoutMs: 30_000 }, async ($, on) => {
  await expectLaterDebtStands(await laterDebtDuringTick($, on, 'after-read'))
})

test('MODEL-DEBT-MARK guard: a later model stop owing a later debt while the tick marks the old debt ended sends nothing of the old debt', { timeoutMs: 30_000 }, async ($, on) => {
  const held = await laterDebtDuringTick($, on, 'mark')
  // The clear was refused, so the view held the old debt: the store marks it ended, and not the later one.
  const ended = carryEndedOf(held.store, held.w)?.owedAt
  const later = held.view()?.carryDue?.owedAt
  expect(ended !== undefined && later !== undefined && ended < later, `the old debt (${ended}) is marked ended, the later one (${later}) is not`).toBe(true)
  await expectLaterDebtStands(held)
})

/**
 * The later debt a stop owed during the tick's await has ended again (a Use now): `due` is undefined as before the stop, yet
 * the tick's debt was superseded and sends nothing. Only the tick's own line, CONTINUE_RESET's text, is looked for: the
 * press's own carry-on is its own.
 */
for (const where of ['clear', 'after-read', 'mark', 'carry-read'] as const) {
  // At the clear the read that follows finds the session moved by that Use now, so the move check already holds.
  test(`MODEL-DEBT-ABA-${where.toUpperCase()}${where === 'clear' ? ' guard' : ''}: a later model stop's debt that a Use now ended again during the tick's ${where} leaves the old carry-on unsent`, { timeoutMs: 30_000 }, async ($, on) => {
    const { w } = await laterDebtDuringTick($, on, where, false, true)
    expect(w.submitted.filter(text => /usage limit has reset/.test(text)), 'the superseded debt is not sent').toEqual([])
  })
}

test('MODEL-DEBT-MOVED: a later model stop owing a later debt while a refused clear and a login that moved are read marks the old debt ended and holds nothing', { timeoutMs: 30_000 }, async ($, on) => {
  const held = await laterDebtDuringTick($, on, 'moved')
  expect(whats(stopLogOf(held.store, held.w)).filter(line => line.startsWith('carry-on held')), 'the old debt is not held for the move').toEqual([])
  const ended = carryEndedOf(held.store, held.w)?.owedAt
  const later = held.view()?.carryDue?.owedAt
  expect(ended !== undefined && later !== undefined && ended < later, `the old debt (${ended}) is marked ended, the later one (${later}) is not`).toBe(true)
  await expectLaterDebtStands(held)
})

test('MODEL-DEBT-MARK-TURN: a later model stop owing a later debt while the tick marks a debt a turn has since overtaken logs no verdict on the old debt', { timeoutMs: 30_000 }, async ($, on) => {
  const held = await laterDebtDuringTick($, on, 'mark', true)
  expect(whats(stopLogOf(held.store, held.w)).filter(line => line.startsWith('a turn ran since the stop')), 'the old debt gets no verdict').toEqual([])
  expect(held.view()?.carryDue, 'the later debt stands').toMatchObject({ at: Date.parse('2026-10-12T15:00:00Z'), from: '1' })
})

test('MODEL-DEBT-CARRY-READ: a later model stop owing a later debt while carryOn reads before it submits sends nothing of the old debt', { timeoutMs: 30_000 }, async ($, on) => {
  const held = await laterDebtDuringTick($, on, 'carry-read')
  const isFreeLine = (line: string) => line.startsWith('a login is free: carry-on')
  expect(whats(stopLogOf(held.store, held.w)).filter(isFreeLine), 'no carry-on is logged for the send the guard declined').toEqual([])
  await expectLaterDebtStands(held)
  expect(whats(stopLogOf(held.store, held.w)).filter(isFreeLine), 'the later debt logs its own send').toEqual(['a login is free: carry-on on 1'])
})

// ---------------------------------------------------------------- PR B, epic puma-9arph.109: readings that show what they are
// ---------------------------------------------------------------- puma-9arph.109.6: read ages

test('READ-AGE: a body check and a response save keep the Fable row\'s own read time, though each refreshes the reading\'s', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 40]
  w.usage['tok-2'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  const first = store.get('usage:1') as { at: number; fable?: { pct: number; at?: number } }
  expect(first.fable, 'the body that listed the Fable week stamps it').toMatchObject({ pct: 40, at: first.at })
  // Later bodies list no Fable week: its row is kept, with the time it was read.
  w.usage['tok-1'] = [25, 31]
  await clock.advance(40 * 60_000)
  const afterBody = store.get('usage:1') as { at: number; src: string; fable?: { pct: number; at?: number } }
  expect([afterBody.src, afterBody.at > first.at, afterBody.fable?.at]).toEqual(['body', true, first.at])
  w.limits = limitsOf(26, 32)
  await respond($, clock, w)
  const afterResponse = store.get('usage:1') as { at: number; src: string; fable?: { pct: number; at?: number } }
  expect([afterResponse.src, afterResponse.at > first.at, afterResponse.fable]).toEqual(['response', true, { pct: 40, resetsAt: FABLE_RESET, at: first.at }])
})

/**
 * Login 1 is in use with its Fable week spent. Login 2 holds a stored reading with room, read `readAgo` ms ago, its Fable
 * row `fableAgo` ms ago; its token has run out where `isTwoIdle`. The schedule does not read login 2 before the stop.
 */
async function agedReadings($: Engine, on: On, options: { readAgo: number; fableAgo?: number; isTwoIdle?: boolean }) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', options.isTwoIdle ? NOW - HOUR : undefined)
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 10, 10]
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'rotate-to': 'room',
      'usage:2': {
        fiveHour: { pct: 10, resetsAt: '2026-10-12T12:00:00Z' },
        sevenDay: { pct: 10, resetsAt: '2026-10-18T03:00:00Z' },
        fable: { pct: 10, resetsAt: FABLE_RESET, at: NOW - (options.fableAgo ?? options.readAgo) },
        at: NOW - options.readAgo,
        by: '2',
        v: 1,
        src: 'body',
      },
      'usage-due:2': { next: NOW + HOUR, fails: 0, at: NOW - options.readAgo, v: 1 },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  return { w, store, clock }
}

test('READ-AGE: a login read 5 minutes ago whose Fable row is 40 minutes old is picked as stale for a Fable stop, and the log says so', async ($, on) => {
  const { w, store, clock } = await agedReadings($, on, { readAgo: 5 * 60_000, fableAgo: 40 * 60_000 })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w)).toEqual([SLOT2])
  // The pick was judged on the Fable row, read 40 minutes ago, though a response refreshed the reading 5 minutes ago: the log
  // and the carry-on line both say 40.
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('picked '))).toEqual(['picked 2: stale, read 40 min ago; tried 1'])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Fable week was last read 40 min ago/)
})

test('READ-AGE: an idle login is picked as stale with its true age, in the log and not as spent (06:11:51)', async ($, on) => {
  const { w, store, clock } = await agedReadings($, on, { readAgo: 2360 * 60_000, isTwoIdle: true })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w)).toEqual([SLOT2])
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('picked '))).toEqual(['picked 2: stale (idle token), read 2360 min ago; tried 1'])
})

test('READ-AGE guard: a login with a live token read 5 minutes ago, Fable row included, is still picked as fresh', async ($, on) => {
  const { w, store, clock } = await agedReadings($, on, { readAgo: 5 * 60_000 })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slotValues(w)).toEqual([SLOT2])
  expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('picked '))).toEqual(['picked 2: fresh, read 5 min ago; tried 1'])
})

// ---------------------------------------------------------------- puma-9arph.109.7: readings that show what they are

test('PROVENANCE: the rows every session stores are at version 2 and carry each login\'s windows with their source and read time', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 40]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  const read = store.get('usage:1') as { at: number }
  // Rows version 2 has a key of its own, which an older session never writes; `rows` stays version 1, for older readers.
  const rows = store.get('rows2') as { v: number; rows: { id: string; windows?: unknown }[] }
  expect(rows.v).toBe(2)
  expect(rows.rows.find(r => r.id === '1')?.windows).toEqual({ week: { pct: 30, source: 'read', readAt: read.at }, fable: { pct: 40, source: 'read', readAt: read.at } })
  const v1 = store.get('rows') as { v: number; rows: { id: string; lines: unknown[]; windows?: unknown }[] }
  expect([v1.v, v1.rows.map(r => r.windows), v1.rows.map(r => r.lines)]).toEqual([1, [undefined, undefined], rows.rows.map(r => r.lines)])
})

test('PROVENANCE: the pane draws a spent window in the warning colour and one with room in none', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 100, 40]
  const clock = world(on, w, { accounts: [TWO_LOGINS.accounts[0]] })
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const spent = await pane.find({ text: /^▰{10} 100%$/ })
  const room = await pane.find({ text: /^▰{4}▱{6}  40%$/ })
  expect([painted(spent)[0]?.color, painted(room)[0]?.color], 'the spent week is in the warning colour, the Fable week with room in none').toEqual(['warning', undefined])
  await pane.unmount()
})

// ---------------------------------------------------------------- puma-9arph.109.8: every move leaves a line in the stop-log

const movesOf = (store: Map<string, unknown>, w: World) => whats(stopLogOf(store, w)).filter(line => line.startsWith('moved to '))

test('MOVE-LOG: a move by a press leaves "moved to N (by a press or a command)"', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 41]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  await pane.unmount()
  expect(movesOf(store, w)).toEqual(['moved to 2 (by a press or a command)'])
})

test('MOVE-LOG: a move by the tick or a response leaves "moved to N (by the tick or a response)"', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [92, 40]
  await start($, clock)
  expect(slotValues(w)).toEqual([SLOT2])
  expect(movesOf(store, w)).toEqual(['moved to 2 (by the tick or a response)'])
})

test('MOVE-LOG: a stop that rides the switch running leaves its own line beside the switch\'s', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => { open = resolve })
  let writes = 0
  w.beforeEnv = () => (writes++ === 0 ? gate : Promise.resolve())
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  open()
  await settleReal(clock)
  expect(movesOf(store, w)).toEqual(['moved to 2 (by the tick or a response)', 'moved to 2 (by a stop riding the switch running)'])
})

test('MOVE-LOG: the point-back of a switch that did not take leaves "moved to N (by a point-back: ...)"', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 41]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  await pane.unmount()
  // The switch did not take: responses still carry login 1's week.
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(60_000)
  await respond($, clock, w)
  await clock.advance(4 * 60_000)
  await respond($, clock, w)
  expect(movesOf(store, w)).toEqual(['moved to 2 (by a press or a command)', 'moved to 1 (by a point-back: responses still use login 1)'])
})

test('MOVE-LOG: a stop whose reset names another login points back, and leaves its own "moved to" line', async ($, on) => {
  const ctx = await fableOnTwo($, on, '2')
  await movedToOneThenStoppedOnTwo($, ctx)
  expect(movesOf(ctx.store, ctx.w)).toEqual(['moved to 1 (by a stop)', "moved to 2 (by a point-back: the stop's reset names login 2)", 'moved to 1 (by a stop)'])
})

test('MOVE-LOG: a move by a Claude in Chrome visit leaves "moved to N (by a Claude in Chrome visit)", and so does its move back', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  await start($, clock)
  // The extension signs in as login 2: a Connect visit to login 2 is the only way the session moves here.
  w.chrome.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'chrome-try-2' })
  await settleReal(clock)
  await clock.advance(2 * 60_000)
  await settleReal(clock)
  await pane.unmount()
  expect(movesOf(store, w)).toEqual(['moved to 2 (by a Claude in Chrome visit)', 'moved to 1 (by a Claude in Chrome visit)'])
})

// ---------------------------------------------------------------- puma-9arph.109.9: a credentials file beside the keychain login

const SECRET_FILE = '{"claudeAiOauth":{"accessToken":"SECRET-ACCESS-TOKEN","refreshToken":"SECRET-REFRESH-TOKEN","expiresAt":0},"mcpOAuth":{}}'

const FILE_MTIME = Date.parse('2026-11-03T21:46:53Z')

/** A macOS session whose normal login is in the keychain, with the file `files` holds beside it. */
async function credentialsFileWorld($: Engine, on: On, files: Record<string, string>, system: World['system'] = 'macOS') {
  const w = fresh(system)
  if (system === 'macOS') w.keychain['Claude Code-credentials'] = blob('tok-1')
  else w.files[FILE1] = blob('tok-1')
  Object.assign(w.files, files)
  w.mtimes = { [FILE1]: FILE_MTIME }
  w.usage['tok-1'] = [20, 30]
  const s = clearable(on)
  const clock = world(on, w, { accounts: [TWO_LOGINS.accounts[0]] })
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  return { w, s, clock }
}

const warned = (texts: string[]) => texts.filter(t => /\.credentials\.json/.test(t))

test('CREDENTIALS-FILE: a credentials file beside the keychain login is warned of once, as a toast, a notice and a pane line that name its time and moving it aside, and is never read', async ($, on) => {
  const { w, clock } = await credentialsFileWorld($, on, { [FILE1]: SECRET_FILE })
  expect([warned(w.toasts).length, warned(w.notices).length]).toEqual([1, 1])
  const text = warned(w.toasts)[0] ?? ''
  expect(text).toContain('2026-11-03 21:46 UTC')
  expect(text).toContain(`mv ${FILE1} ${FILE1}.aside`)
  expect(text).toMatch(/move back to Claude Code's own login/)
  await clock.advance(30 * 60_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const line = await pane.find({ text: /\.credentials\.json/ })
  expect(painted(line)[0]?.color, 'the pane line is a warning').toBe('warning')
  await pane.unmount()
  expect([warned(w.toasts).length, warned(w.notices).length], 'once a session').toEqual([1, 1])
  expect(w.readPaths ?? [], 'only its name and time are read, never its contents').not.toContain(FILE1)
  expect(w.writes ?? []).not.toContain(FILE1)
  expect(JSON.stringify([w.toasts, w.notices, w.logged, line]), 'no token value anywhere it was said').not.toContain('SECRET')
})

test('CREDENTIALS-FILE: with no such file nothing is warned, and on Linux, where the file is the login itself, nothing either', async ($, on) => {
  const none = await credentialsFileWorld($, on, {})
  expect([warned(none.w.toasts), warned(none.w.notices)]).toEqual([[], []])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /\.credentials\.json/ })).toBeUndefined()
  await pane.unmount()
})

test('CREDENTIALS-FILE: on Linux the file is the login itself and is not warned of', async ($, on) => {
  const { w } = await credentialsFileWorld($, on, {}, 'Linux')
  expect([warned(w.toasts), warned(w.notices)]).toEqual([[], []])
})

test('CREDENTIALS-FILE: a /clear keeps the pane line and warns no second time', async ($, on) => {
  const { w, s, clock } = await credentialsFileWorld($, on, { [FILE1]: SECRET_FILE })
  await clearSession($, clock, s.clear)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /\.credentials\.json/ })).toBeDefined()
  await pane.unmount()
  expect([warned(w.toasts).length, warned(w.notices).length]).toEqual([1, 1])
})

// Codex pr-b-r1 C2: a reload of the mod empties its memory, and the session goes on: its view, still bound, says it was told.
test('CREDENTIALS-FILE: a reload of the mod in the same session warns no second time, and the pane line stays', async ($, on) => {
  const w = fresh()
  w.files[FILE1] = SECRET_FILE
  w.mtimes = { [FILE1]: FILE_MTIME }
  const told = '/Users/tester/.claude/.credentials.json exists (told before the reload)'
  await reloadedWorld($, on, { credentialsNote: told }, {}, undefined, w)
  expect([warned(w.toasts), warned(w.notices)]).toEqual([[], []])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /told before the reload/ })).toBeDefined()
  await pane.unmount()
})

// Codex pr-b-r1 NOTE and C1: part A's first key, `usage-body:<id>`, goes with the others where a sign-in is replaced, and a login keeps the newest keys only.
test('BODY-KEYS: a sign-in as another account deletes every body key of the login, the first version\'s with no session among them', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30, 40]
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'holder:1': { token: 'a-token-that-is-not-this-one', who: { email: 'nine@example.com' } },
      'usage-body:1': { at: NOW - HOUR },
      'usage-body:1:session-old': { at: NOW - HOUR },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  // The sign-in's usage is dropped and not read again in the same check: no body key stands.
  expect([...store.keys()].filter(k => k.startsWith('usage-body:1'))).toEqual([])
})

// Codex pr-b-r3: no key is ever rewritten, so the prune of an old key can lose no newer body: B's newer body has a key of its own.
test('BODY-KEYS: a body another session saves while the prune runs stands, and the week-old key of that session goes', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30, 40]
  const oldKey = `usage-body:1:${NOW - 8 * DAY}:session-b`
  const newKey = `usage-body:1:${NOW}:session-b`
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, [oldKey]: { at: NOW - 8 * DAY } }))
  // Session B saves its body, as session B does: under a key of its own, while this session saves its own.
  w.onStoreSet = key => {
    if (key.startsWith('usage-body:1:') && !key.endsWith(':session-b')) store.set(newKey, { at: NOW })
  }
  const clock = world(on, w, store)
  await start($, clock)
  expect([store.has(oldKey), store.get(newKey)], 'the old body is pruned, B\'s newer one stands').toEqual([false, { at: NOW }])
})

// Codex pr-b-r4 B2: every completed body has a key of its own, whatever completed in between; the shared row and the marks
// go by the order of the requests, the baseline of the next request by the order of the completions.
for (const kind of ['week', 'five'] as const) {
  test(`BODY-WRITE-ORDER: a body (96) that began before another's (94) and completed after it has its own key, writes no row and ends no ${kind} mark, and the next body (91) falls from it`, async ($, on) => {
    const { w, store, clock, key } = await markedOnThree($, on, kind, 98, 96)
    // This session's body of login 3 is answered, then waits before the mod reads it, as the other session's body lands.
    const held = { isPaused: false, release: () => {} }
    const gate = new Promise<void>(resolve => {
      held.release = resolve
    })
    w.afterUsageBody = async token => {
      if (token !== 'tok-3' || held.isPaused) return
      held.isPaused = true
      await gate
    }
    for (let waited = 0; waited < 12 * 60_000 && !held.isPaused; waited += 1_000) await clock.advance(1_000)
    expect(held.isPaused, 'the body of login 3 waits after its answer').toBe(true)
    await clock.advance(1_000)
    // The other session's body began after this one's, completed first, and saved the row and its own key.
    store.set('usage:3', bodyRowOfThree(94, clock.now()))
    store.set(`usage-body:3:${clock.now()}:session-a`, bodyOfThree(94, clock.now()))
    w.afterUsageBody = undefined
    // This session's body completes after the other's.
    await clock.advance(1_000)
    held.release()
    await clock.settle()
    const own =[...store.keys()].filter(k => k.startsWith('usage-body:3:') && k.endsWith(`:${w.otherEnv.ACCOUNT_ROTATOR_SESSION}`))
    expect(own.length, 'the late body has a key of its own').toBe(1)
    expect((store.get('usage:3') as { sevenDay?: { pct: number } }).sevenDay?.pct, 'and left the newer row as it was').toBe(94)
    expect(store.get(key), 'the late body ends no mark').toBeDefined()
    w.usage['tok-3'] = [91, 91, 91]
    for (let waited = 0; waited < 35 * 60_000; waited += 20_000) await clock.advance(20_000)
    await clock.settle()
    expect((store.get('usage:3') as { sevenDay?: { pct: number } }).sevenDay?.pct, 'the next body, 91, is stored').toBe(91)
    expect(markStands(store, key), 'it fell 5 from the newest completed body, 96: the mark ends').toBe(false)
  })
}

// puma-9arph.109.12: a scheduled read of login 2 in flight when Use now starts a switch to it completes after the switch's
// `since`; its completion time alone made it "a good read since the switch", so the settle's own read was refused.
test('SINCE-READ-TIME: a read of login 2 begun before Use now and ended after it is no read of the switch, so the settle reads login 2 again', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 41]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  // The scheduled read of login 2 (30 minutes on) waits after its body is made, so it ends after the press.
  const held = { isPaused: false, open: () => {} }
  const gate = new Promise<void>(resolve => {
    held.open = resolve
  })
  w.afterUsageBody = async token => {
    if (token !== 'tok-2' || held.isPaused) return
    held.isPaused = true
    await gate
  }
  for (let waited = 0; waited < 40 * 60_000 && !held.isPaused; waited += 1_000) await clock.advance(1_000)
  expect(held.isPaused, 'the scheduled read of login 2 waits after its body').toBe(true)
  await clock.advance(1_000)
  await useNow($, clock, '2')
  expect(slots(w), 'the press moved the session while the read waited').toEqual([SLOT2])
  await clock.advance(1_000)
  w.afterUsageBody = undefined
  held.open()
  await clock.settle()
  const heldDue = store.get('usage-due:2') as { at?: number } | undefined
  const before = callsWith(w, 'tok-2')
  await clock.advance(SETTLE_WAIT)
  w.limits = limitsOf(10, 41, OTHER_WEEK)
  await respond($, clock, w)
  expect(typeof heldDue?.at, 'the held read stored its completion').toBe('number')
  expect(callsWith(w, 'tok-2'), 'the settle read login 2 again').toBe(before + 1)
})
