import { mock, test as kitTest } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunResult, SessionRateLimit, ToolCallArgs } from 'claude-code'
import type { StoredRows, View } from '../types'
import { EMPTY_VIEW, REQUEST_POLL_MS, USAGE_CLAIM_WAIT_MS, USAGE_FORCE_AFTER_MS, USAGE_IDLE_MS, blockedText, keychainItem, storedLineText } from './model'

/** The default timeout of a flow test: five files run in parallel, so a test can wait on a loaded machine. */
export const DEFAULT_TEST_TIMEOUT_MS = 30_000
const runKitTest = kitTest as (...args: unknown[]) => unknown
/**
 * The kit's `test` (`(name, ...rest) => collector.test(name, rest)`, rest being `[fn]` or `[options, fn]`), with
 * `timeoutMs` defaulted. A test's own options win, every field of them.
 */
export const test = ((name: string, ...rest: unknown[]) => {
  const [first] = rest
  if (typeof first === 'function') return runKitTest(name, { timeoutMs: DEFAULT_TEST_TIMEOUT_MS }, ...rest)
  if (typeof first === 'object' && first !== null) {
    return runKitTest(name, { timeoutMs: DEFAULT_TEST_TIMEOUT_MS, ...first }, ...rest.slice(1))
  }
  return runKitTest(name, ...rest)
}) as typeof kitTest

export const NOW = Date.parse('2026-10-12T10:00:00Z')

export const HOUR = 3600_000

export const HOME = '/Users/tester'

export const SLOT2 = `${HOME}/.claude/accounts/2`

/** Where Claude Code keeps logins 1 and 2 on Linux. */
export const FILE1 = `${HOME}/.claude/.credentials.json`

export const FILE2 = `${SLOT2}/.credentials.json`

export type World = {
  /** The machine: macOS has a file of its own a Linux machine lacks */
  system: 'macOS' | 'Linux'
  /** keychain item name -> stored JSON */
  keychain: Record<string, string>
  /** credentials file -> stored text, or null where it cannot be read; `$.fs.write` writes here too */
  files: Record<string, string | null>
  /** every path `$.fs.write` wrote, in order */
  writes?: string[]
  /**
   * access token -> [5-hour %, or null where the account reports no 5-hour window, week %, or null where the
   * plan reports no weekly limit], and the Fable week's % as a third member where the usage endpoint lists one
   */
  usage: Record<string, [number | null, number | null, number?]>
  /** access token -> the HTTP status the usage endpoint fails with, where it fails */
  failing?: Record<string, number>
  /** access token -> the Retry-After header a failing usage call carries, where it carries one */
  retryAfter?: Record<string, string>
  /** The access token of each usage call the mod made, in order. */
  usageCalls: string[]
  /** Access tokens whose usage call throws, as a dropped connection does. */
  throwing?: string[]
  /** access token -> when its week resets, as its usage body says; `WEEK_RESET` where unset */
  weekResets?: Record<string, string>
  /** access token -> the `five_hour` value its usage body carries, as given (`undefined` leaves the field out), over what `usage` says */
  fiveHourBody?: Record<string, unknown>
  /** access token -> when its 5-hour window resets, as its usage body says; 12:00Z on the test's day where unset */
  fiveHourResets?: Record<string, string>
  /** access token -> the HTTP status the profile endpoint fails with, where it fails */
  profileFailing?: Record<string, number>
  /** Access tokens whose profile call throws, as a dropped connection or a refused tunnel does. */
  profileThrowing?: string[]
  /** access token -> the email of the account it signs in, as the profile endpoint answers */
  owners: Record<string, string>
  /** access token -> the organization name its profile answers, where not 'Org' (a named owner's) */
  orgNames?: Record<string, string>
  /** access token -> the profile's `organization.plan_display_name`, where it names one */
  planNames?: Record<string, string>
  /** The token a /login signs in, where the session reads its sign-in, and its plan. */
  loginToken?: string
  loginPlan?: string
  /** slot -> signed-in email */
  emails: Record<string, string>
  envSets: { name: string; value?: string }[]
  /** The variables the mod set other than the slot, by name. */
  otherEnv: Record<string, string | undefined>
  /** What ACCOUNT_ROTATOR_SESSION held when the engine's own start ran. */
  markAtStart?: string
  /** Claude Code's security policy refuses every variable but the slot. */
  refuseMark?: boolean
  /** Names in a listed folder that are links, no plain files. */
  linkFiles?: string[]
  /** A look at a folder is refused. */
  listFails?: boolean
  /** path -> the modification time `$.fs.list` gives a listed file, epoch ms; 0 where unset. */
  mtimes?: Record<string, number>
  /** Every path `$.fs.read` was asked for, in order. */
  readPaths?: string[]
  /** The folders that exist under the accounts folder, signed in or not. */
  folders?: string[]
  /** How a `mkdir` fails, where it does. */
  mkdirFails?: 'exit' | 'refused'
  /** Who a press's `claude auth login` signs in. */
  loginEmail?: string
  /** How the store refuses the `store-id` key: its write, or its read and its write. */
  storeIdFails?: 'write' | 'read'
  /** The store refuses the read of every key that starts with this. */
  storeReadFails?: string
  /** The store refuses the write of every key that starts with this. */
  storeWriteFails?: string
  /** puma-9arph.26: the text of the mod's own bin/account-rotator-claude, as `$.fs.read` finds it under the plugin's folder. */
  ownLauncher?: string
  /** puma-9arph.26: every chmod, test, mv and rm the mod ran, as typed. */
  fileCommands?: string[]
  /** puma-9arph.26: what a write of the temporary launcher leaves on disk instead of its text, as an engine write that went wrong would. */
  temporaryStores?: string
  /** puma-9arph.26: chmod exits 0 and gives no mode, so `test -x` of the file exits 1. */
  isChmodIgnored?: boolean
  /** puma-9arph.26: which of chmod, mv and rm exits 1, or every one is refused as a managed policy does. */
  fileCommandFails?: 'chmod' | 'mv' | 'rm' | 'refused'
  /** puma-9arph.26: path -> the mode chmod gave it; `mv` carries a mode to its target. */
  modes?: Record<string, string>
  /** What the mod wrote to the debug log. */
  logged?: string[]
  /** Runs before each write of a shared store, to read what stood before it. */
  onStoreSet?: (key: string, value: unknown) => void
  /** Runs after each write of a shared store: another session's write that lands next. */
  afterStoreSet?: (key: string) => void
  /** Awaited once a read of a shared store has its value, before it answers: a read that comes back late. */
  afterStoreGet?: (key: string) => Promise<void>
  /** The slot of each `claude auth status` the mod ran. */
  statusAsked?: string[]
  /** Runs inside a `claude auth status`: what another session writes while this one waits on it. */
  onStatus?: () => void
  /** How a `claude auth status` fails, where it does: `exit` is exit 1 with no JSON, `other` exit 1 with another authMethod. */
  statusFails?: 'refused' | 'exit' | 'garbage' | 'timeout' | 'other'
  /** The slots whose sign-in Claude Code does not count: `claude auth status` there exits 1, authMethod none. */
  signedOut?: string[]
  /** The timeout of each `claude auth status` run without `--json` (a check's sign-in read). */
  statusTimeouts?: (number | undefined)[]
  /** The slot of each `claude auth logout` the mod ran. */
  logouts?: string[]
  /** What a `claude auth logout` answers, where it fails. */
  logoutFails?: { exitCode: number | null; stderr: string }
  /** While set, a Bash call runs until it settles. */
  bashRuns?: Promise<void>
  /** While set, a file read waits until it settles, so two readers overlap as the engine's hops can make them. */
  readGate?: Promise<void>
  /** While set, a file's existence check waits until it settles, as `readGate` does for a read. */
  existsGate?: Promise<void>
  spawned: { argv: readonly string[]; env?: Record<string, string> }[]
  submitted: string[]
  /** The engine refuses every submit with this reason, as a Stop that stands or a host's limit does. */
  submitDrop?: string
  /** While set, a submit stays queued until it settles, as under Claude Code's limit modal: it answers once the prompt enters. */
  submitHold?: Promise<void>
  /** The submit hook throws: the kit skips it and the mod's `$.prompt.submit` rejects (puma-9arph.86). */
  isSubmitThrown?: boolean
  /** A hook keeps the mod's fill out of the box, so the fill answers isFilled false with no cause. */
  isFillRefused?: boolean
  /** How many fills the mod made; while `fillHold` is set, a fill answers only once it settles; `isFillThrown` makes a fill throw. */
  fills?: number
  fillHold?: Promise<void>
  isFillThrown?: boolean
  /** What the prompt box holds, as `$.prompt.read` answers it; while `readHold` is set, the read answers once it settles. */
  draft?: string
  /** The pane's rendered lines, as `orca terminal read --screen --json` answers them; unset, that read fails. */
  screen?: string[]
  readHold?: Promise<void>
  /** Called as a read of the box begins, before `readHold`: a test knows the look has reached it. */
  onPromptRead?: () => void
  /** Called as a read of the pane's screen begins: a test acts between the look's fill and its key. */
  onScreenRead?: () => void
  /** Where it answers true, a debug line fails to write. */
  isLogFailing?: (text: string) => boolean
  /** Whether each line in `submitted` was sent as the person's own words (`asUser`), not under the mod's name. */
  asUser: boolean[]
  /** What the session's last response reported, as `$.session.usage()` answers it. */
  limits: SessionRateLimit[]
  /** Ids of the panes open now. */
  panes: string[]
  toasts: string[]
  /** What the mod sent through `ui.notify`, the terminal's own notice. */
  notices: string[]
  /** While set, a notice answers only once it settles: a notice the terminal never answers holds whatever waits on it. */
  notifyHold?: Promise<void>
  /** The terminal refuses every notice, which the mod meets as a rejection. */
  isNotifyRefused?: boolean
  /** When the Fable week the usage endpoint lists resets; `FABLE_RESET` where unset. */
  fableResets?: string
  /** access token -> when its Fable week resets, where the logins' Fable weeks reset apart; `fableResets` where unset */
  fableResetsBy?: Record<string, string>
  /** The session's environment beyond USER and HOME. */
  env: Record<string, string>
  /** Claude Code's security policy refuses every switch, as in a session on a Team seat. */
  refuseEnv?: boolean
  breakEnv?: boolean
  /** Awaited once a usage body is made, before it is answered: a body that comes back late, its numbers those of its own time. */
  afterUsageBody?: (token: string) => Promise<void>
  /** Awaited before each answer, so a press can finish during a usage read. */
  beforeFetch?: () => Promise<void>
  /** Awaited before each keychain answer, so a read can come back late, as on a real Mac. */
  beforeKeychain?: () => Promise<void>
  /** Awaited before each switch's slot write (never the start's), so a switch can hang where the engine sets no limit. */
  beforeEnv?: () => Promise<void>
  /** Awaited before a write of the slot already in use (the start's check), so it can land after a switch moved the slot. */
  beforeSameEnv?: () => Promise<void>
  /**
   * Claude in Chrome, where the session has it: the slots of the accounts a
   * Chrome extension is signed in to, one per Chrome profile, and the slot its
   * connection was made as.
   */
  chrome?: { extensions: string[]; as?: string }
  /** What every Claude in Chrome tool answers in place of the world's own answer, as an error where `isChromeError`. */
  chromeText?: string
  isChromeError?: boolean
  /** A second text block every Claude in Chrome answer carries after its first, as list_connected_browsers adds a note. */
  chromeNote?: string
  /** The slot in use at each of the mod's calls to Claude in Chrome, the session having it or not. */
  chromeAsked: string[]
  /** The slash commands the mod ran, as typed. */
  commands: string[]
}

