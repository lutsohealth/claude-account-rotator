import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, SessionRateLimit } from 'claude-code'
import type { View } from '../types'
import { NUDGE_LEAD_MS, NUDGE_TEXT, OWN_CONTINUE_MARGIN_MS, USAGE_CLAIM_WAIT_MS, USAGE_IDLE_MS, keychainItem } from './model'
import { FABLE_HIT_STOP, FILL_NO_CAUSE, HOME, HOUR, N1, NOW, OTHER_WEEK, PANE_PROPS, PICKED_TWO, PLAIN, PLAIN_STOPS, REQUESTS, SLOT2, SLOT3, STOP_RATE_LIMIT, THREE_LOGINS, TWO_LOGINS, blob, carryClearRefusal, carryEndedOf, carryOnAnswers, clearSession, clearable, countdownWorld, fresh, isEnded, isSwitchedToast, kept, loggedWorld, mountPane, owedWorld, ownMark, pastOwed, queuedWorld, ran, refresh, refuseCarryClear, refusedOwedWorld, reloadedWorld, resultOf, sent, settleReal, slots, spentTwo, start, stopHeard, stopLogOf, turnStops, untilTick, useRequest, watchedView, whats, world } from './flow-harness'
import type { Around, World } from './flow-harness'

/** What the look (every 15 s, v4 s.3) writes where it finds an open turn, or a fill that answers no 'dialog' (the kit's cannot). */
const WAITS_ON_TURN = 'owed resume waits: 1 turns open'

// The look (v4 s.3) replaces the 5 s watch: a carry-on whose resume enters (a main-loop turn starts) before the next look gets no key.
test('a carry-on that enters before the next look gets no key (puma-9arph.34 C6)', async ($, on) => {
  const w = fresh()
  const enter = queuedWorld(on, w)
  enter()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await turnStops($, clock)
  await clock.advance(36_000)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await clock.advance(20_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.spawned).toEqual([])
  expect(whats(stopLogOf(store, w)).at(-1)).toBe('resume entered')
})

// Each row keeps one condition of the Escape false: no key goes, and the stop-log says what the look found last.
for (const [name, arrange, last] of [
  ["an agent's turn is open (C2)", { during: ($: Engine) => $.turn.start({ text: 'look', turnId: 'agent-turn', agentId: 'agent-1' }) }, WAITS_ON_TURN],
  ['the main turn is still open (C3)', { isEnded: false }, WAITS_ON_TURN],
  ['the box takes the fill (C5)', { isFilled: true }, FILL_NO_CAUSE],
  // Review CALL1 [UNPROVEN-DIALOG]: a hook's refusal carries no cause and proves no dialog.
  ['a hook refused the fill, its cause left out (Review CALL1)', {}, FILL_NO_CAUSE],
  // No limit stop, so no episode and no look: the carry-on's own line is the last.
  ['the stop was a rejected sign-in, not a limit (RULING 6008)', { stop: { error: 'authentication_failed' } }, 'carry-on queued'],
  [
    'a turn ran since the limit stop',
    {
      during: async ($: Engine) => {
        await $.turn.start({ text: 'and this', turnId: 'turn-2' })
        await $.turn.complete({ turnId: 'turn-2', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
      },
    },
    // The turn that ran since is the resume entering and answering: it ends the episode, so no look follows.
    'carry-on queued',
  ],
] as const) {
  test(`a queued carry-on gets no key where ${name} (puma-9arph.34 C)`, async ($, on) => {
    const w = fresh()
    const rule: { during?: ($: Engine) => Promise<unknown>; isEnded?: boolean; isFilled?: boolean; stop?: { error: 'rate_limit' | 'authentication_failed' } } = arrange
    queuedWorld(on, w)
    if (rule.isFilled === true) w.isFillRefused = false
    const { store, clock } = await loggedWorld(on, w)
    await start($, clock)
    w.usage['tok-1'] = [100, 41]
    await turnStops($, clock, rule.stop, rule.isEnded ?? true)
    await rule.during?.($)
    await clock.settle()
    await clock.advance(36_000)
    expect(w.submitted).toHaveLength(1)
    await clock.advance(20_000)
    expect(w.spawned).toEqual([])
    expect(whats(stopLogOf(store, w)).at(-1)).toBe(last)
  })
}

// Review CALL1 [UNPROVEN-DIALOG], its class: the other submit site, connectChrome's, under the same watch.
test('the line a stop cut by the Claude in Chrome visit carries on with gets the same watch, no key for a hook\'s refusal, and the stop sends one line (puma-9arph.34 C8)', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  await spentTwo(w)
  queuedWorld(on, w)
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'chrome-account': '2' }))
  const clock = world(on, w, store)
  await start($, clock)
  await turnStops($, clock)
  await clock.advance(36_000)
  expect(w.submitted).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  await clock.advance(5_000)
  expect(whats(stopLogOf(store, w)).at(-1)).toBe(FILL_NO_CAUSE)
  await clock.advance(10 * 60_000)
  expect(w.spawned).toEqual([])
  expect(w.submitted).toHaveLength(1)
})

// ---------------------------------------------------------------- puma-9arph.71: one Escape cancels Claude Code's own continue

/** The pane once the countdown is gone (R7): no footer. */
const NO_FOOTER = ['⏺ Automatic continue cancelled · /rate-limit-options to re-arm', '──────────', '❯ ', '──────────']

const OWN_ESCAPE = ['orca', 'terminal', 'send', '--terminal', 'term_test-pane', '--text', '\u001b', '--json']

const ownLines = (store: Map<string, unknown>, w: World) => whats(stopLogOf(store, w)).filter(l => l.startsWith('own continue:'))

/**
 * A main turn as the engine raises it: `prompt.submit` stamps where the prompt came from, which `turn.start` does not
 * carry (puma-9arph.80). The text is each kind's own shape as the stand-in read it; the person's prompt goes at an idle prompt.
 */
async function promptTurn($: Engine, turnId: string, kind: 'composer' | 'task-notification', isAnswered = true): Promise<void> {
  const text = kind === 'composer' ? 'mine' : '<task-notification>\n<status>completed</status>\n</task-notification>'
  await $.prompt.submit({ text, origin: { kind }, wait: false })
  await $.turn.start({ text, turnId })
  if (isAnswered) await $.turn.complete({ turnId, reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
}

// The kit draws no countdown of Claude Code's: this counts the mod's own key and carry-on. The proof of one continue for
// the stop is the stand-in run on the bead (S5).
test('the doubled path: once the carry-on answered, the mod sends one Escape, never a second, and its own carry-on once (puma-9arph.71)', async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await carryOnAnswers($, clock, w)
  expect(w.spawned).toEqual([])
  await clock.advance(16_000)
  expect(w.spawned.map(s => s.argv)).toEqual([OWN_ESCAPE])
  await clock.advance(5 * 60_000)
  expect([w.spawned.length, w.submitted.length]).toEqual([1, 1])
  expect(ownLines(store, w)).toEqual(['own continue: armed', 'own continue: Escape (exit 0)'])
})

// Each row keeps one gate of the own-continue Escape false (acceptance 2): no key goes, and the stop-log says why once.
for (const [name, arrange, last] of [
  ['R2: a draft in the box', { draft: 'half a thought' }, 'own continue: no key, the prompt box holds a draft'],
  ['R7: no countdown on screen', { screen: NO_FOOTER }, 'own continue: no key, no countdown on screen'],
  ['the screen read fails', { screen: 'unset' }, 'own continue: no key, the screen is unreadable'],
  ['a hook refuses the fill, its cause left out', { isFillRefused: true }, 'own continue: no key, the fill was refused: no cause'],
  ['no Orca pane', { noPane: true }, 'own continue: no key, no Orca pane'],
  ["R3, R4: an agent's turn open", { during: ($: Engine) => $.turn.start({ text: 'look', turnId: 'agent-turn', agentId: 'agent-1' }) }, 'own continue: no key, a turn is open'],
  ["R3x: a person's turn began since", { during: ($: Engine) => promptTurn($, 'turn-person', 'composer', false) }, "own continue: disarmed, a person's prompt"],
  // A stop heard with no turn start heard before it (as after a reload) raises its own countdown: the old arm ends.
  ['a new stop heard with no turn start', { during: ($: Engine) => $.classic.StopFailure({ error: 'rate_limit' }) }, 'own continue: disarmed, a new stop'],
] as const) {
  test(`the own-continue Escape goes nowhere where ${name} (puma-9arph.71)`, async ($, on) => {
    const w = fresh()
    const rule: { draft?: string; screen?: readonly string[] | 'unset'; isFillRefused?: boolean; noPane?: boolean; during?: ($: Engine) => Promise<unknown> } = arrange
    countdownWorld(on, w)
    // The session reads its environment at its start.
    if (rule.noPane === true) delete w.env.ORCA_TERMINAL_HANDLE
    const { store, clock } = await loggedWorld(on, w)
    await start($, clock)
    await carryOnAnswers($, clock, w)
    if (rule.draft !== undefined) w.draft = rule.draft
    if (rule.screen !== undefined) w.screen = rule.screen === 'unset' ? undefined : [...rule.screen]
    if (rule.isFillRefused === true) w.isFillRefused = true
    await rule.during?.($)
    await clock.advance(46_000)
    expect(w.spawned).toEqual([])
    expect(ownLines(store, w).at(-1)).toBe(last)
    expect(ownLines(store, w).filter(l => l === last)).toHaveLength(1)
  })
}

// Round 1 F3 [ARM-LIFETIME]: a main turn that starts while the arm reads the view ends the need for the key before
// the arm is set; no stale arm keys once that turn ends.
test('a main turn that starts while the carry-on\'s answer arms leaves no arm behind (puma-9arph.71 round 1 F3)', async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await turnStops($, clock)
  await clock.advance(36_000)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  const answered = $.turn.complete({ turnId: 'turn-carry', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await promptTurn($, 'turn-person', 'composer', false)
  await answered
  await $.turn.complete({ turnId: 'turn-person', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.settle()
  await clock.advance(46_000)
  expect(w.spawned).toEqual([])
  expect(ownLines(store, w)).not.toContain('own continue: Escape (exit 0)')
})

// puma-9arph.80 case A: a background agent's task notification is no person's prompt and does not end Claude Code's
// countdown (stand-in run a3): the arm stands through its turn, and the key goes at the idle prompt after it.
test("a task notification's turn after the carry-on answered leaves the arm: one Escape goes (puma-9arph.80 A)", async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await carryOnAnswers($, clock, w)
  await promptTurn($, 'turn-note', 'task-notification')
  await clock.settle()
  await clock.advance(16_000)
  expect(w.spawned.map(s => s.argv)).toEqual([OWN_ESCAPE])
  expect(ownLines(store, w)).toEqual(['own continue: armed', 'own continue: Escape (exit 0)'])
})

// puma-9arph.80 case B: the resume enters by a task notification's turn, before the carry-on's own (stand-in run 1):
// the countdown stands there too, so the proven resume arms the key, whichever turn entered.
test("a resume that a task notification's turn entered arms the own-continue Escape: one goes (puma-9arph.80 B)", async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await turnStops($, clock)
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  await promptTurn($, 'turn-note', 'task-notification')
  await clock.settle()
  await clock.advance(16_000)
  expect(w.spawned.map(s => s.argv)).toEqual([OWN_ESCAPE])
  expect(ownLines(store, w)).toEqual(['own continue: armed', 'own continue: Escape (exit 0)'])
})

// A turn that begins and ends while a look waits on its fill leaves the arm, but that look's reads are stale: it sends
// no key, and the next look does (RULING 6839 a: no key from a look a turn ran through).
test("a task notification's turn during the look's fill gets that look no key; the next look sends one (puma-9arph.80)", async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await carryOnAnswers($, clock, w)
  let release = () => {}
  w.fillHold = new Promise<void>(resolve => {
    release = resolve
  })
  await clock.advance(16_000)
  await promptTurn($, 'turn-note', 'task-notification')
  release()
  w.fillHold = undefined
  await clock.settle()
  expect(w.spawned).toEqual([])
  expect(ownLines(store, w)).toContain('own continue: no key, a main turn began during the look')
  await clock.advance(15_000)
  expect(w.spawned.map(s => s.argv)).toEqual([OWN_ESCAPE])
})

// Codex round 1 KEY-QUEUED, its instance: a person's prompt typed while a turn runs waits in the queue, the box empty
// and no turn open once that turn ends; it is the person's, so it ends the arm as it is submitted.
test("a person's prompt queued behind an agent's turn ends the arm: no key once that turn ends (puma-9arph.80 KEY-QUEUED)", async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await carryOnAnswers($, clock, w)
  await $.turn.start({ text: 'agent work', turnId: 'agent-turn', agentId: 'agent-1' })
  await $.prompt.submit({ text: 'my next request', origin: { kind: 'composer' }, turnId: 'agent-turn', wait: false })
  await $.turn.complete({ turnId: 'agent-turn', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.advance(16_000)
  expect(w.spawned).toEqual([])
  expect(ownLines(store, w).at(-1)).toBe("own continue: disarmed, a person's prompt")
})

// KEY-QUEUED, its class: any prompt still entering (its hooks running, its turn not started) holds the key, whoever sent it.
for (const kind of ['composer', 'task-notification'] as const) {
  test(`a ${kind} prompt still entering holds the own-continue key (puma-9arph.80 KEY-QUEUED class)`, async ($, on) => {
    const w = fresh()
    countdownWorld(on, w)
    const { store, clock } = await loggedWorld(on, w)
    await start($, clock)
    await carryOnAnswers($, clock, w)
    let release = () => {}
    w.submitHold = new Promise<void>(resolve => {
      release = resolve
    })
    const entering = $.prompt.submit({ text: 'next', origin: { kind }, wait: false })
    await clock.advance(16_000)
    expect(w.spawned).toEqual([])
    expect(ownLines(store, w).at(-1)).toBe(kind === 'composer' ? "own continue: disarmed, a person's prompt" : 'own continue: no key, a prompt is entering')
    release()
    await entering
  })
}

// Codex round 1 KEY-STALE-PANEL: every gate the look read before an await is read again before the key, the box
// among them; the accounts panel opened during the look's fill (its instance), a draft typed after the fill (its class).
for (const [name, during, last] of [
  [
    'the accounts panel opened during the fill',
    async ($: Engine) => void (await $.command.run({ command: 'accounts', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })),
    'own continue: no key, the accounts panel is shown',
  ],
  ['a draft typed after the fill, before the key', undefined, 'own continue: no key, the prompt box holds a draft'],
] as const) {
  test(`the own-continue look sends no key where ${name} (puma-9arph.80 KEY-STALE-PANEL)`, async ($, on) => {
    const w = fresh()
    countdownWorld(on, w)
    // The mod's /accounts opens its panel only where the engine took the command's registration.
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    const { store, clock } = await loggedWorld(on, w)
    await start($, clock)
    await carryOnAnswers($, clock, w)
    let release = () => {}
    w.fillHold = new Promise<void>(resolve => {
      release = resolve
    })
    // The draft is typed as the look reads the screen, after its fill: only a read of the box after that sees it.
    if (during === undefined) w.onScreenRead = () => void (w.draft = 'unfinished request')
    await clock.advance(16_000)
    await during?.($)
    release()
    w.fillHold = undefined
    await clock.settle()
    expect(w.spawned).toEqual([])
    expect(ownLines(store, w).at(-1)).toBe(last)
  })
}

// A person's prompt that entered the resume cancelled the countdown (R3x): the proven resume arms nothing.
test("a resume a person's prompt entered arms no own-continue Escape (puma-9arph.80)", async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await turnStops($, clock)
  await clock.advance(36_000)
  await promptTurn($, 'turn-person', 'composer')
  await clock.settle()
  await clock.advance(46_000)
  expect([w.spawned, ownLines(store, w)]).toEqual([[], []])
})

// The arm keeps the key's gates (RULING 6839 a): a turn that is no person's leaves it, and the gates still say no key.
for (const [name, during, last] of [
  // Claude Code's own resent turn, as the stand-in read its text; its origin is not measured, so none is raised.
  [
    "the countdown's own resent turn, the footer gone after it",
    async ($: Engine, w: World) => {
      await $.turn.start({ text: 'Your claude.ai usage limit has reset. Continue the task you were working on.', turnId: 'turn-own' })
      await $.turn.complete({ turnId: 'turn-own', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
      w.screen = [...NO_FOOTER]
    },
    'own continue: no key, no countdown on screen',
  ],
] as const) {
  test(`the own-continue arm stands, and no key goes, where ${name} (puma-9arph.80)`, async ($, on) => {
    const w = fresh()
    countdownWorld(on, w)
    const { store, clock } = await loggedWorld(on, w)
    await start($, clock)
    w.draft = 'half a thought'
    await carryOnAnswers($, clock, w)
    await during($, w)
    w.draft = undefined
    await clock.settle()
    await clock.advance(46_000)
    expect(w.spawned).toEqual([])
    expect(ownLines(store, w).at(-1)).toBe(last)
  })
}

// RULING 6839 b: an arm with no stored reset (the stop's read showed the login spent, so no stop mark was written) ends
// at the five-hour window's length, the shortest window a stop marks, plus the margin; until then a draft holds the key.
// Five hours of looks: 1.25 s on vox, past the kit's 5 s default on CI's runner.
test('an own-continue arm with no stored reset ends at five hours plus the margin (puma-9arph.80)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await turnStops($, clock)
  await clock.advance(36_000)
  // No mark of login 1 stands when the carry-on answers; the minute's merge takes that into the view.
  for (const key of ['mark:1', 'week-mark:1', 'fable-mark:1']) store.delete(key)
  await clock.advance(61_000)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.settle()
  const armedAt = stopLogOf(store, w).find(e => e.what === 'own continue: armed')?.at
  expect(armedAt, 'the carry-on armed no own continue').toBeDefined()
  w.draft = 'half a thought'
  await clock.advance(5 * HOUR)
  expect(ownLines(store, w)).not.toContain(DEADLINE_LINE)
  await clock.advance(OWN_CONTINUE_MARGIN_MS + LOOK_MS)
  const at = stopLogOf(store, w).filter(e => e.what === DEADLINE_LINE).map(e => e.at)
  expect(at, 'the arm with no stored reset held no deadline').toHaveLength(1)
  expect((at[0] ?? 0) - (armedAt ?? 0)).toBeGreaterThanOrEqual(5 * HOUR + OWN_CONTINUE_MARGIN_MS)
  expect(w.spawned).toEqual([])
})

test('a rejected sign-in arms no own-continue Escape: its stop raises no countdown (puma-9arph.71)', async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await carryOnAnswers($, clock, w, { error: 'authentication_failed' })
  await clock.advance(46_000)
  expect([w.spawned, ownLines(store, w)]).toEqual([[], []])
})

// puma-9arph.78: the wiring of puma-9arph.77, end to end. Each stop marks its own window, which resets 3 minutes on;
// another session then stores a newer mark of another window, resetting hours on, before the carry-on answers. The
// arm holds the reset of the window the stop judged, never that newer mark's: a draft in the box holds the key back,
// so the look writes the deadline line at the first look at or after that reset plus the 45 s margin.
const SOON = new Date(NOW + 3 * 60_000).toISOString()

const LATE_MARK = { pct: 100, resetsAt: new Date(NOW + 4 * HOUR).toISOString(), at: NOW + 40_000 }

const DEADLINE_LINE = "own continue: disarmed, past the own continue's deadline"

/** How often the own-continue look runs, register.tsx's OWED_LOOK_MS: the line lands within one look of the deadline. */
const LOOK_MS = 15_000

for (const [kind, said, judged, other] of [
  ['weekly', "You've hit your weekly limit · resets Nov 10 at 11am", (w: World) => void (w.weekResets = { 'tok-1': SOON }), 'mark:1'],
  ['Fable', FABLE_HIT_STOP.last_assistant_message, (w: World) => void (w.fableResets = SOON), 'week-mark:1'],
  ['5-hour (the control)', PLAIN_STOPS[0], (w: World) => void (w.fiveHourResets = { 'tok-1': SOON }), 'fable-mark:1'],
] as const) {
  test(`a ${kind} stop arms the own-continue Escape with the reset of the window it judged, over a newer mark of another window (puma-9arph.78)`, async ($, on) => {
    const w = fresh()
    countdownWorld(on, w)
    judged(w)
    const { store, clock } = await loggedWorld(on, w)
    // Login 1 is not spent at the stop, so markStop judges a window; login 2 has room on every limit.
    w.usage['tok-1'] = [60, 40, 50]
    w.usage['tok-2'] = [10, 30, 10]
    await start($, clock)
    await $.turn.start({ text: 'go on', turnId: 'turn-1' })
    await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: said })
    await $.turn.complete({ turnId: 'turn-1', reason: 'error', answer: '', durationMs: 1, isAborted: false })
    await clock.settle()
    await clock.advance(36_000)
    expect(w.submitted).toHaveLength(1)
    // Another session's stop on login 1, newer than this one's; the minute's merge takes it into the view.
    store.set(other, LATE_MARK)
    await clock.advance(25_000)
    await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
    await $.turn.complete({ turnId: 'turn-carry', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
    await clock.settle()
    w.draft = 'half a thought'
    await clock.advance(5 * 60_000)
    const deadline = Date.parse(SOON) + OWN_CONTINUE_MARGIN_MS
    const at = stopLogOf(store, w).filter(e => e.what === DEADLINE_LINE).map(e => e.at)
    expect(w.spawned).toEqual([])
    expect(at, `${kind}: the arm held no deadline at the judged window's reset (${SOON}); with no line it held none, or the newer mark's`).toHaveLength(1)
    const isInLook = at[0] !== undefined && at[0] >= deadline && at[0] < deadline + LOOK_MS
    expect(isInLook, `${kind}: the deadline line at ${new Date(at[0] ?? 0).toISOString()}, not in the look after ${new Date(deadline).toISOString()}`).toBe(true)
  })
}

// puma-9arph.34 acceptance 3(c): a carry-on whose turn dies on the limit again, on the login moved to, moves on and carries on once more.
test('a carry-on whose turn dies on the usage limit again moves to the next login and carries on once more, the watch judging each stop (puma-9arph.34 3(c))', async ($, on) => {
  const w = fresh()
  const SLOT3 = `${HOME}/.claude/accounts/3`
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [60, 40]
  w.usage['tok-2'] = [10, 30]
  w.usage['tok-3'] = [20, 50]
  w.env.ORCA_TERMINAL_HANDLE = 'term_test-pane'
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield* []
    return { value: { code: 0, signal: null } }
  })
  const three = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }], 'rotate-to': 'room' }
  const store = new Map<string, unknown>(Object.entries(three))
  const clock = world(on, w, store)
  await start($, clock)
  // The first stop, on login 1: the move to login 2 and its carry-on, which enters.
  w.usage['tok-1'] = [100, 41]
  await turnStops($, clock)
  expect(slots(w)).toEqual([SLOT2])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  // The carry-on's own turn dies on the limit on login 2: the move to login 3, and one carry-on more, which stays queued.
  w.usage['tok-2'] = [100, 31]
  w.submitHold = new Promise<void>(() => {})
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry-1' })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'turn-carry-1', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2, SLOT3])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(2)
  await clock.advance(10 * 60_000)
  expect(w.submitted).toHaveLength(2)
  // The second stop is a limit stop with no turn begun since and none open, so the look reaches the fill: the kit's box
  // answers no cause, so no key goes (the engine's own 'dialog' is model.test.ts's row). The second stop is the episode's
  // later one, on a login no response has shown since its switch: it marks nothing and moves to the next untried login (v4 s.6).
  expect(w.spawned).toEqual([])
  expect(whats(stopLogOf(store, w))).toEqual([
    STOP_RATE_LIMIT,
    'owed resume: turns closed',
    PICKED_TWO,
    'moved to 2 (by a stop)',
    'carry-on armed',
    'carry-on queued',
    'carry-on resolved',
    'resume entered',
    "resume ended rate_limit: the carry-on's own turn, nothing queued",
    stopHeard('none', '2'),
    'owed resume: turns closed',
    // A wordless stop on a switch no response has proven is login 2's only at its second: this first one may have gone out on login 1.
    'stop on owed resume: login 2 in use, no response since its switch, no mark',
    'picked 3: fresh, read 1 min ago; tried 1',
    'moved to 3 (by a stop)',
    'carry-on armed',
    'carry-on queued',
    FILL_NO_CAUSE,
  ])
})

