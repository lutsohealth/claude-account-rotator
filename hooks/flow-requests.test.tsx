import { expect } from 'claude-code/testing'
import { test } from './flow-harness'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ToolCallArgs } from 'claude-code'
import type { StoredRows, View } from '../types'
import { REQUEST_POLL_MS, REQUEST_TTL_MS, USAGE_CLAIM_WAIT_MS, fingerprint, keychainItem, longBar } from './model'
import { BLOCKED_ON_LOGIN, DAY, FABLE_RESET, FABLE_STOP, FILE1, FILE2, FILL_NO_CAUSE, HOME, HOUR, LOGIN, N1, NOW, OTHER_WEEK, PANE_PROPS, PICKED_TWO, PLAIN, REQUESTS, SEEN, SLOT2, SLOT3, STOP_RATE_LIMIT, THREE_LOGINS, TWO_LOGINS, USE_COMMAND, WEEK_RESET, bandText, bashCall, beat, blob, callsWith, carryOnAnswers, countdownWorld, debugLines, endSession, fableRows, fresh, isEnded, isOwedCarryOnLine, kept, limitsOf, lineOne, loggedWorld, markOf, markStands, mountBand, mountPane, owedWorld, ownMark, pastLastRead, pressPane, ran, refresh, reloadThenClear, reloadedWorld, respond, resultOf, resumeAnswers, rmRequest, rowsWorld, selectWorld, sent, settleReal, slots, start, stopHeard, stopLogOf, untilTick, useNow, useRequest, watchedView, whats, world } from './flow-harness'
import type { World } from './flow-harness'

/** A select request for login `id`, read from the store whose id is `storeId`, as bin/account-rotator writes it. */
const selectRequest = (nonce: string, id: string, storeId: unknown, at: number) => JSON.stringify({ kind: 'select', nonce, at, id, store: storeId })

test('a store holds a store-id, which the first session that finds none writes', async ($, on) => {
  const { store } = await selectWorld($, on)
  expect(typeof store.get('store-id')).toBe('string')
})

// puma-9arph.5: `account-rotator continue-text` sets or clears fable-continue-text through a session's request.
/** A continue-text request as bin/account-rotator writes one; `fields` stands in for its text, or what a hand put there. */
const continueRequest = (nonce: string, storeId: unknown, at: number, fields: Record<string, unknown>) => JSON.stringify({ kind: 'continue-text', nonce, at, id: '', store: storeId, ...fields })

/** Login 1 at its Fable limit, login 2 with Fable room, the store as given; a minute's merge done, so it has a store-id. */
async function fableReady($: Engine, on: On, kept: Record<string, unknown>): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, ...kept }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(60_000)
  return { w, store, clock }
}

/** The request applied at the next minute, then a Fable stop and its switch landed: what the carry-on sent. */
async function requestThenFableStop($: Engine, w: World, store: Map<string, unknown>, clock: MockClock, fields: Record<string, unknown>): Promise<void> {
  w.files[`${REQUESTS}/${N1}.json`] = continueRequest(N1, store.get('store-id'), await clock.now(), fields)
  await clock.advance(60_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
}

test('a continue-text request sets the line, trimmed, and the next Fable switch carries on with it as the person\'s words', async ($, on) => {
  const { w, store, clock } = await fableReady($, on, {})
  await requestThenFableStop($, w, store, clock, { text: '  Please resume.  ' })
  expect([store.get('fable-continue-text'), resultOf(w, N1)?.ok, w.submitted, w.asUser]).toEqual(['Please resume.', true, ['Please resume.'], [true]])
})

test('a continue-text request with text null clears the line, and the next Fable switch sends the mod\'s own', async ($, on) => {
  const { w, store, clock } = await fableReady($, on, { 'fable-continue-text': 'Go on on Fable-free ground.' })
  await requestThenFableStop($, w, store, clock, { text: null })
  expect([store.has('fable-continue-text'), resultOf(w, N1)?.ok, w.asUser]).toEqual([false, true, [false]])
})

// RULING 5287: a request a hand wrote, malformed or with a text the CLI refuses, is refused by the session too.
const REFUSED_TEXTS: [string, Record<string, unknown>][] = [
  ['501 characters', { text: 'a'.repeat(501) }],
  ['spaces only', { text: '   ' }],
  ['empty', { text: '' }],
  ['a number', { text: 42 }],
  ['no text field', {}],
]

for (const [name, fields] of REFUSED_TEXTS) {
  test(`a continue-text request with ${name}, which the CLI would refuse or never writes, is refused with an answer and keeps the line`, async ($, on) => {
    const { w, store, clock } = await fableReady($, on, { 'fable-continue-text': 'Go on on Fable-free ground.' })
    w.files[`${REQUESTS}/${N1}.json`] = continueRequest(N1, store.get('store-id'), await clock.now(), fields)
    await clock.advance(60_000)
    const answer = resultOf(w, N1)
    expect([name, answer?.ok, /1 to 500 characters/.test(String(answer?.message)), store.get('fable-continue-text')]).toEqual([name, false, true, 'Go on on Fable-free ground.'])
  })
}

// Review R2 (Codex, #70 round 1) [REQUEST-UNANSWERED]: the CLI writes a request whole, by a rename, so a request
// file that does not parse is a broken request, refused with an answer, and the line stays.
test('Review R2: a continue-text request file that does not parse is refused with an answer and keeps the line', async ($, on) => {
  const { w, store, clock } = await fableReady($, on, { 'fable-continue-text': 'Keep this.' })
  w.files[`${REQUESTS}/${N1}.json`] = '{"kind":"continue-text","text":"bad",'
  await clock.advance(60_000)
  expect([resultOf(w, N1)?.ok, store.get('fable-continue-text')]).toEqual([false, 'Keep this.'])
})

test('Review R2 class: every request file that is not a JSON object gets a refusal, and the line stays', async ($, on) => {
  const { w, store, clock } = await fableReady($, on, { 'fable-continue-text': 'Keep this.' })
  const corpus = ['{"kind":"continue-text","text":"bad",', '{"kind":"continue-text","text":', '{"kind":"continue-text","text":"bad"} trailing', '', 'null', '42', '"continue-text"', '[{"kind":"continue-text"}]']
  corpus.forEach((text, i) => { w.files[`${REQUESTS}/review-r2-${i + 1}.json`] = text })
  await clock.advance(60_000)
  const offenders = corpus.flatMap((_, i) => resultOf(w, `review-r2-${i + 1}`)?.ok === false ? [] : [`review-r2-${i + 1}`])
  expect(corpus.length).toBeGreaterThan(0)
  expect([offenders, store.get('fable-continue-text')]).toEqual([[], 'Keep this.'])
})

test('Review R2, the other side: a file that does not parse and whose name is no nonce the CLI writes gets no result', async ($, on) => {
  const { w, clock } = await fableReady($, on, {})
  w.files[`${REQUESTS}/short.json`] = '{"kind":'
  w.files[`${REQUESTS}/${N1}.json`] = '{"kind":'
  await clock.advance(60_000)
  expect([w.files[`${REQUESTS}/short.result.json`], resultOf(w, N1)?.ok]).toEqual([undefined, false])
})

// Review R3 (Codex, #70 round 1) [CHARACTER-COUNT-MISMATCH]: the CLI counts code points (Python len), so the session
// counts the same, never UTF-16 units: a line of 251 to 500 astral characters is taken on both sides.
test('Review R3: a line of 251 emoji, which the CLI takes, is taken by the session', async ($, on) => {
  const { w, store, clock } = await fableReady($, on, {})
  const line = '😀'.repeat(251)
  w.files[`${REQUESTS}/${N1}.json`] = continueRequest(N1, store.get('store-id'), await clock.now(), { text: line })
  await clock.advance(60_000)
  expect([resultOf(w, N1)?.ok, store.get('fable-continue-text')]).toEqual([true, line])
})

test('Review R3 class: the session takes every line of 500 code points and refuses a line of 501, or one that is not UTF-8', async ($, on) => {
  const { w, store, clock } = await fableReady($, on, {})
  const cases: [string, string, boolean][] = [
    ['emoji-500', '😀'.repeat(500), true], ['cjk-emoji-500', '中😀'.repeat(250), true], ['music-500', '𝄞'.repeat(500), true],
    ['emoji-501', '😀'.repeat(501), false], ['ascii-501', 'a'.repeat(501), false],
    // A lone surrogate, which the CLI refuses as text that is not UTF-8.
    ['lone-surrogate', 'ok \udcff', false], ['lone-high-surrogate', '\ud83d ok', false],
  ]
  for (const [label, line] of cases) w.files[`${REQUESTS}/review-r3-${label}.json`] = continueRequest(`review-r3-${label}`, store.get('store-id'), await clock.now(), { text: line })
  await clock.advance(60_000)
  const offenders = cases.flatMap(([label, , taken]) => resultOf(w, `review-r3-${label}`)?.ok === taken ? [] : [label])
  expect(cases.length).toBeGreaterThan(0)
  expect(offenders).toEqual([])
})

test('two sessions booting at once end with one store-id: this session keeps the one the store holds', async ($, on) => {
  const { store, clock } = await selectWorld($, on)
  // The other session's write of its own id lands after this session's.
  store.set('store-id', 'theirs')
  await clock.advance(60_000)
  expect(store.get('store-id')).toBe('theirs')
})

test('a select request for this store is applied at the minute: launch-on, launch-slot and a result that says so', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await clock.advance(60_000)
  expect([store.get('launch-on'), (store.get('launch-slot') as { id?: string } | undefined)?.id]).toEqual(['account:2', '2'])
  expect(resultOf(w, N1)).toMatchObject({ nonce: N1, ok: true })
})

// Found live on vox login 2 at 52f30f5: account 1 had no room, the pick went to account 3, and the result said account 1.
test('a select of a login with no room is applied, and its result names the login new sessions really start on', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on, [50, 100])
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await clock.advance(60_000)
  expect([store.get('launch-on'), (store.get('launch-slot') as { id?: string } | undefined)?.id]).toEqual(['account:2', '1'])
  expect(resultOf(w, N1)).toMatchObject({ ok: true, pickId: '1' })
  expect(resultOf(w, N1)?.message).toMatch(/new sessions start on one@example.com \(two@example.com has no room/)
})

test('a request read from another store, a stale one, one whose nonce is not its file\'s and one for a login not listed change nothing', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const [id, now, before] = [store.get('store-id'), clock.now(), store.get('launch-on')]
  w.files[`${REQUESTS}/named-0001.json`] = selectRequest('other-name', '2', id, now)
  w.files[`${REQUESTS}/other-0001.json`] = selectRequest('other-0001', '2', 'another-store', now)
  w.files[`${REQUESTS}/stale-0001.json`] = selectRequest('stale-0001', '2', id, now - REQUEST_TTL_MS - 1)
  w.files[`${REQUESTS}/gone-00001.json`] = selectRequest('gone-00001', '9', id, now)
  await clock.advance(60_000)
  expect(store.get('launch-on')).toBe(before)
  expect([resultOf(w, 'other-0001'), resultOf(w, 'stale-0001'), resultOf(w, 'gone-00001')?.ok]).toEqual([undefined, undefined, false])
})

// Review C11-R1 F8 (Opus) [UNPINNED-GUARD] (RULING 4607): the survivors in the session's half.
// Review R2 (Codex, #70 round 1): a file that does not parse is answered with a refusal, no longer passed over unanswered.
test('a request file that does not parse is refused, one no read can reach is passed over, and the next is applied', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/torn-00001.json`] = '{"kind": "sel'
  w.files[`${REQUESTS}/noread-001.json`] = null
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await clock.advance(60_000)
  expect([store.get('launch-on'), resultOf(w, 'torn-00001')?.ok, resultOf(w, 'noread-001'), resultOf(w, N1)?.ok]).toEqual(['account:2', false, undefined, true])
})

test('a select while no login has room says new sessions start on Claude Code\'s login, and names no pick', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on, [50, 100], [50, 100])
  // The seed: no login has room, so no pick stands.
  expect(store.get('launch-slot')).toBeUndefined()
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await clock.advance(60_000)
  expect(resultOf(w, N1)).toMatchObject({ ok: true, message: "no account has room, so new sessions start on Claude Code's login" })
  expect(resultOf(w, N1)?.pickId).toBeUndefined()
})

test('a request another session already answered is not applied by this one', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  w.files[`${REQUESTS}/${N1}.result.json`] = JSON.stringify({ nonce: N1, ok: true, message: 'theirs', at: clock.now() })
  await clock.advance(60_000)
  expect(store.get('launch-on')).toBeUndefined()
  expect(JSON.parse(w.files[`${REQUESTS}/${N1}.result.json`] ?? '{}').message).toBe('theirs')
})

// Review C11-R1 [TEST-NAME-OVERCLAIM] (Opus): one session here, twice; two holding one listing apply it twice, the same launch-on.
test('a request with a result already is not applied again at this session\'s next minute', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await clock.advance(60_000)
  // Another session's press sets launch-on since; the next minute must not put the request back.
  store.set('launch-on', 'room')
  await clock.advance(60_000)
  expect(store.get('launch-on')).toBe('room')
  expect((w.writes ?? []).filter(p => p === `${REQUESTS}/${N1}.result.json`)).toHaveLength(1)
})

// Review C11-R1 F1 (Opus) [TICK-HELD-BY-REQUEST] -> [REQUEST-LIFE] (RULING 4607).

// REDTEST F1 [TICK-HELD-BY-REQUEST], head fac35db. Appended to a copy of hooks/flow.test.tsx (it uses that file's world).
// Proven by: sh redtest/run_ts.sh redtest/F1_tick.tsx

/**
 * selectWorld, with one step that fails while `gate.failing` names it. The kit takes one hook per event and none after
 * the first `$`, so the world's own hooks fail by what they touch: its files object and its store Map.
 */
async function gatedWorld($: Engine, on: On): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock; gate: { failing: string } }> {
  const gate = { failing: '' }
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 20]
  w.files = new Proxy<World['files']>({}, {
    set(target, key, value) {
      if (gate.failing === 'the result write' && String(key).endsWith('.result.json')) throw new Error(`EACCES: permission denied, open '${String(key)}'`)
      return Reflect.set(target, key, value)
    },
  })
  class GatedStore extends Map<string, unknown> {
    get(key: string): unknown {
      if (gate.failing === 'the launch-slot read' && key === 'launch-slot') throw new Error('store refused')
      if (gate.failing === 'the store-id read' && key === 'store-id') throw new Error('store refused')
      return super.get(key)
    }
    set(key: string, value: unknown): this {
      if (gate.failing === 'the launch-on write' && key === 'launch-on') throw new Error('store refused')
      return super.set(key, value)
    }
  }
  const store = new GatedStore(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(60_000)
  return { w, store, clock, gate }
}

/** A login whose usage read falls due before the next minute's tick, so that tick's checkAll(false) reads it. */
const dueSoon = (store: Map<string, unknown>, clock: MockClock) => store.set('usage-due:1', { next: clock.now() + 30_000, fails: 0, at: clock.now() - 600_000 })

/** The minute's tick, and the wait its usage claim sleeps. */
const tickAndClaim = async (clock: MockClock) => {
  await clock.advance(60_000)
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
  await clock.settle()
}

test('with no request, the minute reads a usage that fell due', async ($, on) => {
  const { w, store, clock } = await gatedWorld($, on)
  dueSoon(store, clock)
  const before = w.usageCalls.length
  await tickAndClaim(clock)
  expect(w.usageCalls.length, 'the control read no usage: the fixture no longer reaches checkAll').toBeGreaterThan(before)
})

test('a request the session fails to apply is answered with its failure', async ($, on) => {
  const { w, store, clock, gate } = await gatedWorld($, on)
  gate.failing = 'the launch-on write'
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await clock.advance(60_000)
  await clock.settle()
  expect(resultOf(w, N1)?.ok).toBe(false)
})

test('a request whose result cannot be written is not applied again over a later press', async ($, on) => {
  const { w, store, clock, gate } = await gatedWorld($, on)
  gate.failing = 'the result write'
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await clock.advance(60_000)
  await clock.settle()
  expect(store.get('launch-on')).toBe('account:2')
  store.set('launch-on', 'room')
  await clock.advance(60_000)
  await clock.settle()
  expect(store.get('launch-on'), 'the same request set launch-on again, over the press, once a minute until its TTL').toBe('room')
})

test('no failing step of applyRequests stops the minute', async ($, on) => {
  const { w, store, clock, gate } = await gatedWorld($, on)
  const steps = ['the result write', 'the launch-on write', 'the launch-slot read']
  expect(steps.length, 'the sweep lists no step').toBeGreaterThan(0)
  const offenders: string[] = []
  let serial = 0
  for (const step of steps) {
    const nonce = `sweep-${String(++serial).padStart(4, '0')}`
    w.files[`${REQUESTS}/${nonce}.json`] = selectRequest(nonce, '2', store.get('store-id'), clock.now())
    dueSoon(store, clock)
    const before = w.usageCalls.length
    gate.failing = step
    await tickAndClaim(clock)
    gate.failing = ''
    if (w.usageCalls.length === before) offenders.push(`${step}: the minute's checkAll did not run`)
    delete w.files[`${REQUESTS}/${nonce}.json`]
    await clock.advance(60_000)
    await clock.settle()
    await clock.advance(USAGE_CLAIM_WAIT_MS)
    await clock.settle()
  }
  expect(offenders, `steps of applyRequests that stop settlePending and checkAll; catch each request's failure inside the loop: ${offenders.join('; ')}`).toEqual([])
})

// Review C11-R1 F2 (Opus) [OLDER-REQUEST-WINS] -> [REQUEST-LIFE] (RULING 4607).

// REDTEST F2 [OLDER-REQUEST-WINS], head fac35db. Appended to a copy of hooks/flow.test.tsx.
// Proven by: sh redtest/run_ts.sh redtest/F2_order.tsx

test('every listing order of three requests ends on the newest', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const ids = ['1', '2']
  const requests = [
    { nonce: 'first-0001', id: ids[1] ?? '', age: 40_000 },
    { nonce: 'secnd-0001', id: ids[1] ?? '', age: 20_000 },
    { nonce: 'third-0001', id: ids[0] ?? '', age: 0 },
  ]
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  expect(orders.length, 'the sweep lists no order').toBeGreaterThan(0)
  const offenders: string[] = []
  for (const order of orders) {
    const tag = order.join('')
    store.set('launch-on', 'room')
    for (const at of order) {
      const r = requests[at]
      if (r === undefined) continue
      const nonce = `${r.nonce}${tag}`
      w.files[`${REQUESTS}/${nonce}.json`] = selectRequest(nonce, r.id, store.get('store-id'), clock.now() - r.age)
    }
    await clock.advance(60_000)
    await clock.settle()
    if (store.get('launch-on') !== 'account:1') offenders.push(`listed ${tag}: launch-on ${String(store.get('launch-on'))}, newest asked account:1`)
    for (const path of Object.keys(w.files)) if (path.startsWith(`${REQUESTS}/`)) delete w.files[path]
  }
  expect(offenders, `orders in which an older request overwrites a newer one; apply by ascending \`at\`, or only the newest: ${offenders.join('; ')}`).toEqual([])
})