/** Claude Code's words for a browser call that found no browser, as a session moved off its login gets them. */
export const NO_BROWSER =
  'Browser extension is not connected: the OAuth token Claude Code is using belongs to a different claude.ai account than the one Claude Code is logged in as. ' +
  'If CLAUDE_CODE_OAUTH_TOKEN is set in your shell or CI profile, unset it (or re-mint it for this account), then run /logout and /login in Claude Code and make sure the browser extension is signed into the same claude.ai account.'

export const blob = (token: string, expiresAt = NOW + 6 * HOUR, plan = 'max', tier?: string) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: `refresh-${token}`,
      expiresAt,
      refreshTokenExpiresAt: NOW + 20 * 24 * HOUR,
      scopes: ['user:inference', 'user:profile'],
      subscriptionType: plan,
      ...(tier === undefined ? {} : { rateLimitTier: tier }),
    },
  })

/** Who each login's token signs in, as the profile endpoint answers, where the test names no owner. */
export const OWNER_BY_NUMBER = ['one@example.com', 'two@example.com', 'three@example.com', 'four@example.com', 'five@example.com']

/** When the week of every login resets, unless the world names another for its token. */
export const WEEK_RESET = '2026-10-18T03:00:00Z'

/** When the Fable week of every login resets. */
export const FABLE_RESET = '2026-10-17T03:00:00Z'

/** One of the usage body's `limits` rows: a week scoped to a model. */
export const limitRow = (model: string, percent: number, resetsAt = FABLE_RESET) => ({
  kind: 'weekly_scoped',
  group: 'weekly',
  percent,
  resets_at: resetsAt,
  scope: { model: { display_name: model } },
})

export const ran = (exitCode: number, stdout: string): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

/** Whether the stop mark under `key` stands: stored, and no end record names it (a proven end writes the record and keeps the key). */
export function markStands(store: Map<string, unknown>, key: string): boolean {
  const mark = store.get(key) as { at?: number } | undefined
  const [, prefix, id] = /^(week-|fable-)?mark:(.+)$/.exec(key) ?? []
  const kind = prefix === undefined ? 'five' : prefix.slice(0, -1)
  return mark !== undefined && !store.has(`mark-end:${kind}:${id}:${mark.at}`)
}