// ---------------------------------------------------------------- puma-9arph.54: the owed resume (design v4)

/** The stop-log's time of its first line that starts with `prefix`. */
const logTime = (store: Map<string, unknown>, w: World, prefix: string): number => stopLogOf(store, w).find(e => e.what.startsWith(prefix))?.at ?? Number.NaN

test('row b: pickAfterStop skips tried logins and answers undefined once all are tried', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  // Each stop is the carry-on's turn dying: no response, no entry, so one episode, and its tried set grows. A wordless stop
  // on a switch no response proved makes its login tried only at its second, so each login after the first takes two.
  for (let stop = 0; stop < 5; stop++) {
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.settle()
    await clock.advance(36_000)
  }
  expect(slots(w)).toEqual([SLOT2, SLOT3, SLOT2, SLOT3])
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('picked ') || l.startsWith('stayed'))).toEqual([
    'picked 2: fresh, read 0 min ago; tried 1',
    'picked 3: fresh, read 1 min ago; tried 1',
    'picked 2: fresh, read 1 min ago; tried 1',
    'picked 3: fresh, read 2 min ago; tried 1, 2',
    'stayed: no untried login (tried 1, 2, 3)',
  ])
})

// The kit cannot draw 'dialog': this proves the wiring up to the fill, at the first look after the agent's turn closes.
test('row c: a carry-on queued while an agent turn is open gets its Escape at the first look after that turn closes, with no main-loop turn and no prompt typed', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await turnStops($, clock)
  await $.turn.start({ text: 'look', turnId: 'agent-turn', agentId: 'agent-1' })
  await clock.advance(60_000)
  expect(w.submitted).toHaveLength(1)
  expect(whats(stopLogOf(store, w))).toContain(WAITS_ON_TURN)
  expect(whats(stopLogOf(store, w))).not.toContain(FILL_NO_CAUSE)
  await $.turn.complete({ turnId: 'agent-turn', agentId: 'agent-1', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.advance(15_000)
  const lines = whats(stopLogOf(store, w))
  expect(lines.slice(-2)).toEqual(['owed resume: turns closed', FILL_NO_CAUSE])
  expect(lines).not.toContain('resume entered')
  expect(w.submitted).toHaveLength(1)
  expect(w.spawned).toEqual([])
})

// The kit cannot draw 'dialog': this proves the wiring up to the fill, and the resume enters by a main-loop turn.
test('row d: with no event after the stop, the 15 s look alone sends the Escape and the resume enters', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000 + 15_000)
  expect(whats(stopLogOf(store, w)).at(-1)).toBe(FILL_NO_CAUSE)
  expect(w.submitted).toHaveLength(1)
  expect(w.spawned).toEqual([])
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await clock.settle()
  expect(whats(stopLogOf(store, w)).at(-1)).toBe('resume entered')
})

// puma-9arph.81: every gate the owed look read before its fill is read again after it, with no await before the key. The
// kit cannot draw 'dialog', so each row proves its gate by the stop-log's reason; model.test.ts row k proves no key goes.
for (const [name, during, why] of [
  [
    'a task notification still entering',
    async ($: Engine, w: World) => {
      let open = () => {}
      w.submitHold = new Promise<void>(resolve => {
        open = resolve
      })
      const entering = $.prompt.submit({ text: 'agent note', origin: { kind: 'task-notification' }, wait: false })
      return async () => {
        open()
        await entering
      }
    },
    'a prompt began entering during the fill',
  ],
  [
    'a press of Use now that moves the session',
    async ($: Engine) => {
      const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
      const pressed = pane.press({ key: 'use-3' })
      return async () => {
        await pressed
        await pane.unmount()
      }
    },
    'the switch moved during the fill',
  ],
  [
    'a press of Use now held for the token in use',
    async ($: Engine, w: World, clock: MockClock) => {
      const soon = blob('tok-2', clock.now() + 7 * 60_000)
      w.keychain['Claude Code-credentials'] = soon
      w.keychain[await keychainItem(SLOT2)] = soon
      const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
      const pressed = pane.press({ key: 'use-3' })
      return async () => {
        await pressed
        await pane.unmount()
      }
    },
    'a switch was held during the fill',
  ],
] as const) {
  test(`the owed look sends no key where ${name} begins during its fill (puma-9arph.81)`, { timeoutMs: 20_000 }, async ($, on) => {
    const w = fresh()
    const { store, clock } = await owedWorld($, on, w)
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.settle()
    await clock.advance(36_000)
    let release = () => {}
    w.fillHold = new Promise<void>(resolve => {
      release = resolve
    })
    const fillsBefore = w.fills ?? 0
    await clock.advance(15_000)
    expect(w.fills ?? 0, 'the look waits in its fill').toBeGreaterThan(fillsBefore)
    const finish = await during($, w, clock)
    await clock.settle()
    release()
    w.fillHold = undefined
    await clock.settle()
    await finish()
    const lines = whats(stopLogOf(store, w))
    expect(w.spawned).toEqual([])
    expect(lines).toContain(`owed resume: no key, ${why}`)
  })
}

// RULING 6891: each gate's reason is written once an episode, two different gates in one episode each once.
test('two different gates in one episode are each named once (puma-9arph.81, RULING 6891)', { timeoutMs: 20_000 }, async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  const holdFill = (): (() => void) => {
    let release = () => {}
    w.fillHold = new Promise<void>(resolve => {
      release = resolve
    })
    return release
  }
  // The first look's fill: a task notification begins entering, then enters.
  let release = holdFill()
  await clock.advance(15_000)
  let open = () => {}
  w.submitHold = new Promise<void>(resolve => {
    open = resolve
  })
  const entering = $.prompt.submit({ text: 'agent note', origin: { kind: 'task-notification' }, wait: false })
  await clock.settle()
  release()
  w.fillHold = undefined
  await clock.settle()
  open()
  w.submitHold = undefined
  await entering
  // The next look's fill: a press of Use now is held for the token in use, which refreshes soon.
  release = holdFill()
  await clock.advance(15_000)
  const soon = blob('tok-2', clock.now() + 7 * 60_000)
  w.keychain['Claude Code-credentials'] = soon
  w.keychain[await keychainItem(SLOT2)] = soon
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const pressed = pane.press({ key: 'use-3' })
  await clock.settle()
  release()
  w.fillHold = undefined
  await clock.settle()
  await pressed
  await pane.unmount()
  const named = whats(stopLogOf(store, w)).filter(l => l.startsWith('owed resume: no key, '))
  expect(named).toEqual(['owed resume: no key, a prompt began entering during the fill', 'owed resume: no key, a switch was held during the fill'])
})

// Review M403 A (C1): an entry that ends aborted, such as a waker's turn an Escape landed on, leaves the carry-on owed.
test('C1: a main turn aborted after entry lets the next look reach the fill again', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000 + 15_000)
  expect(whats(stopLogOf(store, w)).at(-1)).toBe(FILL_NO_CAUSE)
  await $.turn.start({ text: 'a waker', turnId: 'waker' })
  await $.turn.complete({ turnId: 'waker', reason: 'aborted', answer: '', durationMs: 1, isAborted: true })
  await clock.settle()
  const fills = w.fills ?? 0
  await clock.advance(15_000)
  expect(w.fills ?? 0).toBe(fills + 1)
  expect(whats(stopLogOf(store, w))).not.toContain('owed resume: no carry-on queued, no key')
})

