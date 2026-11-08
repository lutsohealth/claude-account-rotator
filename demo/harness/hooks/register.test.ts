import { expect, test } from 'claude-code/testing'

import { readingFromUsage } from '../../../hooks/model'
import { register } from './register'

// puma-eslxj.18 (RULING 4699): the harness refuses the real session's usage by what a value holds, under any key.

const MOD = 'account-rotator'
const NOW = 1_000
/** A reset no imitated login has. */
const REAL_RESET = '2030-01-02T03:04:05.000Z'
const REAL_READING = { fiveHour: { pct: 12, resetsAt: REAL_RESET }, sevenDay: { pct: 34, resetsAt: REAL_RESET }, at: NOW, by: '1', v: 1, src: 'response' }
const REAL_MARK = { pct: 100, resetsAt: REAL_RESET, at: NOW }

type Answer = { value?: unknown; deny?: string }
type Handler = (...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
register(((event: string, handler: Handler) => void handlers.set(event, handler)) as unknown as Parameters<typeof register>[0], {})

const $ = { clock: { now: async () => NOW, sleep: async () => {} } }
const nextFrom = (plugin: string) => Object.assign(async () => ({ value: 'passed on' }), { origin: { plugin } })
const call = (event: string, e: unknown, plugin = MOD) => handlers.get(event)?.($, e, nextFrom(plugin))

const set = (key: string, value: unknown, plugin = MOD) => call('store.set', { key, value }, plugin) as Promise<Answer>
const held = async (key: string) => ((await call('store.get', { key })) as Answer).value
const written = async (key: string, value: unknown) => [(await set(key, value)).deny, await held(key)]
const expectRefused = async (key: string, value: unknown) => expect([key, ...(await written(key, value))]).toEqual([key, 'the demo shows imitated usage only', undefined])
const expectStored = async (key: string, value: unknown) => expect([key, ...(await written(key, value))]).toEqual([key, undefined, value])

/** A login's reading as the mod makes it, from the usage the harness answers. */
async function imitatedReading(id: string) {
  const init = { headers: { Authorization: `Bearer demo-${id}` } }
  const answer = (await call('http.fetch', { url: 'https://api.anthropic.com/api/oauth/usage', init })) as { value: { text: string } }
  const reading = readingFromUsage(JSON.parse(answer.value.text), NOW)
  // A reading with no reset in it would pass the rule unread.
  expect([typeof reading?.fiveHour?.resetsAt, typeof reading?.sevenDay?.resetsAt]).toEqual(['string', 'string'])
  return reading
}

test('a real reset is refused and not stored, under every key, at any depth and beside an imitated one', async () => {
  for (const key of ['usage:1', 'reading:1']) await expectRefused(key, REAL_READING)
  for (const key of ['mark:1', 'week-mark:1', 'fable-mark:1', 'a-key-no-version-writes-yet:1']) await expectRefused(key, REAL_MARK)
  await expectRefused('deep:1', { a: [{ b: REAL_MARK }] })
  await expectRefused('usage:mixed', { ...(await imitatedReading('1')), sevenDay: { pct: 34, resetsAt: REAL_RESET } })
})

test('each imitated login\'s reading, and a stop mark at its week reset, is stored', async () => {
  for (const id of ['1', '2', '3']) {
    const reading = await imitatedReading(id)
    await expectStored(`usage:${id}`, reading)
    await expectStored(`week-mark:${id}`, { pct: 100, resetsAt: reading?.sevenDay?.resetsAt, at: NOW })
  }
})

test('the login + Add a login signs in has its reading stored too', async () => {
  const spawned = call('process.spawn', { argv: ['claude', 'auth', 'login'], env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: '/home/you/.claude/accounts/7' } })
  for await (const _ of spawned as AsyncIterable<unknown>);
  await expectStored('usage:7', await imitatedReading('7'))
})

test('a value with no reset is stored', async () => {
  for (const [key, value] of [['rows', { v: 1, at: NOW, rows: [] }], ['no-five-hour:1', true], ['check-error:1', 'failed'], ['gone', null]] as const) await expectStored(key, value)
})

test('another plugin\'s write goes through, whatever it holds', async () => {
  expect(await set('usage:other', REAL_READING, 'another-plugin')).toEqual({ value: 'passed on' })
  expect(await held('usage:other')).toBe(undefined)
})

// puma-eslxj.31 (RULING 4705): `$.env.set` resolves to the engine's EnvSetResult, `{}` once the variable is set.
const SLOT_NAME = 'CLAUDE_SECURESTORAGE_CONFIG_DIR'
const SLOT_2 = '/home/you/.claude/accounts/2'
const setSlot = async (value: string) => ((await call('env.set', { name: SLOT_NAME, value })) as Answer).value
const slotInUse = async () => ((await call('env.get', { name: SLOT_NAME })) as Answer).value

test('a switch answers as the engine does and moves the imitated login', async () => {
  await setSlot('/home/you/.claude/accounts/3')
  expect([await setSlot(SLOT_2), await slotInUse()]).toEqual([{}, SLOT_2])
})

test('the slot in use answers as the engine does and stays', async () => {
  await setSlot(SLOT_2)
  expect([await setSlot(SLOT_2), await slotInUse()]).toEqual([{}, SLOT_2])
})

test('another variable goes on to the engine', async () => {
  expect(await call('env.set', { name: 'ACCOUNT_ROTATOR_SESSION', value: 'mark' })).toEqual({ value: 'passed on' })
})