/** `$.store` over `entries`, which the test writes mid-run as another session on the Mac would. */
export function sharedStore(on: On, entries: Map<string, unknown>, w: World): void {
  on('store.get', (_$, e) => {
    const isRefused = (e.key === 'store-id' && w.storeIdFails === 'read') || (w.storeReadFails !== undefined && e.key.startsWith(w.storeReadFails))
    if (isRefused) return { deny: 'store: refused' }
    const value = entries.get(e.key)
    return w.afterStoreGet === undefined ? { value } : w.afterStoreGet(e.key).then(() => ({ value }))
  })
  on('store.set', (_$, e) => {
    if (e.key === 'store-id' && w.storeIdFails !== undefined) return { deny: 'store: refused' }
    if (w.storeWriteFails !== undefined && e.key.startsWith(w.storeWriteFails)) return { deny: 'store: refused' }
    w.onStoreSet?.(e.key, e.value)
    entries.set(e.key, e.value)
    w.afterStoreSet?.(e.key)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    entries.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...entries.keys()] }))
}

/** Everything beneath the plugin: keychain or credentials files, `claude auth`, the usage API, the UI sinks. */
export function world(on: On, w: World, store: Record<string, unknown> | Map<string, unknown>): MockClock {
  const clock = mock.clock(on, { now: NOW })
  if (store instanceof Map) sharedStore(on, store, w)
  else mock.store(on, store)
  mock.env(on, { USER: 'tester', HOME, ...w.env })
  let slot = w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? ''
  on('env.set', async (_$, e) => {
    if (e.name !== 'CLAUDE_SECURESTORAGE_CONFIG_DIR') {
      if (w.refuseMark) return { deny: `env (managed): ${e.name} is not for plugins outside policy to change` }
      w.otherEnv[e.name] = e.value
      return { value: {} }
    }
    if (w.refuseEnv) return { deny: `env (managed): ${e.name} is not for plugins outside policy to change` }
    if (w.breakEnv) return { deny: 'no policy said this' }
    // The mod sets the slot in use at its start, to learn whether it may switch: not a switch. Held, it can land after
    // a switch moved the slot, and then it moves the slot back, as the engine would.
    if ((e.value ?? '') === slot && w.beforeSameEnv !== undefined) await w.beforeSameEnv()
    if ((e.value ?? '') === slot) return { value: {} }
    await w.beforeEnv?.()
    slot = e.value ?? ''
    w.envSets.push(e)
    return { value: {} }
  })
  on('process.run', async (_$, e) => {
    const [cmd, sub, verb] = e.argv
    if (cmd === 'orca' && sub === 'terminal' && verb === 'read') {
      w.onScreenRead?.()
      return { value: w.screen === undefined ? ran(1, '') : ran(0, JSON.stringify({ result: { terminal: { source: 'screen', tail: w.screen } } })) }
    }
    if (cmd === 'security') {
      await w.beforeKeychain?.()
      const stored = w.keychain[e.argv[e.argv.length - 1] ?? '']
      return { value: stored === undefined ? ran(44, '') : ran(0, stored) }
    }
    if (cmd === 'mkdir') {
      if (w.mkdirFails === 'refused') return { deny: 'process (managed): mkdir is not for plugins to run' }
      if (w.mkdirFails === 'exit') return { value: { ...ran(1, ''), stderr: 'mkdir: Permission denied' } }
      if (sub === '-p') return { value: ran(0, '') }
      if ((w.folders ?? []).includes(sub ?? '')) return { value: { ...ran(1, ''), stderr: 'mkdir: File exists' } }
      w.folders = [...(w.folders ?? []), sub ?? '']
      return { value: ran(0, '') }
    }
    if (cmd === 'claude' && sub === 'auth' && verb === 'status') {
      w.statusAsked = [...(w.statusAsked ?? []), e.init?.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? '']
      if (!e.argv.includes('--json')) w.statusTimeouts = [...(w.statusTimeouts ?? []), e.init?.timeoutMs]
      w.onStatus?.()
      if (w.statusFails === 'refused') return { deny: 'process (managed): claude is not for plugins to run' }
      if (w.statusFails === 'exit') return { value: ran(1, '') }
      if (w.statusFails === 'garbage') return { value: ran(0, 'not json') }
      if (w.statusFails === 'timeout') return { value: { ...ran(0, ''), exitCode: null } }
      if (w.statusFails === 'other') return { value: ran(1, JSON.stringify({ loggedIn: false, authMethod: 'api_key' })) }
      // The documented shape (https://code.claude.com/docs/en/cli-reference): exit 0 if logged in, 1 if not; authMethod.
      const asked = e.init?.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? ''
      if ((w.signedOut ?? []).includes(asked)) return { value: ran(1, JSON.stringify({ loggedIn: false, authMethod: 'none' })) }
      const email = w.emails[asked]
      const named = email ? { email, orgId: `org-${email}`, orgName: 'Org', subscriptionType: 'max' } : {}
      return { value: ran(0, JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', ...named })) }
    }
    if (cmd === 'chmod' || cmd === 'test' || cmd === 'mv' || cmd === 'rm') {
      w.fileCommands = [...(w.fileCommands ?? []), e.argv.join(' ')]
      if (w.fileCommandFails === 'refused') return { deny: `process (managed): ${cmd} is not for plugins to run` }
      if (w.fileCommandFails === cmd) return { value: { ...ran(1, ''), stderr: `${cmd}: failed` } }
      w.modes = w.modes ?? {}
      if (cmd === 'chmod' && !w.isChmodIgnored) w.modes[e.argv[2] ?? ''] = sub ?? ''
      if (cmd === 'test') return { value: ran(sub === '-x' && w.modes[e.argv[2] ?? ''] === '755' ? 0 : 1, '') }
      if (cmd === 'mv') {
        const [from, to] = [e.argv[2] ?? '', e.argv[3] ?? '']
        w.files[to] = w.files[from] ?? null
        if (w.modes[from] !== undefined) w.modes[to] = w.modes[from]
        delete w.files[from]
        delete w.modes[from]
      }
      if (cmd === 'rm') delete w.files[e.argv[2] ?? '']
      return { value: ran(0, '') }
    }
    if (cmd === 'claude' && sub === 'auth' && verb === 'logout') {
      w.logouts = [...(w.logouts ?? []), e.init?.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? '']
      return { value: { ...ran(0, ''), ...w.logoutFails } }
    }
    throw new Error(`unexpected command: ${e.argv.join(' ')}`)
  })
  on('http.fetch', async (_$, e) => {
    await w.beforeFetch?.()
    const token = (e.init?.headers?.Authorization ?? '').replace('Bearer ', '')
    if (e.url === 'https://api.anthropic.com/api/oauth/profile') {
      if (w.profileThrowing?.includes(token)) throw new Error('socket hang up')
      const profileFailing = w.profileFailing?.[token]
      if (profileFailing !== undefined) return { value: { status: profileFailing, ok: false, headers: {}, text: '' } }
      // A token the test names no owner for signs in the login its number says: tok-2 is two@example.com's.
      const email = w.owners[token] ?? OWNER_BY_NUMBER[Number(/^tok-(\d)$/.exec(token)?.[1] ?? 0) - 1]
      if (email === undefined) return { value: { status: 404, ok: false, headers: {}, text: '' } }
      // A named owner's profile names its organization; a default owner's names none, so its login keeps its label.
      const orgName = w.orgNames?.[token] ?? (w.owners[token] === undefined ? undefined : 'Org')
      const planName = w.planNames?.[token]
      const profile = {
        account: { uuid: `account-${email}`, email },
        organization: {
          uuid: `org-${email}`,
          ...(orgName === undefined ? {} : { name: orgName }),
          organization_type: 'claude_max',
          ...(planName === undefined ? {} : { plan_display_name: planName }),
        },
      }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(profile) } }
    }
    w.usageCalls.push(token)
    if (w.throwing?.includes(token)) throw new Error('socket hang up')
    const failing = w.failing?.[token]
    const retryAfter = w.retryAfter?.[token]
    if (failing !== undefined) return { value: { status: failing, ok: false, headers: retryAfter === undefined ? {} : { 'retry-after': retryAfter }, text: '' } }
    const usage = w.usage[token]
    if (usage === undefined) return { value: { status: 401, ok: false, headers: {}, text: '' } }
    const [five, week, fable] = usage
    const body = {
      five_hour: w.fiveHourBody !== undefined && token in w.fiveHourBody ? w.fiveHourBody[token] : five === null ? null : { utilization: five, resets_at: w.fiveHourResets?.[token] ?? '2026-10-12T12:00:00Z' },
      seven_day: week === null ? null : { utilization: week, resets_at: w.weekResets?.[token] ?? WEEK_RESET },
      // A row for another model beside the Fable one, spent: read as Fable's, it would show.
      ...(fable === undefined ? {} : { limits: [limitRow('Sonnet', 100), limitRow('Fable 5.1', fable, w.fableResetsBy?.[token] ?? w.fableResets)] }),
    }
    await w.afterUsageBody?.(token)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  // Claude Code keeps a /login's sign-in where the session reads its own: the slot it is on.
  on('command.run', { command: 'login' }, async () => {
    if (w.loginToken !== undefined) w.keychain[await keychainItem(slot)] = blob(w.loginToken, NOW + 6 * HOUR, w.loginPlan)
    return { text: 'Login successful' }
  })
  // Claude in Chrome connects at its first call, as the slot the session is on then, until `/mcp reconnect`;
  // a browser answers only where that is an account a Chrome extension is signed in to.
  const isAnswered = (chrome: NonNullable<World['chrome']>) => {
    chrome.as ??= slot
    return chrome.extensions.includes(chrome.as)
  }
  // What list_connected_browsers answers: an empty list, no error, where no browser answers.
  const browsers = (chrome: NonNullable<World['chrome']>) =>
    JSON.stringify(isAnswered(chrome) ? [{ deviceId: 'device-1', name: 'Browser 1', osPlatform: 'macOS', isLocal: true }] : [])
  const note = () => (w.chromeNote === undefined ? [] : [{ type: 'text' as const, text: w.chromeNote }])
  on('mcp.call', (_$, e) => {
    w.chromeAsked.push(slot)
    if (w.chrome === undefined) return { deny: `no connected MCP tool "${e.tool}" on a server named "${e.server}"` }
    return { value: { content: [{ type: 'text', text: browsers(w.chrome) }, ...note()], isError: false } }
  })
  on('tool.call', { tool: /^mcp__claude-in-chrome__/ }, (_$, e) => {
    const text = w.chromeText ?? (w.chrome !== undefined && e.tool.endsWith('__list_connected_browsers') ? browsers(w.chrome) : undefined)
    const blocks = [{ type: 'text' as const, text: text ?? '' }, ...note()]
    if (text !== undefined) return w.isChromeError === true ? { isError: true as const, result: text, text } : { result: blocks, text: blocks.map(b => b.text).join('\n') }
    if (w.chrome !== undefined && isAnswered(w.chrome)) return { result: [{ type: 'text', text: 'Tabs: none' }], text: 'Tabs: none' }
    return { isError: true as const, result: NO_BROWSER, text: NO_BROWSER }
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    await w.bashRuns
    return { result: 'ran', text: 'ran' } as never
  })
  on('command.run', { command: 'mcp' }, (_$, e) => {
    w.commands.push(`/mcp ${e.args}`)
    if (w.chrome !== undefined && e.args === 'reconnect claude-in-chrome') delete w.chrome.as
    return { text: 'Successfully reconnected to claude-in-chrome' }
  })
  on('prompt.submit', async (_$, e) => {
    w.submitted.push(e.text)
    w.asUser.push(e.origin.kind === 'plugin' && e.origin.asUser === true)
    if (w.isSubmitThrown === true) throw new Error('the submit broke')
    await w.submitHold
    if (w.submitDrop !== undefined) return { drop: w.submitDrop }
    return { text: e.text }
  })
  // The kit keeps no cause a test writes on the mod's own fill: a refusal here is a hook's, never the engine's 'dialog'.
  on('prompt.fill', async () => {
    w.fills = (w.fills ?? 0) + 1
    if (w.isFillThrown === true) throw new Error('the fill broke')
    await w.fillHold
    return { isFilled: w.isFillRefused !== true, text: w.draft ?? '' }
  })
  on('prompt.read', async () => {
    w.onPromptRead?.()
    await w.readHold
    return { value: { text: w.draft ?? '', cursor: 0 } }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.start', (_$, e) => {
    w.markAtStart = w.otherEnv.ACCOUNT_ROTATOR_SESSION
    return { cwd: e.cwd }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 'session-1' }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: w.limits } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('classic.StopFailure', () => ({}))
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    // puma-9arph.41: a field that names the switch changes only through writeSwitch; any other writer fails the run.
    if (e.text.includes('switch field written outside writeSwitch')) throw new Error(`a stray switch write: ${e.text}`)
    if (w.isLogFailing?.(e.text) === true) throw new Error('log refused')
    w.logged = [...(w.logged ?? []), e.text]
    return { value: undefined }
  })
  on('ui.notify', (_$, e) => {
    w.notices.push(e.text)
    const answer = w.isNotifyRefused === true ? { deny: 'notify: refused' } : { value: { isSent: true, channel: 'iterm2' } as const }
    return w.notifyHold === undefined ? answer : w.notifyHold.then(() => answer)
  })
  on('ui.open', (_$, e) => {
    if (!w.panes.includes(e.id)) w.panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.close', (_$, e) => {
    w.panes = w.panes.filter(id => id !== e.id)
    return { value: undefined }
  })
  on('fs.write', (_$, e) => {
    w.files[e.path] = e.path.endsWith('/claude.new') && w.temporaryStores !== undefined ? w.temporaryStores : e.text
    w.writes = [...(w.writes ?? []), e.path]
    return { value: undefined }
  })
  on('fs.list', (_$, e) => {
    const names = Object.keys(w.files).filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
    if (w.listFails) return { deny: `EACCES: permission denied, scandir '${e.path}'` }
    if (names.length === 0) return { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
    return { value: names.map(p => ({ name: p.slice(e.path.length + 1), kind: (w.linkFiles ?? []).includes(p.slice(e.path.length + 1)) ? 'other' : 'file', size: (w.files[p] ?? '').length, mtimeMs: w.mtimes?.[p] ?? 0, isLink: false })) }
  })
  on('fs.exists', async (_$, e) => {
    await w.existsGate
    return { value: (e.path === '/System/Library/CoreServices/SystemVersion.plist' && w.system === 'macOS') || (w.folders ?? []).includes(e.path) }
  })
  on('fs.read', async (_$, e) => {
    w.readPaths = [...(w.readPaths ?? []), e.path]
    await w.readGate
    // puma-9arph.26: the mod's own launcher file, wherever the host puts the plugin's folder.
    if (w.ownLauncher !== undefined && e.path.endsWith('/bin/account-rotator-claude')) return { value: w.ownLauncher }
    const text = w.files[e.path]
    if (text === null) return { deny: `EACCES: permission denied, open '${e.path}'` }
    return text === undefined ? { deny: `ENOENT: no such file or directory, open '${e.path}'` } : { value: text }
  })
  return clock
}

export const fresh = (system: World['system'] = 'macOS'): World => ({
  system,
  keychain: {},
  files: {},
  usage: {},
  usageCalls: [],
  owners: {},
  emails: {},
  envSets: [],
  otherEnv: {},
  spawned: [],
  submitted: [],
  asUser: [],
  limits: [],
  panes: [],
  toasts: [],
  notices: [],
  env: {},
  chromeAsked: [],
  commands: [],
})

export const TWO_LOGINS ={ accounts: [{ id: '1', slot: '', email: 'one@example.com' }, { id: '2', slot: SLOT2, email: 'two@example.com' }] }

/** What a refused switch says in the world's session, on login 1, Claude Code's login. */
export const BLOCKED_ON_LOGIN = blockedText({ ...EMPTY_VIEW, ...TWO_LOGINS, activeId: '1', sessionId: 'session-1' })

/** The props of every Text drawn with a color or on one, its hover with them, in document order. */
export function painted(node: unknown): Record<string, unknown>[] {
  if (typeof node !== 'object' || node === null) return []
  const { type, props, hover, children } = node as { type?: string; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
  const isPainted = props?.color !== undefined || props?.backgroundColor !== undefined
  const own = type === 'Text' && isPainted ? [{ ...props, ...(hover === undefined ? {} : { hover }) }] : []
  return [...own, ...(children ?? []).flatMap(painted)]
}

/** The footer's one control: its glyphs, opening the pane. */
export const GLYPHS = { key: 'accounts' } as const

export const PANE_PROPS = {
  title: 'Claude accounts',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

/** Lets the last usage read pass a minute old: a stop, a /login or a sign-in reads the usage again only then. */
export const pastLastRead = (clock: MockClock) => clock.advance(USAGE_FORCE_AFTER_MS + 1000)

/** Lets the schedule come round for a login no response read: the 10-minute check reads it again. */
export const pastNextRead = (clock: MockClock) => clock.advance(USAGE_IDLE_MS)

/**
 * Starts the session and lets boot finish, its usage claims' wait included. A tick or a response moves a session only
 * while its main loop is failed (red in Orca), so unless a test is about that hold (`isClean`), the session starts red:
 * a main-loop StopFailure of an error that switches nothing, heard before boot.
 */
export async function start($: Engine, clock: MockClock, isClean = false): Promise<void> {
  if (!isClean) await $.classic.StopFailure({ error: 'server_error' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
}

/**
 * The resume a stop's carry-on starts, answering: the main loop's turn begins (the resume entered) and ends with an
 * answer, which ends the stop's episode (v4 s.2), so the next stop opens an episode of its own.
 */
export async function resumeAnswers($: Engine, clock: MockClock, turnId = 'resumed'): Promise<void> {
  await $.turn.start({ text: 'go on', turnId })
  await $.turn.complete({ turnId, reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.settle()
}

/** The stop of a turn that used up the Fable week, as Claude Code reports it. */
export const FABLE_STOP = {
  error: 'rate_limit',
  last_assistant_message: "You've reached your Fable limit. Switch to another model to continue.",
}

/** The same stop as Claude Code 2.1.325 and later words it. */
export const FABLE_HIT_STOP = { error: 'rate_limit', last_assistant_message: "You've hit your Fable limit · resets Nov 18 at 3pm" }

/** What Claude says when a turn dies on a limit that is not the Fable week. */
// v4 s.7: a wording that names no limit the mod knows ('Claude usage limit reached.') is read as no wording, so a spent
// Fable week makes it a Fable stop (row u's test); the plain stops here each name the 5-hour window.
export const PLAIN_STOPS = ["You've hit your session limit · resets 3pm", "You've hit your 5-hour limit"]

// puma-eslxj.29 [HELD-LOST-AT-RELOAD] (RULING 4708): the kit cannot reload a module, so these pin what survives one.
export function watchedView(on: On): () => View | undefined {
  let view: View | undefined
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view') view = value
    return next(e)
  })
  return () => view
}

export const SLOT3 = `${HOME}/.claude/accounts/3`

export const THREE_LOGINS = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }] }

/** The person types /login at the prompt. */
export const LOGIN = { command: 'login', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

export const pressPane = async ($: Engine, clock: MockClock, keys: string[]): Promise<void> => {
  const pane = await mountPane($)
  for (const key of keys) {
    await pane.press({ key })
    await clock.settle()
    await pane.redraw()
  }
  await pane.unmount()
}

// puma-9arph.10: a hot reload empties the module's `kept` while the view survives it; boot copies the surviving view's
// Fable stop mark into `kept`, so a /clear after the reload gives it back.
/** A session whose view survived a reload as `surviving` (none: a fresh start), then a /clear: the view the rebind wrote. */
export async function reloadThenClear($: Engine, on: On, surviving: Partial<View> | undefined): Promise<View | undefined> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30, 100]
  let phase: 'reloaded' | 'live' | 'cleared' = surviving === undefined ? 'live' : 'reloaded'
  let last: View | undefined
  on('state.get', async (_$, e, next) => {
    const read = await next(e)
    if (e.plugin !== 'account-rotator' || e.key !== 'view' || phase === 'live') return read
    // Until the mod writes the view again: the view the reload kept, or the default a /clear leaves.
    const value = phase === 'reloaded' ? { ...EMPTY_VIEW, ...TWO_LOGINS, activeId: '1', isBound: true, ...surviving } : EMPTY_VIEW
    return { value: { value, version: read.value?.version ?? 0 } }
  })
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view') {
      phase = 'live'
      last = value
    }
    return next(e)
  })
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  await endSession($, clock, 'clear')
  phase = 'cleared'
  await $.classic.SessionStart({ source: 'clear' } as never)
  await clock.settle()
  return last
}