// C12 (puma-eslxj.13, RULING 4624): `account use` moves the one session that ran it, by the mark it set at boot.

test('boot sets a mark in the environment of every later Bash child, before the engine starts, and it is no session id', async ($, on) => {
  const { w } = await selectWorld($, on)
  expect(typeof w.markAtStart).toBe('string')
  expect(w.markAtStart).toBe(ownMark(w))
  expect(ownMark(w)).not.toBe('session-1')
})

test('a policy that refuses the mark leaves the session running, and no use request is applied', async ($, on) => {
  const w = fresh()
  w.refuseMark = true
  const { store, clock } = await selectWorld($, on, undefined, undefined, w)
  expect(typeof store.get('store-id'), 'the session stopped at the refusal').toBe('string')
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), 'undefined')
  await untilTick(clock)
  expect([resultOf(w, N1), w.envSets]).toEqual([undefined, []])
})

test('during a Bash call that names account-rotator, a use for this session is applied within a beat, and its result names the account', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const call = bashCall($, w, USE_COMMAND)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await beat(clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(resultOf(w, N1)).toMatchObject({ nonce: N1, ok: true, activeId: '2' })
  expect(resultOf(w, N1)?.message).toMatch(/this session now uses two@example.com/)
  await call.finish()
})

test('a Bash call that does not name account-rotator watches nothing: the request waits for the minute, which applies it', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const call = bashCall($, w, 'git status')
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await beat(clock)
  await beat(clock)
  expect(resultOf(w, N1)).toBeUndefined()
  await call.finish()
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(true)
})

test('the watch ends with its call: a later request waits for the minute', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const call = bashCall($, w, USE_COMMAND)
  await beat(clock)
  await call.finish()
  await beat(clock)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await beat(clock)
  await beat(clock)
  expect(resultOf(w, N1)).toBeUndefined()
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(true)
})

test('a Bash call that throws ends its watch too', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.bashRuns = Promise.reject(new Error('the tool failed'))
  await $.tool.call({ tool: 'Bash', command: USE_COMMAND } as unknown as ToolCallArgs).catch(() => undefined)
  await beat(clock)
  await beat(clock)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await beat(clock)
  await beat(clock)
  expect(resultOf(w, N1)).toBeUndefined()
})

test('with no Bash call at all (a `!` command, a wrapper), the minute applies this session\'s use', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(resultOf(w, N1)?.ok).toBe(true)
})

// Two sessions on one store: the store-id is shared, so the mark alone tells them apart.
test('two sessions on one store: another session\'s use is not applied here, by the watch or the minute, and its answer stays its own', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const before = store.get('launch-on')
  const [theirs, answered] = ['their-0001', 'their-0002']
  w.files[`${REQUESTS}/${theirs}.json`] = useRequest(theirs, '2', store.get('store-id'), clock.now(), 'session-theirs')
  w.files[`${REQUESTS}/${answered}.json`] = useRequest(answered, '2', store.get('store-id'), clock.now(), 'session-theirs')
  const answer = JSON.stringify({ nonce: answered, ok: true, message: 'theirs', at: clock.now() })
  w.files[`${REQUESTS}/${answered}.result.json`] = answer
  const call = bashCall($, w, USE_COMMAND)
  await beat(clock)
  await call.finish()
  await untilTick(clock)
  expect(w.envSets, 'this session moved on another session\'s request').toEqual([])
  expect(resultOf(w, theirs), 'this session answered another session\'s request').toBeUndefined()
  expect(w.files[`${REQUESTS}/${answered}.result.json`]).toBe(answer)
  expect(store.get('launch-on')).toBe(before)
  // The control: the other session's select is every session's to take, so the same minute reached the folder.
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok, 'the control took no request: the fixture no longer reaches applyRequests').toBe(true)
})

test('a use with this session\'s mark and another store\'s id is not applied', async ($, on) => {
  const { w, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', 'another-store', clock.now(), ownMark(w))
  await untilTick(clock)
  expect([resultOf(w, N1), w.envSets]).toEqual([undefined, []])
})

test('a policy refusal answers not ok with the blocked text', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.refuseEnv = true
  const call = bashCall($, w, USE_COMMAND)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await beat(clock)
  await call.finish()
  expect(resultOf(w, N1)).toMatchObject({ ok: false, message: BLOCKED_ON_LOGIN, activeId: '1' })
})

test('a switch held for a token refresh answers ok, names the wait, and moves once the token has refreshed', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 60_000)
  const call = bashCall($, w, USE_COMMAND)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await beat(clock)
  await call.finish()
  expect(w.envSets).toEqual([])
  expect(resultOf(w, N1)).toMatchObject({ ok: true, activeId: '1' })
  expect(resultOf(w, N1)?.message).toMatch(/this session moves to two@example.com .*in a few minutes, once one@example.com's token has refreshed/)
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 6 * HOUR)
  await untilTick(clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

test('a use of the account in use, while a switch is held, drops the held switch: the latest ask stands', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 60_000)
  w.files[`${REQUESTS}/held-00001.json`] = useRequest('held-00001', '2', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  expect(resultOf(w, 'held-00001')?.message).toMatch(/in a few minutes/)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '1', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  expect(resultOf(w, N1)).toMatchObject({ ok: true, activeId: '1' })
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 6 * HOUR)
  await untilTick(clock)
  expect(w.envSets.filter(e => e.value === SLOT2), 'the held switch ran after a later use asked to stay').toEqual([])
})

test('a use of the account in use answers ok and moves nothing', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '1', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  expect(w.envSets).toEqual([])
  expect(resultOf(w, N1)).toMatchObject({ ok: true, activeId: '1' })
  expect(resultOf(w, N1)?.message).toMatch(/this session already uses one@example.com/)
})

test('a use of an account not listed, or one the panel offers no Use now for, answers not ok and moves nothing', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  store.set('health:2', { kind: 'login-needed', why: 'its sign-in has run out' })
  await untilTick(clock)
  w.files[`${REQUESTS}/gone-00001.json`] = useRequest('gone-00001', '9', store.get('store-id'), clock.now(), ownMark(w))
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  expect(w.envSets).toEqual([])
  expect(resultOf(w, 'gone-00001')).toMatchObject({ ok: false, message: 'account 9 is not listed in this store' })
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(resultOf(w, N1)?.message).toMatch(/two@example.com .*cannot take over: its sign-in has run out/)
})

test('a select during a Bash call that names account-rotator is applied within a beat too', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const call = bashCall($, w, 'account-rotator account select --account 2')
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await beat(clock)
  expect(store.get('launch-on')).toBe('account:2')
  await call.finish()
})

test('two Bash calls watching at once read one listing and apply its request once', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const first = bashCall($, w, USE_COMMAND)
  const second = bashCall($, w, USE_COMMAND)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  let open = () => {}
  w.readGate = new Promise<void>(resolve => {
    open = resolve
  })
  await clock.advance(REQUEST_POLL_MS)
  await clock.settle()
  open()
  w.readGate = undefined
  await clock.settle()
  expect((w.writes ?? []).filter(p => p === `${REQUESTS}/${N1}.result.json`)).toHaveLength(1)
  expect(w.envSets).toHaveLength(1)
  // The two calls may share one running command in the world: end both before waiting on either.
  await Promise.all([first.finish(), second.finish()])
})

test('a failing look at the folder does not end the watch: the next beat applies the request', async ($, on) => {
  const { w, store, clock, gate } = await gatedWorld($, on)
  const call = bashCall($, w, USE_COMMAND)
  gate.failing = 'the store-id read'
  await beat(clock)
  gate.failing = ''
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await beat(clock)
  expect(resultOf(w, N1)?.ok, 'the watch stopped at its first failure').toBe(true)
  await call.finish()
})

test('before boot has read the accounts, the watch takes no request: it would answer that no account is listed', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 20]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'store-id': 'store-abc' }))
  const clock = world(on, w, store)
  const call = bashCall($, w, 'account-rotator account select --account 2')
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', 'store-abc', clock.now())
  await beat(clock)
  expect(resultOf(w, N1)).toBeUndefined()
  await start($, clock)
  await beat(clock)
  expect(resultOf(w, N1)?.ok).toBe(true)
  await call.finish()
})

// Review C12-R1 F1 (Opus) [POLICY-HOLD-READ-AS-MOVED] -> [ANSWER-NOT-TRUE].

/**
 * `on` with the world's env.set hook answered as the engine's own hold answers, `{ value: { deny } }`, for the names
 * `holds` picks. The engine's type: "The engine's hold resolves; a hook's own { deny } rejects the caller".
 */
const onUnderHold = (on: On, holds: (name: string) => boolean, why = 'is not for plugins outside policy to change'): On =>
  ((event: string, ...rest: unknown[]) => {
    if (event !== 'env.set') return (on as (...a: unknown[]) => unknown)(event, ...rest)
    const below = rest.at(-1) as (...a: unknown[]) => unknown
    return (on as (...a: unknown[]) => unknown)('env.set', ($: unknown, e: { name: string }, next: unknown) =>
      holds(e.name) ? { value: { deny: `env (managed): ${e.name} ${why}` } } : below($, e, next),
    )
  }) as unknown as On

test('a hold in words of the engine\'s own is a refusal too: the reason is not the sign of one', async ($, on) => {
  let isHolding = false
  const { w, store, clock } = await selectWorld($, onUnderHold(on, name => isHolding && name === 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'your organization holds this'))
  isHolding = true
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  expect(w.envSets, 'the fixture wrote the slot under a hold').toEqual([])
  expect(resultOf(w, N1)).toMatchObject({ ok: false, message: BLOCKED_ON_LOGIN, activeId: '1' })
})

test('every $.env.set site reads a hold the engine resolves: the boot check, the panel press', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 20]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'store-id': 'store-abc' }))
  const clock = world(onUnderHold(on, name => name === 'CLAUDE_SECURESTORAGE_CONFIG_DIR'), w, store)
  await start($, clock)
  await clock.advance(60_000)
  const offenders: string[] = []
  const text = BLOCKED_ON_LOGIN
  const said = [...w.notices, ...w.toasts].map(String)
  if (!said.some(t => t.includes(text))) offenders.push('checkSwitching (useSlot): the boot check says nothing of the hold')
  const pane = await mountPane($)
  const useButton = await pane.find({ key: 'use-2' })
  expect(useButton, 'the sweep found no Use now to press').toBeDefined()
  await pane.press({ key: 'use-2' })
  await clock.settle()
  const claimed = w.toasts.filter(t => t.startsWith('Switched to Claude account two@example.com'))
  if (claimed.length > 0) offenders.push(`switchTo by press (useSlot): "${claimed[0]}" with the slot unmoved`)
  await pane.unmount()
  expect(offenders, `sites that read a resolved { deny } as done; check the result of $.env.set in useSlot: ${offenders.join('; ')}`).toEqual([])
})

// Review C12-R1 F2 (Opus) [CONNECT-UNDOES-USE] -> [ANSWER-NOT-TRUE].

/** Three logins signed in, and a session on login 1 whose Connect visits login 2 as it opens, still under way. */
async function visitWorld($: Engine, on: On): Promise<{ w: World; clock: MockClock; slot3: string }> {
  const slot3 = `${HOME}/.claude/accounts/3`
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(slot3)] = blob('tok-3')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 20]
  w.usage['tok-3'] = [10, 20]
  const accounts = [...TWO_LOGINS.accounts, { id: '3', slot: slot3, email: 'three@example.com' }]
  const store = new Map<string, unknown>(Object.entries({ accounts, 'rotate-to': 'off', 'chrome-account': '2', 'store-id': 'store-abc', 'health:1': { kind: 'ok' }, 'health:2': { kind: 'ok' }, 'health:3': { kind: 'ok' } }))
  const clock = world(on, w, store)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(w.envSets.at(-1)?.value, 'the fixture is not visiting login 2').toBe(SLOT2)
  return { w, clock, slot3 }
}

test('a use answered ok during Connect is followed by no move its answer did not name', async ($, on) => {
  const { w, clock, slot3 } = await visitWorld($, on)
  const call = bashCall($, w, 'account-rotator account use --account 3')
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '3', 'store-abc', clock.now(), ownMark(w))
  await beat(clock)
  await call.finish()
  const answeredAt = w.envSets.length
  const isOk = resultOf(w, N1)?.ok === true
  await clock.advance(5 * 60_000)
  await clock.settle()
  const later = w.envSets.slice(answeredAt).map(e => e.value ?? "Claude Code's login")
  const offenders = isOk ? later.filter(v => v !== slot3) : []
  expect(offenders, `moves after an ok answer that the answer did not name; refuse or hold a use while isConnectingChrome: ${offenders.join(', ')}`).toEqual([])
})

// Review C12-R1 F3 (Opus) [STALE-VIEW-WATCH] -> [WATCH-IS-NOT-THE-MINUTE].

test('every answer the watch gives within a beat agrees with the store as it stands', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const SLOT3 = `${HOME}/.claude/accounts/3`
  const id = store.get('store-id')
  const offenders: string[] = []
  const call = bashCall($, w, USE_COMMAND)
  await beat(clock)
  // Another session marks login 2's sign-in dead; this session's view still says ok.
  store.set('health:2', { kind: 'login-needed', why: 'sign-in rejected' })
  w.files[`${REQUESTS}/dead-00001.json`] = useRequest('dead-00001', '2', id, clock.now(), ownMark(w))
  await beat(clock)
  if (resultOf(w, 'dead-00001')?.ok === true) offenders.push(`use of a login the store marks login-needed: ok, "${resultOf(w, 'dead-00001')?.message}", slot moved to a dead sign-in`)
  // Another session adds login 3.
  store.set('accounts', [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }])
  store.set('health:3', { kind: 'ok' })
  w.files[`${REQUESTS}/seln-00001.json`] = selectRequest('seln-00001', '3', id, clock.now())
  await beat(clock)
  if (resultOf(w, 'seln-00001')?.ok !== true) offenders.push(`select of a login just added: "${resultOf(w, 'seln-00001')?.message}" (C11's minute merged first, so this is new with the watch)`)
  w.files[`${REQUESTS}/used-00001.json`] = useRequest('used-00001', '3', id, clock.now(), ownMark(w))
  await beat(clock)
  if (resultOf(w, 'used-00001')?.ok !== true) offenders.push(`use of a login just added: "${resultOf(w, 'used-00001')?.message}"`)
  await call.finish()
  expect(offenders, `answers from a stale view; run mergeStore in the watch before applyRequests when a request is there: ${offenders.join('; ')}`).toEqual([])
})

test('a beat with no request to take merges nothing: a command can run for minutes', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const call = bashCall($, w, USE_COMMAND)
  store.set('rows', 'another session wrote this')
  await beat(clock)
  expect(store.get('rows'), 'the watch merged the store with nothing to take').toBe('another session wrote this')
  await call.finish()
})

// Review C12-R1 F4 (Opus) [SELF-SWITCH] -> [ANSWER-NOT-TRUE].

test('a use of the account in use with a switch held says it already uses it, and does not call that a switch', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 60_000)
  w.files[`${REQUESTS}/held-00001.json`] = useRequest('held-00001', '2', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '1', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  const offenders = [
    ...(/already uses/.test(String(resultOf(w, N1)?.message)) ? [] : [`the answer: "${resultOf(w, N1)?.message}"`]),
    ...w.toasts.filter(t => t.startsWith('Switched to Claude account one@example.com')).map(t => `the toast: "${t}"`),
  ]
  expect(offenders, `the PR says this "moves nothing", yet switchTo ran on the login in use; cancel the held switch and answer "already uses": ${offenders.join('; ')}`).toEqual([])
})

test('a use that moves nothing leaves no unproven switch behind it: minutes on, no response is judged against one', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 60_000)
  w.files[`${REQUESTS}/held-00001.json`] = useRequest('held-00001', '2', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '1', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(true)
  w.keychain['Claude Code-credentials'] = blob('tok-1', clock.now() + 6 * HOUR)
  // A week no login's reading names yet: with no switch unproven this is a debug line, never a word to the person.
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-11-02T03:00:00Z' }]
  await clock.advance(5 * 60_000)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  const offenders = w.toasts.filter(t => /has not shown in responses|did not take/.test(t))
  expect(offenders, `useAccount reached switchTo with the login in use, leaving pending { from: 1, id: 1 }, which holds responses and the rotation until the give-up and then reports a switch nobody made: ${offenders.join('; ')}`).toEqual([])
})

// puma-9arph.16: a give-up that read its pending switch before a network read undid a newer switch made meanwhile.
const SLOT3_OF_3 = `${HOME}/.claude/accounts/3`

/**
 * Three logins, each its own week; the session moved to login 2 (proven), then by `use 1` to login 1, whose
 * responses still carry login 2's week 4 minutes on. The next response's give-up holds its read of login 2's
 * sign-in open while `during` runs. Answers the slots set, in order.
 */
async function staleGiveUp($: Engine, on: On, during: (w: World, clock: MockClock, store: Map<string, unknown>) => Promise<void>, rotateTo = 'reset', heldRead = 1): Promise<{ w: World; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3_OF_3)] = blob('tok-3')
  w.usage = { 'tok-1': [5, 30], 'tok-2': [5, 30], 'tok-3': [1, 10] }
  w.weekResets = { 'tok-1': WEEK_RESET, 'tok-2': OTHER_WEEK, 'tok-3': '2026-10-19T06:00:00Z' }
  const store = new Map<string, unknown>(Object.entries({ accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3_OF_3, email: 'three@example.com' }], 'rotate-to': rotateTo }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(60_000)
  const use = async (nonce: string, id: string) => {
    const call = bashCall($, w, `account-rotator account use --account ${id}`)
    w.files[`${REQUESTS}/${nonce}.json`] = useRequest(nonce, id, store.get('store-id'), clock.now(), ownMark(w))
    await beat(clock)
    await call.finish()
  }
  w.limits = limitsOf(5, 30, OTHER_WEEK)
  await use('b0000000000000000000000000000002', '2')
  await clock.advance(60_000)
  await respond($, clock, w)
  await use('b0000000000000000000000000000001', '1')
  await clock.advance(4 * 60_000 + 30_000)
  let open = () => {}
  let reads = 0
  w.beforeFetch = () => ((reads += 1) === heldRead ? new Promise<void>(resolve => (open = resolve)) : Promise.resolve())
  const measuring = $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.advance(500)
  expect(reads, `the settle reached read ${heldRead}`).toBe(heldRead)
  w.beforeFetch = undefined
  await during(w, clock, store)
  open()
  await measuring
  await clock.settle()
  return { w, clock }
}