// puma-9arph.60 point 1: another turn that enters and ends 'error', with no stop of its own, leaves the carry-on owed too.
test('C1: an entry by another turn that ends in an error with no limit stop lets the next look reach the fill again', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000 + 15_000)
  expect(whats(stopLogOf(store, w)).at(-1)).toBe(FILL_NO_CAUSE)
  await $.turn.start({ text: 'a waker', turnId: 'waker' })
  await $.turn.complete({ turnId: 'waker', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(whats(stopLogOf(store, w)).at(-1)).toBe('resume ended error: another turn, the carry-on still queued')
  const fills = w.fills ?? 0
  await clock.advance(15_000)
  expect(w.fills ?? 0).toBe(fills + 1)
  expect(whats(stopLogOf(store, w))).not.toContain('owed resume: no carry-on queued, no key')
})

// puma-9arph.60: another turn that enters and dies on a limit leaves the first carry-on queued: the stop's own carry-on is
// not sent again, so one resume is never entered twice.
test('C1: an entry by another turn that dies on a limit leaves the first carry-on queued and sends no second', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000 + 15_000)
  expect(w.submitted).toHaveLength(1)
  await $.turn.start({ text: 'a waker', turnId: 'waker' })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'waker', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  await clock.advance(36_000)
  const lines = whats(stopLogOf(store, w))
  expect(lines).toContain('resume ended rate_limit: another turn, the carry-on still queued')
  expect(lines).toContain('carry-on not sent again: one is queued')
  expect(w.submitted).toHaveLength(1)
})

// puma-9arph.60 point 3: the carry-on's own turn, entered and then aborted, leaves nothing queued: no look reaches the fill.
test('C1: the carry-on\'s own turn that enters and ends aborted leaves nothing queued, so no look reaches the fill', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000 + 15_000)
  expect(w.submitted).toHaveLength(1)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'aborted', answer: '', durationMs: 1, isAborted: true })
  await clock.settle()
  expect(whats(stopLogOf(store, w)).at(-1)).toBe("resume ended aborted: the carry-on's own turn, nothing queued")
  const fills = w.fills ?? 0
  await clock.advance(45_000)
  expect(w.fills ?? 0).toBe(fills)
})

// puma-9arph.60, round 2 F1: a carry-on whose submit is refused during another turn is gone, so that turn's failed end
// gives nothing back and no look acts on it.
test('C1: a carry-on refused during another turn is not given back when that turn ends in an error', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  let refuse = (_error: Error) => {}
  w.submitHold = new Promise<void>((_resolve, reject) => { refuse = reject })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  await $.turn.start({ text: 'a waker', turnId: 'waker' })
  refuse(new Error('submission refused'))
  await clock.settle()
  await $.turn.complete({ turnId: 'waker', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain('resume ended error: another turn, nothing queued')
  const fills = w.fills ?? 0
  await clock.advance(15_000)
  expect(w.fills ?? 0).toBe(fills)
})

// puma-9arph.60, round 2 F1's class: a carry-on the engine drops during another turn is gone too.
test('C1: a carry-on dropped during another turn is not given back when that turn ends in an error', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  let answer = () => {}
  w.submitHold = new Promise<void>(resolve => { answer = resolve })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  await $.turn.start({ text: 'a waker', turnId: 'waker' })
  w.submitDrop = 'a Stop stands'
  answer()
  await clock.settle()
  await $.turn.complete({ turnId: 'waker', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain('resume ended error: another turn, nothing queued')
})

// puma-9arph.60, round 2 F4: a rejected sign-in on another turn that entered ends the entry at once, so the switch's
// carry-on finds the first one queued while that turn is still open, and one resume never enters twice.
test('C1: a rejected sign-in on another turn that entered sends no second carry-on while that turn is open', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  await $.turn.start({ text: 'a waker', turnId: 'waker' })
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  const lines = whats(stopLogOf(store, w))
  expect(lines).toContain('resume ended authentication_failed: another turn, the carry-on still queued')
  expect(lines).toContain('carry-on not sent again: one is queued')
})

// puma-9arph.60, stand-in run 2: Claude Code hands turn.start a plugin's prompt inside its own frame, so the carry-on's
// own turn is told by its text within that frame; a framed carry-on that dies on a limit leaves the next login a carry-on.
test('C1: the carry-on\'s own turn, framed by Claude Code, that dies on a limit sends the next login a carry-on', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  const framed = `The account-rotator plugin sent a message:\n${w.submitted[0]}\n\nThis is how Claude Code surfaces a prompt a plugin submits between turns.`
  await $.turn.start({ text: framed, turnId: 'turn-carry' })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(2)
  expect(whats(stopLogOf(store, w))).toContain("resume ended rate_limit: the carry-on's own turn, nothing queued")
})

// Review M403 B: a look whose fill has not answered holds the lock, and every later look skips its tick.
// A look's own fill is bounded (puma-9arph.74), so a later stop holds the lock here: its slot write, which the engine
// answers with no bound of the mod's own, waits across the looks' ticks.
test('row d: a look while a stop holds the lock does nothing', async ($, on) => {
  const w = fresh()
  const { clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000 + 15_000)
  const before = w.fills ?? 0
  expect(before).toBeGreaterThan(0)
  let release = () => {}
  w.beforeEnv = () =>
    new Promise<void>(resolve => {
      release = resolve
    })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(30_000)
  expect(w.fills ?? 0).toBe(before)
  w.beforeEnv = undefined
  release()
  await clock.settle()
  await clock.advance(36_000 + 15_000)
  expect(w.fills ?? 0).toBeGreaterThan(before)
})

// Review M403 E: a look that throws says so in the stop-log, once an episode.
test('a throw in the owed-resume look writes one stop-log line', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  w.isFillThrown = true
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000 + 30_000)
  // One line, whatever name the engine gives the error; the next looks fail too and say nothing more.
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('owed resume look failed: '))).toHaveLength(1)
})

test('row h: a StopFailure with agent_id switches nothing, opens no episode and allows no Escape', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit', agent_id: 'agent-1', agent_type: 'Explore' })
  await clock.settle()
  await clock.advance(2 * 60_000)
  expect([slots(w), w.submitted, w.spawned]).toEqual([[], [], []])
  // An episode would have the look write that nothing is queued; the one line is the agent's stop.
  expect(whats(stopLogOf(store, w))).toEqual(['stop heard from agent Explore: rate_limit, no switch'])
})

test('row i: an open turn that never ends holds every Escape and the stop-log names the wait once', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await turnStops($, clock, undefined, false)
  await clock.advance(5 * 60_000)
  const lines = whats(stopLogOf(store, w))
  expect(lines.filter(l => l === WAITS_ON_TURN)).toHaveLength(1)
  expect(lines.filter(l => l.startsWith('owed resume: fill') || l.includes('Escape'))).toEqual([])
  expect(w.spawned).toEqual([])
})

test('row j: a carry-on submitted while a main turn runs, that turn dies on a limit, no second carry-on is submitted', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await turnStops($, clock)
  // A main-loop turn (a waker's) runs as the carry-on goes out behind it, and dies on the limit on login 2.
  await $.turn.start({ text: 'waker', turnId: 'turn-waker' })
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'turn-waker', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2, SLOT3])
  expect(w.submitted).toHaveLength(1)
  expect(whats(stopLogOf(store, w))).toContain('carry-on not sent again: one is queued')
})

test('row l: with no pane, the look logs once and sends no key', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w, false)
  await turnStops($, clock)
  await clock.advance(5 * 60_000)
  const lines = whats(stopLogOf(store, w))
  expect(lines.filter(l => l === 'owed resume: no Orca pane, waits for an Esc')).toHaveLength(1)
  expect(lines.filter(l => l.startsWith('owed resume: fill'))).toEqual([])
  expect(w.spawned).toEqual([])
})

test('row r: a resume that dies with no response since its switch marks nothing on the target and moves to the next login', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await turnStops($, clock)
  await clock.advance(36_000)
  // The resume enters on login 2 and dies at once on the limit.
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2, SLOT3])
  expect(['mark:1', 'mark:2', 'week-mark:2', 'fable-mark:2'].map(key => store.get(key) !== undefined)).toEqual([true, false, false, false])
  expect(whats(stopLogOf(store, w))).toContain('stop on owed resume: login 2 in use, no response since its switch, no mark')
})

// The kit cannot draw 'dialog': the look reaches the fill within v4's bound, and the resume enters there.
test('row t: with no scheduled task firing, entry comes within the bound by mock-clock advances alone', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  for (let waited = 0; waited < 120_000 && !whats(stopLogOf(store, w)).includes(FILL_NO_CAUSE); waited += 5_000) await clock.advance(5_000)
  expect(whats(stopLogOf(store, w))).toContain(FILL_NO_CAUSE)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await clock.settle()
  const stop = logTime(store, w, 'stop heard')
  // entry - stop <= max(m + 35 s, close - stop) + 50 s x h + 65 s + 2 min x (n - 1), with no turn open, h = 0 and n = 1.
  const m = logTime(store, w, 'moved to') - stop
  const bound = m + 35_000 + 65_000
  expect(logTime(store, w, 'resume entered') - stop).toBeLessThanOrEqual(bound)
})

test('row u: an unknown wording reads the Fable week from the usage read, as no wording does', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  // The usage read shows login 1's Fable week spent; the words name no limit.
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  // A Fable stop: the move is for the Fable week, and login 1's 5-hour window is left unmarked.
  expect(slots(w)).toEqual([SLOT2])
  expect(w.toasts.filter(t => /has 0% of its Fable week left\.$/.test(t))).toHaveLength(1)
  expect(store.get('mark:1')).toBeUndefined()
})

test('row b: a measure within 30 s of entry, then a stop, keeps one episode and its tried set', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await turnStops($, clock)
  await clock.advance(36_000)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await clock.advance(10_000)
  // A measure of the context alone, which proves no switch; less than ENTRY_PROOF_MS after the entry, it ends nothing.
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['context'] })
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  const lines = whats(stopLogOf(store, w))
  expect(lines.filter(l => l.startsWith('work resumed'))).toEqual([])
  // The stop on login 2 is wordless and its switch unproven: login 2 is tried only at its second such stop.
  expect(lines.filter(l => l.startsWith('picked 3'))).toEqual(['picked 3: fresh, read 1 min ago; tried 1'])
  expect(slots(w)).toEqual([SLOT2, SLOT3])
})

// ---------------------------------------------------------------- puma-9arph.57: the refresh nudge

/** owedWorld with login 1's token 7 minutes from expiry, then a usage-limit stop whose switch to 2 the refresh guard holds. */
async function heldWorld($: Engine, on: On, w: World) {
  const { store, clock } = await owedWorld($, on, w)
  const expiresAt = clock.now() + 7 * 60_000
  w.keychain['Claude Code-credentials'] = blob('tok-1', expiresAt)
  const stopAt = clock.now()
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  return { store, clock, expiresAt, stopAt }
}

/** The nudge's own turn, as Claude Code starts it once the Escape frees it, dying on the limit or answering. */
async function nudgeTurn($: Engine, clock: MockClock, end: { error: 'rate_limit' | 'authentication_failed' } | 'answer'): Promise<void> {
  await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
  if (end !== 'answer') await $.classic.StopFailure(end)
  await $.turn.complete({ turnId: 'turn-nudge', reason: end === 'answer' ? 'answer' : 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
}

const NUDGE_SENT = "refresh nudge: login 1's token expires in "

test('row v: a held stop with no turn open sends one nudge NUDGE_LEAD_MS before the expiry, lands after the refresh and enters the resume within the bound', async ($, on) => {
  const w = fresh()
  const { store, clock, expiresAt, stopAt } = await heldWorld($, on, w)
  expect(whats(stopLogOf(store, w))).toContain('held for 2: the token in use refreshes soon')
  await clock.advance(2 * 60_000)
  expect(w.submitted).toEqual([])
  await clock.advance(75_000)
  expect(w.submitted).toEqual([NUDGE_TEXT])
  const sent = whats(stopLogOf(store, w)).find(l => l.startsWith(NUDGE_SENT)) ?? ''
  expect(Number(sent.slice(NUDGE_SENT.length).split(' ')[0])).toBeLessThanOrEqual(NUDGE_LEAD_MS / 1000)
  // Claude Code refreshes login 1's token before the nudge's request, under login 1's own slot; the request dies on the limit.
  await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
  refresh(w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'turn-nudge', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  expect(whats(stopLogOf(store, w)).filter(l => ['refresh nudge entered on login 1', 'moved to 2 (by a stop)', 'resume entered'].includes(l))).toEqual(['refresh nudge entered on login 1', 'moved to 2 (by a stop)'])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(2)
  const carry = w.submitted[1] ?? ''
  // B3: neither text holds the other, so the turn check never takes one for the other.
  expect([carry.includes(NUDGE_TEXT), NUDGE_TEXT.includes(carry)]).toEqual([false, false])
  await $.turn.start({ text: carry, turnId: 'turn-carry' })
  await clock.settle()
  expect(whats(stopLogOf(store, w)).at(-1)).toBe('resume entered')
  // The bound: the nudge at most one 15 s look after expiresAt - NUDGE_LEAD_MS, then the move's 35 s and 65 s for the entry.
  expect(logTime(store, w, 'resume entered') - stopAt).toBeLessThanOrEqual(expiresAt - NUDGE_LEAD_MS - stopAt + 15_000 + 35_000 + 65_000)
})

// Council B5: the nudge never goes over what the person is typing.
test('row v: a draft in the prompt box holds the nudge back until the box is empty', async ($, on) => {
  const w = fresh()
  const { clock } = await heldWorld($, on, w)
  w.draft = 'half a thought'
  await clock.advance(3 * 60_000 + 15_000)
  expect(w.submitted).toEqual([])
  w.draft = ''
  await clock.advance(15_000)
  expect(w.submitted).toEqual([NUDGE_TEXT])
})

// Merge read of #129, note 4: a box read with no answer counts as a draft after READ_TIMEOUT_MS, so it holds the look's
// lock, and with it every later look and stop, no longer.
test('row v: a box read that never answers holds the look no longer than the read bound, and the nudge goes later', async ($, on) => {
  const w = fresh()
  const { clock } = await heldWorld($, on, w)
  const never = new Promise<void>(() => {})
  let reads = 0
  w.onPromptRead = () => {
    w.readHold = reads++ === 0 ? never : undefined
  }
  await clock.advance(3 * 60_000 + 15_000)
  expect([reads > 1, w.submitted]).toEqual([true, [NUDGE_TEXT]])
})

test('row v: a nudge whose request refreshes nothing lands no switch and sends no second nudge before the token\'s expiry', async ($, on) => {
  const w = fresh()
  const { store, clock } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await nudgeTurn($, clock, { error: 'rate_limit' })
  // Short of the expiry, 7 minutes after the stop: puma-9arph.65 sends one more past it.
  await clock.advance(3 * 60_000)
  expect(slots(w)).toEqual([])
  expect(w.submitted).toEqual([NUDGE_TEXT])
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('refresh nudge: token'))).toEqual(['refresh nudge: token not refreshed, switch still held'])
})

// Council B2: the nudge's own turn never counts as the resume's entry, so a measure after it ends nothing.
test('row v: the nudge\'s own turn is no entry: a measure 31 s after it starts ends no episode and drops no held switch', async ($, on) => {
  const w = fresh()
  const { store, clock } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
  await clock.advance(31_000)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['context'] })
  await clock.settle()
  const lines = whats(stopLogOf(store, w))
  expect([lines.includes('resume entered'), lines.some(l => l.startsWith('work resumed'))]).toEqual([false, false])
  refresh(w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await $.turn.complete({ turnId: 'turn-nudge', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
})

// Council B4: a rejected sign-in after a nudge drops the held switch; nothing marks login 1, so no later expiry releases the guard.
test('row v: an authentication_failed after a nudge drops the held switch and never lands it', async ($, on) => {
  const w = fresh()
  const { store, clock } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await nudgeTurn($, clock, { error: 'authentication_failed' })
  await clock.advance(10 * 60_000)
  expect(whats(stopLogOf(store, w))).toContain('held switch dropped: authentication_failed after the refresh nudge, login 1 kept')
  expect([slots(w), (store.get('health:1') as { kind?: string } | undefined)?.kind]).toEqual([[], 'ok'])
  // Review r1 NUDGE_EPISODE: the drop ends the episode, so nothing waits on it and a later stop moves.
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('owed resume: no carry-on queued'))).toEqual([])
  refresh(w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
})

// RULING 6441 item 2 (a named departure from council B4): a stop that neither marks a sign-in rejected nor raises the
// limit leaves the hold as a held stop has it today; no mark is written, so the guard's expiry release stays out of reach.
for (const error of ['overloaded', 'unknown'] as const) {
  test(`row v: an ${error} stop after a nudge keeps the held switch and marks nothing`, async ($, on) => {
    const w = fresh()
    const view = watchedView(on)
    const { store, clock } = await heldWorld($, on, w)
    await clock.advance(3 * 60_000 + 15_000)
    await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
    await $.classic.StopFailure({ error })
    await $.turn.complete({ turnId: 'turn-nudge', reason: 'error', answer: '', durationMs: 1, isAborted: false })
    await clock.settle()
    expect([view()?.held?.target.id, (store.get('health:1') as { kind?: string } | undefined)?.kind]).toEqual(['2', 'ok'])
    expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('held switch dropped'))).toEqual([])
  })
}