export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 9 }, view: {} } as const

/**
 * A call to one of Claude in Chrome's tools, as Claude makes one: its input
 * typed loosely, as the type root lists only the MCP tools this machine has.
 */
export const browse = ($: Engine, tool: string, args: Record<string, unknown> = {}) =>
  $.tool.call({ tool: `mcp__claude-in-chrome__${tool}`, ...args } as unknown as ToolCallArgs)

/** Login 1 with room and login 2 spent, both signed in. */
export async function spentTwo(w: World): Promise<void> {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [100, 30]
}

export const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })

export const mountBand = ($: Engine) => $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })

export const slots = (w: World) => w.envSets.map(e => e.value ?? '')

// Claude in Chrome answers list_connected_browsers with the list, then a note block naming the browser in use.
export const NOTE = '1 browser is connected; "Browser 1" (deviceId device-1) is the one picked last and will be used.'

/** Claude Code refreshes login 1's token: the next try at the switch goes through. */
export const refresh = (w: World) => {
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 8 * HOUR)
}

/** How many usage calls the mod made with `token`. */
export const callsWith = (w: World, token: string) => w.usageCalls.filter(t => t === token).length

/** A response's rate limits: the 5-hour window and the week, in percent used, and when the week resets. */
export const limitsOf = (five: number, week: number, weekReset = '2026-10-18T03:00:00Z'): SessionRateLimit[] => [
  { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-12T12:00:00Z' },
  { kind: 'seven_day', percentUsed: week, resetsAt: weekReset },
]

/** A response measured with the world's limits, and what it set off run out. */
export async function respond($: Engine, clock: MockClock, w: World): Promise<void> {
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
}

/** Account 2's week resets a day before account 1's, so a response tells by its reset whose week it is. */
export const OTHER_WEEK = '2026-10-17T05:00:00Z'

/** Every text the pane draws, one per line. */
export async function paneText($: Engine): Promise<string> {
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')
  await pane.unmount()
  return texts.join('\n')
}

/**
 * A switch to login 2 by Use now, unproven by any response, with a turn dying on a limit `delay` after it; `last`,
 * where given, the response measured between, by whose week it says which login it spent.
 */
export async function stopDuringSwitch(
  $: Engine,
  on: On,
  delay: number,
  said: string,
  last?: SessionRateLimit[],
  usage: Partial<World['usage']> = {},
): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = usage['tok-1'] ?? [10, 40]
  w.usage['tok-2'] = usage['tok-2'] ?? [10, 41]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  await pane.unmount()
  if (last !== undefined) {
    await clock.advance(SETTLE_WAIT)
    w.limits = last
    await respond($, clock, w)
  }
  await clock.advance(delay)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: said })
  await clock.settle()
  return { w, store, clock }
}