for (const heldRead of [1, 2]) {
  test(`a use that lands while an older switch's give-up waits on its read ${heldRead} stays: the give-up no longer points the session back over it`, async ($, on) => {
    const { w } = await staleGiveUp($, on, async (w, clock, store) => {
      const call = bashCall($, w, 'account-rotator account use --account 3')
      w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '3', store.get('store-id'), clock.now(), ownMark(w))
      await beat(clock)
      await call.finish()
      expect(resultOf(w, N1)?.message).toMatch(/now uses three@example.com/)
    }, 'reset', heldRead)
    expect(slots(w).at(-1), `the give-up of the switch to login 1 put back login 2 after "now uses three@example.com": ${slots(w).join(' -> ')}`).toBe(SLOT3_OF_3)
    expect(w.toasts.filter(t => /did not take/.test(t))).toEqual([])
  })
}

test('a stop that moves the session while an older switch\'s give-up waits on a read stays where the stop moved it', async ($, on) => {
  let moved: string | undefined
  const { w } = await staleGiveUp($, on, async (w, clock) => {
    await $.classic.StopFailure({ error: 'authentication_failed' })
    await clock.settle()
    moved = slots(w).at(-1)
  }, 'room')
  expect(moved, 'the stop moved the session to login 3, the most room, not to login 2 the give-up points at').toBe(SLOT3_OF_3)
  expect(slots(w).at(-1), `the give-up undid the stop's move: ${slots(w).join(' -> ')}`).toBe(moved)
})

test('with no newer switch, a give-up whose read waited still points the session back to the login it left', async ($, on) => {
  const { w } = await staleGiveUp($, on, async () => {})
  expect(slots(w).at(-1)).toBe(SLOT2)
  expect(w.toasts.filter(t => /The switch to Claude account one@example.com did not take/.test(t))).toHaveLength(1)
})

// Review C12-R1 F5 (Opus) [MARK-NOT-LOAD-STABLE] -> [MARK-LIFE].

test('no fresh load strands a child started before it, however many come', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const first = ownMark(w)
  const seen: (string | undefined)[] = [first]
  // An enable, a worker respawn, a reload: each a later session.start.
  for (let i = 0; i < 3; i += 1) {
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
    await clock.settle()
    seen.push(ownMark(w))
  }
  expect(new Set(seen).size, `each session.start made a new mark, so a background Bash or tmux pane started earlier holds a dead one and every use from it exits 3: ${seen.join(', ')}`).toBe(1)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), first)
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(true)
})

// Review C12-R1 F6 (Opus) [UNBOUNDED-WATCH] and WATCH_END (Codex) [WATCH-LIFETIME] -> [WATCH-IS-NOT-THE-MINUTE].

/** `on`, counting each look at the requests folder as the world's fs.list hook answers it. */
const onCountingLooks = (on: On, count: { looks: number }): On =>
  ((event: string, ...rest: unknown[]) => {
    if (event !== 'fs.list') return (on as (...a: unknown[]) => unknown)(event, ...rest)
    const below = rest.at(-1) as (...a: unknown[]) => unknown
    return (on as (...a: unknown[]) => unknown)('fs.list', ($: unknown, e: { path: string }, next: unknown) => {
      if (e.path.endsWith('account-rotator-requests')) count.looks += 1
      return below($, e, next)
    })
  }) as unknown as On

/** Runs a call past REQUEST_TTL_MS, by when no request its command wrote can still be taken, and counts its looks over 40 beats. */
async function looksPastTheTtl($: Engine, w: World, clock: MockClock, count: { looks: number }, command: string): Promise<number> {
  const call = bashCall($, w, command)
  await beat(clock)
  await clock.advance(REQUEST_TTL_MS + 2 * REQUEST_POLL_MS)
  await clock.settle()
  count.looks = 0
  for (let i = 0; i < 40; i += 1) await beat(clock)
  const { looks } = count
  await call.finish()
  await beat(clock)
  return looks
}

// A test for each command, each its own run of one REQUEST_TTL_MS of beats: the beats up to the deadline are the proof,
// so they stay, and a command's run no longer waits behind the others'.
const WATCHED_COMMANDS = ['tail -f /var/log/account-rotator.log', 'cd ~/Projects/claude-account-rotator && npm run dev', 'account-rotator account use --account 2; sleep 36000']

for (const command of WATCHED_COMMANDS) {
  test(`no command shape holds the watch past the time a request lasts: ${command}`, { timeoutMs: 120_000 }, async ($, on) => {
    const count = { looks: 0 }
    const { w, clock } = await selectWorld($, onCountingLooks(on, count))
    const commands = [command]
    const offenders: string[] = []
    for (const shape of commands) {
      const looks = await looksPastTheTtl($, w, clock, count, shape)
      if (looks >= 5) offenders.push(`${shape}: ${looks} looks in 40 beats`)
    }
    expect(commands.length).toBeGreaterThan(0)
    expect(offenders, `commands the watch polls for without end; bound watchRequests by REQUEST_TTL_MS: ${offenders.join('; ')}`).toEqual([])
  })
}

// An emptied list registers no test above, so nothing else would fail.
test('the watch is tried with at least one command shape', () => {
  expect(WATCHED_COMMANDS.length).toBeGreaterThan(0)
})

// Review C12-R2 C12-BOUNDARY (Codex) [WATCH-BOUNDARY] -> [WATCH-IS-NOT-THE-MINUTE].
// A test for each kind of request, each its own run of the beats up to the deadline, which are the proof.
for (const [nonce, make] of [['deadline-use01', useRequest], ['deadline-sel01', selectRequest]] as const) {
  test(`a watch takes neither kind of request on its deadline beat: ${nonce}`, { timeoutMs: 30_000 }, async ($, on) => {
    const { w, store, clock } = await selectWorld($, on)
    const offenders: string[] = []
    const call = bashCall($, w, USE_COMMAND)
    await clock.settle()
    await clock.advance(REQUEST_TTL_MS - REQUEST_POLL_MS)
    await clock.settle()
    w.files[`${REQUESTS}/${nonce}.json`] = make(nonce, '2', store.get('store-id'), clock.now(), ownMark(w))
    await beat(clock)
    if (resultOf(w, nonce)) offenders.push(nonce)
    await call.finish()
    expect(offenders, `taken at REQUEST_TTL_MS; check the deadline after the sleep too: ${offenders.join(', ')}`).toEqual([])
  })
}

test('a finished call must not take any later select or use before the minute', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const call = bashCall($, w, USE_COMMAND)
  await call.finish()
  w.files[`${REQUESTS}/late-use01.json`] = useRequest('late-use01', '2', store.get('store-id'), clock.now(), ownMark(w))
  w.files[`${REQUESTS}/late-sel01.json`] = selectRequest('late-sel01', '2', store.get('store-id'), clock.now())
  await beat(clock)
  const offenders = ['late-use01', 'late-sel01'].filter(n => resultOf(w, n)).map(n => `${n} taken after watcher ended`)
  expect(offenders, `watchRequests must recheck isRunning after sleep before applyRequests: ${offenders.join('; ')}`).toEqual([])
})

// C12 `rm` (puma-eslxj.13, RULING 4640): `account rm` drops an account through any session on the store, as Remove does.

const LOGIN3 = { id: '3', slot: SLOT3, email: 'three@example.com' }

/** Every store key `rm` deletes for an account. */
const ACCOUNT_KEYS = ['reading', 'usage', 'mark', 'no-five-hour', 'week-mark', 'fable-mark', 'check-error', 'health', 'holder', 'usage-due']

test('an rm during a Bash call that names the CLI signs the slot out, drops the account and its keys, re-picks launch-slot and says so', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  store.set('launch-on', 'account:2')
  await untilTick(clock)
  expect((store.get('launch-slot') as { id?: string } | undefined)?.id, 'the fixture does not pick login 2').toBe('2')
  for (const key of ACCOUNT_KEYS) store.set(`${key}:2`, { seeded: true })
  const call = bashCall($, w, 'account-rotator account rm --account 2')
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await beat(clock)
  await call.finish()
  expect(w.logouts).toEqual([SLOT2])
  expect((store.get('accounts') as { id: string }[]).map(a => a.id)).toEqual(['1'])
  const left = ACCOUNT_KEYS.filter(key => store.has(`${key}:2`))
  expect(left, `keys left behind: ${left.join(', ')}`).toEqual([])
  expect((store.get('launch-slot') as { id?: string } | undefined)?.id).toBe('1')
  expect(resultOf(w, N1)).toMatchObject({ nonce: N1, ok: true, pickId: '1' })
  expect(resultOf(w, N1)?.message).toMatch(/two@example.com is removed; new sessions start on one@example.com/)
})

test('with no Bash call the minute applies an rm', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect([w.logouts, resultOf(w, N1)?.ok]).toEqual([[SLOT2], true])
})

// Two sessions on one store: what each key holds for another account is not this rm's, and neither is an account this session's view has not seen.
test('two sessions on one store: an rm keeps every key of an account another session added since this session last read the store', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  expect(ACCOUNT_KEYS.length, 'the sweep lists no key').toBeGreaterThan(0)
  store.set('accounts', [...TWO_LOGINS.accounts, LOGIN3])
  for (const key of ACCOUNT_KEYS) store.set(`${key}:3`, { theirs: true })
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  const call = bashCall($, w, 'account-rotator account rm --account 2')
  await beat(clock)
  await call.finish()
  expect((store.get('accounts') as { id: string }[]).map(a => a.id)).toEqual(['1', '3'])
  const lost = ACCOUNT_KEYS.filter(key => !store.has(`${key}:3`))
  expect(lost, `another account's keys deleted: ${lost.join(', ')}`).toEqual([])
})

test('two sessions on one store: an rm of an account another session already removed answers ok with no logout', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  store.set('accounts', TWO_LOGINS.accounts.filter(a => a.id !== '2'))
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(w.logouts ?? []).toEqual([])
  expect(resultOf(w, N1)).toMatchObject({ ok: true })
  expect(resultOf(w, N1)?.message).toMatch(/the account with id 2 is already gone/)
})

test('two sessions on one store: a press of Remove from a view that still lists an account another session removed signs nothing out', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const pane = await mountPane($)
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  // No minute has passed: this session's view still lists login 2, and the press has no merge before it.
  store.set('accounts', TWO_LOGINS.accounts.filter(a => a.id !== '2'))
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  await pane.unmount()
  expect(w.logouts ?? [], 'the press signed out a login the store no longer lists').toEqual([])
})

// Review C12-rm ID-REUSE (Codex) [RM-TARGET-NOT-SEEN]: a request waits, so its id can change holder before it is applied.
test('an rm of an id that holds another login than the CLI read signs nothing out and deletes nothing', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const offenders: string[] = []
  const holders = [{ id: '2', slot: SLOT2, email: 'new@example.com' }, { id: '2', slot: `${HOME}/.claude/accounts/9`, email: 'two@example.com' }, { id: '2', slot: SLOT2 }]
  let serial = 0
  for (const holder of holders) {
    store.set('accounts', [TWO_LOGINS.accounts[0], holder])
    store.set('reading:2', { theirs: true })
    const nonce = `reuse-${String(++serial).padStart(4, '0')}`
    w.files[`${REQUESTS}/${nonce}.json`] = rmRequest(nonce, '2', store.get('store-id'), clock.now())
    await untilTick(clock)
    const isKept = (store.get('accounts') as { id: string }[]).some(a => a.id === '2') && store.has('reading:2')
    if ((w.logouts ?? []).length > 0 || !isKept || resultOf(w, nonce)?.ok !== false) offenders.push(JSON.stringify(holder))
    w.logouts = []
    delete w.files[`${REQUESTS}/${nonce}.json`]
  }
  expect(offenders, `holders of id 2 an old rm removed; compare what the CLI saw before the logout: ${offenders.join('; ')}`).toEqual([])
})

// Review C12-rm-R2 ORG-REUSE and EMAIL-FILL (Codex) [RM-TARGET-NOT-SEEN]: the model test holds every case; these two hold the wiring.
test('an rm that read one organization signs out no other under the same email', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  store.set('accounts', [TWO_LOGINS.accounts[0], { id: '2', slot: SLOT2, email: 'two@example.com', orgId: 'org-b' }])
  w.files[`${REQUESTS}/${N1}.json`] = JSON.stringify({ kind: 'rm', nonce: N1, at: clock.now(), id: '2', store: store.get('store-id'), slot: SLOT2, email: 'two@example.com', orgId: 'org-a' })
  await untilTick(clock)
  expect([w.logouts ?? [], resultOf(w, N1)?.ok]).toEqual([[], false])
})

test('an rm that read an account before its email was learned still applies: the slot is the same and no other login is known', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = JSON.stringify({ kind: 'rm', nonce: N1, at: clock.now(), id: '2', store: store.get('store-id'), slot: SLOT2 })
  await untilTick(clock)
  expect([w.logouts, resultOf(w, N1)?.ok]).toEqual([[SLOT2], true])
})

// Review C12-rm SHARED-SLOT (Codex) [RM-TARGET-NOT-SEEN].
test('an rm of an account that shares its slot with one that stays signs nothing out', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  store.set('accounts', [...TWO_LOGINS.accounts, { id: '3', slot: SLOT2, email: 'same-slot@example.com' }])
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(w.logouts ?? [], 'the logout signed out three@example.com, which stays listed').toEqual([])
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(resultOf(w, N1)?.message).toMatch(/two@example.com shares its sign-in with same-slot@example.com/)
  expect((store.get('accounts') as unknown[]).length).toBe(3)
})

test('two sessions on one store: a session still on an account another session removed is not moved by it', async ($, on) => {
  const w = fresh()
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  const { store, clock } = await selectWorld($, on, undefined, undefined, w)
  store.set('accounts', TWO_LOGINS.accounts.filter(a => a.id !== '2'))
  await untilTick(clock)
  expect(w.envSets).toEqual([])
})

test('the account the applying session is on: it moves off first, then signs it out', async ($, on) => {
  const w = fresh()
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  const { store, clock } = await selectWorld($, on, undefined, undefined, w)
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: undefined }])
  expect([w.logouts, resultOf(w, N1)?.ok]).toEqual([[SLOT2], true])
})

test('in use with no other account signed in: not ok, naming it, no logout, the account and its keys stay', async ($, on) => {
  const w = fresh()
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  const { store, clock } = await selectWorld($, on, undefined, undefined, w)
  store.set('health:1', { kind: 'login-needed', why: 'its sign-in has run out' })
  store.set('reading:2', { seeded: true })
  await untilTick(clock)
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(resultOf(w, N1)?.message).toMatch(/two@example.com is in use and no other account can take over yet; not removed/)
  expect(w.logouts ?? []).toEqual([])
  expect((store.get('accounts') as { id: string }[]).map(a => a.id)).toEqual(['1', '2'])
  expect(store.has('reading:2')).toBe(true)
})

test('in use under a policy refusal: not ok, no logout', async ($, on) => {
  const w = fresh()
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  const { store, clock } = await selectWorld($, on, undefined, undefined, w)
  w.refuseEnv = true
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect([resultOf(w, N1)?.ok, w.logouts ?? []]).toEqual([false, []])
})

test('Claude Code\'s own login, however a request names it: not ok, no logout', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '1', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(resultOf(w, N1)?.message).toMatch(/Claude Code's own login/)
  expect([w.logouts ?? [], (store.get('accounts') as unknown[]).length]).toEqual([[], 2])
})

test('while Connect holds the session an rm answers not ok and signs nothing out', async ($, on) => {
  const { w, clock } = await visitWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '3', 'store-abc', clock.now())
  const call = bashCall($, w, 'account-rotator account rm --account 3')
  await beat(clock)
  await call.finish()
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(resultOf(w, N1)?.message).toMatch(/Claude in Chrome is connecting/)
  expect(w.logouts ?? []).toEqual([])
})

// A non-zero logout is a real failure: `claude auth logout` on an empty slot exits 0, measured twice (RULING 4640).
for (const [name, failure] of [
  ['a non-zero exit', { exitCode: 1, stderr: 'keychain is locked\nsecond line' }],
  ['no exit code, as a timeout gives', { exitCode: null, stderr: '' }],
] as const) {
  test(`a logout that fails with ${name} keeps the account and every key, and says so`, async ($, on) => {
    const { w, store, clock } = await selectWorld($, on)
    w.logoutFails = failure
    for (const key of ACCOUNT_KEYS) store.set(`${key}:2`, { seeded: true })
    w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
    await untilTick(clock)
    expect(resultOf(w, N1)?.ok).toBe(false)
    expect(resultOf(w, N1)?.message).toMatch(/two@example.com .*could not be signed out/)
    if (failure.stderr !== '') expect(resultOf(w, N1)?.message).toMatch(/keychain is locked$/)
    expect((store.get('accounts') as { id: string }[]).map(a => a.id)).toEqual(['1', '2'])
    // A usage read that works clears check-error, in the same minute.
    const lost = ACCOUNT_KEYS.filter(key => key !== 'check-error' && !store.has(`${key}:2`))
    expect(lost, `keys deleted though the login stays signed in: ${lost.join(', ')}`).toEqual([])
  })
}

test('a press of Remove whose logout fails keeps the account and tells the person', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.logoutFails = { exitCode: 1, stderr: 'keychain is locked' }
  await pressPane($, clock, ['ask-remove-2', 'remove-2'])
  await clock.settle()
  expect((store.get('accounts') as { id: string }[]).map(a => a.id)).toEqual(['1', '2'])
  expect(w.toasts.filter(t => /could not be signed out/.test(t))).toHaveLength(1)
})

test('a press of Remove with none to take over still tells the person', async ($, on) => {
  const w = fresh()
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  const { store, clock } = await selectWorld($, on, undefined, undefined, w)
  store.set('health:1', { kind: 'login-needed', why: 'its sign-in has run out' })
  await untilTick(clock)
  await pressPane($, clock, ['ask-remove-2', 'remove-2'])
  await clock.settle()
  expect(w.toasts.filter(t => /no other account can take over yet; not removed/.test(t))).toHaveLength(1)
})

test('an rm that leaves no room anywhere says new sessions start on Claude Code\'s login, and names no pick', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on, [50, 100], [50, 100])
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(true)
  expect(resultOf(w, N1)?.message).toMatch(/two@example.com is removed; no account has room, so new sessions start on Claude Code's login/)
  expect(resultOf(w, N1)?.pickId).toBeUndefined()
})

// C13 `add` (puma-eslxj.14, RULING 4660): `account add` signs a new folder in, and any session on the store lists it.

const SLOT7 = `${HOME}/.claude/accounts/7`

const N2 = '1f3c2a9e1b7d4c55a6e8f00112233445'

const addRequest = (nonce: string, slot: string, storeId: unknown, at: number) =>
  JSON.stringify({ kind: 'add', nonce, at, id: slot.split('/').pop(), store: storeId, slot })

const listedIds = (store: Map<string, unknown>) => (store.get('accounts') as { id: string }[]).map(a => a.id)

const listedRow = (store: Map<string, unknown>, id: string) => (store.get('accounts') as { id: string }[]).find(a => a.id === id)

/** A folder signed in as `email`, its usage readable, listed by no account. */
async function signInFolder(w: World, slot: string, email: string, token = 'tok-7'): Promise<void> {
  w.emails[slot] = email
  w.owners[token] = email
  w.usage[token] = [15, 25]
  w.keychain[await keychainItem(slot)] = blob(token)
}