// Review r1 NUDGE_STALE: a press during the nudge's reads replaces the held stop; the nudge was for that stop alone.
test('row v: a press during the nudge\'s reads replaces the held switch, and no nudge goes', async ($, on) => {
  const w = fresh()
  const view = watchedView(on)
  const { clock } = await heldWorld($, on, w)
  let release = () => {}
  w.readHold = new Promise<void>(resolve => {
    release = resolve
  })
  // Review r2 STALE_TEST_GAP: the look runs unawaited, so the press waits until the look is inside its box read.
  const reached = new Promise<void>(resolve => {
    w.onPromptRead = resolve
  })
  await clock.advance(3 * 60_000 + 15_000)
  await reached
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-3' })
  await clock.settle()
  expect([view()?.held?.target.id, view()?.held?.carry]).toEqual(['3', undefined])
  release()
  await clock.settle()
  expect(w.submitted).toEqual([])
  await pane.unmount()
})

// Review r1 NUDGE_TEST_TIMING, its instance as written: a measure 31 s after the nudge's turn completes ends nothing.
test('row v: a measure 31 s after the nudge\'s turn completes on the limit ends no episode', async ($, on) => {
  const w = fresh()
  const { store, clock } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await nudgeTurn($, clock, { error: 'rate_limit' })
  await clock.advance(31_000)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['context'] })
  expect(whats(stopLogOf(store, w)).some(x => x.startsWith('work resumed'))).toBe(false)
})

/** The carry-on the person's turn is owed, as Claude Code starts it and the login in use answers it. */
async function carryTurn($: Engine, clock: MockClock, w: World): Promise<void> {
  const carry = w.submitted[1] ?? ''
  expect(carry).not.toBe(NUDGE_TEXT)
  await $.turn.start({ text: carry, turnId: 'turn-carry' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false })
  await clock.advance(10 * 60_000)
}

// Merge read of #129, note 1 (RULING 6468): the answer was to the nudge alone, so the turn the limit stopped is still
// owed, and it carries on once on login 1.
test('row v: a nudge that login 1 answers drops the held switch and carries the person\'s turn on there once', async ($, on) => {
  const w = fresh()
  const view = watchedView(on)
  const { store, clock } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  expect(view()?.held?.target.id).toBe('2')
  await nudgeTurn($, clock, 'answer')
  const done = (l: string) => l.startsWith('held switch dropped') || l.startsWith('work resumed')
  expect(whats(stopLogOf(store, w)).filter(done)).toEqual(['held switch dropped: the refresh nudge answered on login 1'])
  expect([view()?.held, w.submitted.length]).toEqual([undefined, 2])
  await carryTurn($, clock, w)
  expect(whats(stopLogOf(store, w)).filter(done)).toEqual(['held switch dropped: the refresh nudge answered on login 1', 'work resumed on login 1'])
  expect([w.submitted.length, slots(w)]).toEqual([2, []])
})

/**
 * Merge read of #129, block 1: another session on login 1 refreshes the shared token while the nudge sits queued, so the
 * minute retry lands the held switch, and the landing's carry-on is held back behind the nudge.
 */
async function landedWhileNudgeQueued($: Engine, on: On, w: World) {
  const { store, clock } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  expect(w.submitted).toEqual([NUDGE_TEXT])
  refresh(w)
  await clock.advance(60_000)
  expect(slots(w)).toEqual([SLOT2])
  await clock.advance(36_000)
  expect([whats(stopLogOf(store, w)).includes('carry-on not sent again: one is queued'), w.submitted]).toEqual([true, [NUDGE_TEXT]])
  return { store, clock }
}

test('row v: a landing while the nudge sits queued carries the person\'s turn on once the nudge is answered', async ($, on) => {
  const w = fresh()
  const { store, clock } = await landedWhileNudgeQueued($, on, w)
  await nudgeTurn($, clock, 'answer')
  expect(w.submitted).toHaveLength(2)
  // Merge read b of #129, note 3: the hold landed, so the answer's line says it was gone, never a refused drop.
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('held switch'))).toEqual(["held switch already gone at the refresh nudge's answer, on login 2"])
  await carryTurn($, clock, w)
  const lines = whats(stopLogOf(store, w))
  expect(lines.filter(l => l === 'resume entered' || l.startsWith('work resumed'))).toEqual(['resume entered', 'work resumed on login 2'])
  expect([lines.some(l => l.startsWith('owed resume: no carry-on queued')), w.submitted.length]).toEqual([false, 2])
})

// RULING 6473: the carry-on the landing held back is owed at every ending of the nudge's turn, as the fork main carries
// the turn on after the same landing. A switching stop on that turn is the stop path's (its own landing carries on).
// The engine's own drop or throw of the nudge after such a landing no kit order reaches: a hook's answer counts only
// within its budget (HookBudget.ms), and the landing holds its carry-on back SETTLE_MS after it lands.
for (const end of ['aborted', 'overloaded'] as const) {
  test(`row v: a landing while the nudge sits queued carries the person's turn on once when the nudge ends ${end}`, async ($, on) => {
    const w = fresh()
    const { clock } = await landedWhileNudgeQueued($, on, w)
    await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
    if (end === 'overloaded') await $.classic.StopFailure({ error: 'overloaded' })
    await $.turn.complete({ turnId: 'turn-nudge', reason: end === 'aborted' ? 'aborted' : 'error', answer: '', durationMs: 1, isAborted: end === 'aborted' })
    await clock.settle()
    expect([w.submitted.length, w.submitted[1] === NUDGE_TEXT]).toEqual([2, false])
    await clock.advance(10 * 60_000)
    expect(w.submitted).toHaveLength(2)
  })
}

// Review r7 NUDGE_STALE_SETTLEMENT: the nudge's own submission refused late, after its turn ran and the person's carry-on
// was queued, clears nothing of that newer carry-on, so a later landing sends no second one.
for (const late of ['throw', 'drop'] as const) {
  test(`row v: a late ${late} of the nudge's submission leaves the newer carry-on queued, and no second goes`, async ($, on) => {
    const w = fresh()
    const { clock } = await heldWorld($, on, w)
    let settle = () => {}
    w.submitHold = new Promise<void>((resolve, reject) => {
      settle = late === 'drop' ? resolve : () => reject(new Error('late nudge refusal'))
    })
    await clock.advance(3 * 60_000 + 15_000)
    expect(w.submitted).toEqual([NUDGE_TEXT])
    w.submitHold = new Promise<void>(() => {})
    await nudgeTurn($, clock, 'answer')
    expect(w.submitted).toHaveLength(2)
    if (late === 'drop') w.submitDrop = 'a Stop stands'
    settle()
    await clock.settle()
    refresh(w)
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.settle()
    await clock.advance(36_000)
    expect(w.submitted).toHaveLength(2)
  })
}

/** The held switch's minute retry owning the switch, paused in its keychain read after its owner claim, the nudge's turn open. */
async function gatedRetry($: Engine, on: On, w: World) {
  const view = watchedView(on)
  const { store, clock } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  expect(w.submitted).toEqual([NUDGE_TEXT])
  let open = () => {}
  const gate = new Promise<void>(resolve => {
    open = resolve
  })
  let isGated = false
  w.beforeKeychain = () => {
    if (isGated || view()?.owner === undefined) return Promise.resolve()
    isGated = true
    return gate
  }
  await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
  // Past the minute's retry (45 s on) and inside its read's bound, READ_TIMEOUT_MS (puma-9arph.74).
  await clock.advance(50_000)
  expect([isGated, view()?.owner !== undefined, view()?.held?.target.id]).toEqual([true, true, '2'])
  return { view, store, clock, open }
}

/**
 * Review r2 DROP_RACE: the held switch's minute retry owns the switch, paused in its keychain read after its owner claim,
 * when the nudge's turn ends in a drop; the drop's write is refused, and the retry then writes the hold again.
 */
async function dropDuringRetry($: Engine, on: On, end: 'authentication_failed' | 'answer', isRefreshed = false) {
  const w = fresh()
  const { view, store, clock, open } = await gatedRetry($, on, w)
  if (end !== 'answer') await $.classic.StopFailure({ error: end })
  const done = $.turn.complete({ turnId: 'turn-nudge', reason: end === 'answer' ? 'answer' : 'error', answer: '', durationMs: 1, isAborted: false })
  // The retry's read then finds login 1's token refreshed, passes the guard and lands the switch.
  if (isRefreshed) refresh(w)
  open()
  await done
  await clock.settle()
  return { w, view, store, clock }
}

test('row v: an authentication_failed after a nudge while the held switch\'s retry owns the switch drops nothing and ends no episode', async ($, on) => {
  const { w, view, store, clock } = await dropDuringRetry($, on, 'authentication_failed')
  expect(view()?.held?.target.id).toBe('2')
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('held switch'))).toEqual(['held switch not dropped: a switch is running'])
  // The hold stands as a held stop's does: nothing lands it past the guard.
  await clock.advance(10 * 60_000)
  expect([slots(w), w.submitted]).toEqual([[], [NUDGE_TEXT]])
})

test('row v: a nudge answered while the held switch\'s retry owns the switch drops nothing and ends no episode', async ($, on) => {
  const { w, view, store } = await dropDuringRetry($, on, 'answer')
  expect(view()?.held?.target.id).toBe('2')
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('held switch') || l.startsWith('work resumed'))).toEqual(['held switch not dropped: a switch is running'])
})

test('row v: an authentication_failed after a nudge whose retry lands the switch meanwhile drops nothing and ends no episode', async ($, on) => {
  const { w, store } = await dropDuringRetry($, on, 'authentication_failed', true)
  const lines = whats(stopLogOf(store, w))
  expect([slots(w), lines.filter(l => l.startsWith('held switch') || l.startsWith('work resumed'))]).toEqual([[SLOT2], ['held switch not dropped: a switch is running']])
})

// puma-9arph.68: `account use` on the login in use cannot end the hold while the retry owns the switch, and says so.
test('a use of the login in use while the held switch\'s retry owns the switch is refused and says a switch is running', async ($, on) => {
  const w = fresh()
  const { view, store, clock, open } = await gatedRetry($, on, w)
  // Each later retry's read waits too: the minute's tick runs the retry, then the request, inside that read's bound
  // (puma-9arph.74).
  w.beforeKeychain = () => (view()?.owner === undefined ? Promise.resolve() : new Promise<void>(() => {}))
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '1', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  const answer = resultOf(w, N1)
  expect([answer?.ok, /a switch is running/.test(String(answer?.message)), view()?.held?.target.id], `the answer: "${answer?.message}"`).toEqual([false, true, '2'])
  open()
  await clock.settle()
})

// Review r3 REPLACED-HOLD: a press after the nudge replaces the stop's hold with its own; the drop is for the stop's alone.
for (const key of ['use-2', 'use-3'] as const) {
  for (const end of ['answer', 'authentication_failed'] as const) {
    test(`row v: a ${key} press after the nudge keeps its hold through the nudge's ${end}`, async ($, on) => {
      const w = fresh()
      const view = watchedView(on)
      const { store, clock } = await heldWorld($, on, w)
      await clock.advance(3 * 60_000 + 15_000)
      await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
      const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
      await pane.press({ key })
      await clock.settle()
      const target = key.slice('use-'.length)
      expect([view()?.held?.target.id, view()?.held?.carry]).toEqual([target, undefined])
      if (end !== 'answer') await $.classic.StopFailure({ error: end })
      await $.turn.complete({ turnId: 'turn-nudge', reason: end === 'answer' ? 'answer' : 'error', answer: '', durationMs: 1, isAborted: false })
      await clock.settle()
      const lines = whats(stopLogOf(store, w)).filter(l => l.startsWith('held switch'))
      expect([view()?.held?.target.id, lines]).toEqual([target, ['held switch not dropped: not the hold the nudge went for']])
      await pane.unmount()
    })
  }
}

// Review r4 LATER-STOP-HOLD: a later stop that holds the switch for another need replaces the hold the nudge went for;
// the drop after the nudge leaves that stop's hold standing.
for (const end of ['answer', 'authentication_failed'] as const) {
  test(`row v: a nudge ending in ${end} after a later Fable stop held the switch keeps that stop's hold`, async ($, on) => {
    const w = fresh()
    const view = watchedView(on)
    const { store, clock } = await heldWorld($, on, w)
    await clock.advance(3 * 60_000 + 15_000)
    await $.turn.start({ text: NUDGE_TEXT, turnId: 'turn-nudge' })
    await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: FABLE_HIT_STOP.last_assistant_message })
    await clock.settle()
    expect(view()?.held?.carry).toEqual({ need: 'fable' })
    if (end !== 'answer') await $.classic.StopFailure({ error: end })
    await $.turn.complete({ turnId: 'turn-nudge', reason: end === 'answer' ? 'answer' : 'error', answer: '', durationMs: 1, isAborted: false })
    await clock.settle()
    const lines = whats(stopLogOf(store, w)).filter(l => l.startsWith('held switch'))
    expect([view()?.held?.carry, lines]).toEqual([{ need: 'fable' }, ['held switch not dropped: not the hold the nudge went for']])
  })
}

// ---------------------------------------------------------------- puma-9arph.65: what ends a held switch, and the nudge's edges

/** Login 1's token runs out in 7 minutes, inside the refresh guard, over a store the test reads. */
async function expiringWorld(on: On, w: World) {
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 7 * 60_000)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30, 10]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  return { store, clock: world(on, w, store) }
}

const atOfStored = (store: Map<string, unknown>, id: string) => (store.get(`health:${id}`) as { at?: unknown } | undefined)?.at

/** Where a check, not a stop, wrote login-needed on the login in use: the world's change, and the why it stores. */
const CHECK_ROUTES: [string, (w: World) => void, RegExp][] = [
  ['not signed in', w => { w.signedOut = [''] }, /^not signed in$/],
  ['signed in as another login', w => { w.keychain['Claude Code-credentials'] = blob('tok-2', NOW + 7 * 60_000) }, /^signed in as /],
  ['a rejected usage read', w => { w.failing = { 'tok-1': 401 } }, /^sign-in rejected$/],
]