/** Past the 35 s a switch takes to land. */
export const SETTLE_WAIT = 36_000

/** The band's text above the prompt, or '' where no band is drawn. */
export async function bandText($: Engine): Promise<string> {
  try {
    const band = await mountBand($)
    const texts = (await band.findAll({ type: 'Text' })).map(t => t.text ?? '')
    await band.unmount()
    return texts.join('\n')
  } catch (error) {
    if (/no implementation for ui\.render/.test(String(error))) return ''
    throw error
  }
}

// puma-eslxj.17: every path that ends an unproven switch without proof reverts the stop it marked provisionally.

/** Presses Use now on `id` in the pane. */
export async function useNow($: Engine, clock: MockClock, id: string): Promise<void> {
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: `use-${id}` })
  await clock.settle()
  await pane.unmount()
}

/** Ends the session with the engine's reason word: by default as /exit does. */
export async function endSession($: Engine, clock: MockClock, reason = 'prompt_input_exit'): Promise<void> {
  await $.session.end({ reason, sessionId: 'session-1', resume: { id: 'session-1' } } as Parameters<Engine['session']['end']>[0])
  await clock.settle()
}

// puma-9arph.3: /clear, /resume and /branch reset every $.state value to its default, and session.start does not fire
// again; classic.SessionStart fires after each, with source clear, resume or fork. The kit never resets $.state, so
// `clearable` does: after `clear()` a read of the view finds the default until the mod writes the view again, and
// `view()` is what such a read finds, and `writes()` every view written.
export function clearable(on: On): { clear: () => void; view: () => View | undefined; writes: () => View[] } {
  let isCleared = false
  let last: View | undefined
  const written: View[] = []
  on('state.get', async (_$, e, next) => {
    const read = await next(e)
    if (!isCleared || e.plugin !== 'account-rotator' || e.key !== 'view') return read
    return { value: { value: EMPTY_VIEW, version: read.value?.version ?? 0 } }
  })
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view') {
      isCleared = false
      last = value
      written.push(value)
    }
    return next(e)
  })
  return { clear: () => { isCleared = true }, view: () => (isCleared ? EMPTY_VIEW : last), writes: () => [...written] }
}