test('an add lists the folder under its number with who signed in, for a session to answer and the minute to read', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(listedRow(store, '7')).toMatchObject({ id: '7', slot: SLOT7, email: 'seven@example.com', orgId: 'org-seven@example.com', plan: 'max' })
  expect(store.get('health:7')).toMatchObject({ kind: 'ok' })
  expect(resultOf(w, N1)).toMatchObject({ nonce: N1, ok: true, accountId: '7' })
  expect(resultOf(w, N1)?.message).toMatch(/^seven@example\.com is added/)
  expect(w.usageCalls, 'the same minute reads the new account: it needs no read of its own').toContain('tok-7')
  await untilTick(clock)
  expect(store.get('health:7')).toMatchObject({ kind: 'ok' })
})

test('an add during a Bash call that names the CLI is applied at once', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  const call = bashCall($, w, `account-rotator account add --folder ${SLOT7}`)
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await beat(clock)
  await call.finish()
  expect(listedIds(store)).toEqual(['1', '2', '7'])
  expect(resultOf(w, N1)?.ok).toBe(true)
})

test('an account an add listed is in this session at once: a later request in the same minute finds it', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  w.files[`${REQUESTS}/${N2}.json`] = JSON.stringify({ kind: 'select', nonce: N2, at: clock.now() + 1, id: '7', store: store.get('store-id') })
  await untilTick(clock)
  expect([resultOf(w, N1)?.ok, resultOf(w, N2)?.ok]).toEqual([true, true])
})

test('an add of a folder an account already lists says which, and changes nothing', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const before = JSON.stringify(store.get('accounts'))
  w.statusAsked = []
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT2, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N1)).toMatchObject({ ok: true, accountId: '2', message: 'already two@example.com', pickId: (store.get('launch-slot') as { id: string }).id })
  expect(JSON.stringify(store.get('accounts'))).toBe(before)
})

test('an add of a login an account already holds is refused, Claude Code own login too, and names the folder left signed in', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const rows = [{ id: '1', slot: '', email: 'one@example.com', orgId: 'org-one@example.com' }, { id: '2', slot: SLOT2, email: 'two@example.com', orgId: 'org-two@example.com' }]
  const offenders: string[] = []
  let serial = 0
  for (const twin of rows) {
    store.set('accounts', rows)
    await signInFolder(w, SLOT7, twin.email)
    const nonce = `twin-${String(++serial).padStart(4, '0')}`
    w.files[`${REQUESTS}/${nonce}.json`] = addRequest(nonce, SLOT7, store.get('store-id'), clock.now())
    await untilTick(clock)
    const result = resultOf(w, nonce)
    const said = String(result?.message)
    if (result?.ok !== false || !said.includes(`that sign-in is ${twin.email} already`) || !said.includes(SLOT7) || !said.includes('claude auth logout')) offenders.push(`${twin.id}: ${said}`)
    if (listedIds(store).includes('7') || store.has('health:7')) offenders.push(`${twin.id}: listed`)
    delete w.files[`${REQUESTS}/${nonce}.json`]
  }
  expect(offenders).toEqual([])
})

// Review C13-R1 F5 [TWIN-BY-WHAT-IS-KNOWN] (RULING 4668): a wrong refusal has a way back, a wrong acceptance makes a twin that stays.
test('an add under an email a row holds with its organization unread is refused; under another organization it is listed', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'two@example.com')
  store.set('accounts', TWO_LOGINS.accounts)
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(String(resultOf(w, N1)?.message)).toMatch(/not read yet/)
  expect(listedIds(store)).not.toContain('7')
  store.set('accounts', [TWO_LOGINS.accounts[0], { id: '2', slot: SLOT2, email: 'two@example.com', orgId: 'org-other' }])
  w.files[`${REQUESTS}/${N2}.json`] = addRequest(N2, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N2)?.ok).toBe(true)
  expect(listedIds(store)).toContain('7')
})

// Review C13-R1 F6 [AFTER-SIGN-IN]: nobody read that the folder holds no sign-in, and a second approval costs a person.
test('an add whose status read fails says it could not read who, never that the folder holds no sign-in', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.statusFails = 'garbage'
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(String(resultOf(w, N1)?.message)).toMatch(/could not read who/)
  expect(String(resultOf(w, N1)?.message)).not.toMatch(/holds no sign-in|run account add/)
})

// Review C13-R1 F3 and OVERCLAIM [AFTER-SIGN-IN]: the session reads its own write back, so the answer is what the store holds.
test('two sessions on one store, accounts: a write that took the place of the new row answers not ok, and a row under another id answers that id', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  const without = store.get('accounts') as object[]
  let writes = 0
  w.afterStoreSet = key => {
    if (key === 'accounts' && writes++ === 0) store.set('accounts', without)
  }
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(String(resultOf(w, N1)?.message)).toMatch(/another session's write/)
  writes = 0
  w.afterStoreSet = key => {
    if (key === 'accounts' && writes++ === 0) store.set('accounts', [...without, { id: '9', slot: SLOT7, email: 'seven@example.com', orgId: 'org-seven@example.com' }])
  }
  w.files[`${REQUESTS}/${N2}.json`] = addRequest(N2, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N2)).toMatchObject({ ok: true, accountId: '9' })
  expect(String(resultOf(w, N2)?.message)).toMatch(/seven@example\.com/)
})

// puma-eslxj.28 [STORE-ID-THROW-SKIPS-MINUTE]: a refused store-id rejects no merge, so the minute settles and checks, in that order: a check read means the settle ran.
for (const way of ['write', 'read'] as const) {
  test(`a refused store-id ${way} skips none of the minute, and says so in the debug log`, async ($, on) => {
    const { w, store, clock } = await selectWorld($, on)
    store.delete('store-id')
    store.delete('usage-due:2')
    w.usageCalls = []
    w.logged = []
    w.storeIdFails = way
    await untilTick(clock)
    expect(w.usageCalls, 'the minute did not reach its check').toContain('tok-2')
    expect((w.logged ?? []).filter(line => /store-id/.test(line)).length, 'the refusal is logged on its own').toBeGreaterThan(0)
  })
}

test('a session that starts under a refused store-id write still boots and reads its accounts', async ($, on) => {
  const w = fresh()
  w.storeIdFails = 'write'
  const { store } = await selectWorld($, on, undefined, undefined, w)
  expect(store.has('store-id')).toBe(false)
  expect(w.usageCalls.length, 'boot stopped at its merge').toBeGreaterThan(0)
})

test('two sessions on one store, store-id: a refused write is tried again the next minute, and an id another session wrote meanwhile stands', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  store.delete('store-id')
  w.storeIdFails = 'write'
  await untilTick(clock)
  expect(store.has('store-id')).toBe(false)
  w.storeIdFails = undefined
  await untilTick(clock)
  expect(typeof store.get('store-id'), 'the next minute did not write it').toBe('string')
  store.delete('store-id')
  w.storeIdFails = 'write'
  await untilTick(clock)
  w.storeIdFails = undefined
  store.set('store-id', 'theirs')
  await untilTick(clock)
  expect(store.get('store-id')).toBe('theirs')
})

// Review C13-R2 RED-READBACK-IDENTITY [AFTER-SIGN-IN]: the slot alone is not the sign-in this session read.
test('two sessions on one store, accounts: a write that gave the new row another login answers not ok', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  let replaced = false
  w.afterStoreSet = key => {
    if (key !== 'accounts' || replaced) return
    replaced = true
    store.set('accounts', (store.get('accounts') as { slot: string }[]).map(a => (a.slot === SLOT7 ? { ...a, email: 'eight@example.com', orgId: 'org-eight@example.com' } : a)))
  }
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(replaced, 'the fixture reached the write').toBe(true)
  expect(resultOf(w, N1)?.ok).toBe(false)
})

// Review C13-R1 F9 [STALE-ID-KEY]: an account on `rm` is not moved, so a session on it can write under the id after the rm.
test('a row an add lists wears no key an old holder of that id left, by the list rm drops', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const left = ACCOUNT_KEYS.map(key => `${key}:7`)
  expect(left.length, 'the sweep lists no key').toBeGreaterThan(0)
  for (const key of left) store.set(key, { oldHolder: true })
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.statusFails = undefined
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  let whenListed: string[] = ['the row was never written']
  w.onStoreSet = (key, value) => {
    if (key === 'accounts' && (value as { id: string }[]).some(a => a.id === '7') && whenListed[0] === 'the row was never written') {
      whenListed = left.filter(k => JSON.stringify(store.get(k)) === JSON.stringify({ oldHolder: true }))
    }
  }
  await untilTick(clock)
  expect(whenListed, 'keys of the old holder when the new row was written').toEqual([])
})

test('an add of a folder with no sign-in that can be read lists nothing, in each way the read fails', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const ways = [undefined, 'exit', 'garbage', 'refused'] as const
  const offenders: string[] = []
  let serial = 0
  for (const way of ways) {
    w.statusFails = way
    const nonce = `none-${String(++serial).padStart(4, '0')}`
    w.files[`${REQUESTS}/${nonce}.json`] = addRequest(nonce, SLOT7, store.get('store-id'), clock.now())
    await untilTick(clock)
    if (resultOf(w, nonce)?.ok !== false || listedIds(store).includes('7') || store.has('health:7')) offenders.push(String(way))
    delete w.files[`${REQUESTS}/${nonce}.json`]
  }
  expect(offenders).toEqual([])
})

test('an add of anything but a numbered folder under the accounts folder lists nothing and runs nothing on it', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const bad = ['/etc', `${HOME}/.claude/accounts/`, `${HOME}/.claude/accounts/0`, `${HOME}/.claude/accounts/7/`, `${HOME}/.claude/accounts/7/../2`, `${HOME}/.claude/accounts/abc`]
  const offenders: string[] = []
  let serial = 0
  for (const slot of bad) {
    w.emails[slot] = `someone${serial}@example.com`
    w.statusAsked = []
    const nonce = `slot-${String(++serial).padStart(4, '0')}`
    w.files[`${REQUESTS}/${nonce}.json`] = addRequest(nonce, slot, store.get('store-id'), clock.now())
    await untilTick(clock)
    const asked = w.statusAsked.includes(slot)
    if (resultOf(w, nonce)?.ok !== false || asked || (store.get('accounts') as { slot: string }[]).some(a => a.slot === slot)) offenders.push(slot)
    delete w.files[`${REQUESTS}/${nonce}.json`]
  }
  expect(offenders).toEqual([])
})

// freeId and holdsLogin (C12): an adopted id can be one a waiting rm names, whose CLI read another holder.
test('an add whose number another slot holds takes the free id, and a waiting rm of that id signs nothing out, by the slot', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  store.set('accounts', [...TWO_LOGINS.accounts, { id: '7', slot: `${HOME}/.claude/accounts/9`, email: 'nine@example.com' }])
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  w.files[`${REQUESTS}/${N2}.json`] = JSON.stringify({ kind: 'rm', nonce: N2, at: clock.now() + 1, id: '3', store: store.get('store-id'), slot: SLOT3, email: 'three@example.com' })
  await untilTick(clock)
  expect(listedRow(store, '3')).toMatchObject({ slot: SLOT7, email: 'seven@example.com' })
  expect(resultOf(w, N1)).toMatchObject({ ok: true, accountId: '3' })
  expect([w.logouts ?? [], resultOf(w, N2)?.ok]).toEqual([[], false])
})

test('a waiting rm of a slot an add listed with another login signs nothing out, by the email', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT3, 'new@example.com')
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT3, store.get('store-id'), clock.now())
  w.files[`${REQUESTS}/${N2}.json`] = JSON.stringify({ kind: 'rm', nonce: N2, at: clock.now() + 1, id: '3', store: store.get('store-id'), slot: SLOT3, email: 'three@example.com' })
  await untilTick(clock)
  expect(listedRow(store, '3')).toMatchObject({ slot: SLOT3, email: 'new@example.com' })
  expect([w.logouts ?? [], resultOf(w, N2)?.ok]).toEqual([[], false])
})

// Two sessions on one store, per key the add reads or writes: `accounts`, `health:<id>`, `launch-slot`, `rows`, `store-id`.
test('two sessions on one store, accounts: a session that lists the folder while this one reads who signed in leaves one row', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.onStatus = () => {
    if ((store.get('accounts') as { slot: string }[]).some(a => a.slot === SLOT7)) return
    store.set('accounts', [...(store.get('accounts') as object[]), { id: '7', slot: SLOT7, email: 'seven@example.com' }])
  }
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(listedIds(store)).toEqual(['1', '2', '7'])
  expect(resultOf(w, N1)).toMatchObject({ ok: true, accountId: '7', message: 'already seven@example.com' })
})

test('two sessions on one store, accounts: an account another session listed while this one read who signed in stays', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.onStatus = () => {
    if (listedIds(store).includes('8')) return
    store.set('accounts', [...(store.get('accounts') as object[]), { id: '8', slot: `${HOME}/.claude/accounts/8`, email: 'eight@example.com' }])
  }
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(listedIds(store)).toEqual(['1', '2', '8', '7'])
})

test('two sessions on one store, accounts: a login another session listed while this one read who signed in is a twin', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'eight@example.com')
  w.onStatus = () => {
    if (listedIds(store).includes('8')) return
    store.set('accounts', [...(store.get('accounts') as object[]), { id: '8', slot: `${HOME}/.claude/accounts/8`, email: 'eight@example.com', orgId: 'org-eight@example.com' }])
  }
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(listedIds(store)).not.toContain('7')
})

test('two sessions on one store, accounts: the session that takes one request second answers already', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  w.files[`${REQUESTS}/${N2}.json`] = addRequest(N2, SLOT7, store.get('store-id'), clock.now() + 1)
  await untilTick(clock)
  expect(listedIds(store)).toEqual(['1', '2', '7'])
  expect([resultOf(w, N1)?.accountId, resultOf(w, N2)?.message]).toEqual(['7', 'already seven@example.com'])
})

test('two sessions on one store, health: the health stands before the row, so a session that merges between them never finds the account not signed in', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  let healthAtRow: unknown = 'no row written'
  w.onStoreSet = (key, value) => {
    if (key === 'accounts' && (value as { id: string }[]).some(a => a.id === '7') && healthAtRow === 'no row written') healthAtRow = store.get('health:7')
  }
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  expect(healthAtRow).toEqual({ kind: 'ok' })
})

test('two sessions on one store, launch-slot: the pick counts the setting another session changed, and the answer names it', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.onStatus = () => store.set('launch-on', 'account:2')
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  w.onStatus = undefined
  expect((store.get('launch-slot') as { id?: string } | undefined)?.id).toBe('2')
  expect(resultOf(w, N1)).toMatchObject({ ok: true, pickId: '2' })
})

test('two sessions on one store, rows: the rows the add leaves name the new account beside every other', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, store.get('store-id'), clock.now())
  await untilTick(clock)
  const rows = (store.get('rows') as StoredRows).rows.map(r => r.id)
  expect(rows).toEqual(['1', '2', '7'])
})

test('two sessions on one store, store-id: an add read from another store is left alone, and an add changes no store-id', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const id = store.get('store-id')
  await signInFolder(w, SLOT7, 'seven@example.com')
  w.files[`${REQUESTS}/${N1}.json`] = addRequest(N1, SLOT7, 'another-store', clock.now())
  await untilTick(clock)
  expect([resultOf(w, N1), listedIds(store).includes('7')]).toEqual([undefined, false])
  w.files[`${REQUESTS}/${N2}.json`] = addRequest(N2, SLOT7, id, clock.now())
  await untilTick(clock)
  expect([resultOf(w, N2)?.ok, store.get('store-id')]).toEqual([true, id])
})

// puma-eslxj.25: what the session takes from the request folder, and what it says when it cannot look.
const paddedSelect = (nonce: string, storeId: unknown, at: number, pad = 0) => JSON.stringify({ kind: 'select', nonce, at, id: '2', store: storeId, pad: 'x'.repeat(pad) })

// Review R2 (Codex, #70 round 1), its class: a request too large to read is refused unread, never left unanswered.
test('a request over 4 KB is refused unread, in one debug line, and one of exactly 4 KB is taken', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const size = paddedSelect(N1, store.get('store-id'), clock.now()).length
  w.files[`${REQUESTS}/${N1}.json`] = paddedSelect(N1, store.get('store-id'), clock.now(), 4097 - size)
  await untilTick(clock)
  w.files[`${REQUESTS}/${N1}.json`] = paddedSelect(N1, store.get('store-id'), clock.now(), 4097 - size)
  await untilTick(clock)
  expect([resultOf(w, N1)?.ok, /over 4096 bytes/.test(String(resultOf(w, N1)?.message)), store.get('launch-on')]).toEqual([false, true, undefined])
  expect(debugLines(w, N1).length).toBe(1)
  w.files[`${REQUESTS}/${N2}.json`] = paddedSelect(N2, store.get('store-id'), clock.now(), 4096 - size)
  await untilTick(clock)
  expect(resultOf(w, N2)?.ok).toBe(true)
})