for (const [route, change, why] of CHECK_ROUTES) {
  test(`puma-9arph.65: a held switch outlives the token's expiry where a check wrote login-needed (${route}), and lands once the token refreshes`, async ($, on) => {
    const w = fresh()
    const view = watchedView(on)
    const { store, clock } = await expiringWorld(on, w)
    change(w)
    await start($, clock)
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    await pane.press({ key: 'use-2' })
    await clock.settle()
    const stored = store.get('health:1') as { kind?: string; why?: string } | undefined
    expect([stored?.kind, why.test(stored?.why ?? ''), atOfStored(store, '1'), view()?.held?.target.id]).toEqual(['login-needed', true, undefined, '2'])
    // Past the expiry and one tick: no refresh came, so nothing says the switch is safe.
    await clock.advance(8 * 60_000)
    expect([slots(w), view()?.held?.target.id]).toEqual([[], '2'])
    refresh(w)
    await clock.advance(60_000)
    expect(slots(w)).toEqual([SLOT2])
    await pane.unmount()
  })
}

/** A stop's rejected sign-in on login 1 whose token runs out in 7 minutes: the switch to 2 is held for the refresh. */
async function rejectedAndHeld($: Engine, on: On, w: World) {
  const { store, clock } = await expiringWorld(on, w)
  await start($, clock)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain('held for 2: the token in use refreshes soon')
  expect([healthOfStored(store, '1')?.why, typeof atOfStored(store, '1')], 'premise: the stop wrote the mark').toEqual(['sign-in rejected', 'number'])
  return { store, clock }
}

test('puma-9arph.65: a held switch lands at the next tick after the token\'s expiry once a stop saw the sign-in rejected', async ($, on) => {
  const w = fresh()
  const { store, clock } = await rejectedAndHeld($, on, w)
  // No check reads login 1 meanwhile.
  readHeldElsewhere(store)
  await clock.advance(6 * 60_000)
  expect(slots(w)).toEqual([])
  await clock.advance(2 * 60_000)
  expect(slots(w)).toEqual([SLOT2])
})

test('puma-9arph.65: a check\'s rejected read in the hold keeps the stop\'s mark, so the switch still lands at the expiry', async ($, on) => {
  const w = fresh()
  const { store, clock } = await rejectedAndHeld($, on, w)
  const readsBefore = w.usageCalls.filter(t => t === 'tok-1').length
  w.failing = { 'tok-1': 401 }
  store.delete('usage-due:1')
  await clock.advance(2 * 60_000)
  expect(w.usageCalls.filter(t => t === 'tok-1').length, 'premise: a check read login 1 and was rejected').toBeGreaterThan(readsBefore)
  expect([healthOfStored(store, '1')?.why, typeof atOfStored(store, '1')], 'the stop\'s mark stands').toEqual(['sign-in rejected', 'number'])
  expect(slots(w)).toEqual([])
  await clock.advance(6 * 60_000)
  expect(slots(w)).toEqual([SLOT2])
})

const SIGN_IN_WAIT = "Switching accounts waits for this login's sign-in to refresh. Send any message to retry, or use /accounts."

const DRAFT_NOTICE = 'Switching accounts waits for your draft: press Enter to send it, or clear the box.'

const DRAFT_LINE = 'refresh nudge: a draft in the box, switch still held'

test('puma-9arph.65: a nudge whose token stays unrefreshed past its expiry is sent once more, never a third, and the person is told once', async ($, on) => {
  const w = fresh()
  const { store, clock, expiresAt } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await nudgeTurn($, clock, { error: 'rate_limit' })
  await clock.advance(expiresAt - clock.now() - 20_000)
  expect(w.submitted, 'no second nudge before the expiry').toEqual([NUDGE_TEXT])
  await clock.advance(40_000)
  expect(w.submitted).toEqual([NUDGE_TEXT, NUDGE_TEXT])
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith("refresh nudge again: login 1's token expired "))).toHaveLength(1)
  await nudgeTurn($, clock, { error: 'rate_limit' })
  await clock.advance(30 * 60_000)
  expect(w.submitted).toEqual([NUDGE_TEXT, NUDGE_TEXT])
  expect(w.toasts.filter(t => t === SIGN_IN_WAIT)).toHaveLength(1)
  expect(slots(w)).toEqual([])
})

test('puma-9arph.65: the nudge goes where the box holds exactly the mod\'s own line a queued carry-on left in it', async ($, on) => {
  const w = fresh()
  const { clock } = await heldWorld($, on, w)
  w.draft = NUDGE_TEXT
  await clock.advance(3 * 60_000 + 15_000)
  expect(w.submitted).toEqual([NUDGE_TEXT])
})

test('puma-9arph.65: a person\'s text in the box holds the switch and says so once, and only once the token is due', async ($, on) => {
  const w = fresh()
  const { store, clock } = await heldWorld($, on, w)
  w.draft = 'half a thought'
  await clock.advance(2 * 60_000)
  expect([w.toasts.filter(t => t === DRAFT_NOTICE), whats(stopLogOf(store, w)).filter(l => l === DRAFT_LINE)], 'not told while the token is not due').toEqual([[], []])
  await clock.advance(75_000)
  await clock.advance(30_000)
  expect(w.submitted).toEqual([])
  expect([w.toasts.filter(t => t === DRAFT_NOTICE), whats(stopLogOf(store, w)).filter(l => l === DRAFT_LINE)]).toEqual([[DRAFT_NOTICE], [DRAFT_LINE]])
  w.draft = ''
  await clock.advance(15_000)
  expect(w.submitted).toEqual([NUDGE_TEXT])
})

const EXPIRED_TOKEN_REJECTED = 'stop rejected on the expired token after the refresh nudge: the held switch lands through the release'

test('puma-9arph.65: a rejected sign-in on a nudge sent with the token already expired and not refreshed marks it, keeps the hold, and the switch lands at the next tick', async ($, on) => {
  const w = fresh()
  const view = watchedView(on)
  const { store, clock, expiresAt } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await nudgeTurn($, clock, { error: 'rate_limit' })
  await clock.advance(expiresAt - clock.now() + 20_000)
  expect(w.submitted, 'premise: the second nudge went on the expired token').toEqual([NUDGE_TEXT, NUDGE_TEXT])
  await nudgeTurn($, clock, { error: 'authentication_failed' })
  expect([healthOfStored(store, '1')?.why, typeof atOfStored(store, '1'), view()?.held?.target.id]).toEqual(['sign-in rejected', 'number', '2'])
  expect(whats(stopLogOf(store, w))).toContain(EXPIRED_TOKEN_REJECTED)
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('held switch dropped'))).toEqual([])
  expect(slots(w)).toEqual([])
  await clock.advance(60_000)
  expect(slots(w)).toEqual([SLOT2])
  // The operator's order: it switches AND resumes. The held stop's carry-on goes once the switch has settled.
  await clock.advance(36_000)
  expect(w.submitted, 'the stop carry-on after the landing').toHaveLength(3)
  const carry = w.submitted[2] ?? ''
  await $.turn.start({ text: carry, turnId: 'turn-carry' })
  await clock.settle()
  expect(whats(stopLogOf(store, w)).at(-1)).toBe('resume entered')
})

test('puma-9arph.65: a rejected sign-in on a nudge sent before the token\'s expiry still drops the held switch and marks nothing', async ($, on) => {
  const w = fresh()
  const { store, clock } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await nudgeTurn($, clock, { error: 'authentication_failed' })
  const lines = whats(stopLogOf(store, w))
  expect(lines).toContain('held switch dropped: authentication_failed after the refresh nudge, login 1 kept')
  expect(lines).not.toContain(EXPIRED_TOKEN_REJECTED)
  expect([healthOfStored(store, '1')?.kind, atOfStored(store, '1')]).toEqual(['ok', undefined])
  await clock.advance(10 * 60_000)
  expect(slots(w)).toEqual([])
})

// Review r65 F1|F3 (RULING 6487): a token is told by its digest, not by its expiry alone. A replacement token with the
// same expiry gets neither C6's mark (the hold is dropped as at main) nor the one more nudge.
test('Review r65 F1: C6 does not release on a replacement token with the same expiry', async ($, on) => {
  const w = fresh()
  const view = watchedView(on)
  const { clock, expiresAt } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await nudgeTurn($, clock, { error: 'rate_limit' })
  await clock.advance(expiresAt - clock.now() + 20_000)
  expect(w.submitted).toEqual([NUDGE_TEXT, NUDGE_TEXT])

  w.keychain['Claude Code-credentials'] = blob('replacement-1', expiresAt)
  await nudgeTurn($, clock, { error: 'authentication_failed' })
  expect(view()?.held).toBeUndefined()
  await clock.advance(60_000)
  expect(slots(w)).toEqual([])
})

for (const token of ['replacement-1', 'replacement-2']) {
  test(`Review r65 F1 class: C6 requires the same token, not merely the same expiry: ${token}`, async ($, on) => {
    const w = fresh()
    const { store, clock, expiresAt } = await heldWorld($, on, w)
    await clock.advance(3 * 60_000 + 15_000)
    await nudgeTurn($, clock, { error: 'rate_limit' })
    await clock.advance(expiresAt - clock.now() + 20_000)
    w.keychain['Claude Code-credentials'] = blob(token, expiresAt)
    await nudgeTurn($, clock, { error: 'authentication_failed' })
    expect(atOfStored(store, '1')).toBeUndefined()
    expect(slots(w)).toEqual([])
  })
}

test('Review r65 F3: a replacement token with the same expiry gets no second nudge', async ($, on) => {
  const w = fresh()
  const { clock, expiresAt } = await heldWorld($, on, w)
  await clock.advance(3 * 60_000 + 15_000)
  await nudgeTurn($, clock, { error: 'rate_limit' })
  w.keychain['Claude Code-credentials'] = blob('replacement-1', expiresAt)
  await clock.advance(expiresAt - clock.now() + 20_000)
  expect(w.submitted).toEqual([NUDGE_TEXT])
})

// ---------------------------------------------------------------- puma-9arph.38: one switch in flight

/**
 * Another session's read of login 1, spent, in the shared store as saveReading writes it: the minute's merge brings it
 * into the view, so both checks of the next tick find the login in use spent. This session's own read of it is due
 * only USAGE_IDLE_MS after the start's, a time no 10-minute mark meets.
 */
const spentElsewhere = (store: Map<string, unknown>, at: number) =>
  store.set('usage:1', { fiveHour: { pct: 100, resetsAt: '2026-10-12T12:00:00Z' }, sevenDay: { pct: 41, resetsAt: '2026-10-18T00:00:00Z' }, at, by: '1', v: 1, src: 'body' })

test('a held rotation retried in the tick where the tick\'s own rotation also leaves switches once, though the keychain answers late (puma-9arph.38)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  // Login 1 spent from the start, its token about to refresh: the start's rotation is held for login 2.
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  expect(w.toasts.filter(isSwitchedToast)).toHaveLength(0)
  refresh(w)
  w.beforeKeychain = () => new Promise<void>(resolve => setTimeout(resolve, 5))
  for (let i = 0; i < 3 && w.toasts.filter(isSwitchedToast).length === 0; i += 1) {
    await clock.advance(60_000)
    await settleReal(clock)
  }
  await clock.advance(60_000)
  await settleReal(clock)
  expect([slots(w), w.toasts.filter(isSwitchedToast).length]).toEqual([[SLOT2], 1])
})

test('the 10-minute check beside the minute\'s check, both finding the login in use spent, switches once, though the keychain answers late (puma-9arph.38)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await settleReal(clock)
  w.usage['tok-1'] = [100, 41]
  await clock.advance(10 * 60_000 - 1000)
  await settleReal(clock)
  // Both timers fire at the tenth minute, each check ending in the rotation.
  spentElsewhere(store, clock.now())
  w.beforeKeychain = () => new Promise<void>(resolve => setTimeout(resolve, 5))
  await clock.advance(1000)
  await settleReal(clock)
  // Each check waits USAGE_CLAIM_WAIT_MS for its claim to stand, then reads and rotates: both in this one tick.
  await clock.advance(USAGE_CLAIM_WAIT_MS)
  await settleReal(clock)
  await clock.advance(1000)
  await settleReal(clock)
  expect([slots(w), w.toasts.filter(isSwitchedToast).length]).toEqual([[SLOT2], 1])
})

test('a usage-limit stop while a rotation\'s switch is in flight rides it: one switch, its carry-on entered, none skipped (puma-9arph.38)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  // The start's rotation leaves the spent login 1; its slot write waits on a gate the test opens, so it has written no
  // `pending` when the stop comes: the stop meets a switch in flight, not one settling.
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => { open = resolve })
  let writes = 0
  w.beforeEnv = () => (writes++ === 0 ? gate : Promise.resolve())
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  expect(slots(w)).toEqual([])
  await $.classic.StopFailure(PLAIN)
  await settleReal(clock)
  open()
  await settleReal(clock)
  await clock.advance(36_000)
  await settleReal(clock)
  expect([slots(w), w.toasts.filter(isSwitchedToast).length, w.submitted.length]).toEqual([[SLOT2], 1, 1])
  expect(whats(stopLogOf(store, w)).filter(x => x.startsWith('carry-on skipped'))).toEqual([])
})

test('a press while a switch in flight hangs still lands once SWITCH_WAIT_MS has passed (puma-9arph.38)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  // The start's rotation leaves login 1 and its slot write never answers, as an engine call with no limit of its own may.
  let writes = 0
  w.beforeEnv = () => (writes++ === 0 ? new Promise<void>(() => undefined) : Promise.resolve())
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  expect(slots(w)).toEqual([])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  void pane.press({ key: 'use-2' })
  await settleReal(clock)
  expect(slots(w)).toEqual([])
  await clock.advance(30_000)
  await settleReal(clock)
  await pane.unmount()
  expect(slots(w)).toEqual([SLOT2])
})

test('a switch in flight that throws frees the next one: a later tick switches normally (puma-9arph.38)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  // The start's rotation meets a slot write that fails with no policy named: the switch throws.
  w.breakEnv = true
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  expect(slots(w)).toEqual([])
  w.breakEnv = false
  await clock.advance(60_000)
  await settleReal(clock)
  expect(slots(w)).toEqual([SLOT2])
})

// Review r1 WAITERS-RACE: callers released from one wait each went on to switch, so two presses gave three switches.
for (const [name, keys] of [
  ['two Use now presses', ['use-2', 'use-2']],
  ['Use now and Rotate now', ['use-2', 'rotate']],
] as const) {
  test(`Review r1 WAITERS-RACE: ${name} waiting on one switch in flight start no second switch (puma-9arph.38)`, async ($, on) => {
    const w = fresh()
    const { clock } = await loggedWorld(on, w)
    let open: () => void = () => undefined
    const gate = new Promise<void>(resolve => { open = resolve })
    let writes = 0
    w.beforeEnv = () => (writes++ === 0 ? gate : Promise.resolve())
    w.usage['tok-1'] = [100, 41]
    await start($, clock)
    await settleReal(clock)
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    for (const key of keys) void pane.press({ key })
    await settleReal(clock)
    open()
    await settleReal(clock)
    await pane.unmount()
    expect([name, w.toasts.filter(isSwitchedToast).length]).toEqual([name, 1])
  })
}