/** A reset as Claude Code runs it: the session ends for /clear or /resume (no end is fired for fork), $.state resets, classic.SessionStart fires. */
export async function clearSession($: Engine, clock: MockClock, clear: () => void, source: 'clear' | 'resume' | 'fork' = 'clear'): Promise<void> {
  if (source !== 'fork') await endSession($, clock, source)
  clear()
  await $.classic.SessionStart({ source } as never)
  await clock.settle()
}

/** What the pane draws after each `Fable` row's label, in order: one entry per row. */
export async function fableRows($: Engine): Promise<string[]> {
  const texts = (await paneText($)).split('\n')
  return texts.flatMap((t, i) => (t === ' Fable used ' ? [texts[i + 1] ?? ''] : t.trimEnd() === ' Fable used –' ? ['–'] : []))
}

export const markOf = (value: unknown) => [(value as { pct?: unknown } | undefined)?.pct, (value as { resetsAt?: unknown } | undefined)?.resetsAt]

export type RowsKey = Partial<StoredRows>

export const rowsOf = (store: Map<string, unknown>) => store.get('rows') as RowsKey | undefined

/** Each login's stored lines as a reader in this machine's zone prints them at `now`, by default when they were written. */
export const rowsText = (store: Map<string, unknown>, now = rowsOf(store)?.at ?? NaN) =>
  rowsOf(store)?.rows?.map(r => ({ id: r.id, lines: r.lines.map(l => storedLineText(l, now)) }))

export const lineOne = (store: Map<string, unknown>, id: string) => rowsText(store)?.find(r => r.id === id)?.lines[0] ?? '(no row)'