test('an entry of a request name that is no plain file is skipped unread, in one debug line', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/${N1}.json`] = paddedSelect(N1, store.get('store-id'), clock.now())
  w.linkFiles = [`${N1}.json`]
  await untilTick(clock)
  await untilTick(clock)
  expect(resultOf(w, N1)).toBeUndefined()
  expect(debugLines(w, N1).length).toBe(1)
})

test('a failing look at the request folder says so once, and again only after it recovers', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const line = 'requests folder'
  w.logged = []
  w.files[`${REQUESTS}/${N1}.json`] = paddedSelect(N1, store.get('store-id'), clock.now())
  await untilTick(clock)
  w.listFails = true
  await untilTick(clock)
  await untilTick(clock)
  expect(debugLines(w, line).length, 'one line while it fails').toBe(1)
  w.listFails = false
  await untilTick(clock)
  w.listFails = true
  await untilTick(clock)
  expect(debugLines(w, line).length, 'again after it recovered').toBe(2)
})

// puma-eslxj.30's gap (RULING 4687): adoptSignIn's own-row exclusion.
test('a re-login of a listed account is not its own twin', async ($, on) => {
  const { w, store, clock } = await pressWorld($, on)
  delete w.keychain[await keychainItem(SLOT2)]
  await clock.advance(10 * 60_000)
  await clock.settle()
  expect(store.get('health:2'), 'the fixture lost its sign-in').toMatchObject({ kind: 'login-needed' })
  w.loginEmail = 'two@example.com'
  const pane = await mountPane($)
  await pane.press({ key: 'sign-in-2' })
  await clock.settle()
  await pane.unmount()
  expect(store.get('health:2')).toMatchObject({ kind: 'ok' })
})

// puma-eslxj.30 (RULING 4683): a press and `account add` pick a folder by one rule, and a row wears nothing an old holder left.

/** A session whose `claude auth login` signs the folder in as `w.loginEmail`, for a press of + Add an account. */
async function pressWorld($: Engine, on: On, w: World = fresh(), beforeStart?: (store: Map<string, unknown>) => void): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock; rowAtLogin: () => boolean }> {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 20]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  beforeStart?.(store)
  const clock = world(on, w, store)
  let isRowAtLogin = false
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    const slot = e.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? ''
    isRowAtLogin = (store.get('accounts') as { slot: string }[]).some(a => a.slot === slot)
    if (w.loginEmail !== undefined) await signInFolder(w, slot, w.loginEmail, 'tok-new')
    return { value: { code: 0, signal: null } }
  })
  await start($, clock)
  await clock.advance(60_000)
  return { w, store, clock, rowAtLogin: () => isRowAtLogin }
}

async function pressAdd($: Engine, clock: MockClock): Promise<void> {
  const pane = await mountPane($)
  await pane.press({ key: 'add' })
  await clock.settle()
  await pane.unmount()
}

const accountsFolder = (n: number) => `${HOME}/.claude/accounts/${n}`

// Review C30 SLOT-RACE: the claim is the mkdir itself, as the CLI's os.mkdir: a folder another process made a moment ago refuses it, with no look before it to go stale.
test('a press claims the first number with no account, no slot and no folder by mkdir, and signs in only there, after its row', async ($, on) => {
  const { w, store, clock, rowAtLogin } = await pressWorld($, on)
  // Folder 3 stays where an account was removed; folder 6 is a CLI's mid sign-in. Id 4 is another slot's, slot 5 another id's.
  w.folders = [accountsFolder(3), accountsFolder(6)]
  store.set('accounts', [...TWO_LOGINS.accounts, { id: '4', slot: accountsFolder(9), email: 'nine@example.com' }, { id: '90', slot: accountsFolder(5), email: 'five@example.com' }])
  w.loginEmail = 'new@example.com'
  await pressAdd($, clock)
  expect(listedRow(store, '7')).toMatchObject({ slot: accountsFolder(7), email: 'new@example.com' })
  expect(listedIds(store)).toEqual(['1', '2', '4', '90', '7'])
  expect(w.spawned.map(s => s.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR)).toEqual([accountsFolder(7)])
  expect(rowAtLogin(), 'the row stands before the sign-in').toBe(true)
  expect(Object.keys(w.files).filter(p => p.includes('/.claude/accounts/'))).toEqual([`${accountsFolder(7)}/README`])
})

test('two sessions on one store, accounts: a press keeps a row another session listed since this view, and takes the next number', async ($, on) => {
  const { store, clock } = await pressWorld($, on)
  store.set('accounts', [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }])
  await pressAdd($, clock)
  expect(listedIds(store)).toEqual(['1', '2', '3', '4'])
})

test('a press drops what an old holder of the id left, then stands the health, then the row', async ($, on) => {
  const { w, store, clock } = await pressWorld($, on)
  for (const key of ACCOUNT_KEYS) store.set(`${key}:3`, { oldHolder: true })
  let atRow: { left: string[]; health: unknown } | undefined
  w.onStoreSet = (key, value) => {
    if (key === 'accounts' && atRow === undefined && (value as { id: string }[]).some(a => a.id === '3')) {
      atRow = { left: ACCOUNT_KEYS.filter(k => JSON.stringify(store.get(`${k}:3`)) === JSON.stringify({ oldHolder: true })), health: store.get('health:3') }
    }
  }
  await pressAdd($, clock)
  expect(atRow?.left, 'keys of the old holder at the row').toEqual([])
  expect(atRow?.health).toMatchObject({ kind: 'login-needed' })
})

test('a press that cannot make its folder tells the person, each way it fails, and writes no row and no sign-in', async ($, on) => {
  const { w, store, clock } = await pressWorld($, on)
  for (const way of ['exit', 'refused'] as const) {
    w.mkdirFails = way
    w.toasts = []
    await pressAdd($, clock)
    expect(listedIds(store), way).toEqual(['1', '2'])
    expect(w.spawned, way).toEqual([])
    expect(Object.keys(w.files).filter(p => p.includes('/.claude/accounts/')), way).toEqual([])
    expect(w.toasts.join(' '), way).toMatch(/Something went wrong/)
  }
})

test('a press on a store with only Claude Code login takes folder 2', async ($, on) => {
  const { store, clock } = await pressWorld($, on)
  store.set('accounts', [TWO_LOGINS.accounts[0]])
  await pressAdd($, clock)
  expect(listedRow(store, '2')).toMatchObject({ slot: accountsFolder(2) })
})

test('a press that signs in a login a row holds with its organization unread is a twin, as for account add', async ($, on) => {
  const { w, store, clock } = await pressWorld($, on)
  store.set('accounts', TWO_LOGINS.accounts)
  w.loginEmail = 'two@example.com'
  await pressAdd($, clock)
  expect(store.get('health:3')).toMatchObject({ kind: 'login-needed' })
  expect(JSON.stringify(store.get('health:3'))).toMatch(/two@example.com/)
  expect((listedRow(store, '3') as { email?: string }).email).toBeUndefined()
})

test('a session started on a slot nobody listed takes the free id, wearing nothing an old holder left', async ($, on) => {
  const w = fresh()
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = accountsFolder(7)
  expect(ACCOUNT_KEYS.length, 'the sweep lists no key').toBeGreaterThan(0)
  let left: string[] | undefined
  const { store } = await pressWorld($, on, w, entries => {
    for (const key of ACCOUNT_KEYS) entries.set(`${key}:3`, { oldHolder: true })
    w.onStoreSet = (key, value) => {
      if (key === 'accounts' && left === undefined && (value as { id: string }[]).some(a => a.id === '3')) left = ACCOUNT_KEYS.filter(k => JSON.stringify(entries.get(`${k}:3`)) === JSON.stringify({ oldHolder: true }))
    }
  })
  expect(listedRow(store, '3')).toMatchObject({ slot: accountsFolder(7) })
  expect(left, 'keys of the old holder at the row').toEqual([])
})

// puma-9arph.23: a Fable figure in the pane is what the usage endpoint reports for the account.

/**
 * A Fable stop on login 1 (its Fable week spent) moves the session to login 2, whose own week reads Fable 10%. With
 * `isReadOld`, the stop comes 30 s on, so login 2's last read is over a minute old by the carry-on.
 */
async function fableMoved($: Engine, on: On, isReadOld = false): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  if (isReadOld) await clock.advance(30_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  return { w, store, clock }
}

test('a Fable stop in the 35 seconds after a switch marks nothing on the account moved to, and the response that proves the switch leaves its Fable week as read', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on)
  // Another turn, sent before the switch landed, dies on login 1's Fable week.
  await clock.advance(5_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(store.get('fable-mark:2')).toBeUndefined()
  // The switch's own carry-on goes once; the stop adds none, at its own 35 s either.
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  w.limits = limitsOf(10, 30, OTHER_WEEK)
  await respond($, clock, w)
  expect(store.get('fable-mark:2')).toBeUndefined()
  expect(await fableRows($)).toEqual([`${longBar(100)} 100%`, `${longBar(10)}  10%`])
})

// Upstream b90ff1b: a turn that dies in the 35 seconds after a switch may have gone out on the login left, a rejected sign-in too.
test('a rejected sign-in in the 35 seconds after a switch marks nothing on the account moved to, and the switch carries on once', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on)
  await clock.advance(5_000)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expect((store.get('health:2') as { kind?: string } | undefined)?.kind).not.toBe('login-needed')
  expect(slots(w)).toEqual([SLOT2])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
})

// Review codex-r2 A1 [AUTH-SETTLE], the instance: a response with the moved-to login's week proves the switch took, so a
// rejected sign-in after it, still inside the 35 seconds, is that login's.
test('Review codex-r2 A1: a target response during settle makes its rejected sign-in belong to the target', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on)
  await clock.advance(5_000)
  w.limits = limitsOf(10, 30, OTHER_WEEK)
  await respond($, clock, w)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expect((store.get('health:2') as { kind?: string } | undefined)?.kind, 'A1: a target response already identified two@example.com; a real rejected sign-in must mark it sign-in-needed during settle').toBe('login-needed')
})

// Review codex-r2 A1 [AUTH-SETTLE], the class: target-proven rejected sign-ins must pass the common settle return.
test('Review codex-r2 A1 class: target-proven rejected sign-ins must pass the common settle return', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on)
  await clock.advance(5_000)
  w.limits = limitsOf(10, 30, OTHER_WEEK)
  await respond($, clock, w)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  const offenders = [] as string[]
  if ((store.get('health:2') as { kind?: string } | undefined)?.kind !== 'login-needed') offenders.push('settling switch after a target response')
  expect(offenders, 'Offender: settling switch after a target response. Fix: use response ownership before the blanket settle return for authentication_failed; the same settle return is also used during Connect visits.').toEqual([])
})

// Review of 3f4e021 [UNPINNED-AUTH-AFTER-SETTLE]: past the 35 seconds, the switch has landed, so a rejected sign-in is the
// moved-to login's though no response has proved the switch yet.
test('a rejected sign-in past the 35 seconds after a switch, before any response, sets the account moved to as needing a sign-in', async ($, on) => {
  const { store, clock } = await fableMoved($, on)
  await clock.advance(36_000)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expect((store.get('health:2') as { kind?: string } | undefined)?.kind).toBe('login-needed')
})

/**
 * The session on login 2 after a Fable switch, the switch unproven, with rotation turned off past the minute's merge, so
 * a rejected sign-in 61 s on comes past the settle and cannot move the session.
 */
async function rejectedStaying($: Engine, on: On): Promise<{ store: Map<string, unknown>; clock: MockClock }> {
  const { w, store, clock } = await fableMoved($, on)
  store.set('rotate-to', 'off')
  await clock.advance(61_000)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expect(slots(w), 'premise: the stop does not move the session').toEqual([SLOT2])
  expect((store.get('health:2') as { kind?: string } | undefined)?.kind, 'premise: the unproven stop marks login 2').toBe('login-needed')
  return { store, clock }
}

// Review codex on #87 [AUTH-UNDO], the instance (puma-9arph.27): a rejected sign-in on an unproven switch that does not
// move the session is provisional, as a usage-limit stop there is, so the end of that switch gives the health back.
test('Review codex AUTH-UNDO: an unproven rejected sign-in that does not move the session is given back on process exit', async ($, on) => {
  const { store, clock } = await rejectedStaying($, on)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } } as Parameters<Engine['session']['end']>[0])
  await clock.settle()
  expect((store.get('health:2') as { kind?: string } | undefined)?.kind, 'Offender: process exit after an unproven rejected sign-in. Fix: record and undo its health write when the pending switch ends without proof.').not.toBe('login-needed')
})

// Review codex on #87 [AUTH-UNDO], the class: every process end gives an unproven rejected sign-in back.
for (const reason of ['prompt_input_exit', 'logout', 'other'] as const) {
  test(`Review codex AUTH-UNDO class: ${reason} gives back an unproven rejected sign-in that does not move the session`, async ($, on) => {
    const { store, clock } = await rejectedStaying($, on)
    await $.session.end({ reason, sessionId: 'session-1', resume: { id: 'session-1' } } as Parameters<Engine['session']['end']>[0])
    await clock.settle()
    expect((store.get('health:2') as { kind?: string } | undefined)?.kind, `Offender: ${reason}. Fix: record the rejected sign-in's health write and undo it when this unproven switch ends at ${reason}.`).not.toBe('login-needed')
  })
}

// Review codex on #88 [AUTH-OWNERSHIP], the instance: the undo gives back only this stop's own health write; another
// session's identical rejection since is that session's and stands.
test('Review codex AUTH-OWNERSHIP: an identical independent rejection survives process exit', async ($, on) => {
  const { store, clock } = await rejectedStaying($, on)
  const secondSessionWrite = { kind: 'login-needed', why: 'sign-in rejected' }
  store.set('health:2', secondSessionWrite)
  await endSession($, clock)
  expect(store.get('health:2'), 'Offender: process exit undoes a second session\'s identical rejection. Fix: give provisional health writes unique ownership or a version and compare it before undo.').toEqual(secondSessionWrite)
})

// Review codex on #88 [AUTH-OWNERSHIP], the class: a replaced switch undoes as process exit does.
test('Review codex AUTH-OWNERSHIP class: an identical independent rejection survives switch replacement', async ($, on) => {
  const { store, clock } = await rejectedStaying($, on)
  const secondSessionWrite = { kind: 'login-needed', why: 'sign-in rejected' }
  store.set('health:2', secondSessionWrite)
  await useNow($, clock, '1')
  expect(store.get('health:2'), 'Offenders: process exit and Use now replacement both call undoProvisionalStop, which erases an identical second-session rejection. Fix: version or tag the health write and undo only the first session\'s own version.').toEqual(secondSessionWrite)
})

// Review codex on #88 [AUTH-VIEW], the instance: an undo that deletes a health key with no earlier value drops it from the view.
test('Review codex AUTH-VIEW: undo of a first health key clears the session view', async ($, on) => {
  const view = watchedView(on)
  const { store, clock } = await fableMoved($, on)
  store.set('rotate-to', 'off')
  await clock.advance(61_000)
  store.delete('health:2')
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expect(store.get('health:2')).toMatchObject({ kind: 'login-needed' })
  await endSession($, clock)
  expect([store.get('health:2'), view()?.health['2']?.kind], 'Offender: process-exit undo deletes the provisional key but mergeStore keeps the stale login-needed view. Fix: clear the matching view health when deleting that key.').toEqual([undefined, undefined])
})

// Review codex on #88 [AUTH-VIEW], the class: a replaced switch clears it too.
test('Review codex AUTH-VIEW class: a replaced switch clears a deleted provisional health from the view', async ($, on) => {
  const view = watchedView(on)
  const { store, clock } = await fableMoved($, on)
  store.set('rotate-to', 'off')
  await clock.advance(61_000)
  store.delete('health:2')
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  await useNow($, clock, '1')
  expect([store.get('health:2'), view()?.health['2']?.kind], 'Offenders: process exit and Use now replacement delete a first health write, but mergeStore revives the stale view. Fix: drop health from the view when the provisional health key is deleted.').toEqual([undefined, undefined])
})

// puma-9arph.27: a stop's own move keeps what the stop marked (the mark is why it moves), a rejected sign-in's health too.
test('a rejected sign-in on an unproven switch that moves the session keeps the account moved to as needing a sign-in after the session ends', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on)
  await clock.advance(36_000)
  // The limit stop's resume answered, so its episode no longer holds login 1 as tried (v4 s.1, s.2).
  await resumeAnswers($, clock)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expect(slots(w), 'premise: the stop moves the session back').toEqual([SLOT2, ''])
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } } as Parameters<Engine['session']['end']>[0])
  await clock.settle()
  expect((store.get('health:2') as { kind?: string } | undefined)?.kind).toBe('login-needed')
})

// puma-9arph.27, acceptance 3: a response with the moved-to login's week proves the switch, so a rejected sign-in after
// it is that login's for good: no end of anything gives it back.
test('a rejected sign-in on a proven switch still stands after the session ends', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on)
  await clock.advance(36_000)
  w.limits = limitsOf(10, 30, OTHER_WEEK)
  await respond($, clock, w)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1', resume: { id: 'session-1' } } as Parameters<Engine['session']['end']>[0])
  await clock.settle()
  expect((store.get('health:2') as { kind?: string } | undefined)?.kind).toBe('login-needed')
})

// Measured on vox (2026-11-12 11:48Z): the turn the mod's own carry-on started, sent as the settle ended, still went
// out on the login left and died on its Fable week; it marked the login moved to, whose usage read 35% that week.
// v4 s.6: the carry-on's turn dying is the episode's later stop. It marks nothing, whatever the read of the login moved
// to (so the read's age no longer matters), and moves to the next untried login: with two logins there is none, so no
// carry-on follows, and a second such stop marks nothing either.
for (const isReadOld of [false, true]) test(`a Fable stop answering the mod's own carry-on just past the settle, before any response, marks nothing on the account moved to, whose read ${isReadOld ? 'over' : 'under'} a minute old shows Fable room, and moves to no login, there being none untried`, async ($, on) => {
  const { w, store, clock } = await fableMoved($, on, isReadOld)
  await clock.advance(35_500)
  expect(w.submitted).toHaveLength(1)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(store.get('fable-mark:2')).toBeUndefined()
  expect(slots(w)).toEqual([SLOT2])
  expect(w.notices.map(String).filter(t => /^Fable limit reached/.test(t))).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(store.get('fable-mark:2')).toBeUndefined()
})

// v4 s.6: the other side of the carry-on rule is gone for a stop of a standing episode: it marks nothing, though the
// login's own read shows its Fable week spent, so the pane keeps what the last check read, and no carry-on follows.
test('a Fable stop answering the mod\'s own carry-on, whose login\'s own read shows its Fable week spent, marks nothing: no carry-on again, and the pane keeps the last check\'s reading', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  // Login 2's last read is over a minute old by the stop, so the stop reads it again.
  await clock.advance(30_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  await clock.advance(35_500)
  expect(w.submitted).toHaveLength(1)
  w.usage['tok-2'] = [10, 30, 100]
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(await fableRows($)).toEqual([`${longBar(100)} 100%`, `${longBar(10)}  10%`])
  expect(w.notices.map(String).filter(t => /Fable week/.test(t))).toEqual([])
})

test('a Fable stop while Chrome connects marks nothing on the visited account, though a browser answering proves the visit', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [40, 30, 10]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'chrome-account': '2', 'chrome-accounts': ['2'] }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(slots(w)).toEqual([SLOT2])
  // A turn sent as the window opened, on login 1's sign-in, dies on its Fable week while the window visits login 2.
  await clock.advance(10_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(26_000)
  // A browser answered as login 2, so the visit took; the window is back on login 1.
  expect(w.chromeAsked).toEqual([SLOT2])
  expect(slots(w)).toEqual([SLOT2, ''])
  expect(store.get('fable-mark:2')).toBeUndefined()
  expect(await fableRows($)).toEqual([`${longBar(100)} 100%`, `${longBar(10)}  10%`])
  // Nor is the stop told as login 2's limit: it was the turn's on login 1, which carries on once the visit ends.
  expect(w.notices.map(String).filter(t => /Fable/.test(t))).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
})

// A DEFAULT of the plan, the MASTER's call (puma-9arph.23): a body read more than 30 minutes after a mark's `at`,
// showing the same Fable week below 100, ends the mark. A usage read that lags a stop catches up well within that.
for (const [age, isEnded] of [[31, true], [10, false]] as const) {
  test(`a read ${age} minutes after a Fable mark that reads the same week at 35% ${isEnded ? 'ends the mark' : 'keeps it'}`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [20, 30, 10]
    w.usage['tok-2'] = [null, 39, 35]
    const mark = { pct: 100, resetsAt: FABLE_RESET, at: NOW - age * 60_000 }
    const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'fable-mark:2': mark }))
    const clock = world(on, w, store)
    await start($, clock)
    expect([age, markStands(store, 'fable-mark:2') ? store.get('fable-mark:2') : undefined]).toEqual([age, isEnded ? undefined : mark])
    expect(await fableRows($)).toEqual([`${longBar(10)}  10%`, isEnded ? `${longBar(35)}  35%` : `${longBar(100)} 100%`])
  })
}