// Review r1 of #104 and #105 (Codex gpt-6-sol at b503ddd), class [STALE-WRITE-AFTER-GIVE-UP]: a switch given up on
// wrote a record at an await its one generation check did not cover. Each order of the two presses is swept.
for (const [first, later] of [['2', '3'], ['3', '2']]) {
  test(`a switch given up on during its keychain read leaves the held press for login ${later} standing (Review STALE_HELD_INTENT)`, async ($, on) => {
    const w = fresh()
    const { clock } = await loggedWorld(on, w, THREE_LOGINS)
    w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
    w.usage['tok-3'] = [10, 30]
    const view = watchedView(on)
    await start($, clock)
    await settleReal(clock)
    // The token in use refreshes soon, so each press is held; the first one's keychain read hangs past SWITCH_WAIT_MS.
    w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
    let open: () => void = () => undefined
    const gate = new Promise<void>(resolve => { open = resolve })
    let reads = 0
    w.beforeKeychain = () => (reads++ === 0 ? gate : Promise.resolve())
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    void pane.press({ key: `use-${first}` })
    await settleReal(clock)
    void pane.press({ key: `use-${later}` })
    await settleReal(clock)
    await clock.advance(30_000)
    await settleReal(clock)
    open()
    await settleReal(clock)
    await pane.unmount()
    expect(view()?.held?.target.id).toBe(later)
  })

  test(`a switch given up on during its keychain read that then finds no refresh due leaves the held press for login ${later} standing (Review STALE_HELD_CLEARED)`, async ($, on) => {
    const w = fresh()
    const { clock } = await loggedWorld(on, w, THREE_LOGINS)
    w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
    w.usage['tok-3'] = [10, 30]
    const view = watchedView(on)
    await start($, clock)
    await settleReal(clock)
    // The later press reads the token in use about to refresh and is held; the first press's read hangs past
    // SWITCH_WAIT_MS and, once open, reads that token refreshed, so it goes on past the hold to its own switch.
    w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
    let open: () => void = () => undefined
    const gate = new Promise<void>(resolve => { open = resolve })
    let reads = 0
    w.beforeKeychain = () => (reads++ === 0 ? gate : Promise.resolve())
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    void pane.press({ key: `use-${first}` })
    await settleReal(clock)
    void pane.press({ key: `use-${later}` })
    await settleReal(clock)
    await clock.advance(30_000)
    await settleReal(clock)
    const isHeldFirst = view()?.held?.target.id === later
    w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 8 * HOUR)
    open()
    await settleReal(clock)
    await pane.unmount()
    expect([isHeldFirst, view()?.held?.target.id]).toEqual([true, later])
  })

  test(`a switch given up on after its slot check leaves the session on login ${later}, pressed for since (Review STALE_PENDING_WRITE)`, async ($, on) => {
    const w = fresh()
    const { clock } = await loggedWorld(on, w, THREE_LOGINS)
    w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
    w.usage['tok-3'] = [10, 30]
    const view = watchedView(on)
    // The first press's switch passes its slot check, then its next view read hangs past SWITCH_WAIT_MS.
    let open: () => void = () => undefined
    const gate = new Promise<void>(resolve => { open = resolve })
    let isHeld = false
    on('state.get', async (_$, e, next) => {
      if (e.key === 'view' && w.envSets.at(-1)?.value === (first === '2' ? SLOT2 : SLOT3) && !isHeld) {
        isHeld = true
        await gate
      }
      return next(e)
    })
    await start($, clock)
    await settleReal(clock)
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    void pane.press({ key: `use-${first}` })
    await settleReal(clock)
    void pane.press({ key: `use-${later}` })
    await settleReal(clock)
    await clock.advance(30_000)
    await settleReal(clock)
    open()
    await settleReal(clock)
    await pane.unmount()
    expect([isHeld, view()?.activeId]).toEqual([true, later])
  })
}

test('a stop that gives up on a hung switch after a press gave up on it leaves the press\'s own switch standing (puma-9arph.39)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'rotate-to': 'order' })
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  // The start's rotation to login 2 hangs for ever; the press's own switch to login 3 hangs until opened.
  const hung = new Promise<void>(() => undefined)
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => { open = resolve })
  let writes = 0
  w.beforeEnv = () => { const n = writes++; return n === 0 ? hung : n === 1 ? gate : Promise.resolve() }
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  await clock.advance(10_000)
  void $.classic.StopFailure({ error: 'rate_limit' })
  await settleReal(clock)
  // The press gives up on the hung switch: its own switch to login 3 starts and its slot write waits on the gate.
  await clock.advance(20_000)
  await settleReal(clock)
  // The stop gives up on the same hung switch while the press's switch is under way.
  await clock.advance(10_000)
  await settleReal(clock)
  open()
  await settleReal(clock)
  await settleReal(clock)
  await pane.unmount()
  expect(slots(w)).toEqual([SLOT3])
})

test('F102-3: the carry-on owed goes though the view write that clears carryDue is refused (puma-9arph.40)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-2'] = [100, 30]
  const seen = refuseCarryClear(on)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 4 * 60_000)
  expect(seen.refused, 'the clearing write was refused').toBeGreaterThan(0)
  expect(w.submitted, whats(stopLogOf(store, w)).join(' | ')).toHaveLength(1)
})

test('F102-3 b: a carry-on sent while the view still holds carryDue is not sent again after the mod boots again (puma-9arph.40)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-2'] = [100, 30]
  refuseCarryClear(on)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 4 * 60_000)
  const before = w.submitted.length
  // boot again on the same store, the clock past the time owed. Not a reload: the module keeps its memory (puma-9arph.40
  // PLAN, T2a and T2b stand in for a reload).
  await start($, clock)
  await clock.advance(10 * 60_000)
  expect([before, w.submitted.length], whats(stopLogOf(store, w)).join(' | ')).toEqual([1, 1])
})

// ---------------------------------------------------------------- puma-9arph.40: a debt ended while its view clear is refused

const OWED_AT = Date.parse('2026-10-12T09:30:00Z')

const RELOADED_MARK = 'session-reloaded'

const carryEndedKeys = (store: Map<string, unknown>) => [...store.keys()].filter(k => k.startsWith('carry-ended:'))

/** A view that survived a reload holding the carry-on owed at 12:00 on login 1, owed at OWED_AT, under RELOADED_MARK. */
const survivingDebt = (owed: { owedAt?: number } = { owedAt: OWED_AT }): Partial<View> => ({
  carryDue: { at: Date.parse('2026-10-12T12:00:00Z'), from: '1', ...owed },
  sessionMark: RELOADED_MARK,
})

test('a carry-on sent while its view clear is refused leaves the ended mark in the store (puma-9arph.40)', async ($, on) => {
  const { w, store, clock, seen } = await refusedOwedWorld($, on)
  await pastOwed(clock)
  expect(typeof seen.owed?.owedAt, 'the debt names when it was owed').toBe('number')
  expect([w.submitted.length, carryEndedOf(store, w), carryEndedKeys(store).length]).toEqual([1, { owedAt: seen.owed?.owedAt }, 1])
  // The mark says when the debt ended, which the sweep ages it from: at the carry-on, after the time owed.
  const { endedAt } = store.get(`carry-ended:${w.otherEnv.ACCOUNT_ROTATOR_SESSION}`) as { endedAt?: number }
  expect((endedAt ?? 0) >= Date.parse('2026-10-12T12:00:00Z')).toBe(true)
})

test('a reload whose view still holds a debt the store marks ended owes nothing (puma-9arph.40)', async ($, on) => {
  // Counts the view writes that clear carryDue: the first write after the reload still holds it.
  let clears = 0
  const counting: Around = (e, inner) => {
    if (e.key === 'view' && e.value.carryDue === undefined) clears += 1
    return inner(e)
  }
  const { w, clock } = await reloadedWorld($, on, survivingDebt(), { [`carry-ended:${RELOADED_MARK}`]: { owedAt: OWED_AT } }, counting)
  await pastOwed(clock)
  expect([w.submitted.length, clears > 0, w.otherEnv.ACCOUNT_ROTATOR_SESSION]).toEqual([0, true, RELOADED_MARK])
})

test('a reload whose view holds a debt with no ended mark sends it once (puma-9arph.40)', async ($, on) => {
  const { w, clock } = await reloadedWorld($, on, survivingDebt())
  await pastOwed(clock)
  expect(w.submitted).toHaveLength(1)
})

// Codex round 2 F3: boot's clear of a debt the store marks ended spares a newer debt a stop wrote meanwhile.
test('a reload\'s clear of a marked debt spares a newer debt written just before it lands (puma-9arph.40)', async ($, on) => {
  const newer = { at: Date.parse('2026-10-12T12:00:00Z'), from: '1', owedAt: OWED_AT + 60_000 }
  let isArmed = true
  let held: View['carryDue']
  const racing: Around = async (e, inner) => {
    if (isArmed && e.key === 'view' && e.value.carryDue === undefined) {
      isArmed = false
      // A stop's write of its own debt lands first, as one that comes during boot's read of the mark.
      await inner({ ...e, value: { ...e.value, carryDue: newer } })
    }
    const result = await inner(e)
    if (e.key === 'view' && !(typeof result === 'object' && result !== null && 'deny' in result)) held = e.value.carryDue
    return result
  }
  await reloadedWorld($, on, survivingDebt(), { [`carry-ended:${RELOADED_MARK}`]: { owedAt: OWED_AT } }, racing)
  expect([isArmed, held?.owedAt]).toEqual([false, newer.owedAt])
})

// RULING 7129: no path drops a debt nobody ended (P1), and the mark outlives the debt's end, not its start (P2).
const DAY_MS = 24 * 3600_000

test('a reload keeps a debt owed 8 days ago that nobody ended, its reset tomorrow (puma-9arph.40)', async ($, on) => {
  const owedAt = NOW - 8 * DAY_MS
  let held: View['carryDue']
  const observe: Around = async (e, inner) => {
    const result = await inner(e)
    if (e.key === 'view' && !(typeof result === 'object' && result !== null && 'deny' in result)) held = e.value.carryDue
    return result
  }
  await reloadedWorld($, on, { ...survivingDebt({ owedAt }), carryDue: { at: NOW + DAY_MS, from: '1', owedAt } }, {}, observe)
  expect(held?.owedAt, 'a debt nobody ended survives boot').toBe(owedAt)
})

test('a reload sends a debt owed 8 days ago that nobody ended, though the ended mark cannot be read (puma-9arph.40)', async ($, on) => {
  const w = fresh()
  w.storeReadFails = 'carry-ended:'
  const { clock } = await reloadedWorld($, on, survivingDebt({ owedAt: NOW - 8 * DAY_MS }), {}, undefined, w)
  await pastOwed(clock)
  expect(w.submitted).toHaveLength(1)
})

test('the mark of a debt owed 6.9 days before it ended outlives the start\'s sweep a day after the end, so a reload sends nothing (puma-9arph.40)', async ($, on) => {
  const endedAt = NOW - DAY_MS
  const owedAt = endedAt - 6.9 * DAY_MS
  const key = `carry-ended:${RELOADED_MARK}`
  const { w, store, clock } = await reloadedWorld($, on, survivingDebt({ owedAt }), { [key]: { owedAt, endedAt } })
  await pastOwed(clock)
  // The start's sweep ran in this boot: the mark it kept is what the next reload reads.
  expect([w.submitted.length, store.get(key)]).toEqual([0, { owedAt, endedAt }])
})

test('a reload whose debt has no owedAt is sent once though the store holds a mark with no owedAt (puma-9arph.40)', { timeoutMs: 30_000 }, async ($, on) => {
  const { w, clock } = await reloadedWorld($, on, survivingDebt({}), { [`carry-ended:${RELOADED_MARK}`]: {} })
  await pastOwed(clock)
  expect(w.submitted).toHaveLength(1)
})

test('a reload whose marked debt\'s clear is refused again owes nothing and boots on (puma-9arph.40)', { timeoutMs: 30_000 }, async ($, on) => {
  const { seen, around } = carryClearRefusal()
  const { w, clock } = await reloadedWorld($, on, survivingDebt(), { [`carry-ended:${RELOADED_MARK}`]: { owedAt: OWED_AT } }, around)
  await pastOwed(clock)
  expect([seen.refused > 0, w.submitted.length, (w.logged ?? []).filter(line => line.includes('start failed'))]).toEqual([true, 0, []])
})

test('a switch that ends the carry-on owed, its view clear refused, leaves the ended mark (puma-9arph.40)', async ($, on) => {
  const { w, store, clock, seen } = await refusedOwedWorld($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'use-2' })
  await clock.settle()
  await pane.unmount()
  expect([w.envSets.at(-1)?.value, seen.refused > 0, carryEndedOf(store, w)]).toEqual([SLOT2, true, { owedAt: seen.owed?.owedAt }])
})

test('Use now pressed during a refused clearing write ends the carry-on owed and leaves the ended mark (puma-9arph.40)', { timeoutMs: 30_000 }, async ($, on) => {
  let isArmed = false
  let switchToTwo = async () => {}
  const pressing: Around = async (e, inner) => {
    const isClearing = isArmed && e.key === 'view' && e.value.carryDue === undefined
    if (isClearing) isArmed = false
    const result = await inner(e)
    if (isClearing) await switchToTwo()
    return result
  }
  const { w, store, clock, seen } = await refusedOwedWorld($, on, fresh(), { outer: pressing })
  const pane = await mountPane($)
  switchToTwo = async () => {
    await pane.press({ key: 'use-2' })
  }
  isArmed = true
  await clock.advance(Date.parse('2026-10-12T12:04:00Z') - clock.now())
  expect([isArmed, w.envSets.at(-1)?.value]).toEqual([false, SLOT2])
  await clock.advance(10 * 60_000)
  await pane.unmount()
  expect([w.submitted.length, carryEndedOf(store, w)]).toEqual([0, { owedAt: seen.owed?.owedAt }])
})

test('a refused clear, then the held branch, leaves the debt owed with no ended mark for a reload to read (puma-9arph.40)', { timeoutMs: 30_000 }, async ($, on) => {
  // After the first refused clear, the view reads login 1 as needing a sign-in until the next view write, which the
  // held branch makes: shouldLeave sends it there. That write keeps the view's own health, and reads the mark then.
  let isSpentRead = false
  let isDone = false
  let health: View['health'] = {}
  let markAtHeld: unknown = 'never held'
  const shared: { store?: Map<string, unknown>; w?: World } = {}
  const holding: Around = async (e, inner) => {
    if (e.key !== 'view' || isDone) return inner(e)
    if (isSpentRead && e.value.carryDue !== undefined) {
      isSpentRead = false
      isDone = true
      markAtHeld = shared.store?.get(`carry-ended:${shared.w?.otherEnv.ACCOUNT_ROTATOR_SESSION}`)
      return inner({ ...e, value: { ...e.value, health } })
    }
    const result = await inner(e)
    if (e.value.carryDue === undefined && typeof result === 'object' && result !== null && 'deny' in result) isSpentRead = true
    return result
  }
  const setup = () =>
    on('state.get', async (_$, e, next) => {
      const read = await next(e)
      if (!isSpentRead || e.plugin !== 'account-rotator' || e.key !== 'view' || read.value === undefined) return read
      const view = read.value.value as View
      health = view.health
      return { value: { ...read.value, value: { ...view, health: { ...view.health, '1': { kind: 'login-needed', why: 'sign-in rejected' } } } } }
    })
  const { w, store, clock, seen } = await refusedOwedWorld($, on, fresh(), { outer: holding, setup })
  shared.store = store
  shared.w = w
  await pastOwed(clock)
  const held = whats(stopLogOf(store, w)).filter(what => what === 'carry-on held: the login moved')
  expect([held.length, isDone, markAtHeld, w.submitted.length, carryEndedOf(store, w)]).toEqual([1, true, undefined, 1, { owedAt: seen.owed?.owedAt }])
})

test('the start\'s sweep deletes an ended mark that ended over 7 days ago or is unreadable, and keeps one owed long ago that ended since (puma-9arph.40)', async ($, on) => {
  const w = fresh()
  const day = DAY_MS
  const { store, clock } = await loggedWorld(on, w, {
    'carry-ended:old': { owedAt: NOW - 9 * day, endedAt: NOW - 8 * day },
    'carry-ended:new': { owedAt: NOW - 9 * day, endedAt: NOW - day },
    'carry-ended:bad': 'no mark',
  })
  await start($, clock)
  expect(carryEndedKeys(store)).toEqual(['carry-ended:new'])
})