/** Two logins read at boot, or failing with 429 where `isFailing`, then a minute on, past the minute's merge. */
export async function rowsWorld($: Engine, on: On, isFailing = false): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  if (isFailing) w.failing = { 'tok-1': 429, 'tok-2': 429 }
  w.usage['tok-1'] = [null, 30, 40]
  w.usage['tok-2'] = [null, 40]
  // Login 2's week resets at its own time, so a response proves login 1's.
  w.weekResets = { 'tok-2': '2026-10-19T03:00:00Z' }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  return { w, store, clock }
}

// C11 (puma-eslxj.12, RULING 4593 and 4595): `account-rotator account select` drops a request file in the config
// folder's account-rotator-requests; a session's minute tick applies one only when it names this store's store-id.
export const REQUESTS = `${HOME}/.claude/account-rotator-requests`

/** A nonce as the CLI writes one, a uuid's hex. */
export const N1 = '0f3c2a9e1b7d4c55a6e8f00112233445'

export const resultOf = (w: World, nonce: string): Record<string, unknown> | undefined => {
  const text = w.files[`${REQUESTS}/${nonce}.result.json`]
  return typeof text === 'string' ? (JSON.parse(text) as Record<string, unknown>) : undefined
}

/** Two logins, with room unless the test spends a week, a session started on login 1, a minute's merge done. */
export async function selectWorld($: Engine, on: On, login2: [number, number] = [10, 20], login1: [number, number] = [10, 20], w: World = fresh()): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = login1
  w.usage['tok-2'] = login2
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(60_000)
  return { w, store, clock }
}

export const USE_COMMAND = 'account-rotator account use --account 2'

/** A use request as bin/account-rotator writes it, aimed at the session whose mark is `session`. */
export const useRequest = (nonce: string, id: string, storeId: unknown, at: number, session: unknown) => JSON.stringify({ kind: 'use', nonce, at, id, store: storeId, session })

export const ownMark = (w: World) => w.otherEnv.ACCOUNT_ROTATOR_SESSION

/** A Bash call as Claude makes one, running until `finish`; the test writes the request the command would. */
export function bashCall($: Engine, w: World, command: string): { finish: () => Promise<unknown> } {
  let end = () => {}
  w.bashRuns = new Promise<void>(resolve => {
    end = resolve
  })
  const done = $.tool.call({ tool: 'Bash', command } as unknown as ToolCallArgs)
  return {
    finish: () => {
      end()
      return done
    },
  }
}

/** One beat of the watch over a running call. */
export const beat = async (clock: MockClock) => {
  await clock.advance(REQUEST_POLL_MS)
  await clock.settle()
}

/** The next minute's tick, whatever the time now. */
export const untilTick = async (clock: MockClock) => {
  await clock.advance(60_000)
  await clock.settle()
}

/** What the CLI read of each login these tests remove. */
export const SEEN: Record<string, { slot: string; email: string }> = {
  '1': { slot: '', email: 'one@example.com' },
  '2': { slot: SLOT2, email: 'two@example.com' },
  '3': { slot: SLOT3, email: 'three@example.com' },
}

export const rmRequest = (nonce: string, id: string, storeId: unknown, at: number) => JSON.stringify({ kind: 'rm', nonce, at, id, store: storeId, ...SEEN[id] })

export const debugLines = (w: World, text: string) => (w.logged ?? []).filter(line => line.includes(text))

export type StopLogEntry = { at: number; what: string }

export const DAY = 24 * HOUR

/** The stop-log's first line of a usage-limit stop: its wording class (model.ts's wordingClass) and the login believed in use, written before the stop's owner is known. */
export const stopHeard = (wording: 'none' | 'fable' | 'session' | 'weekly' | 'unknown', id = '1') => `stop heard: rate_limit (wording: ${wording}), login ${id} believed in use`

/** A stop with no words, and the plain stop (PLAIN, naming the session limit), on login 1. */
export const STOP_RATE_LIMIT = stopHeard('none')

/** The line a stop writes when it moves to a login with a fresh read, read just now; the one tried is login 1. */
export const PICKED_TWO = 'picked 2: fresh, read 0 min ago; tried 1'

/** This session's stop-log: what the store holds under the session's mark. */
export const stopLogOf = (store: Map<string, unknown>, w: World): StopLogEntry[] => (store.get(`stop-log:${w.otherEnv.ACCOUNT_ROTATOR_SESSION}`) ?? []) as StopLogEntry[]

export const whats = (entries: readonly StopLogEntry[]) => entries.map(e => e.what)

/** Two logins on a store the test reads, login 1 in use with room; `extra` seeds the store. */
export async function loggedWorld(on: On, w: World, extra: Record<string, unknown> = {}) {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [60, 40]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, ...extra }))
  return { store, clock: world(on, w, store) }
}

export const PLAIN = { error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] }

/** The stop-log's line of the carry-on owed once a login frees up, as it goes. */
export const isOwedCarryOnLine = (what: string) => what.startsWith('a login is free: carry-on')

export const FILL_NO_CAUSE = 'owed resume: fill answered no cause, no key'

/**
 * A world whose carry-on stays queued, in an Orca pane, its fill refused by a hook. The kit keeps no cause on the
 * mod's own fill, so no test here draws the engine's own 'dialog' that the Escape needs: model.test.ts holds that row,
 * and these hold every condition before it. Answers what lets the queued prompt enter.
 */
export function queuedWorld(on: On, w: World): () => void {
  let enter = () => {}
  w.submitHold = new Promise<void>(resolve => {
    enter = resolve
  })
  w.isFillRefused = true
  w.env.ORCA_TERMINAL_HANDLE = 'term_test-pane'
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield* []
    return { value: { code: 0, signal: null } }
  })
  return enter
}

/** The main loop's turn that dies on a stop: it starts, the stop is heard, then it ends on the error, in the order the spike read. */
export async function turnStops($: Engine, clock: MockClock, stop: { error: 'rate_limit' | 'authentication_failed' } = { error: 'rate_limit' }, isEnded = true): Promise<void> {
  await $.turn.start({ text: 'go on', turnId: 'turn-1' })
  await $.classic.StopFailure(stop)
  if (isEnded) await $.turn.complete({ turnId: 'turn-1', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
}

/** The pane after the carry-on answered, as the reading saw it (R6c): the countdown's footer under the prompt box. */
export const COUNTDOWN_FOOTER = ['⏺ stand-in: done', '──────────', '❯ ', '──────────', '  ⚠ Usage limit reached · limit resets 1:06am', '    Continuing shortly · Esc to cancel']

/** A world in an Orca pane whose screen shows the countdown, every spawn recorded. */
export function countdownWorld(on: On, w: World): void {
  w.env.ORCA_TERMINAL_HANDLE = 'term_test-pane'
  w.screen = COUNTDOWN_FOOTER
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield* []
    return { value: { code: 0, signal: null } }
  })
}