/**
 * A store another session writes into: on its `nth` read of `fable-mark:2` it answers what stood, then stores
 * `renewed` at once, as a Fable stop in another session would land between this session's read and delete.
 */
class RenewingMarkStore extends Map<string, unknown> {
  reads = 0
  constructor(entries: Iterable<[string, unknown]>, readonly nth: number, readonly renewed: unknown) { super(entries) }
  get(key: string): unknown {
    const value = super.get(key)
    if (key === 'fable-mark:2' && ++this.reads === this.nth) super.set(key, this.renewed)
    return value
  }
}

// puma-9arph.29 MARK-DROP-RACE (Codex advisory on #86): a body read judged a Fable mark ended and deleted the key
// whatever stood there by then, so a stop another session wrote between the read and the delete was lost.
test('a Fable mark another session renews between a read that ends the old mark and its delete stands', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 10]
  w.usage['tok-2'] = [null, 39, 35]
  const renewed = { pct: 100, resetsAt: FABLE_RESET, at: NOW }
  // The start reads fable-mark:2 once to draw it, then once in the body read that ends it: the second read is the race's.
  const store = new RenewingMarkStore(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'fable-mark:2': { pct: 100, resetsAt: FABLE_RESET, at: NOW - 31 * 60_000 } }), 2, renewed)
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.reads, 'the premise: the body read read the mark').toBeGreaterThanOrEqual(2)
  expect(store.get('fable-mark:2'), 'the body read deleted a mark another session wrote after it judged the old one. Fix: delete only while the stored mark is the one judged.').toEqual(renewed)
})

test('a token refresh of the account in use keeps its usage back-off', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 30]
  w.usage['tok-1r'] = [10, 30]
  w.owners = { 'tok-1': 'one@example.com', 'tok-1r': 'one@example.com' }
  w.failing = { 'tok-1': 429 }
  w.retryAfter = { 'tok-1': '1800' }
  const store = new Map<string, unknown>(Object.entries({ accounts: [{ id: '1', slot: '', email: 'one@example.com' }], 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(callsWith(w, 'tok-1')).toBe(1)
  // Claude Code refreshes the token in use: a new access token and a new refresh token, the same account.
  w.keychain['Claude Code-credentials'] = blob('tok-1r')
  // The 10-minute check finds the new token and leaves the back-off standing.
  await clock.advance(12 * 60_000)
  expect(callsWith(w, 'tok-1r')).toBe(0)
  // The back-off the 429 asked for still ends it.
  await clock.advance(20 * 60_000)
  expect(callsWith(w, 'tok-1r')).toBeGreaterThan(0)
})

// A DEFAULT of the plan, the MASTER's call (puma-9arph.23): an idle account whose sign-in ran out shows its last read as
// updated HH:MM, idle, and is read again when a session next runs on it; the mod refreshes no sign-in by itself.
test('a login whose token has run out with no session on it reads updated HH:MM · idle, or idle with no reading, never Failed to update', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW - HOUR)
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3', NOW - HOUR)
  w.usage['tok-1'] = [10, 20]
  const lastRead = NOW - 3 * HOUR
  const store = new Map<string, unknown>(
    Object.entries({
      ...THREE_LOGINS,
      'holder:2': { token: await fingerprint('refresh-tok-2'), who: { email: 'two@example.com' } },
      'usage:2': { fiveHour: { pct: 0 }, sevenDay: { pct: 10, resetsAt: WEEK_RESET }, at: lastRead, by: '2', v: 1, src: 'body' },
      'usage-due:2': { next: NOW - 1, fails: 0, at: lastRead, v: 1 },
      'check-error:3': { why: 'the usage call answered HTTP 429', at: NOW - 2 * HOUR },
      'usage-due:3': { next: NOW - 1, fails: 2, v: 1 },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  expect([callsWith(w, 'tok-2'), callsWith(w, 'tok-3')]).toEqual([0, 0])
  expect([lineOne(store, '2'), lineOne(store, '3')].filter(l => /Failed to update/.test(l))).toEqual([])
  expect(lineOne(store, '2')).toMatch(/  updated \d\d:\d\d · idle$/)
  expect(lineOne(store, '3')).toMatch(/  idle$/)
})

// Review round 1 of #85, finding A3 [FABLE-UNCOVERED]: the stuck line counted the 5-hour window and the week, never the Fable week.
test('a window that can\'t switch, stuck on its Fable week with Fable room on another login, says once that it is stuck', async ($, on) => {
  const w = fresh()
  w.refuseEnv = true
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 10]
  w.usage['tok-2'] = [20, 30, 100]
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const stuck = (t: string) => /^Claude account two@example\.com is near its limit, and this window can't switch accounts\./.test(t)
  expect(w.toasts.filter(stuck)).toHaveLength(0)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(21 * 60_000)
  expect(w.toasts.filter(stuck)).toHaveLength(1)
})

// Review codex-r1 [STALE-FABLE-PROOF], the instance: a 35-second-old reading proves nothing, so the stop reads the
// target again, and a body that shows its Fable week spent lets the stop stand.
test('Review codex-r1: a real Fable stop on the target is not cleared by its 35-second-old reading', async ($, on) => {
  const { w, clock } = await fableMoved($, on, false)
  await clock.advance(35_500)
  expect(w.submitted).toHaveLength(1)
  // The carry-on's turn answered, ending the first stop's episode: this stop is the first of its own (v4 s.2, s.6).
  await resumeAnswers($, clock)
  w.usage['tok-2'] = [10, 30, 100]
  const calls = callsWith(w, 'tok-2')
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(callsWith(w, 'tok-2')).toBe(calls + 1)
  expect(await fableRows($)).toEqual([`${longBar(100)} 100%`, `${longBar(100)} 100%`])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
})

// Review codex-r1 [STALE-FABLE-PROOF], the class: every gate that skips the stop's read. A reading that is only
// recent is the instance above, which reads again.
for (const gate of ['backoff', 'other-claim', 'expired-token'] as const) {
  test(`Review codex-r1 class: a skipped ${gate} check cannot clear a real target Fable stop`, async ($, on) => {
    const { w, store, clock } = await fableMoved($, on, false)
    const prior = store.get('usage-due:2') as { next: number; fails: number; at?: number; v?: number; claim?: string }
    if (gate === 'backoff') store.set('usage-due:2', { ...prior, fails: 1, next: NOW + HOUR })
    if (gate === 'other-claim') store.set('usage-due:2', { ...prior, fails: 0, claim: 'other-session', next: NOW + HOUR })
    if (gate === 'expired-token') w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW - 1)
    await clock.advance(35_500)
    await resumeAnswers($, clock)
    w.usage['tok-2'] = [10, 30, 100]
    const calls = callsWith(w, 'tok-2')
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    expect([gate, callsWith(w, 'tok-2')]).toEqual([gate, calls])
    expect([gate, markOf(store.get('fable-mark:2'))]).toEqual([gate, [100, FABLE_RESET]])
  })
}

// Review codex-r2 R1 [POST-SWITCH-READ], the instance: a good read of the target stored after the switch began made the
// since gate skip the stop's read, so the stop marked a login whose read shows Fable room.
test('Review codex-r2 R1: a good target read after switch does not turn a stale carry-on stop into its Fable mark', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on)
  await clock.advance(35_500)
  expect(w.submitted).toHaveLength(1)
  const due = store.get('usage-due:2') as { next: number; fails: number; at?: number; claim?: string }
  store.set('usage:2', { ...(store.get('usage:2') as object), at: NOW + 10_000, src: 'body' })
  store.set('usage-due:2', { ...due, at: NOW + 10_000 })
  await resumeAnswers($, clock)
  const calls = callsWith(w, 'tok-2')
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(store.get('fable-mark:2'), 'R1: a good target read after switch made the since gate skip; use its own Fable 10% body as evidence, or re-read it before marking').toBeUndefined()
  expect(callsWith(w, 'tok-2')).toBe(calls + 1)
})

// Review codex-r2 R1 [POST-SWITCH-READ], the class: a finished read of the target after the switch, by any session,
// leaves the same keys and no claim (a live claim is the codex-r1 other-claim row, which marks). The stop reads the
// target again, as a stored body is no proof: it clears while the endpoint reads room, and stands once it reads the
// week spent. One switch clears once, so each row is its own session.
for (const [site, fable] of [['the endpoint still reads Fable room', 10], ['the endpoint reads the Fable week spent since', 100]] as const) {
  test(`Review codex-r2 R1 class: a good read of the target stored after the switch is read again by the carry-on stop: ${site}`, async ($, on) => {
    const { w, store, clock } = await fableMoved($, on)
    await clock.advance(35_500)
    const { claim: _claim, ...due } = store.get('usage-due:2') as { next: number; fails: number; at?: number; claim?: string }
    store.set('usage:2', { ...(store.get('usage:2') as object), at: NOW + 10_000, src: 'body' })
    store.set('usage-due:2', { ...due, at: NOW + 10_000 })
    w.usage['tok-2'] = [10, 30, fable]
    await resumeAnswers($, clock)
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    await clock.advance(36_000)
    const isCleared = fable < 100
    expect([site, store.get('fable-mark:2'), w.submitted.length], `Offender: ${site}. Fix: re-read the target before judging the stop; a stored body is no proof (keepFable).`).toEqual([site, undefined, isCleared ? 2 : 1])
  })
}

// Review opus-r1 R1F1 [FABLE-MARK-ANCHOR], the instance: a later Fable stop on a login its mark holds left `at` at the first stop.
test('Review R1F1: a Fable stop on a login its mark already holds restarts the 30 minutes, so a lower read 5 minutes after it keeps the mark', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 39, 35]
  w.usage['tok-2'] = [10, 30, 10]
  const mark = { pct: 100, resetsAt: FABLE_RESET, at: NOW - 25 * 60_000 }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'fable-mark:1': mark }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(2 * 60_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(store.get('fable-mark:1'), 'the premise: the stop leaves login 1 marked').toBeDefined()
  await clock.advance(5 * 60_000)
  await $.command.run(LOGIN)
  await clock.settle()
  expect(store.get('fable-mark:1'), 'a read of the week at 35%, 5 minutes after a Fable stop, ended its mark. Fix: a Fable stop on a login its mark holds renews the mark\'s at.').toBeDefined()
})

// Review opus-r1 R1F1 [FABLE-MARK-ANCHOR], the class: whatever keeps a Fable-stopped session on a marked login, the stop renews the 30 minutes.
for (const [cause, extra, otherFable] of [
  ['rotation off', { 'rotate-to': 'off' }, 10],
  ['no other login with Fable room', {}, 100],
] as const) {
  test(`Review R1F1 class: a session kept on a marked login by ${cause}: its Fable stop renews the mark, so a lower read 5 minutes after it keeps it`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [null, 39, 35]
    w.usage['tok-2'] = [10, 30, otherFable]
    const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, ...extra, 'fable-mark:1': { pct: 100, resetsAt: FABLE_RESET, at: NOW - 25 * 60_000 } }))
    const clock = world(on, w, store)
    await start($, clock)
    await clock.advance(2 * 60_000)
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    expect(slots(w), `the premise (${cause}): the session stays on login 1`).toEqual([])
    await clock.advance(5 * 60_000)
    await $.command.run(LOGIN)
    await clock.settle()
    expect(store.get('fable-mark:1'), `${cause}: a lower read 5 minutes after a Fable stop ended the mark. Fix: renew the mark's at on every Fable stop on a login it holds.`).toBeDefined()
  })
}

// Review of 84bc902, LOW (a): with no stored reading of its own, the stop judged the view's, which carries the mark.
test('a Fable stop on a marked login with no reading of its own renews the mark in its week', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-2'] = [10, 30, 10]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'fable-mark:1': { pct: 100, resetsAt: FABLE_RESET, at: NOW - 25 * 60_000 } }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('usage:1'), 'the premise: login 1 has no reading').toBeUndefined()
  await clock.advance(2 * 60_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  const mark = store.get('fable-mark:1') as { at: number }
  expect([markOf(mark), mark.at >= NOW + 2 * 60_000]).toEqual([[100, FABLE_RESET], true])
})

// Review opus-r1 R1F2 [IDLE-IN-USE], the instance: idle is for a login with no session on it, never this session's own.
test('Review R1F2: the login this session runs on, its token just run out, never reads idle', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 30_000)
  w.usage['tok-1'] = [10, 20]
  const store = new Map<string, unknown>(
    Object.entries({
      accounts: [{ id: '1', slot: '', email: 'one@example.com' }],
      'holder:1': { token: await fingerprint('refresh-tok-1'), who: { email: 'one@example.com' } },
      'usage:1': { fiveHour: { pct: 10 }, sevenDay: { pct: 20, resetsAt: WEEK_RESET }, at: NOW - 5 * 60_000, by: '1', v: 1, src: 'body' },
      'usage-due:1': { next: NOW - 1, fails: 0, at: NOW - 5 * 60_000, v: 1 },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  expect(lineOne(store, '1'), 'the row of the login in use says idle. Fix: no isIdle for the login the session runs on.').not.toMatch(/idle$/)
})

// Review opus-r1 R1F2 [IDLE-IN-USE], the class: on either kind of slot, with a last read or none, the login in use never reads idle.
for (const [slot, hasRead] of [['', true], ['', false], [SLOT2, true], [SLOT2, false]] as const) {
  const where = slot === '' ? "Claude Code's login" : 'folder 2'
  test(`Review R1F2 class: the login in use on ${where}, ${hasRead ? 'with' : 'without'} a last read, its token run out, never reads idle`, async ($, on) => {
    const w = fresh()
    if (slot !== '') w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = slot
    const id = slot === '' ? '1' : '2'
    w.keychain['Claude Code-credentials'] = blob('tok-1', slot === '' ? NOW + 30_000 : NOW + 6 * HOUR)
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2', slot === '' ? NOW + 6 * HOUR : NOW + 30_000)
    w.usage['tok-1'] = [10, 20]
    w.usage['tok-2'] = [10, 30]
    const store = new Map<string, unknown>(
      Object.entries({
        ...TWO_LOGINS,
        'holder:1': { token: await fingerprint('refresh-tok-1'), who: { email: 'one@example.com' } },
        'holder:2': { token: await fingerprint('refresh-tok-2'), who: { email: 'two@example.com' } },
        ...(hasRead ? { [`usage:${id}`]: { fiveHour: { pct: 10 }, sevenDay: { pct: 20, resetsAt: WEEK_RESET }, at: NOW - 5 * 60_000, by: id, v: 1, src: 'body' } } : {}),
      }),
    )
    const clock = world(on, w, store)
    await start($, clock)
    await clock.advance(61_000)
    expect(lineOne(store, id), `${where}, ${hasRead ? 'with' : 'without'} a read: the login in use reads idle. Fix: isIdle only for a login no session runs on.`).not.toMatch(/idle$/)
  })
}

// Review R1 BAND-NUMBER (Codex gpt-6-sol at bcbfb83), class NUMBER-NAME: the signing-in band named the login by number.
test('signing-in band names the known email', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  store.set('health:2', { kind: 'logging-in', since: NOW })
  await clock.advance(61_000)
  const band = await mountBand($)
  expect(await band.find({ text: /◌ Account 2:/ })).toBeUndefined()
  expect(await band.find({ text: /^◌ Signing in: in your browser, approve as two@example\.com and pick the organization\./ })).toBeDefined()
  await band.unmount()
})

test('every signed-in login uses its email while signing in', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  for (const [id, email] of [['1', 'one@example.com'], ['2', 'two@example.com']]) {
    store.set(`health:${id}`, { kind: 'logging-in', since: NOW })
    await clock.advance(61_000)
    const band = await mountBand($)
    expect(await band.find({ text: new RegExp(`◌ Account ${id}:`) })).toBeUndefined()
    // puma-9arph.28 item 4: the band names the login by its email, not only no number.
    expect(await band.find({ text: new RegExp(`approve as ${email}`) })).toBeDefined()
    await band.unmount()
    store.set(`health:${id}`, { kind: 'ok' })
  }
})

// ---------------------------------------------------------------- puma-9arph.34 B: the stop-log

const STOP_SESSION = stopHeard('session')

test('a stop, its switch and its carry-on write their entries in order under this session\'s key (puma-9arph.34 B3)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(whats(stopLogOf(store, w))).toEqual([STOP_RATE_LIMIT, PICKED_TWO, 'moved to 2 (by a stop)', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
  expect(stopLogOf(store, w).every(e => typeof e.at === 'number' && e.at >= NOW)).toBe(true)
})

test('a stop held back for a token about to refresh logs the hold, then the move and the carry-on once it lands (puma-9arph.34 B3)', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  // Spent only now: a login spent at the start would be held by the tick, which carries nothing.
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toEqual([STOP_SESSION, PICKED_TWO, 'held for 2: the token in use refreshes soon'])
  refresh(w)
  await clock.advance(60_000)
  await clock.advance(36_000)
  expect(whats(stopLogOf(store, w))).toEqual([STOP_SESSION, PICKED_TWO, 'held for 2: the token in use refreshes soon', 'moved to 2 (by a stop)', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
})

test('a switch made after the carry-on was armed logs that the carry-on was skipped (puma-9arph.34 B3)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-1' })
  await clock.settle()
  await pane.unmount()
  await clock.advance(36_000)
  expect(w.submitted).toEqual([])
  expect(whats(stopLogOf(store, w))).toEqual([STOP_RATE_LIMIT, PICKED_TWO, 'moved to 2 (by a stop)', 'carry-on armed', 'moved to 1 (by a press or a command)', 'carry-on skipped: another switch since'])
})

for (const [name, setup, reasons] of [
  ['rotation is off', { 'rotate-to': 'off' }, ['stayed: rotation off']],
  // puma-9arph.35: the first login to free up is login 1, its 5-hour window marked spent by the stop until 12:00.
  ['no other login has room', {}, ['no login left: one carry-on at 2026-10-12T12:00:00.000Z', 'stayed: no untried login (tried 1)']],
] as const) {
  test(`a stop that stays because ${name} logs the reason (puma-9arph.34 B4)`, async ($, on) => {
    const w = fresh()
    const { store, clock } = await loggedWorld(on, w, setup)
    if (name !== 'rotation is off') w.usage['tok-2'] = [100, 100]
    await start($, clock)
    w.usage['tok-1'] = [100, 41]
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.settle()
    expect(w.envSets).toEqual([])
    expect(whats(stopLogOf(store, w))).toEqual([STOP_RATE_LIMIT, ...reasons])
  })
}

// ---------------------------------------------------------------- puma-9arph.35: no login left

/** The once-notice of a stop with no login left, and the stop-log's line for it. */
const isWaitNotice = (t: unknown) => /^Every Claude account is near its limit; the next frees up .*\. This session carries on by itself once one frees up\.$/.test(String(t))

const isWaitLine = (what: string) => what.startsWith('no login left: ')