test('a refused ended-mark write still sends the carry-on once (puma-9arph.40)', async ($, on) => {
  const w = fresh()
  w.onStoreSet = key => {
    if (key.startsWith('carry-ended:')) throw new Error('store: refused')
  }
  const { store, clock } = await refusedOwedWorld($, on, w)
  await pastOwed(clock)
  expect([w.submitted.length, carryEndedKeys(store)]).toEqual([1, []])
})

test('a main turn since the stop, its view clear refused, ends the carry-on owed and leaves the ended mark (puma-9arph.40)', async ($, on) => {
  const { w, store, clock, seen } = await refusedOwedWorld($, on)
  await $.turn.start({ text: 'go on', turnId: 'turn-own-continue' })
  await pastOwed(clock)
  const lines = whats(stopLogOf(store, w)).filter(what => what === 'a turn ran since the stop: no carry-on')
  expect([lines.length, w.submitted.length, carryEndedOf(store, w)]).toEqual([1, 0, { owedAt: seen.owed?.owedAt }])
})

test('a reload whose ended mark cannot be read owes the debt once more and boots on (puma-9arph.40)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.storeReadFails = 'carry-ended:'
  const { clock } = await reloadedWorld($, on, survivingDebt(), { [`carry-ended:${RELOADED_MARK}`]: { owedAt: OWED_AT } }, undefined, w)
  await pastOwed(clock)
  expect([w.submitted.length, (w.logged ?? []).filter(line => line.includes('start failed'))]).toEqual([1, []])
})

test('with no session mark a refused clear still sends the carry-on once and writes no ended mark (puma-9arph.40)', async ($, on) => {
  const w = fresh()
  w.refuseMark = true
  const { store, clock } = await refusedOwedWorld($, on, w)
  await pastOwed(clock)
  expect([w.submitted.length, carryEndedKeys(store)]).toEqual([1, []])
})

test('a stop\'s switch given up on by a press says so in the stop-log when it lands late (puma-9arph.39)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'rotate-to': 'order' })
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  let openLate: () => void = () => undefined
  const late = new Promise<void>(resolve => { openLate = resolve })
  let writes = 0
  w.beforeEnv = () => (writes++ === 0 ? late : Promise.resolve())
  await start($, clock)
  await settleReal(clock)
  w.usage['tok-1'] = [100, 41]
  void $.classic.StopFailure({ error: 'rate_limit' })
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  await clock.advance(30_000)
  await settleReal(clock)
  openLate()
  await settleReal(clock)
  await settleReal(clock)
  await pane.unmount()
  expect([slots(w).at(-1), whats(stopLogOf(store, w))]).toEqual([SLOT3, [STOP_RATE_LIMIT, PICKED_TWO, 'moved to 3 (by a press or a command)', 'stop switch given up on: landed late, no carry-on']])
})

test('a switch given up on after SWITCH_WAIT_MS that lands late leaves the session on the login a person pressed for since (puma-9arph.39)', async ($, on) => {
  const w = fresh()
  // Rotation by order: the start's rotation leaves the spent login 1 for login 2; its slot write hangs on a gate.
  const { clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'rotate-to': 'order' })
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => { open = resolve })
  let writes = 0
  w.beforeEnv = () => (writes++ === 0 ? gate : Promise.resolve())
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  await clock.advance(30_000)
  await settleReal(clock)
  expect(slots(w)).toEqual([SLOT3])
  // The given-up switch to login 2 lands now: the session stays on login 3, its slot written last and no switch shown.
  open()
  await settleReal(clock)
  await pane.unmount()
  expect([slots(w).at(-1), w.toasts.filter(t => /^Switched to Claude account two@/.test(String(t))).length]).toEqual([SLOT3, 0])
})


// ---------------------------------------------------------------- puma-9arph.41: the slot and the view name one login

/** Three logins by order, login 1 spent: the start's rotation to login 2 writes its slot through `gates[0]`, the next through `gates[1]`. */
async function hungStart($: Engine, on: On, gates: (() => Promise<void>)[]) {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'rotate-to': 'order' })
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  let writes = 0
  w.beforeEnv = () => (gates[writes++] ?? (() => Promise.resolve()))()
  w.usage['tok-1'] = [100, 41]
  await start($, clock)
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  return { w, store, clock, pane }
}

test('F104-2 a late switch landing between the press\'s slot write and its view write leaves the slot on the login pressed for', async ($, on) => {
  let openLate: () => void = () => undefined
  const late = new Promise<void>(resolve => { openLate = resolve })
  // The press's own slot write lets the given-up switch land at the same moment.
  const { w, clock, pane } = await hungStart($, on, [() => late, () => { openLate(); return Promise.resolve() }])
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  await clock.advance(30_000)
  await settleReal(clock)
  await settleReal(clock)
  await pane.unmount()
  expect([slots(w).at(-1), w.toasts.filter(t => /^Switched to Claude account three@/.test(String(t))).length]).toEqual([SLOT3, 1])
})

/** The slot of each login of THREE_LOGINS, by id. */
const SLOT_OF: Record<string, string> = { '1': '', '2': SLOT2, '3': SLOT3 }

/**
 * Three logins by order, login 1 spent, the world only: the test registers its hooks, then starts. The start's rotation to
 * login 2 writes its slot through `gates[0]`, the next through `gates[1]`.
 */
async function hungWorld(on: On, gates: (() => Promise<void>)[]) {
  const w = fresh()
  const { clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'rotate-to': 'order' })
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  let writes = 0
  w.beforeEnv = () => (gates[writes++] ?? (() => Promise.resolve()))()
  w.usage['tok-1'] = [100, 41]
  return { w, clock }
}

/**
 * Holds the first read of the view that the test's `arm`ed condition meets, until `open()`: the window of an engine call
 * a function makes between two writes. `isAfterRead` holds it once the read is taken, so its caller goes on with what
 * was read. Registered before the session starts, as a hook is; the condition is armed once the test has the world.
 */
function holdViewRead(on: On, isAfterRead = false) {
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => { open = resolve })
  let when: () => boolean = () => false
  let isHeld = false
  on('state.get', async (_$, e, next) => {
    if (e.key !== 'view' || isHeld || !when()) return next(e)
    isHeld = true
    if (isAfterRead) {
      const read = await next(e)
      await gate
      return read
    }
    await gate
    return next(e)
  })
  return { arm: (condition: () => boolean) => { when = condition }, open, isHeld: () => isHeld }
}

/** A response of the session's last turn that names login 1, by its week. */
const LOGIN_ONE_RESPONSE: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 93, resetsAt: '2026-10-12T12:00:00Z' },
  { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' },
]

test('a point-back whose slot write is landed and its view write not yet, with a given-up switch landing then, leaves the slot on the login the view names', async ($, on) => {
  let openLate: () => void = () => undefined
  const late = new Promise<void>(resolve => { openLate = resolve })
  const { w, clock } = await hungWorld(on, [() => late])
  const view = watchedView(on)
  const held = holdViewRead(on)
  w.weekResets = { 'tok-3': OTHER_WEEK }
  await start($, clock)
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // The press gives up on the hung switch to login 2 and lands on login 3.
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  await clock.advance(30_000)
  await settleReal(clock)
  expect(slots(w)).toEqual([SLOT3])
  // Minutes on, responses still use login 1: the point-back writes login 1's slot, then waits on its next read of the view.
  w.limits = LOGIN_ONE_RESPONSE
  await clock.advance(5 * 60_000)
  await settleReal(clock)
  held.arm(() => w.envSets.length === 2)
  void $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await settleReal(clock)
  expect(held.isHeld()).toBe(true)
  openLate()
  await settleReal(clock)
  held.open()
  await settleReal(clock)
  await settleReal(clock)
  await pane.unmount()
  const id = view()?.activeId ?? ''
  expect([id, slots(w).at(-1)]).toEqual([id, SLOT_OF[id]])
})

test('a point-back that runs while a press sits between its slot write and its view write leaves the slot and the view on the login pressed for', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w, THREE_LOGINS)
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const view = watchedView(on)
  const held = holdViewRead(on)
  await start($, clock)
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await settleReal(clock)
  expect(slots(w)).toEqual([SLOT2])
  // Minutes on, responses still use login 1: the switch to login 2 is due its point-back.
  w.limits = LOGIN_ONE_RESPONSE
  await clock.advance(5 * 60_000)
  await settleReal(clock)
  // The press for login 3 writes its slot and waits on its next read of the view, before it publishes.
  held.arm(() => w.envSets.length === 2)
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  expect(held.isHeld()).toBe(true)
  void $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await settleReal(clock)
  held.open()
  await settleReal(clock)
  await settleReal(clock)
  await pane.unmount()
  expect([view()?.activeId, slots(w).at(-1)]).toEqual(['3', SLOT3])
})

test('a stop\'s rotation that moves the session while a late switch\'s put-back holds the view it read leaves the slot on the login the view names', async ($, on) => {
  let openLate: () => void = () => undefined
  const late = new Promise<void>(resolve => { openLate = resolve })
  const { w, clock } = await hungWorld(on, [() => late])
  const view = watchedView(on)
  const held = holdViewRead(on, true)
  await start($, clock)
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  await clock.advance(30_000)
  await settleReal(clock)
  expect(slots(w)).toEqual([SLOT3])
  // The press's switch has settled by the stop: the stop rotates, it does not ride the settle.
  await clock.advance(40_000)
  await settleReal(clock)
  // The given-up switch lands: its put-back reads the view (login 3) and waits there. Its own write may be followed by
  // the newer ask's, so the hold takes the first read once it has written.
  held.arm(() => w.envSets.length >= 2)
  openLate()
  await settleReal(clock)
  expect(held.isHeld()).toBe(true)
  w.usage['tok-3'] = [100, 41]
  void $.classic.StopFailure({ error: 'rate_limit' })
  await settleReal(clock)
  held.open()
  await settleReal(clock)
  await settleReal(clock)
  await pane.unmount()
  const id = view()?.activeId ?? ''
  expect([id, slots(w).at(-1)]).toEqual([id, SLOT_OF[id]])
})

// Review r1 PB_PRESS_VIEW (Codex, #107): a press that asks during the point-back's own slot write publishes first.
async function pbPressView($: Engine, on: On) {
  const w = fresh()
  const { clock } = await loggedWorld(on, w, THREE_LOGINS)
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const view = watchedView(on)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.advance(5 * 60_000)
  w.limits = LOGIN_ONE_RESPONSE
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => { open = resolve })
  let writes = 0
  w.beforeEnv = () => (writes++ === 0 ? gate : Promise.resolve())
  void $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await settleReal(clock)
  expect(writes).toBe(1)
  await pane.press({ key: 'use-3' })
  open()
  await settleReal(clock)
  await pane.unmount()
  return { w, view }
}

test('Review r1 PB_PRESS_VIEW: a press made while the point-back writes its slot stands, in the slot and the view (puma-9arph.41)', async ($, on) => {
  const { w, view } = await pbPressView($, on)
  expect([view()?.activeId, slots(w).at(-1)]).toEqual(['3', SLOT3])
})

test('Review r1 PB_PRESS_VIEW class: after a press during the point-back, the slot is the login the view names (puma-9arph.41)', async ($, on) => {
  const { w, view } = await pbPressView($, on)
  const id = view()?.activeId ?? ''
  expect([id, slots(w).at(-1)]).toEqual([id, SLOT_OF[id]])
})

// Review r1 REFUSED_INTENT (Codex, #107): a press whose slot write is refused leaves the point-back of the switch before it free.
async function refusedIntent($: Engine, on: On) {
  const w = fresh()
  const { clock } = await loggedWorld(on, w, THREE_LOGINS)
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const view = watchedView(on)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  w.refuseEnv = true
  await pane.press({ key: 'use-3' })
  w.refuseEnv = false
  await clock.advance(5 * 60_000)
  w.limits = LOGIN_ONE_RESPONSE
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await settleReal(clock)
  await pane.unmount()
  return { w, view }
}

test('Review r1 REFUSED_INTENT: a refused press leaves the point-back free to point the session back (puma-9arph.41)', async ($, on) => {
  const { w, view } = await refusedIntent($, on)
  expect([view()?.activeId, slots(w).at(-1)]).toEqual(['1', ''])
})

test('Review r1 REFUSED_INTENT class: a refused ask strands no pending switch (puma-9arph.41)', async ($, on) => {
  const { view } = await refusedIntent($, on)
  expect(view()?.pending).toBeUndefined()
})

// ---------------------------------------------------------------- puma-9arph.41: one switch coordinator
/** The owner record the coordinator keeps in the view while a switch runs; absent once none runs. */
const ownerOf = (v: View | undefined): unknown => (v as { owner?: unknown } | undefined)?.owner

// Race (a) (RACE_A, Codex round of #108): the point-back examined its switch, and a press publishes before the
// point-back claims. The hold sits on the claim's own view read: the 4th after the source login's health is stored
// (saveHealth's write, isStill, `after`, then the claim), so the claim meets the press's switch, not the one examined.
test('RACE_A a press published before the point-back claims stands, in the slot and the view (race a)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w, THREE_LOGINS)
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const view = watchedView(on)
  const held = holdViewRead(on)
  let isArmed = false
  let isSourceStored = false
  let reads = 0
  w.onStoreSet = key => {
    if (isArmed && key === 'health:1') {
      isSourceStored = true
      reads = 0
    }
  }
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.advance(5 * 60_000)
  w.limits = LOGIN_ONE_RESPONSE
  isArmed = true
  held.arm(() => isSourceStored && ++reads === 4)
  void $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await settleReal(clock)
  const isHeld = held.isHeld()
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  const published = [view()?.activeId, slots(w).at(-1)]
  held.open()
  await settleReal(clock)
  await settleReal(clock)
  await pane.unmount()
  expect([isHeld, published, view()?.activeId, view()?.pending?.id, slots(w).at(-1)]).toEqual([true, ['3', SLOT3], '3', '3', SLOT3])
})

// The start's check of its slot (checkSwitching) is held until a press has moved the session to login 3, then lands:
// it writes login 1's slot again. Another session named login 3 signed in, so the press can come before the start's checks.
test('a start\'s check of its slot that lands after a press moved the session leaves the slot on the login pressed for at once (puma-9arph.41, the start)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'health:1': { kind: 'ok' }, 'health:3': { kind: 'ok' } })
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  const view = watchedView(on)
  let open: () => void = () => undefined
  const gate = new Promise<void>(resolve => { open = resolve })
  let isHeld = false
  w.beforeSameEnv = () => {
    if (isHeld) return Promise.resolve()
    isHeld = true
    return gate
  }
  await start($, clock)
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  const pressed = [isHeld, view()?.activeId, slots(w).slice()]
  open()
  await settleReal(clock)
  await settleReal(clock)
  const landed = [view()?.activeId, slots(w).at(-1)]
  await pane.unmount()
  expect([pressed, landed]).toEqual([[true, '3', [SLOT3]], ['3', SLOT3]])
})