/** The doubled path of card D196: a usage-limit stop, the switch, and the mod's carry-on entering and answering. */
export async function carryOnAnswers($: Engine, clock: MockClock, w: World, stop: { error: 'rate_limit' | 'authentication_failed' } = { error: 'rate_limit' }): Promise<void> {
  w.usage['tok-1'] = [100, 41]
  await turnStops($, clock, stop)
  await clock.advance(36_000)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.settle()
}

/**
 * Three logins, each with room, login 1 in use and spent by the stop to come; the carry-on of a stop's switch stays
 * queued, in an Orca pane unless `isPane` is false. The kit cannot draw the engine's 'dialog' refusal (queuedWorld's
 * comment), so a test here that needs the Escape proves the wiring up to the fill, and model.test.ts holds the Escape's rows.
 */
export async function owedWorld($: Engine, on: On, w: World, isPane = true) {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [60, 40]
  w.usage['tok-2'] = [10, 30]
  w.usage['tok-3'] = [20, 50]
  queuedWorld(on, w)
  if (!isPane) delete w.env.ORCA_TERMINAL_HANDLE
  const store = new Map<string, unknown>(Object.entries({ ...THREE_LOGINS, 'rotate-to': 'room' }))
  const clock = world(on, w, store)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  return { store, clock }
}

export const isSwitchedToast = (t: unknown) => String(t).startsWith('Switched to ')

/** Lets the jobs of one tick finish in real time, as ticks a minute apart do, a late keychain answer included. */
export async function settleReal(clock: MockClock): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 100))
  await clock.settle()
}

/** A state write as a test reads it, and a step around the rest of its handling: the kit takes one handler an event. */
export type StateWrite = { key: string; value: View }

export type Around = (e: StateWrite, inner: (e: StateWrite) => Promise<unknown>) => Promise<unknown>

/**
 * Refuses every view write that clears `carryDue` once one carry-on has been owed, as an engine that refuses the write.
 * `owed` is the debt the view was last written to hold.
 */
export const carryClearRefusal = () => {
  const seen: { refused: number; owed?: View['carryDue'] } = { refused: 0 }
  let wasOwed = false
  const around: Around = async (e, inner) => {
    const { key, value } = e
    if (key === 'view' && value.carryDue !== undefined) {
      wasOwed = true
      seen.owed = value.carryDue
    }
    if (key === 'view' && wasOwed && value.carryDue === undefined) {
      seen.refused += 1
      return { deny: 'state: refused' }
    }
    return inner(e)
  }
  return { seen, around }
}

/** carryClearRefusal as the test's handler of state.set, `outer` (when given) running around it. */
export const refuseCarryClear = (on: On, outer?: Around) => {
  const { seen, around } = carryClearRefusal()
  on('state.set', async (_$, e, next) => {
    const inner = (x: StateWrite) => around(x, y => next(y as unknown as typeof e))
    const write = e as unknown as StateWrite
    return (await (outer === undefined ? inner(write) : outer(write, inner))) as Awaited<ReturnType<typeof next>>
  })
  return seen
}

/** The store's mark of the carry-on owed this session ended though its view kept it, as the debt it names. */
export const carryEndedOf = (store: Map<string, unknown>, w: World) => {
  const mark = store.get(`carry-ended:${w.otherEnv.ACCOUNT_ROTATOR_SESSION}`) as { owedAt?: number } | undefined
  return mark === undefined ? undefined : { owedAt: mark.owedAt }
}

/** Past login 1's reset at 12:00 and the grace after it: a carry-on owed for 12:00 has gone by then. */
export const pastOwed = (clock: MockClock) => clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 10 * 60_000)

/**
 * Every login spent, every view write clearing carryDue refused, then a usage-limit stop on login 1: one carry-on owed at
 * 12:00. `outer` runs around the refusal; `setup` adds the test's own handlers of other events before the start.
 */
export async function refusedOwedWorld($: Engine, on: On, w = fresh(), { outer, setup }: { outer?: Around; setup?: () => void } = {}) {
  const { store, clock } = await loggedWorld(on, w)
  w.usage['tok-2'] = [100, 30]
  const seen = refuseCarryClear(on, outer)
  setup?.()
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure(PLAIN)
  await clock.settle()
  return { w, store, clock, seen }
}

/**
 * A session whose view survived a hot reload as `surviving`, on two logins both spent, the store a shared one seeded by
 * `extra`; `around` runs around each state write.
 */
export async function reloadedWorld($: Engine, on: On, surviving: Partial<View>, extra: Record<string, unknown> = {}, around?: Around, w = fresh()) {
  const { store, clock } = await loggedWorld(on, w, extra)
  w.usage['tok-1'] = [100, 41]
  w.usage['tok-2'] = [100, 30]
  let isReloaded = true
  on('state.get', async (_$, e, next) => {
    const read = await next(e)
    if (e.plugin !== 'account-rotator' || e.key !== 'view' || !isReloaded) return read
    return { value: { value: { ...EMPTY_VIEW, ...TWO_LOGINS, activeId: '1', isBound: true, ...surviving }, version: read.value?.version ?? 0 } }
  })
  on('state.set', async (_$, e, next) => {
    if ((e as unknown as { key: string }).key === 'view') isReloaded = false
    if (around === undefined) return next(e)
    return (await around(e as unknown as StateWrite, x => next(x as unknown as typeof e))) as Awaited<ReturnType<typeof next>>
  })
  await start($, clock)
  return { w, store, clock }
}

// puma-9arph.26: the mod keeps the launcher copy a person installed as `claude` current, at a session's start.
export const COPY_DIR = `${HOME}/.claude/accounts/bin`

export const kept = (w: World) => Object.keys(w.files).filter(path => path.startsWith(`${COPY_DIR}/`))

export const sent = (w: World, notice: RegExp) => w.notices.some(t => notice.test(t))

/** No stop's recovery ended in this world: what the stop hook's catch writes. */
export const isEnded = (store: Map<string, unknown>, w: World) => whats(stopLogOf(store, w)).some(x => x.startsWith('stop handling failed'))

/**
 * puma-9arph.91: the engine answers the next submit late, as `answer` says (drop, reject or take it), and only that one:
 * every later submit goes through at once, but for the `drops - 1` after it, which it drops at once. Returns what lets
 * the late answer go. The kit reads `submitHold` and `submitDrop` after it counts the submit, so the count names each.
 */
export function answerNextLate(w: World, answer: 'drop' | 'reject' | 'resolve', drops = 1): () => void {
  const nth = w.submitted.length + 1
  let settle = () => {}
  const held = new Promise<void>((resolve, reject) => {
    settle = answer === 'reject' ? () => reject(new Error('submission refused')) : resolve
  })
  held.catch(() => undefined)
  const isDropped = () => (answer === 'drop' || w.submitted.length > nth) && w.submitted.length < nth + drops
  Object.defineProperty(w, 'submitHold', { configurable: true, get: () => (w.submitted.length === nth ? held : undefined) })
  Object.defineProperty(w, 'submitDrop', { configurable: true, get: () => (w.submitted.length >= nth && isDropped() ? 'a Stop stands' : undefined) })
  return settle
}