test('a usage-limit stop with every login spent says so once, a second stop adds nothing, and one carry-on goes on the login in use once its window resets (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  // Both logins' 5-hour windows reset at 12:00: one spent window a login, where the bead's letter and firstFreeAt agree.
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toEqual(['no login left: one carry-on at 2026-10-12T12:00:00.000Z'])
  expect([w.toasts.filter(isWaitNotice).length, w.notices.filter(isWaitNotice).length]).toEqual([1, 1])
  // A second stop before the reset: no notice, no line, no second carry-on.
  await clock.advance(30 * 60_000)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toHaveLength(1)
  expect([w.toasts.filter(isWaitNotice).length, w.notices.filter(isWaitNotice).length]).toEqual([1, 1])
  expect(w.submitted).toEqual([])
  // To the reset and one tick past it: nothing yet, as Claude Code may carry on by itself (the grace).
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 60_000)
  expect(w.submitted).toEqual([])
  // Past the grace, no turn having run: one carry-on, on login 1, with no switch.
  await clock.advance(3 * 60_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.envSets).toEqual([])
  // No switch happened, so the carry-on says the limit reset, never that Claude Code switched.
  expect(w.submitted[0]).toMatch(/usage limit has reset\. Continue where you left off\.$/)
  expect(w.submitted[0]).not.toMatch(/switched/)
  expect(whats(stopLogOf(store, w))).toContain('a login is free: carry-on on 1')
  // Ten minutes on, still one carry-on and one notice.
  await clock.advance(10 * 60_000)
  expect(w.submitted).toHaveLength(1)
  expect([w.toasts.filter(isWaitNotice).length, w.notices.filter(isWaitNotice).length]).toEqual([1, 1])
})

test('a stop with no login left and no time known for any to free up logs the whole line "no login left: one carry-on once a login frees up" (puma-9arph.35, puma-9arph.109.8)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  // Both 5-hour windows are spent and the usage endpoint gives no reset time for either, so no login's freeing is dated.
  w.usage['tok-1'] = [100, 40]
  w.usage['tok-2'] = [100, 30]
  w.fiveHourResets = { 'tok-1': '', 'tok-2': '' }
  await start($, clock)
  // Login 2 needs a sign-in: the stop has no untried login to move to.
  store.set('health:2', { kind: 'login-needed', why: 'its sign-in has run out' })
  await untilTick(clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  // A fleet watchdog reads this line byte for byte.
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toEqual(['no login left: one carry-on once a login frees up'])
})

test('with every login spent, where a main turn starts after the login in use resets (Claude Code carrying on by itself), the mod sends no carry-on of its own (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toHaveLength(1)
  // Claude Code v2.1.325 continued a 5-hour stop by itself at the reset (puma-9arph.35 d5): a main turn starts.
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 30_000)
  await $.turn.start({ text: 'go on', turnId: 'turn-own-continue' })
  await clock.advance(10 * 60_000)
  expect(w.submitted).toEqual([])
  expect(whats(stopLogOf(store, w))).toContain('a turn ran since the stop: no carry-on')
})

test('with every login spent, a login whose usage read fails since the stop is still moved to at its reset, and one carry-on goes there (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  // Login 1's week is spent until 2026-10-18; login 2's 5-hour window frees it at 12:00.
  w.usage['tok-1'] = [40, 100]
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toEqual(['no login left: one carry-on at 2026-10-12T12:00:00.000Z'])
  // Every read of login 2 fails from now: at 12:00 the store still holds its 100%, read before its reset.
  w.failing = { 'tok-2': 429 }
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 60_000)
  expect(w.envSets.at(-1)?.value).toBe(SLOT2)
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  // The tick's own rotation moved there; the carry-on owed went on login 2, and says it switched.
  expect(w.submitted[0]).toMatch(/switched to another of your Claude accounts/)
  expect(whats(stopLogOf(store, w))).toContain('a login is free: carry-on on 2')
  // No second notice and no second carry-on on later ticks.
  await clock.advance(10 * 60_000)
  expect(w.submitted).toHaveLength(1)
  expect([w.toasts.filter(isWaitNotice).length, w.notices.filter(isWaitNotice).length]).toEqual([1, 1])
})

test('with every login spent, the tick at the reset switches to the freed login once, though the keychain answers late, and its carry-on goes (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [40, 100]
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toEqual(['no login left: one carry-on at 2026-10-12T12:00:00.000Z'])
  w.failing = { 'tok-2': 429 }
  const isSwitched = (t: unknown) => String(t).startsWith('Switched to ')
  const settleReal = async () => {
    await new Promise(resolve => setTimeout(resolve, 100))
    await clock.settle()
  }
  await clock.advance(Date.parse('2026-10-12T11:59:30Z') - clock.now())
  await settleReal()
  // On a Mac the keychain read before a switch takes milliseconds, long enough for a second job of the same tick to
  // reach the switch too: two switches, and the second ends the first one's carry-on.
  w.beforeKeychain = () => new Promise<void>(resolve => setTimeout(resolve, 5))
  // One tick at a time, each let finish in real time, as ticks a minute apart do: only a race inside one tick can make
  // a second switch.
  for (let i = 0; i < 3 && w.toasts.filter(isSwitched).length === 0; i += 1) {
    await clock.advance(60_000)
    await settleReal()
  }
  expect([w.envSets.at(-1)?.value, w.toasts.filter(isSwitched).length]).toEqual([SLOT2, 1])
  // The carry-on goes once that one tick's switch lands, not a tick later.
  await clock.advance(36_000)
  await settleReal()
  expect([whats(stopLogOf(store, w)).filter(x => x.startsWith('carry-on skipped')), w.submitted.length]).toEqual([[], 1])
  // Two more ticks: no second switch, no second carry-on.
  for (let i = 0; i < 2; i += 1) {
    await clock.advance(60_000)
    await settleReal()
  }
  expect([w.toasts.filter(isSwitched).length, w.submitted.length]).toEqual([1, 1])
})

test('with every login spent, a login a usage read frees before the time owed is moved to by the tick, and one carry-on still goes there, once (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [40, 100]
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toEqual(['no login left: one carry-on at 2026-10-12T12:00:00.000Z'])
  // Login 2 reads 10% at its next read: the tick's own rotation moves there with no carry-on of its own, and no response follows.
  w.usage['tok-2'] = [10, 30]
  await clock.advance(Date.parse('2026-10-12T11:45:00Z') - clock.now())
  expect(w.envSets.at(-1)?.value).toBe(SLOT2)
  expect(w.submitted).toHaveLength(1)
  expect(whats(stopLogOf(store, w))).toContain('a login is free: carry-on on 2')
  // The time owed passes: nothing more.
  await clock.advance(Date.parse('2026-10-12T12:10:00Z') - clock.now())
  expect(w.submitted).toHaveLength(1)
  expect([w.toasts.filter(isWaitNotice).length, w.notices.filter(isWaitNotice).length]).toEqual([1, 1])
})

test('with every login spent and no stop, the tick owes no carry-on: no notice, no line, nothing sent once a login frees up (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  // Both logins read spent before any turn: the tick's own rotation finds none to move to, with no stop to carry on.
  w.usage['tok-1'] = [100, 41]
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 10 * 60_000)
  expect([w.toasts.filter(isWaitNotice).length, w.notices.filter(isWaitNotice).length]).toEqual([0, 0])
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toEqual([])
  expect(w.submitted).toEqual([])
})

test('a rejected sign-in with every other login spent owes no carry-on: it waits for a person, as the README says (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 10 * 60_000)
  expect([w.toasts.filter(isWaitNotice).length, w.notices.filter(isWaitNotice).length]).toEqual([0, 0])
  expect(whats(stopLogOf(store, w)).filter(isWaitLine)).toEqual([])
})

test('a carry-on owed once a login frees up survives a hot reload, then /clear: the rebound view holds it again (puma-9arph.35)', async ($, on) => {
  const owed = { at: Date.parse('2026-10-12T12:00:00Z'), from: '1' }
  // The turns the reload counts from ride along: each reload counts them again.
  expect((await reloadThenClear($, on, { carryDue: owed }))?.carryDue).toMatchObject(owed)
})

test('a carry-on owed across a hot reload sends nothing where a main turn ran after the reload (puma-9arph.35)', { timeoutMs: 30_000 }, async ($, on) => {
  const { w, clock } = await reloadedWorld($, on, { carryDue: { at: Date.parse('2026-10-12T12:00:00Z'), from: '1' } })
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 30_000)
  await $.turn.start({ text: 'go on', turnId: 'turn-own-continue' })
  await clock.advance(10 * 60_000)
  expect(w.submitted).toEqual([])
})

test('with every login spent, the band says when the first login frees up (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [100, 41]
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  expect(await bandText($)).toMatch(/^Every Claude account is near its limit; the next frees up /)
})

// Codex round 1 [STALE_CARRY_DECISION]: the carry-on's decision is made again after the write that clears what is owed.
test('with every login spent, a main turn that starts during the write clearing the carry-on owed stops it from going (puma-9arph.35)', async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [100, 41]
  w.usage['tok-2'] = [100, 100]
  let isArmed = false
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    const isClearing = isArmed && key === 'view' && value.carryDue === undefined
    if (isClearing) isArmed = false
    const result = await next(e)
    if (isClearing) await $.turn.start({ text: 'continue', turnId: 'own-turn' })
    return result
  })
  await start($, clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  isArmed = true
  await clock.advance(Date.parse('2026-10-12T12:04:00Z') - clock.now())
  expect(w.submitted).toEqual([])
})

test('with every login spent, a switch to a spent login during the write clearing the carry-on owed sends nothing there (puma-9arph.35)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  const { clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [100, 41]
  w.usage['tok-2'] = [100, 100]
  let isArmed = false
  let switchToTwo = async () => {}
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    const isClearing = isArmed && key === 'view' && value.carryDue === undefined
    if (isClearing) isArmed = false
    const result = await next(e)
    if (isClearing) await switchToTwo()
    return result
  })
  await start($, clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  switchToTwo = async () => {
    await pane.press({ key: 'use-2' })
  }
  isArmed = true
  await clock.advance(Date.parse('2026-10-12T12:04:00Z') - clock.now())
  expect(w.envSets.at(-1)?.value).toBe(SLOT2)
  expect(w.submitted).toEqual([])
  await pane.unmount()
})

// ---------------------------------------------------------------- puma-9arph.84: a switch ends the carry-on owed

/** Every login spent, then a usage-limit stop on login 1: one carry-on is owed, at 12:00. */
async function spentAndOwedWorld($: Engine, on: On) {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  const view = watchedView(on)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect([whats(stopLogOf(store, w)).filter(isWaitLine).length, view()?.carryDue?.from]).toEqual([1, '1'])
  return { w, store, clock, view }
}

test('with every login spent, Use now pressed on another login ends the carry-on owed: nothing goes into the session once a login frees up (puma-9arph.84)', async ($, on) => {
  const { w, store, clock, view } = await spentAndOwedWorld($, on)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  await pane.unmount()
  const owedAfter = view()?.carryDue
  expect(w.envSets.at(-1)?.value).toBe(SLOT2)
  // Past the time owed and the grace, both logins free: the person moved the session, so nothing is sent.
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 10 * 60_000)
  expect([w.submitted.length, whats(stopLogOf(store, w)).filter(isOwedCarryOnLine), owedAfter]).toEqual([0, [], undefined])
})

test('with every login spent, `account use` of another login ends the carry-on owed: nothing goes into the session once a login frees up (puma-9arph.84)', async ($, on) => {
  const { w, store, clock, view } = await spentAndOwedWorld($, on)
  await untilTick(clock)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', store.get('store-id'), clock.now(), ownMark(w))
  await untilTick(clock)
  const owedAfter = view()?.carryDue
  expect(resultOf(w, N1)?.activeId).toBe('2')
  await clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 10 * 60_000)
  expect([w.submitted.length, whats(stopLogOf(store, w)).filter(isOwedCarryOnLine), owedAfter]).toEqual([0, [], undefined])
})

test('with every login spent, a later stop that moves to a login freed since ends the carry-on owed: its own carry-on is the one that goes (puma-9arph.84)', async ($, on) => {
  const { w, store, clock, view } = await spentAndOwedWorld($, on)
  // Between two ticks another session's read finds login 2 with room, and a stop comes before this session's tick moves there.
  await clock.advance(10 * 60_000 + 30_000)
  w.usage['tok-2'] = [10, 30]
  const read = store.get('usage:2') as { fiveHour: { pct: number } }
  store.set('usage:2', { ...read, fiveHour: { ...read.fiveHour, pct: 10 }, at: clock.now() })
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const owedAfter = view()?.carryDue
  expect(w.envSets.at(-1)?.value).toBe(SLOT2)
  await clock.advance(Date.parse('2026-10-12T12:10:00Z') - clock.now())
  expect([w.submitted.length, whats(stopLogOf(store, w)).filter(isOwedCarryOnLine), owedAfter]).toEqual([1, [], undefined])
})

test('with every login spent, Connect\'s visit to the extension\'s login leaves the carry-on owed: it goes once that login frees up (puma-9arph.84)', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const view = watchedView(on)
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  // Chrome opens in a second profile, signed in to login 2's account, and the person connects it there.
  w.chrome.extensions.push(SLOT2)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'chrome-try-2' })
  await clock.settle()
  await clock.advance(36_000)
  await pane.unmount()
  // With login 1 spent, the visit leaves the session on login 2; the carry-on owed stands.
  expect([w.envSets.at(-1)?.value, view()?.carryDue?.from]).toEqual([SLOT2, '1'])
  await clock.advance(Date.parse('2026-10-12T12:10:00Z') - clock.now())
  expect([w.submitted.length, whats(stopLogOf(store, w)).filter(isOwedCarryOnLine)]).toEqual([1, ['a login is free: carry-on on 2']])
})

test('with every login spent, Use now pressed during the write clearing the carry-on owed ends it: nothing goes there once that login frees up (puma-9arph.84)', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-1'] = [100, 41]
  w.usage['tok-2'] = [100, 30]
  let isArmed = false
  let switchToTwo = async () => {}
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    const isClearing = isArmed && key === 'view' && value.carryDue === undefined
    if (isClearing) isArmed = false
    const result = await next(e)
    if (isClearing) await switchToTwo()
    return result
  })
  await start($, clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  switchToTwo = async () => {
    await pane.press({ key: 'use-2' })
  }
  isArmed = true
  // Login 1's reset and its grace pass: the carry-on owed starts to go, and the press lands during its clearing write.
  await clock.advance(Date.parse('2026-10-12T12:04:00Z') - clock.now())
  expect([isArmed, w.envSets.at(-1)?.value]).toEqual([false, SLOT2])
  // Login 2 is free too since 12:00: the press moved the session there, so nothing is carried on.
  await clock.advance(10 * 60_000)
  expect([w.submitted.length, whats(stopLogOf(store, w)).filter(isOwedCarryOnLine)]).toEqual([0, []])
  await pane.unmount()
})

test('with every login spent, a second stop that rides the tick\'s own switch to the login freed ends the carry-on owed: its own carry-on, armed once, is the one that goes (puma-9arph.84)', async ($, on) => {
  const { w, store, clock, open } = await heldTickSwitchWorld($, on)
  // A second stop picks login 2 and rides the held switch, which lands before the next tick: that tick finds nothing owed.
  const stop = $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(5_000)
  open()
  await stop
  await clock.settle()
  await clock.advance(5 * 60_000)
  const lines = whats(stopLogOf(store, w))
  expect(w.envSets.at(-1)?.value).toBe(SLOT2)
  expect([lines.filter(isOwedCarryOnLine).length, lines.filter(x => x === 'carry-on armed').length, w.submitted.length]).toEqual([0, 1, 1])
})

/** Every login spent, a stop on login 1, then the tick's own switch to login 2 at its reset, held in its keychain read until `open`. */
async function heldTickSwitchWorld($: Engine, on: On) {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  const view = watchedView(on)
  w.usage['tok-1'] = [40, 100]
  w.usage['tok-2'] = [100, 30]
  await start($, clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  w.failing = { 'tok-2': 429 }
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
  await clock.advance(Date.parse('2026-10-12T11:59:30Z') - clock.now())
  for (let i = 0; i < 3 && !isGated; i += 1) await clock.advance(60_000)
  expect(isGated).toBe(true)
  return { w, store, clock, view, open }
}

test('with every login spent, a second stop that rides the tick\'s own switch, landing 35 s or more before the next tick, ends the carry-on owed: one carry-on goes (puma-9arph.84)', async ($, on) => {
  const { w, store, clock, open } = await heldTickSwitchWorld($, on)
  // The next tick comes 30 s on: the stop comes before it and rides the held switch, which lands after it.
  await clock.advance(25_000)
  const stop = $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(15_000)
  open()
  await stop
  await clock.settle()
  await clock.advance(5 * 60_000)
  const lines = whats(stopLogOf(store, w))
  // The second line would be the carry-on owed again, held back here only by the first one still in flight.
  expect([lines.filter(x => x === 'carry-on queued' || x.startsWith('carry-on not sent again')), lines.filter(isOwedCarryOnLine), w.submitted.length]).toEqual([['carry-on queued'], [], 1])
})

test('with every login spent, Use now on the login the tick\'s own switch is moving to ends the carry-on owed (puma-9arph.84)', async ($, on) => {
  const { w, store, clock, view, open } = await heldTickSwitchWorld($, on)
  const pane = await mountPane($)
  const pressed = pane.press({ key: 'use-2' })
  await clock.settle()
  open()
  await pressed
  await clock.settle()
  const owedAfter = view()?.carryDue
  await clock.advance(10 * 60_000)
  expect([w.envSets.at(-1)?.value, w.submitted.length, whats(stopLogOf(store, w)).filter(isOwedCarryOnLine), owedAfter]).toEqual([SLOT2, 0, [], undefined])
  await pane.unmount()
})

test('a stop where Claude Code\'s policy refuses switching logs that it stayed for that (puma-9arph.34 B4)', async ($, on) => {
  const w = fresh()
  w.refuseEnv = true
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toEqual([STOP_RATE_LIMIT, 'stayed: switching blocked'])
})

// ---------------------------------------------------------------- puma-9arph.37: a stop whose own read throws

/** PICKED_TWO where login 2's read, made at the start, is a minute old by the stop (pastLastRead). */
const PICKED_ONE_MIN = 'picked 2: fresh, read 1 min ago; tried 1'

const isReadFailed = (id: string) => (what: string) => new RegExp(`^stop read failed: \\w+, login ${id}$`).test(what)

test('a usage-limit stop whose own forced usage read throws still marks the login, moves and carries on once, and says so in the stop-log (puma-9arph.37)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await pastLastRead(clock)
  w.throwing = ['tok-1']
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(36_000)
  const lines = whats(stopLogOf(store, w))
  expect(lines[0]).toBe(STOP_SESSION)
  expect(lines.filter(isReadFailed('1'))).toHaveLength(1)
  expect(lines.filter(l => !isReadFailed('1')(l))).toEqual([STOP_SESSION, PICKED_ONE_MIN, 'moved to 2 (by a stop)', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
  expect(store.get('mark:1')).toBeDefined()
  expect(w.submitted).toHaveLength(1)
})

test('a usage-limit stop whose profile call throws, its sign-in new since the last check, still marks, moves and carries on once (puma-9arph.37)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await pastLastRead(clock)
  // A sign-in no holder names yet: the stop's read asks the profile first, and that call throws.
  w.keychain['Claude Code-credentials'] = blob('tok-9')
  w.profileThrowing = ['tok-9']
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(36_000)
  const lines = whats(stopLogOf(store, w))
  expect(lines.filter(isReadFailed('1'))).toHaveLength(1)
  expect(lines.filter(l => !isReadFailed('1')(l))).toEqual([STOP_SESSION, PICKED_ONE_MIN, 'moved to 2 (by a stop)', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
  expect(store.get('mark:1')).toBeDefined()
  expect(w.submitted).toHaveLength(1)
})

test('a Fable stop on the carry-on whose own read of the login moved to throws marks it as a stop with no read does (puma-9arph.37)', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on, false)
  await clock.advance(35_500)
  expect(w.submitted).toHaveLength(1)
  await resumeAnswers($, clock)
  w.throwing = ['tok-2']
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(whats(stopLogOf(store, w)).filter(isReadFailed('2'))).toHaveLength(1)
  expect(markOf(store.get('fable-mark:2'))).toEqual([100, FABLE_RESET])
})

// Review HOST-FAULT-MISCLASSIFIED (Codex round 1 on #100): a host fault INSIDE the stop's own read is a failed read, not
// the end of the recovery (RULING 6072): the stop goes on, and the line names the error. The class: both read sites.
test('Review HOST-FAULT-MISCLASSIFIED: a store write refused inside the stop\'s forced read still marks, moves and carries on, its line naming the error (puma-9arph.37)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await pastLastRead(clock)
  w.onStoreSet = key => {
    if (key === 'usage-due:1') throw new Error('store write refused at /secret/path')
  }
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(36_000)
  expect(whats(stopLogOf(store, w))).toEqual([STOP_SESSION, 'stop read failed: HooksError, login 1', PICKED_ONE_MIN, 'moved to 2 (by a stop)', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
  expect(store.get('mark:1')).toBeDefined()
  expect(w.submitted).toHaveLength(1)
})

test('Review HOST-FAULT-MISCLASSIFIED class: a store write refused inside the Fable carry-on stop\'s since-read marks it as a stop with no read does (puma-9arph.37)', async ($, on) => {
  const { w, store, clock } = await fableMoved($, on, false)
  await clock.advance(35_500)
  expect(w.submitted).toHaveLength(1)
  await resumeAnswers($, clock)
  w.onStoreSet = key => {
    if (key === 'usage-due:2') throw new Error('store write refused at /secret/path')
  }
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toContain('stop read failed: HooksError, login 2')
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('stop handling failed'))).toEqual([])
  expect(markOf(store.get('fable-mark:2'))).toEqual([100, FABLE_RESET])
})