// BOOT_REPAIR_RACE (Codex round of #109): reconcile is a slot writer that owns no switch. The start's check lands late,
// boot's repair to login 3 is held, a later press completes, then the repair lands over it. The minute's tick sets the
// slot right: it is the backstop for a repair that lands late.
for (const [name, healths, key, want] of [
  ['a later press to login 2', ['1', '2', '3'], 'use-2', ['2', SLOT2]],
  ['a later press back to login 1', ['1', '3'], 'use-1', ['1', '']],
] as const) {
  test(`BOOT_REPAIR_RACE boot's repair landing after ${name} leaves the slot on the login the view names after the minute's tick (puma-9arph.41, the tick)`, async ($, on) => {
    const w = fresh()
    const extra: Record<string, unknown> = { ...THREE_LOGINS }
    for (const id of healths) extra[`health:${id}`] = { kind: 'ok' }
    const { clock } = await loggedWorld(on, w, extra)
    w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
    w.usage['tok-3'] = [10, 30]
    const view = watchedView(on)
    let openCheck: () => void = () => undefined
    const check = new Promise<void>(resolve => { openCheck = resolve })
    w.beforeSameEnv = () => check
    await start($, clock)
    await settleReal(clock)
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    await pane.press({ key: 'use-3' })
    // Write 1 is the late check, write 2 boot's repair, held until the later press has finished.
    let openRepair: () => void = () => undefined
    const repair = new Promise<void>(resolve => { openRepair = resolve })
    let writes = 0
    w.beforeEnv = () => (++writes === 2 ? repair : Promise.resolve())
    openCheck()
    await settleReal(clock)
    const isRepairHeld = writes === 2
    await pane.press({ key })
    openRepair()
    await settleReal(clock)
    await clock.advance(60_000)
    await settleReal(clock)
    await pane.unmount()
    expect([isRepairHeld, view()?.activeId, slots(w).at(-1)]).toEqual([true, ...want])
  })
}

// Race (b): a switch whose view write read the view before it was given up on, and writes after a newer switch published.
test('a given-up switch whose publication read the view before the give-up writes nothing over the press that gave it up (race b)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'rotate-to': 'order' })
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [10, 30]
  w.usage['tok-1'] = [100, 41]
  const view = watchedView(on)
  // The start's rotation to login 2 writes its slot, then its next view read is taken and held before its write.
  const held = holdViewRead(on, true)
  held.arm(() => w.envSets.length === 1)
  await start($, clock)
  await settleReal(clock)
  expect(held.isHeld()).toBe(true)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  await clock.advance(30_000)
  await settleReal(clock)
  held.open()
  await settleReal(clock)
  await settleReal(clock)
  await pane.unmount()
  expect([view()?.activeId, slots(w).at(-1), ownerOf(view())]).toEqual(['3', SLOT3, undefined])
})

// Race (c): a given-up switch's late slot write lands after a newer switch published, and the write that repairs it fails.
test('a late slot write whose repair fails leaves the view naming the login whose slot is in use (race c)', async ($, on) => {
  let openLate: () => void = () => undefined
  const late = new Promise<void>(resolve => { openLate = resolve })
  const { w, clock } = await hungWorld(on, [() => late])
  const view = watchedView(on)
  await start($, clock)
  await settleReal(clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  void pane.press({ key: 'use-3' })
  await settleReal(clock)
  await clock.advance(30_000)
  await settleReal(clock)
  expect(slots(w)).toEqual([SLOT3])
  // The given-up switch's write to login 2's slot lands; every write after it is refused.
  w.breakEnv = true
  openLate()
  await settleReal(clock)
  await clock.advance(60_000)
  await settleReal(clock)
  const id = view()?.activeId ?? ''
  expect([id, slots(w).at(-1), ownerOf(view())]).toEqual([id, SLOT_OF[id], undefined])
  // Once writes are allowed again, the next tick writes nothing: the view and the slot already agree.
  w.breakEnv = false
  const before = slots(w).length
  await clock.advance(60_000)
  await settleReal(clock)
  await pane.unmount()
  expect(slots(w).length).toBe(before)
})

// A /clear while a switch waits on its slot write: the reset drops the view's owner, and the switch still publishes.
test('a /clear while a switch waits on its slot write ends with the view on the login whose slot is in use and no owner left', async ($, on) => {
  let openLate: () => void = () => undefined
  const late = new Promise<void>(resolve => { openLate = resolve })
  const { w, clock } = await hungWorld(on, [() => late])
  const s = clearable(on)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  await settleReal(clock)
  await clearSession($, clock, s.clear)
  openLate()
  await settleReal(clock)
  await settleReal(clock)
  expect([s.view()?.activeId, slots(w).at(-1), s.view()?.pending?.id, ownerOf(s.view())]).toEqual(['2', SLOT2, '2', undefined])
})

// puma-9arph.42: a rejected sign-in stands until a new sign-in or a usage read that works, so a check that reads nothing
// never gives it back to the launch pick. SOURCE of the expected pick: pickLaunch's doc comment, "the signed-in logins
// with room". Login 1 is the one picked for new sessions ('launch-on': 'account:1'), so only its health keeps it out.

/** Two logins; 1's sign-in is rejected at a stop and the session moves to 2. */
async function rejectedOnOne($: Engine, on: On, isTokenLive: boolean, twoUsed = 30) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', isTokenLive ? NOW + 6 * HOUR : NOW - HOUR)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.failing = { 'tok-1': 401 }
  w.usage['tok-2'] = [null, twoUsed]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'launch-on': 'account:1' }))
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  return { w, store, clock }
}

const healthOfStored = (store: Map<string, unknown>, id: string) => store.get(`health:${id}`) as { kind?: string; why?: string } | undefined

const pickOf = (store: Map<string, unknown>) => (store.get('launch-slot') as { id?: string } | undefined)?.id

/** Another session holds login 1's next usage read, so this session's checks read none of it. */
const readHeldElsewhere = (store: Map<string, unknown>) => store.set('usage-due:1', { next: NOW + 6 * HOUR, fails: 0, at: NOW, v: 1 })

const TEN_MINUTE_CHECK = 10 * 60_000 + 1000

for (const twoUsed of [30, 100]) {
  const expected = twoUsed === 100 ? undefined : '2'
  test(`puma-9arph.42 A: a check of a rejected login whose token has run out keeps it rejected; the pick is ${expected ?? 'none'}`, async ($, on) => {
    const { store, clock } = await rejectedOnOne($, on, false, twoUsed)
    expect(healthOfStored(store, '1')?.why, 'the stop marks login 1').toBe('sign-in rejected')
    await clock.advance(TEN_MINUTE_CHECK)
    expect([healthOfStored(store, '1')?.kind, healthOfStored(store, '1')?.why, pickOf(store)]).toEqual(['login-needed', 'sign-in rejected', expected])
  })

  test(`puma-9arph.42 B: a check that reads no usage of a rejected login, its token live, keeps it rejected; the pick is ${expected ?? 'none'}`, async ($, on) => {
    const { store, clock } = await rejectedOnOne($, on, true, twoUsed)
    expect(healthOfStored(store, '1')?.why, 'the stop marks login 1').toBe('sign-in rejected')
    readHeldElsewhere(store)
    await clock.advance(TEN_MINUTE_CHECK)
    expect([healthOfStored(store, '1')?.kind, healthOfStored(store, '1')?.why, pickOf(store)]).toEqual(['login-needed', 'sign-in rejected', expected])
  })
}

test('puma-9arph.42 C: a new sign-in on a rejected login ends the rejection, and it is the pick again', async ($, on) => {
  const { w, store, clock } = await rejectedOnOne($, on, false)
  w.keychain['Claude Code-credentials'] = blob('tok-1b')
  w.owners['tok-1b'] = 'one@example.com'
  w.usage['tok-1b'] = [null, 10]
  readHeldElsewhere(store)
  await clock.advance(TEN_MINUTE_CHECK)
  expect([healthOfStored(store, '1')?.kind, pickOf(store)]).toEqual(['ok', '1'])
})

// Codex round on 4a97eb1, AUTH-RACE: a rejection another session stores while this check waits on its usage call stands.
for (const status of [429, 500]) {
  test(`puma-9arph.42 AUTH-RACE: a rejection stored during a check whose usage read fails (${status}) stands, and the pick is 2`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [null, 10]
    w.usage['tok-2'] = [null, 30]
    const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'launch-on': 'account:1' }))
    const clock = world(on, w, store)
    await start($, clock)
    w.failing = { 'tok-1': status }
    store.delete('usage-due:1')
    let hasWritten = false
    w.beforeFetch = async () => {
      if (hasWritten) return
      hasWritten = true
      store.set('health:1', { kind: 'login-needed', why: 'sign-in rejected', at: NOW + TEN_MINUTE_CHECK })
    }
    await clock.advance(TEN_MINUTE_CHECK)
    expect([healthOfStored(store, '1')?.why, pickOf(store)]).toEqual(['sign-in rejected', '2'])
  })
}

test('puma-9arph.42 C: a usage read of a rejected login that works ends the rejection, and it is the pick again', async ($, on) => {
  const { w, store, clock } = await rejectedOnOne($, on, true)
  w.failing = {}
  w.usage['tok-1'] = [null, 10]
  store.delete('usage-due:1')
  await clock.advance(TEN_MINUTE_CHECK)
  expect([healthOfStored(store, '1')?.kind, pickOf(store)]).toEqual(['ok', '1'])
})

// puma-9arph.48: a login whose keychain holds a record (its refresh token unexpired, its token run out) that Claude Code
// does not count as logged in needs a sign-in after one check, so a launch never starts on it. SOURCE of the signal:
// https://code.claude.com/docs/en/cli-reference, `claude auth status` "Exits with code 0 if logged in, 1 if not", and its
// authMethod field. Login 1 is the one picked for new sessions ('launch-on': 'account:1'), so only its health keeps it out.

/** Two logins, login 1's stored sign-in as `rejectedOnOne` has it, the session started; `isSignedOut`: Claude Code reads login 1 as not logged in. */
async function storedOnOne($: Engine, on: On, isSignedOut: boolean, twoUsed = 30) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-2'] = [null, twoUsed]
  if (isSignedOut) w.signedOut = ['']
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'launch-on': 'account:1' }))
  const clock = world(on, w, store)
  await start($, clock)
  return { w, store, clock }
}

for (const twoUsed of [30, 100]) {
  const expected = twoUsed === 100 ? undefined : '2'
  test(`puma-9arph.48: a login Claude Code reads as not logged in needs a sign-in after one check, and its row says so; the pick is ${expected ?? 'none'}`, async ($, on) => {
    const { store } = await storedOnOne($, on, true, twoUsed)
    expect([healthOfStored(store, '1')?.kind, healthOfStored(store, '1')?.why, pickOf(store)]).toEqual(['login-needed', 'not signed in', expected])
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    expect(await pane.find({ text: /^⚠ sign in needed$/ })).toBeDefined()
    await pane.unmount()
  })
}

test('puma-9arph.48: a login Claude Code reads as logged in, its token run out, stays ok and the pick', async ($, on) => {
  const { store } = await storedOnOne($, on, false)
  expect([healthOfStored(store, '1')?.kind, pickOf(store)]).toEqual(['ok', '1'])
})

// RULING 6244: a check reads every login in turn, so each sign-in read waits 5 s at most.
test('puma-9arph.48: every sign-in read of a check waits 5 seconds at most', async ($, on) => {
  const { w } = await storedOnOne($, on, false)
  const timeouts = w.statusTimeouts ?? []
  expect(timeouts.length, 'premise: a check read a sign-in').toBeGreaterThan(0)
  expect(timeouts.filter(t => t !== 5_000)).toEqual([])
})

for (const way of ['timeout', 'exit', 'other', 'refused'] as const) {
  test(`puma-9arph.48 UNKNOWN: a status read that ends ${way} leaves the health as it was, and the pick is 1`, async ($, on) => {
    const w = fresh()
    w.statusFails = way
    w.signedOut = ['']
    w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-2'] = [null, 30]
    const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'launch-on': 'account:1' }))
    await start($, world(on, w, store))
    expect([healthOfStored(store, '1')?.kind, pickOf(store)]).toEqual(['ok', '1'])
  })
}

// The RECORD's writer: a session on a mod older than 0.5.36 writes 'ok' over the mark and names login 1 the pick.
test('puma-9arph.48: an ok another session writes over the mark is marked again at the next check, and the pick leaves login 1', async ($, on) => {
  const { store, clock } = await storedOnOne($, on, true)
  expect(healthOfStored(store, '1')?.why, 'premise: the check marks login 1').toBe('not signed in')
  store.set('health:1', { kind: 'ok' })
  store.set('launch-slot', { id: '1', slot: '', why: 'you picked it', at: NOW })
  await clock.advance(TEN_MINUTE_CHECK)
  expect([healthOfStored(store, '1')?.kind, healthOfStored(store, '1')?.why, pickOf(store)]).toEqual(['login-needed', 'not signed in', '2'])
})

// Review r1 (Codex, d5d822e) [MARK-ENDS-WITHOUT-PROOF], UNKNOWN-KEEPS-MARK: a read that says nothing ends no mark.
test('Review r1 UNKNOWN-KEEPS-MARK: a status read that times out after a signed-out one keeps the login out of the pick', async ($, on) => {
  const { w, store, clock } = await storedOnOne($, on, true)
  expect(healthOfStored(store, '1')?.why).toBe('not signed in')
  w.statusFails = 'timeout'
  await clock.advance(TEN_MINUTE_CHECK)
  expect([healthOfStored(store, '1')?.kind, pickOf(store)]).toEqual(['login-needed', '2'])
})

for (const way of ['timeout', 'exit', 'other', 'refused'] as const) {
  test(`Review r1 UNKNOWN-KEEPS-MARK class: a status read that ends ${way} keeps a stored 'not signed in'`, async ($, on) => {
    const { w, store, clock } = await storedOnOne($, on, true)
    expect(healthOfStored(store, '1')?.why).toBe('not signed in')
    w.statusFails = way
    await clock.advance(TEN_MINUTE_CHECK)
    expect([healthOfStored(store, '1')?.kind, pickOf(store)]).toEqual(['login-needed', '2'])
  })
}

// Review r1 [MARK-ENDS-WITHOUT-PROOF], REJECTION-KEEP: a signed-out read keeps a rejection, which only #110's proofs end.
test('Review r1 REJECTION-KEEP: a signed-out status read does not replace a rejected sign-in', async ($, on) => {
  const { w, store, clock } = await rejectedOnOne($, on, false)
  expect(healthOfStored(store, '1')?.why).toBe('sign-in rejected')
  w.signedOut = ['']
  await clock.advance(TEN_MINUTE_CHECK)
  expect(healthOfStored(store, '1')?.why).toBe('sign-in rejected')
})

for (const isTokenLive of [false, true]) {
  test(`Review r1 REJECTION-KEEP class: a rejected sign-in stands through a signed-out read, its token ${isTokenLive ? 'live' : 'run out'}`, async ($, on) => {
    const { w, store, clock } = await rejectedOnOne($, on, isTokenLive)
    expect(healthOfStored(store, '1')?.why).toBe('sign-in rejected')
    w.signedOut = ['']
    await clock.advance(TEN_MINUTE_CHECK)
    expect(healthOfStored(store, '1')?.why).toBe('sign-in rejected')
  })
}

// The rest of the matrix, stored mark x read (in, out, unknown), that no test above pins.
test('puma-9arph.48 matrix: a stored ok stays ok through an unknown read', async ($, on) => {
  const { w, store, clock } = await storedOnOne($, on, false)
  w.statusFails = 'timeout'
  await clock.advance(TEN_MINUTE_CHECK)
  expect([healthOfStored(store, '1')?.kind, pickOf(store)]).toEqual(['ok', '1'])
})

test('puma-9arph.48 matrix: a stored not signed in ends at a read that says logged in, and it is the pick again', async ($, on) => {
  const { w, store, clock } = await storedOnOne($, on, true)
  expect(healthOfStored(store, '1')?.why).toBe('not signed in')
  w.signedOut = []
  await clock.advance(TEN_MINUTE_CHECK)
  expect([healthOfStored(store, '1')?.kind, pickOf(store)]).toEqual(['ok', '1'])
})

test('puma-9arph.48 matrix: a rejected sign-in stands through an unknown read', async ($, on) => {
  const { w, store, clock } = await rejectedOnOne($, on, false)
  w.statusFails = 'timeout'
  await clock.advance(TEN_MINUTE_CHECK)
  expect([healthOfStored(store, '1')?.why, pickOf(store)]).toEqual(['sign-in rejected', '2'])
})
