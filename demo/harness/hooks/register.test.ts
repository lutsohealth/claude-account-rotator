import { expect, test } from 'claude-code/testing'

import { readingFromUsage } from '../../../hooks/model'
import { register } from './register'

// puma-eslxj.18 (RULING 4699): the harness refuses the real session's usage by what a value holds, under any key.

const MOD = 'account-rotator'
const NOW = 1_000
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const REFUSAL = 'the demo shows imitated usage only'
/** A reset no imitated login has. */
const REAL_RESET = '2030-01-02T03:04:05.000Z'
const REAL_READING = { fiveHour: { pct: 12, resetsAt: REAL_RESET }, sevenDay: { pct: 34, resetsAt: REAL_RESET }, at: NOW, by: '1', v: 1, src: 'response' }
const REAL_MARK = { pct: 100, resetsAt: REAL_RESET, at: NOW }

type Answer = { value?: unknown; deny?: string }
type Handler = (...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
register(((event: string, handler: Handler) => void handlers.set(event, handler)) as unknown as Parameters<typeof register>[0])

const $ = { clock: { now: async () => NOW, sleep: async () => {} } }
const nextFrom = (plugin: string) => Object.assign(async () => ({ value: 'passed on' }), { origin: { plugin } })
const call = (event: string, e: unknown, plugin = MOD) => handlers.get(event)?.($, e, nextFrom(plugin))

const set = (key: string, value: unknown, plugin = MOD) => call('store.set', { key, value }, plugin) as Promise<Answer>
const held = async (key: string) => ((await call('store.get', { key })) as Answer).value

/** A login's reading as the mod makes it, from the usage the harness answers. */
async function imitatedReading(id: string) {
  const init = { headers: { Authorization: `Bearer demo-${id}` } }
  const answer = (await call('http.fetch', { url: USAGE_URL, init })) as { value: { text: string } }
  const reading = readingFromUsage(JSON.parse(answer.value.text), NOW)
  // The sweep below would pass on a reading with no reset in it.
  expect([typeof reading?.fiveHour?.resetsAt, typeof reading?.sevenDay?.resetsAt]).toEqual(['string', 'string'])
  return reading
}

const REFUSED_WRITES: [string, unknown][] = [
  ['usage:1', REAL_READING],
  ['reading:1', REAL_READING],
  ['mark:1', REAL_MARK],
  ['week-mark:1', REAL_MARK],
  ['fable-mark:1', REAL_MARK],
  ['a-key-no-version-writes-yet:1', REAL_MARK],
  ['deep:1', { a: [{ b: REAL_MARK }] }],
]

test('a real reset is refused and not stored, under every key and at any depth', async () => {
  for (const [key, value] of REFUSED_WRITES) {
    expect([key, (await set(key, value)).deny, await held(key)]).toEqual([key, REFUSAL, undefined])
  }
})

test('a value that holds an imitated reset beside a real one is refused', async () => {
  const reading = await imitatedReading('1')
  const mixed = { ...reading, sevenDay: { pct: 34, resetsAt: REAL_RESET } }
  expect([(await set('usage:mixed', mixed)).deny, await held('usage:mixed')]).toEqual([REFUSAL, undefined])
})

test('each imitated login\'s reading is stored', async () => {
  for (const id of ['1', '2', '3']) {
    const reading = await imitatedReading(id)
    expect((await set(`usage:${id}`, reading)).deny).toBe(undefined)
    expect(await held(`usage:${id}`)).toEqual(reading)
  }
})

test('a stop mark at an imitated week reset is stored', async () => {
  const reading = await imitatedReading('2')
  const mark = { pct: 100, resetsAt: reading?.sevenDay?.resetsAt, at: NOW }
  expect((await set('week-mark:2', mark)).deny).toBe(undefined)
  expect(await held('week-mark:2')).toEqual(mark)
})

test('the login + Add a login signs in has its reading stored too', async () => {
  const spawned = call('process.spawn', { argv: ['claude', 'auth', 'login'], env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: '/home/you/.claude/accounts/7' } })
  for await (const _ of spawned as AsyncIterable<unknown>);
  const reading = await imitatedReading('7')
  expect((await set('usage:7', reading)).deny).toBe(undefined)
  expect(await held('usage:7')).toEqual(reading)
})

test('a value with no reset is stored', async () => {
  for (const [key, value] of [['rows', { v: 1, at: NOW, rows: [] }], ['no-five-hour:1', true], ['check-error:1', 'failed'], ['gone', null]] as const) {
    expect((await set(key, value)).deny).toBe(undefined)
    expect(await held(key)).toEqual(value)
  }
})

test('another plugin\'s write goes through, whatever it holds', async () => {
  expect(await set('usage:other', REAL_READING, 'another-plugin')).toEqual({ value: 'passed on' })
  expect(await held('usage:other')).toBe(undefined)
})