// ---------------------------------------------------------------- puma-9arph.59: a stop whose own read hangs

/** How long the mod waits on a usage or profile read (READ_TIMEOUT_MS). */
const READ_TIMEOUT = 10_000

/** Holds the first fetch from now on open for good, as a read that never answers; counts the fetches. */
const holdFirstFetch = (w: World) => {
  const held = { fetches: 0 }
  w.beforeFetch = () => ((held.fetches += 1) === 1 ? new Promise<void>(() => {}) : Promise.resolve())
  return held
}

test('puma-9arph.59: a stop whose own usage read hangs times out, so a later main-loop stop is handled and the owed-resume look reaches the fill', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  // Under the rotation line while the forced read's gap passes, so no tick moves before the stop.
  w.usage['tok-1'] = [60, 40]
  await pastLastRead(clock)
  const held = holdFirstFetch(w)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  // A later stop of the main loop while the first one's read hangs: it waits on the lock that read holds.
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(READ_TIMEOUT + 36_000 + 15_000)
  const lines = whats(stopLogOf(store, w))
  expect(held.fetches, 'the stop made its own read').toBeGreaterThan(0)
  expect(lines.filter(isReadFailed('1'))).toEqual(['stop read failed: UsageReadTimedOut, login 1'])
  expect(lines.filter(l => l.startsWith('stop heard: rate_limit'))).toHaveLength(2)
  expect(lines).toContain(FILL_NO_CAUSE)
})

test('puma-9arph.59: a stop whose profile call hangs, its sign-in new since the last check, times out, marks, moves and carries on once', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await pastLastRead(clock)
  // A sign-in no holder names yet: the stop's read asks the profile first, and that call never answers.
  w.keychain['Claude Code-credentials'] = blob('tok-9')
  holdFirstFetch(w)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(READ_TIMEOUT + 36_000)
  const lines = whats(stopLogOf(store, w))
  expect(lines.filter(isReadFailed('1'))).toEqual(['stop read failed: ProfileReadTimedOut, login 1'])
  expect(lines.filter(l => !isReadFailed('1')(l))).toEqual([STOP_SESSION, PICKED_ONE_MIN, 'moved to 2 (by a stop)', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
  expect(store.get('mark:1')).toBeDefined()
  expect(w.submitted).toHaveLength(1)
})

// Review PREFETCH-READ (Codex round 1, RULING 6425): the stop's own read waits on the stored login before
// either fetch. Its first stage is held open, then let go, so only that one wait hangs.
for (const stage of ['the credential file read (Linux)', 'the keychain marker check (macOS)'] as const) {
  test(`Review PREFETCH-READ: a stop whose own wait on ${stage} hangs times out, so a later main-loop stop is handled (puma-9arph.59)`, async ($, on) => {
    const isLinux = stage.endsWith('(Linux)')
    const w = fresh(isLinux ? 'Linux' : 'macOS')
    if (isLinux) {
      w.files[FILE1] = blob('tok-1')
      w.files[FILE2] = blob('tok-2')
    }
    const { store, clock } = await loggedWorld(on, w)
    await start($, clock)
    await pastLastRead(clock)
    const held = new Promise<void>(() => {})
    if (isLinux) w.readGate = held
    else w.existsGate = held
    await $.classic.StopFailure(PLAIN)
    await clock.settle()
    w.readGate = undefined
    w.existsGate = undefined
    await $.classic.StopFailure(PLAIN)
    await clock.settle()
    await clock.advance(READ_TIMEOUT + 60_000)
    const lines = whats(stopLogOf(store, w))
    expect(lines.filter(isReadFailed('1'))).toContain('stop read failed: CredentialReadTimedOut, login 1')
    expect(lines.filter(l => l.startsWith('stop heard:'))).toHaveLength(2)
  })
}

// ---------------------------------------------------------------- puma-9arph.74: the refresh guard's read of the stored sign-in

/**
 * Holds every keychain read made while a switch owns the view, until `open()`, as a read that never answers; the
 * stop's own read and the looks' reads, made with no switch running, answer. `reads` counts the reads it held.
 */
const holdGuardRead = (w: World, view: () => View | undefined) => {
  let release = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const held = { reads: 0, open: () => release() }
  w.beforeKeychain = () => {
    if (view()?.owner === undefined) return Promise.resolve()
    held.reads += 1
    return gate
  }
  return held
}

const stopsHeard = (store: Map<string, unknown>, w: World) => whats(stopLogOf(store, w)).filter(l => l.startsWith('stop heard:'))

test('puma-9arph.74: a stop whose refresh guard read gets no answer holds the switch, and a later stop and the owed-resume look go on', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  const view = watchedView(on)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  const guard = holdGuardRead(w, view)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(READ_TIMEOUT + 1_000)
  expect(guard.reads, 'the guard read was made').toBeGreaterThan(0)
  // HOLD, never free: the switch did not land.
  expect(w.envSets.map(e => e.value)).not.toContain(SLOT2)
  expect(view()?.held?.target.id).toBe('2')
  // The lock is free: a later stop is heard, and the look reaches the refresh nudge's box read (nudgeIfDue), the one
  // prompt.read of a look while a stop's switch is held.
  let boxReads = 0
  w.onPromptRead = () => {
    boxReads += 1
  }
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  await clock.advance(READ_TIMEOUT + 16_000)
  expect(stopsHeard(store, w)).toHaveLength(2)
  expect(boxReads, 'the owed-resume look ran').toBeGreaterThan(0)
  // Once a read answers, the minute's retry lands the switch, once, and carries on once.
  guard.open()
  await clock.advance(60_000)
  await clock.advance(36_000)
  expect(w.envSets.filter(e => e.value === SLOT2)).toHaveLength(1)
  expect(w.submitted).toHaveLength(1)
})

test('puma-9arph.74: a refresh guard read the host refuses sets no hold and ends the stop as before', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  const view = watchedView(on)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  w.beforeKeychain = () => (view()?.owner === undefined ? Promise.resolve() : Promise.reject(new Error('refused')))
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(view()?.held).toBeUndefined()
  expect(view()?.owner).toBeUndefined()
  expect(w.envSets.map(e => e.value)).not.toContain(SLOT2)
  expect(whats(stopLogOf(store, w)).filter(l => l.startsWith('stop handling failed'))).toHaveLength(1)
  // The lock is free: a later stop is heard.
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(stopsHeard(store, w)).toHaveLength(2)
})

test('puma-9arph.74: a held switch whose minute retry finds the guard read refused keeps its hold, and lands once a read answers', async ($, on) => {
  const w = fresh()
  // Inside the refresh guard, and far enough from the expiry that no refresh nudge is due in the test.
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 7 * 60_000)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, new Map<string, unknown>(Object.entries(TWO_LOGINS)))
  const view = watchedView(on)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  expect(view()?.held?.target.id).toBe('2')
  w.beforeKeychain = () => (view()?.owner === undefined ? Promise.resolve() : Promise.reject(new Error('refused')))
  await clock.advance(60_000)
  // The refusal reaches the minute's catch: the hold stands, the switch is let go, and nothing moved.
  expect([view()?.held?.target.id, view()?.owner, slots(w)]).toEqual(['2', undefined, []])
  expect((w.logged ?? []).filter(l => l.includes('held switch retry failed'))).toHaveLength(1)
  w.beforeKeychain = undefined
  refresh(w)
  await clock.advance(60_000)
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
})

test('puma-9arph.74: Connect whose refresh guard read gets no answer moves no window and ends, so browser calls go on', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [40, 30]
  const view = watchedView(on)
  // Every keychain read gets no answer: the guard read Connect makes as the session opens among them.
  w.beforeKeychain = () => new Promise<void>(() => {})
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2', 'chrome-accounts': ['2'] })
  await start($, clock)
  await clock.advance(READ_TIMEOUT + 36_000)
  expect(slots(w)).not.toContain(SLOT2)
  expect(view()?.chromeConnecting).toBeUndefined()
  expect((await $.tool.check({ tool: 'mcp__claude-in-chrome__navigate', input: {} })).decision).toBe('allow')
})

test('puma-9arph.74: an owed-resume look whose prompt fill gets no answer sends no Escape, and a later stop is heard', async ($, on) => {
  const w = fresh()
  const { store, clock } = await owedWorld($, on, w)
  await pastLastRead(clock)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  w.fillHold = new Promise<void>(() => {})
  await clock.advance(36_000 + 16_000)
  expect(w.fills, 'the look reached its fill').toBeGreaterThan(0)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(READ_TIMEOUT + 1_000)
  expect(stopsHeard(store, w)).toHaveLength(2)
  expect(whats(stopLogOf(store, w))).toContain('owed resume: fill got no answer, no key')
})

test('puma-9arph.74: an own-continue look whose prompt fill gets no answer sends no Escape, and a later stop is heard', async ($, on) => {
  const w = fresh()
  countdownWorld(on, w)
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  await carryOnAnswers($, clock, w)
  w.fillHold = new Promise<void>(() => {})
  const fillsBefore = w.fills ?? 0
  await clock.advance(16_000)
  expect(w.fills ?? 0, 'the look reached its fill').toBeGreaterThan(fillsBefore)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  // Each look's fill waits up to the bound, the stop behind it.
  await clock.advance(READ_TIMEOUT + 1_000)
  expect(w.spawned).toEqual([])
  expect(stopsHeard(store, w)).toHaveLength(2)
})

test('a stop whose handling throws in a local step says so in the stop-log, by the error name alone (puma-9arph.37)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  w.onStoreSet = key => {
    if (key === 'mark:1') throw new Error('disk full at /secret/path')
  }
  await start($, clock)
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  // The host hands the mod its own error kind for a hook's throw; the message, with its path, stays out.
  expect(whats(stopLogOf(store, w))).toEqual([STOP_SESSION, 'stop handling failed: HooksError'])
})

test('a carry-on the engine refuses is logged in debug and in the stop-log as a drop, and is not submitted again (puma-9arph.34 B2)', async ($, on) => {
  const w = fresh()
  w.submitDrop = 'a Stop stands'
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  await clock.advance(10 * 60_000)
  expect(w.submitted).toHaveLength(1)
  expect(debugLines(w, 'carry-on dropped: a Stop stands')).toHaveLength(1)
  // The drop clears the in-flight flag, so the look finds nothing queued and says so, once (v4 s.3, C4).
  expect(whats(stopLogOf(store, w)).slice(-2)).toEqual(['carry-on drop', 'owed resume: no carry-on queued, no key'])
})

test('two sessions\' logs land under two keys, each untouched by the other (puma-9arph.34 B5)', async ($, on) => {
  const w = fresh()
  const other = [{ at: NOW - HOUR, what: 'stop heard: rate_limit, login 2 in use' }]
  const { store, clock } = await loggedWorld(on, w, { 'stop-log:session-other': other })
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  const mine = w.otherEnv.ACCOUNT_ROTATOR_SESSION
  expect(mine).toBeDefined()
  expect(mine).not.toBe('session-other')
  expect(store.get('stop-log:session-other')).toEqual(other)
  expect(whats(stopLogOf(store, w))[0]).toBe(STOP_RATE_LIMIT)
})

test('a boot drops a stop-log whose last entry is over 7 days old and keeps a fresher one (puma-9arph.34 B6)', async ($, on) => {
  const w = fresh()
  const stale = [{ at: NOW - 9 * DAY, what: 'a' }, { at: NOW - 8 * DAY, what: 'b' }]
  const fresh6 = [{ at: NOW - 9 * DAY, what: 'a' }, { at: NOW - 1 * DAY, what: 'b' }]
  const { store, clock } = await loggedWorld(on, w, { 'stop-log:stale': stale, 'stop-log:fresh': fresh6 })
  await start($, clock)
  expect(store.has('stop-log:stale')).toBe(false)
  expect(store.get('stop-log:fresh')).toEqual(fresh6)
})

test('a stop-log keeps its last 200 entries: the 51st to 200th stay and the 201st drops the oldest (puma-9arph.109.14)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w, { 'rotate-to': 'off' })
  await start($, clock)
  // The mark is made at start, so the seed lands after it; a recent `at` keeps the boot prune (already run) out of it.
  const seeded = Array.from({ length: 199 }, (_, i) => ({ at: NOW - HOUR, what: `seed ${i + 1}` }))
  store.set(`stop-log:${ownMark(w)}`, seeded)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  const entries = whats(stopLogOf(store, w))
  expect(entries).toHaveLength(200)
  expect(entries[0]).toBe('seed 2')
  expect(entries).toContain('seed 51')
  expect(entries).toContain('seed 199')
  expect(entries.slice(-2)).toEqual([STOP_RATE_LIMIT, 'stayed: rotation off'])
})

// A stop-log line of each shape register.tsx's logStop writes in a stop's recovery, for logs of other sessions.
const SAMPLE_STOP_LINES = [
  STOP_RATE_LIMIT,
  'read live before spent-old: 2',
  PICKED_TWO,
  'moved to 2 (by a stop)',
  'carry-on queued',
  'carry-on resolved',
  'work resumed on login 2',
  'own continue: armed',
  'owed resume: Escape 1 of 2 (exit 0)',
  'no login left: one carry-on at 2026-10-12T12:00:00.000Z',
]

test('31 stop-logs of 200 entries stay at about 400 KB of the 4 MiB store (puma-9arph.109.14)', async ($, on) => {
  const MAX_BYTES = 512_000
  const w = fresh()
  const others = Object.fromEntries(
    Array.from({ length: 30 }, (_, s) => [
      `stop-log:session-other-${s}`,
      Array.from({ length: 200 }, (_, i) => ({ at: NOW - HOUR, what: SAMPLE_STOP_LINES[i % SAMPLE_STOP_LINES.length] })),
    ]),
  )
  const { store, clock } = await loggedWorld(on, w, { 'rotate-to': 'off', ...others })
  await start($, clock)
  for (let i = 0; i < 100; i++) {
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.settle()
  }
  expect(stopLogOf(store, w)).toHaveLength(200)
  const keys = [...store.keys()].filter(k => k.startsWith('stop-log:'))
  expect(keys).toHaveLength(31)
  const size = keys.reduce((sum, k) => sum + JSON.stringify(store.get(k)).length, 0)
  expect(size).toBeLessThanOrEqual(MAX_BYTES)
})

// RULING 6007: the stop-log holds what happened, never a secret.
test('a stop-log holds no token, no email, no carry-on text and no engine reason (RULING 6007)', async ($, on) => {
  const w = fresh()
  w.submitDrop = 'queued for one@example.com with tok-2'
  const { store, clock } = await loggedWorld(on, w, { 'fable-continue-text': 'Go on on Fable-free ground.' })
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  const entries = stopLogOf(store, w)
  // The sweep must have looked at something: the stop, its move, the arming and the answer.
  expect(entries.length).toBeGreaterThanOrEqual(4)
  const text = JSON.stringify(entries)
  for (const secret of [...Object.values(w.keychain), 'tok-1', 'tok-2', 'refresh-tok', '@', 'Go on on Fable-free ground.', 'Continue where you left off', 'queued for', FABLE_STOP.last_assistant_message]) {
    expect(text).not.toContain(secret)
  }
  expect(entries.at(-1)?.what).toBe('carry-on drop')
})

// RULING 6014: a tick or a response may move to a login whose usage read failed; the stop-log names it.
test('a tick that moves to a login whose usage read failed, with no reading, logs it and sends no carry-on (RULING 6014)', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [92, 40]
  const failed = { 'check-error:2': { why: 'the usage call answered HTTP 429', at: NOW, isUsageRead: true }, 'usage-due:2': { next: NOW + HOUR, fails: 1, v: 1 } }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, ...failed }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.submitted).toEqual([])
  expect(whats(stopLogOf(store, w))).toEqual(['moved to 2 (by the tick or a response)', 'no carry-on after the move to 2: its usage read failed'])
})

test('a stop-log write that fails, its debug line failing too, leaves the stop-log writing the next entries (puma-9arph.34 C)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w, { 'rotate-to': 'off' })
  let isFailing = true
  w.onStoreSet = key => {
    if (isFailing && key.startsWith('stop-log:')) throw new Error('disk full')
  }
  w.isLogFailing = text => isFailing && text.includes('stop-log failed')
  await start($, clock)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  isFailing = false
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(whats(stopLogOf(store, w))).toEqual([STOP_RATE_LIMIT, 'stayed: rotation off'])
})

// ---------------------------------------------------------------- puma-9arph.34 C: one Escape frees a carry-on held under the limit modal
