import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunResult, SessionRateLimit, ToolCallArgs } from 'claude-code'
import type { StoredRows, View } from '../types'

import { DEFAULT_FOOTER, EMPTY_VIEW, USAGE_CLAIM_WAIT_MS, USAGE_FORCE_AFTER_MS, USAGE_IDLE_MS, fingerprint, keychainItem, roomColor } from './model'
import { laterMark, longBar, markFrom, storedLineText } from './model'
import { REQUEST_POLL_MS, REQUEST_TTL_MS, blockedText } from './model'
import { PANE_COLUMNS } from './view'

const NOW = Date.parse('2026-10-12T10:00:00Z')
const HOUR = 3600_000
const HOME = '/Users/tester'
const SLOT2 = `${HOME}/.claude/accounts/2`
/** Where Claude Code keeps logins 1 and 2 on Linux. */
const FILE1 = `${HOME}/.claude/.credentials.json`
const FILE2 = `${SLOT2}/.credentials.json`

type World = {
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
  /** access token -> the HTTP status the profile endpoint fails with, where it fails */
  profileFailing?: Record<string, number>
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
  /** The folders that exist under the accounts folder, signed in or not. */
  folders?: string[]
  /** How a `mkdir` fails, where it does. */
  mkdirFails?: 'exit' | 'refused'
  /** Who a press's `claude auth login` signs in. */
  loginEmail?: string
  /** How the store refuses the `store-id` key: its write, or its read and its write. */
  storeIdFails?: 'write' | 'read'
  /** What the mod wrote to the debug log. */
  logged?: string[]
  /** Runs before each write of a shared store, to read what stood before it. */
  onStoreSet?: (key: string, value: unknown) => void
  /** Runs after each write of a shared store: another session's write that lands next. */
  afterStoreSet?: (key: string) => void
  /** The slot of each `claude auth status` the mod ran. */
  statusAsked?: string[]
  /** Runs inside a `claude auth status`: what another session writes while this one waits on it. */
  onStatus?: () => void
  /** How a `claude auth status` fails, where it does. */
  statusFails?: 'refused' | 'exit' | 'garbage'
  /** The slot of each `claude auth logout` the mod ran. */
  logouts?: string[]
  /** What a `claude auth logout` answers, where it fails. */
  logoutFails?: { exitCode: number | null; stderr: string }
  /** While set, a Bash call runs until it settles. */
  bashRuns?: Promise<void>
  /** While set, a file read waits until it settles, so two readers overlap as the engine's hops can make them. */
  readGate?: Promise<void>
  spawned: { argv: readonly string[]; env?: Record<string, string> }[]
  submitted: string[]
  /** Whether each line in `submitted` was sent as the person's own words (`asUser`), not under the mod's name. */
  asUser: boolean[]
  /** What the session's last response reported, as `$.session.usage()` answers it. */
  limits: SessionRateLimit[]
  /** Ids of the panes open now. */
  panes: string[]
  toasts: string[]
  /** What the mod sent through `ui.notify`, the terminal's own notice. */
  notices: string[]
  /** When the Fable week the usage endpoint lists resets; `FABLE_RESET` where unset. */
  fableResets?: string
  /** The session's environment beyond USER and HOME. */
  env: Record<string, string>
  /** Claude Code's security policy refuses every switch, as in a session on a Team seat. */
  refuseEnv?: boolean
  breakEnv?: boolean
  /** Awaited before each answer, so a press can finish during a usage read. */
  beforeFetch?: () => Promise<void>
  /**
   * Claude in Chrome, where the session has it: the slots of the accounts a
   * Chrome extension is signed in to, one per Chrome profile, and the slot its
   * connection was made as.
   */
  chrome?: { extensions: string[]; as?: string }
  /** The slot in use at each of the mod's calls to Claude in Chrome, the session having it or not. */
  chromeAsked: string[]
  /** The slash commands the mod ran, as typed. */
  commands: string[]
}

/** Claude Code's words for a browser call that found no browser, as a session moved off its login gets them. */
const NO_BROWSER =
  'Browser extension is not connected: the OAuth token Claude Code is using belongs to a different claude.ai account than the one Claude Code is logged in as. ' +
  'If CLAUDE_CODE_OAUTH_TOKEN is set in your shell or CI profile, unset it (or re-mint it for this account), then run /logout and /login in Claude Code and make sure the browser extension is signed into the same claude.ai account.'

const blob = (token: string, expiresAt = NOW + 6 * HOUR, plan = 'max', tier?: string) =>
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
const OWNER_BY_NUMBER = ['one@example.com', 'two@example.com', 'three@example.com', 'four@example.com', 'five@example.com']

/** When the week of every login resets, unless the world names another for its token. */
const WEEK_RESET = '2026-10-18T03:00:00Z'

/** When the Fable week of every login resets. */
const FABLE_RESET = '2026-10-17T03:00:00Z'

/** One of the usage body's `limits` rows: a week scoped to a model. */
const limitRow = (model: string, percent: number, resetsAt = FABLE_RESET) => ({
  kind: 'weekly_scoped',
  group: 'weekly',
  percent,
  resets_at: resetsAt,
  scope: { model: { display_name: model } },
})

const ran = (exitCode: number, stdout: string): ProcessRunResult => ({
  exitCode,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

/** `$.store` over `entries`, which the test writes mid-run as another session on the Mac would. */
function sharedStore(on: On, entries: Map<string, unknown>, w: World): void {
  on('store.get', (_$, e) => (e.key === 'store-id' && w.storeIdFails === 'read' ? { deny: 'store: refused' } : { value: entries.get(e.key) }))
  on('store.set', (_$, e) => {
    if (e.key === 'store-id' && w.storeIdFails !== undefined) return { deny: 'store: refused' }
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
function world(on: On, w: World, store: Record<string, unknown> | Map<string, unknown>): MockClock {
  const clock = mock.clock(on, { now: NOW })
  if (store instanceof Map) sharedStore(on, store, w)
  else mock.store(on, store)
  mock.env(on, { USER: 'tester', HOME, ...w.env })
  let slot = w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? ''
  on('env.set', (_$, e) => {
    if (e.name !== 'CLAUDE_SECURESTORAGE_CONFIG_DIR') {
      if (w.refuseMark) return { deny: `env (managed): ${e.name} is not for plugins outside policy to change` }
      w.otherEnv[e.name] = e.value
      return { value: {} }
    }
    if (w.refuseEnv) return { deny: `env (managed): ${e.name} is not for plugins outside policy to change` }
    if (w.breakEnv) return { deny: 'no policy said this' }
    // The mod sets the slot in use at its start, to learn whether it may switch: not a switch.
    if ((e.value ?? '') === slot) return { value: {} }
    slot = e.value ?? ''
    w.envSets.push(e)
    return { value: {} }
  })
  on('process.run', (_$, e) => {
    const [cmd, sub, verb] = e.argv
    if (cmd === 'security') {
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
      w.onStatus?.()
      if (w.statusFails === 'refused') return { deny: 'process (managed): claude is not for plugins to run' }
      if (w.statusFails === 'exit') return { value: ran(1, '') }
      if (w.statusFails === 'garbage') return { value: ran(0, 'not json') }
      const email = w.emails[e.init?.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? '']
      const status = email ? { loggedIn: true, email, orgId: `org-${email}`, orgName: 'Org', subscriptionType: 'max' } : { loggedIn: false }
      return { value: ran(0, JSON.stringify(status)) }
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
      five_hour: five === null ? null : { utilization: five, resets_at: '2026-10-12T12:00:00Z' },
      seven_day: week === null ? null : { utilization: week, resets_at: w.weekResets?.[token] ?? WEEK_RESET },
      // A row for another model beside the Fable one, spent: read as Fable's, it would show.
      ...(fable === undefined ? {} : { limits: [limitRow('Sonnet', 100), limitRow('Fable 5.1', fable, w.fableResets)] }),
    }
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
  on('mcp.call', (_$, e) => {
    w.chromeAsked.push(slot)
    if (w.chrome === undefined) return { deny: `no connected MCP tool "${e.tool}" on a server named "${e.server}"` }
    const browsers = isAnswered(w.chrome) ? [{ deviceId: 'device-1', name: 'Browser 1', osPlatform: 'macOS', isLocal: true }] : []
    return { value: { content: [{ type: 'text', text: JSON.stringify(browsers) }], isError: false } }
  })
  on('tool.call', { tool: /^mcp__claude-in-chrome__/ }, () => {
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
  on('prompt.submit', (_$, e) => {
    w.submitted.push(e.text)
    w.asUser.push(e.origin.kind === 'plugin' && e.origin.asUser === true)
    return { text: e.text }
  })
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
    w.logged = [...(w.logged ?? []), e.text]
    return { value: undefined }
  })
  on('ui.notify', (_$, e) => {
    w.notices.push(e.text)
    return { value: { isSent: true, channel: 'iterm2' } }
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
    w.files[e.path] = e.text
    w.writes = [...(w.writes ?? []), e.path]
    return { value: undefined }
  })
  on('fs.list', (_$, e) => {
    const names = Object.keys(w.files).filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
    if (w.listFails) return { deny: `EACCES: permission denied, scandir '${e.path}'` }
    if (names.length === 0) return { deny: `ENOENT: no such file or directory, scandir '${e.path}'` }
    return { value: names.map(p => ({ name: p.slice(e.path.length + 1), kind: (w.linkFiles ?? []).includes(p.slice(e.path.length + 1)) ? 'other' : 'file', size: (w.files[p] ?? '').length, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', (_$, e) => ({ value: (e.path === '/System/Library/CoreServices/SystemVersion.plist' && w.system === 'macOS') || (w.folders ?? []).includes(e.path) }))
  on('fs.read', async (_$, e) => {
    await w.readGate
    const text = w.files[e.path]
    if (text === null) return { deny: `EACCES: permission denied, open '${e.path}'` }
    return text === undefined ? { deny: `ENOENT: no such file or directory, open '${e.path}'` } : { value: text }
  })
  return clock
}

const fresh = (system: World['system'] = 'macOS'): World => ({
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
const TWO_LOGINS ={ accounts: [{ id: '1', slot: '', email: 'one@example.com' }, { id: '2', slot: SLOT2, email: 'two@example.com' }] }

/** The props of every Text drawn with a color or on one, its hover with them, in document order. */
function painted(node: unknown): Record<string, unknown>[] {
  if (typeof node !== 'object' || node === null) return []
  const { type, props, hover, children } = node as { type?: string; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
  const isPainted = props?.color !== undefined || props?.backgroundColor !== undefined
  const own = type === 'Text' && isPainted ? [{ ...props, ...(hover === undefined ? {} : { hover }) }] : []
  return [...own, ...(children ?? []).flatMap(painted)]
}

/** The footer's one control: its glyphs, opening the pane. */
const GLYPHS = { key: 'accounts' } as const

const PANE_PROPS = {
  title: 'Claude accounts',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

/** Lets the last usage read pass a minute old: a stop, a /login or a sign-in reads the usage again only then. */
const pastLastRead = (clock: MockClock) => clock.advance(USAGE_FORCE_AFTER_MS + 1000)

/** Lets the schedule come round for a login no response read: the 10-minute check reads it again. */
const pastNextRead = (clock: MockClock) => clock.advance(USAGE_IDLE_MS)

/** Starts the session and lets boot finish, its usage claims' wait included. */
async function start($: Engine, clock: MockClock): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
}

test('a login with nothing in the keychain shows as needing a sign-in, with one button for it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'account-rotator',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    })
    expect(await band.find({ text: /account 2 \(two@example.com\) needs a sign-in \(not signed in\)/ })).toBeDefined()
    expect(await band.find({ key: 'sign-in-all' })).toBeDefined()
    await band.unmount()
  }
  expect(w.envSets).toEqual([])
})

test('moves to the login with room once the active one passes 90% of its 5-hour window', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [92, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // Braille of what each login can serve now over bars of its week: login 1 (8% left now)
  // on standby, login 2 (90% left) in use, a line down each side of its column, its percents at the right.
  const button = await footer.find(GLYPHS)
  expect(button?.text).toBe(' ⣀│⣷│  90% \n ▅│▆│  70% ')
  // Every glyph in its room's color, the lines in the theme's dim gray.
  const [one, lineBefore, two, lineAfter, percent] = painted(button?.children[0])
  expect(one).toMatchObject({ color: roomColor(8) })
  expect(lineBefore).toMatchObject({ color: 'subtle' })
  expect(two).toMatchObject({ color: roomColor(90) })
  expect(lineAfter).toMatchObject({ color: 'subtle' })
  expect(percent).toMatchObject({ color: roomColor(90) })
  await footer.unmount()
})

test('on Linux each login is read from the credentials file in its folder, the normal one\'s in ~/.claude, even with a `security` there', async ($, on) => {
  const w = fresh('Linux')
  w.keychain['Claude Code-credentials'] = blob('stale-1')
  w.keychain[await keychainItem(SLOT2)] = blob('stale-2')
  w.files[FILE1] = blob('tok-1')
  w.files[FILE2] = blob('tok-2')
  w.usage['tok-1'] = [92, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find(GLYPHS))?.text).toBe(' ⣀│⣷│  90% \n ▅│▆│  70% ')
  await footer.unmount()
})

test('on Linux a login whose file is missing, holds no Claude login, cannot be read or is not JSON needs a sign-in, as Claude Code counts it', async ($, on) => {
  const slot = (id: number) => `${HOME}/.claude/accounts/${id}`
  const w = fresh('Linux')
  w.files[FILE1] = blob('tok-1')
  // Claude Code keeps MCP servers' sign-ins in the same file.
  w.files[`${slot(3)}/.credentials.json`] = JSON.stringify({ mcpOAuth: {} })
  w.files[`${slot(4)}/.credentials.json`] = null
  w.files[`${slot(5)}/.credentials.json`] = blob('tok-5').slice(0, 40)
  w.usage['tok-1'] = [20, 30]
  const more = [3, 4, 5].map(id => ({ id: String(id), slot: slot(id), email: `${id}@example.com` }))
  const clock = world(on, w, { accounts: [...TWO_LOGINS.accounts, ...more] })
  await start($, clock)
  const band = await $.ui.mount({
    plugin: 'account-rotator',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })
  const names = /account 2 \(two@example.com\), 3 \(3@example.com\), 4 \(4@example.com\), 5 \(5@example.com\) needs a sign-in \(not signed in\)\./
  expect(await band.find({ text: names })).toBeDefined()
  expect(await band.find({ key: 'sign-in-all' })).toBeDefined()
  await band.unmount()
  expect(w.envSets).toEqual([])
})

test('on Linux the band\'s Sign in reads the new login from the file the browser sign-in wrote in its slot', async ($, on) => {
  const w = fresh('Linux')
  w.files[FILE1] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield { stream: 'stdout' as const, text: 'Opening browser to sign in…\n' }
    w.files[FILE2] = blob('tok-2')
    w.usage['tok-2'] = [5, 12]
    return { value: { code: 0, signal: null } }
  })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⚠   80% \n│▆│    70% ')
  const band = await $.ui.mount({
    plugin: 'account-rotator',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })
  await band.press({ key: 'sign-in-all' })
  await clock.settle()
  await band.unmount()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣿   80% \n│▆│▇   70% ')
  await footer.unmount()
})

test('on Linux a switch held back for a token about to refresh is made once the file holds the refreshed one', async ($, on) => {
  const w = fresh('Linux')
  w.files[FILE1] = blob('tok-1', NOW + 5 * 60_000)
  w.files[FILE2] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  await clock.advance(2 * 60_000)
  expect(w.envSets).toEqual([])
  w.files[FILE1] = blob('tok-1', NOW + 8 * HOUR)
  await clock.advance(3 * 60_000)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.unmount()
})

test('the band\'s Sign in signs a locked login in through the browser, in its own slot', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const item2 = await keychainItem(SLOT2)
  const clock = world(on, w, TWO_LOGINS)
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield { stream: 'stdout' as const, text: 'Opening browser to sign in…\n' }
    w.keychain[item2] = blob('tok-2')
    w.usage['tok-2'] = [5, 12]
    return { value: { code: 0, signal: null } }
  })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: ['auto mode'] } })
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⚠   80% \n│▆│    70% ')
  const band = await $.ui.mount({
    plugin: 'account-rotator',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })
  await band.press({ key: 'sign-in-all' })
  await clock.settle()
  await band.unmount()
  expect(w.spawned).toEqual([
    {
      argv: ['claude', 'auth', 'login', '--claudeai', '--email', 'two@example.com'],
      env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2, CLAUDE_CONFIG_DIR: SLOT2 },
    },
  ])
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣿   80% \n│▆│▇   70% ')
  expect(await footer.find({ text: /auto mode/ })).toBeDefined()
  await footer.unmount()
})

test('with rotation disabled, a spent login or a turn that dies on the usage limit stays put, and the pane says so', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [92, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'rotate-to': 'off' })
  await start($, clock)
  await clock.advance(11 * 60_000)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.envSets).toEqual([])
  expect(w.submitted).toEqual([])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^Rotation is disabled/ })).toBeDefined()
  await pane.unmount()
})

test('where Claude Code\'s security policy refuses switching, as on a Team seat, the session says so at its start and once, then stops trying; a press still answers', async ($, on) => {
  const w = fresh()
  w.refuseEnv = true
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const notice = (t: string) => /^Can't switch accounts in this session/.test(t) && /#team-and-enterprise-accounts/.test(t)
  expect(w.toasts.filter(notice)).toHaveLength(1)
  // On the normal login, a personal sign-in there gives the next session one that can switch.
  expect(w.toasts.find(notice)).toMatch(/session that starts on a Team or Enterprise account\. Fix: \/login with your personal \(Pro or Max\) account, then restart Claude/)
  // The login in use runs out: no switch is tried, and nothing more is said.
  w.usage['tok-1'] = [95, 41]
  await clock.advance(21 * 60_000)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.toasts.filter(notice)).toHaveLength(1)
  expect(w.submitted).toEqual([])
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find({ type: 'Text', text: '⚠' }))?.props).toMatchObject({ color: 'warning' })
  await footer.press({ key: 'switch-blocked' })
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
  await footer.unmount()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect((await pane.find({ type: 'Text', text: /^Can't switch accounts in this session\. .*starts on a Team/ }))?.props).toMatchObject({ color: 'warning' })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.toasts.filter(notice)).toHaveLength(2)
  expect(w.toasts.filter(t => /Something went wrong|Switched to/.test(t))).toEqual([])
  await pane.unmount()
})

test('where the policy starts refusing once the mod has moved the session to a seat, it says to start again, not to /login, which would sign in the seat', async ($, on) => {
  const w = fresh()
  w.refuseEnv = true
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const notice = w.toasts.filter(t => /^Can't switch accounts/.test(t))
  expect(notice).toHaveLength(1)
  expect(notice[0]).toMatch(/starts or reloads plugins\. Fix: quit Claude and run `claude --continue` or `claude --resume`\. Not \/restart, which keeps this account\./)
  expect(notice[0]).not.toMatch(/\/login/)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /^Can't switch accounts.*Fix: quit Claude and run `claude --continue`/ })).toBeDefined()
  await pane.unmount()
})

test('a switch that does not take, its responses still the old login\'s minutes later, points the session back and marks the old login in use, and the rotation does not try it again', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [93, 40]
  w.usage['tok-2'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  // Responses go on reporting login 1's usage, its week among it.
  w.limits = [
    { kind: 'five_hour', percentUsed: 93, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' },
  ]
  await clock.advance(5 * 60_000)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  expect(w.toasts.filter(t => /did not take: responses still use account 1/.test(t))).toHaveLength(1)
  expect(w.envSets).toEqual([
    { name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 },
    { name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: undefined },
  ])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const ends = (await pane.findAll({ text: /^(Remove|Use now|● in use)$/ })).filter(e => e.type !== 'Box')
  expect(ends.map(e => e.text)).toEqual(['● in use', 'Remove', 'Use now'])
  // Still spent, but the rotation leaves login 2 be.
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.advance(30 * 60_000)
  expect(w.envSets).toHaveLength(2)
  await pane.press({ key: 'use-2' })
  await clock.settle()
  expect(w.envSets).toHaveLength(3)
  await pane.unmount()
})

test('a turn that dies on the usage limit moves to the other login, then asks Claude to carry on', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [60, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([])
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.submitted).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
})

/** The stop of a turn that used up the Fable week, as Claude Code reports it. */
const FABLE_STOP = {
  error: 'rate_limit',
  last_assistant_message: "You've reached your Fable limit. Switch to another model to continue.",
}

/** Login 1's 5-hour window as the pane draws it at 20% used, and the week at 30%. */
const ONE_AT_20 = /^▰{2}▱{8} 20%$/

test('a Fable stop moves to the login with Fable room and carries on, and the toast names the Fable week, not the 5-hour window', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  // Login 1's Fable week is spent, but a session that never hit it has no reason to leave.
  await clock.advance(2 * 60_000)
  expect(w.envSets).toEqual([])
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /^Switched to Claude account 2.*: account 1 has 0% of its Fable week left\.$/.test(t))).toHaveLength(1)
  expect(w.toasts.filter(t => /5-hour/.test(t))).toEqual([])
  expect(w.submitted).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
  // The 5-hour window every session shares is not counted full: the pane still reads login 1 at 20% used.
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: ONE_AT_20 })).toBeDefined()
  await pane.unmount()
})

test('a Fable stop moves past a login whose Fable week is spent, to the one with room, though the spent one has more 5-hour room', async ($, on) => {
  const w = fresh()
  const SLOT3 = `${HOME}/.claude/accounts/3`
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 100]
  w.usage['tok-3'] = [50, 50, 0]
  const three = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }], 'rotate-to': 'room' }
  const clock = world(on, w, three)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT3 }])
})

test('a Fable stop whose usage read lists no Fable week is told by Claude\'s own words, and still leaves the 5-hour window alone', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /of its Fable week left/.test(t))).toHaveLength(1)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: ONE_AT_20 })).toBeDefined()
  await pane.unmount()
  // Login 1's Fable week is held spent until the next check reads it: the carry-on's own Fable stop on login 2 finds nowhere to go.
  await clock.advance(36_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(w.envSets).toHaveLength(1)
})

test('a rate-limit stop whose fresh usage read shows the Fable week spent is a Fable stop, said in no words', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 60]
  w.usage['tok-2'] = [10, 30, 10]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([])
  // The week is spent by the time the stop's own read comes in, a minute after the boot's.
  w.usage['tok-1'] = [20, 30, 100]
  await pastLastRead(clock)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /of its Fable week left/.test(t))).toHaveLength(1)
})

/** Whether the band above the prompt says anything of the Fable week; the mount refuses where no band is drawn. */
async function hasFableBand($: Engine): Promise<boolean> {
  try {
    const band = await mountBand($)
    const found = (await band.find({ text: /Fable week/ })) !== undefined
    await band.unmount()
    return found
  } catch (error) {
    if (/no implementation for ui\.render/.test(String(error))) return false
    throw error
  }
}

/** What Claude says when a turn dies on a limit that is not the Fable week. */
const PLAIN_STOPS = ["You've hit your session limit · resets 3pm", 'Claude usage limit reached.']

for (const message of PLAIN_STOPS) {
  test(`a plain usage-limit stop ("${message}") on a login whose Fable week is spent marks the 5-hour window and moves to any login with room, with no Fable band`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [20, 30, 100]
    w.usage['tok-2'] = [10, 30, 100]
    const clock = world(on, w, TWO_LOGINS)
    await start($, clock)
    await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: message })
    await clock.settle()
    expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
    expect(w.toasts.filter(t => /^Switched to Claude account 2.*: account 1 has 0% of its 5-hour window left\.$/.test(t))).toHaveLength(1)
    expect(w.toasts.filter(t => /Fable/.test(t))).toEqual([])
    expect(await hasFableBand($)).toBe(false)
    await clock.advance(36_000)
    expect(w.submitted).toHaveLength(1)
    expect(w.asUser).toEqual([false])
  })
}

/** The stops of a turn that died on a limit, with no words that name which: no message, or an empty one. */
const WORDLESS_STOPS = [{ error: 'rate_limit' }, { error: 'rate_limit', last_assistant_message: '' }]

for (const stop of WORDLESS_STOPS) {
  test(`a rate-limit stop with ${'last_assistant_message' in stop ? 'an empty' : 'no'} message is a Fable stop when its usage read shows the Fable week spent, and a plain one when it does not`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [20, 30, 60]
    w.usage['tok-2'] = [10, 30, 100]
    const clock = world(on, w, TWO_LOGINS)
    await start($, clock)
    w.usage['tok-1'] = [20, 30, 100]
    await pastLastRead(clock)
    await $.classic.StopFailure(stop)
    await clock.settle()
    // Login 2's Fable week is spent too: a Fable stop has nowhere to go.
    expect(w.envSets).toEqual([])
    expect(await hasFableBand($)).toBe(true)
    // The read shows the 5-hour window spent instead: a plain stop, which moves.
    w.usage['tok-1'] = [100, 30, 60]
    await pastLastRead(clock)
    await $.classic.StopFailure(stop)
    await clock.settle()
    expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  })
}

/**
 * Three logins, login 1 with its Fable week spent, login 2 not read for it and
 * ahead on every other count (the same 5-hour reset as login 3, more room,
 * first in the list), login 3 read with Fable room.
 */
async function readAndUnread(w: World, rotateTo: string): Promise<{ accounts: unknown[]; 'rotate-to': string }> {
  const SLOT3 = `${HOME}/.claude/accounts/3`
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [30, 20]
  w.usage['tok-3'] = [40, 50, 40]
  return { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }], 'rotate-to': rotateTo }
}

for (const rotateTo of ['reset', 'room', 'order']) {
  test(`with the rotation going by ${rotateTo}, a Fable stop moves to the login with a Fable reading below 95% over the one with none`, async ($, on) => {
    const w = fresh()
    const store = await readAndUnread(w, rotateTo)
    const clock = world(on, w, store)
    await start($, clock)
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: `${HOME}/.claude/accounts/3` }])
  })
}

test('with no login read for the Fable week a Fable stop takes one, the stop there moves on, and once all are marked spent nothing moves', async ($, on) => {
  const w = fresh()
  const SLOT3 = `${HOME}/.claude/accounts/3`
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [20, 30]
  w.usage['tok-3'] = [20, 30]
  const three = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }] }
  const clock = world(on, w, three)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toHaveLength(1)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  // Logins 2 and 3, each once; login 1 was marked at the first stop.
  expect([...slots(w)].sort()).toEqual([SLOT2, SLOT3])
  expect(w.submitted).toHaveLength(2)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect([...slots(w)].sort()).toEqual([SLOT2, SLOT3])
  expect(w.submitted).toHaveLength(2)
})

/** One login only: the usage its read answers at the session's start and at the stop, and the stop. */
const ONE_LOGIN_STOPS: { name: string; start: [number, number, number?]; atStop: [number, number, number?]; stop: { error: string; last_assistant_message?: string }; band: RegExp }[] = [
  {
    name: 'a Fable stop on a read that shows the week spent',
    start: [20, 30, 100],
    atStop: [20, 30, 100],
    stop: FABLE_STOP,
    band: /^Every Claude account has used its Fable week; the next frees up in 4d \d+h\.$/,
  },
  {
    name: 'a stop that says nothing, on a read that shows the week spent by then',
    start: [20, 30, 60],
    atStop: [20, 30, 100],
    stop: { error: 'rate_limit' },
    band: /^Every Claude account has used its Fable week; the next frees up in 4d \d+h\.$/,
  },
  {
    name: 'a Fable stop on a read that lists no Fable week',
    start: [20, 30],
    atStop: [20, 30],
    stop: FABLE_STOP,
    // The usage gave no reset time, so the mark stands a week from the stop; the band is drawn 36 s after it.
    band: /^Every Claude account has used its Fable week; the next frees up in 6d 23h\.$/,
  },
]

for (const { name, start: at, atStop, stop, band } of ONE_LOGIN_STOPS) {
  test(`with one login, ${name} switches nothing and submits nothing, and the band says the Fable week is used`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.usage['tok-1'] = at
    const clock = world(on, w, { accounts: [TWO_LOGINS.accounts[0]] })
    await start($, clock)
    w.usage['tok-1'] = atStop
    await pastLastRead(clock)
    await $.classic.StopFailure(stop)
    await clock.settle()
    await clock.advance(36_000)
    expect(w.envSets).toEqual([])
    expect(w.submitted).toEqual([])
    const shown = await mountBand($)
    expect(await shown.find({ text: band })).toBeDefined()
    await shown.unmount()
  })
}

test('with every login\'s Fable week spent a Fable stop switches nothing and submits nothing, repeated stops included, and the band says when the next one frees up', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 100]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(w.envSets).toEqual([])
  expect(w.submitted).toEqual([])
  // Across the 10-minute check, which reads both logins again, stop after stop.
  for (let i = 0; i < 3; i++) {
    await clock.advance(11 * 60_000)
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    await clock.advance(36_000)
  }
  expect(w.envSets).toEqual([])
  expect(w.submitted).toEqual([])
  const band = await mountBand($)
  // The Fable weeks reset on 17 October, days from the clock.
  expect(await band.find({ text: /^Every Claude account has used its Fable week; the next frees up in 4d \d+h\.$/ })).toBeDefined()
  await band.unmount()
})

test('a Fable stop with no login to move to leaves the 5-hour window unmarked in the store every session shares, so no session leaves on its tick', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 100]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  // Its 60-second ticks: a session on login 1 stays, as login 2 has 5-hour room but no Fable room to offer.
  await clock.advance(5 * 60_000)
  expect(w.envSets).toEqual([])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: ONE_AT_20 })).toBeDefined()
  await pane.unmount()
})

test('a response keeps the Fable week the last check read, which a response never reports', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 100]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  w.limits = [
    { kind: 'five_hour', percentUsed: 21, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-18T03:00:00Z' },
  ]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  const band = await mountBand($)
  expect(await band.find({ text: /^Every Claude account has used its Fable week/ })).toBeDefined()
  await band.unmount()
})

/**
 * Login 1 read at 60% of its Fable week, then a Fable stop on it: the session
 * moves to login 2 and the week is marked spent on login 1. Then login 1's
 * usage lists no Fable week (the row is gone), login 2's is spent, and the
 * 10-minute check reads both.
 */
async function markedThenReread($: Engine, on: On, w: World, store: Record<string, unknown>): Promise<MockClock> {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 60]
  w.usage['tok-2'] = [10, 30, 10]
  const clock = world(on, w, { ...TWO_LOGINS, ...store })
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30, 100]
  await pastNextRead(clock)
  return clock
}

for (const rotateTo of ['reset', 'room', 'order']) {
  test(`with the rotation going by ${rotateTo}, the Fable week a stop marked spent survives a check whose usage lists no Fable week, and the session does not move back on its next stop`, async ($, on) => {
    const w = fresh()
    const clock = await markedThenReread($, on, w, { 'rotate-to': rotateTo })
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    await clock.advance(36_000)
    expect(slots(w)).toEqual([SLOT2])
    expect(w.submitted).toHaveLength(1)
  })
}

// C6 (puma-eslxj.7), a changed expected value. SOURCE: the C6 CASE, RULING 4467: a Fable stop means the week was full,
// and no body of the same week can read it lower but by lagging the stop, so the mark stands until its reset.
test('a check whose usage lists the same Fable week lower leaves the mark a stop left, so the session does not move back before the week resets', async ($, on) => {
  const w = fresh()
  const clock = await markedThenReread($, on, w, {})
  w.usage['tok-1'] = [20, 30, 40]
  await pastNextRead(clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
})

test('the mark a stop left ends at the reset time of the week it marks: a check after it lists no Fable week, and the session can move back', async ($, on) => {
  const w = fresh()
  w.fableResets = '2026-10-12T11:00:00Z'
  const clock = await markedThenReread($, on, w, {})
  // Two hours on, the week the mark stood for has reset.
  await clock.advance(2 * HOUR)
  w.usage['tok-2'] = [10, 30]
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2, ''])
  expect(w.submitted).toHaveLength(2)
})

/** Two logins whose usage lists no Fable week: a Fable stop on each leaves a mark with no reset time the usage gave. */
async function markedWithNoRow($: Engine, on: On, w: World, store: Record<string, unknown>): Promise<MockClock> {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, ...store })
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
  await pastNextRead(clock)
  return clock
}

for (const rotateTo of ['reset', 'room', 'order']) {
  test(`with the rotation going by ${rotateTo}, a Fable mark with no reset time from the usage survives a check that lists no Fable week, and the next stop moves nothing`, async ($, on) => {
    const w = fresh()
    const clock = await markedWithNoRow($, on, w, { 'rotate-to': rotateTo })
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    await clock.advance(36_000)
    expect(slots(w)).toEqual([SLOT2])
    expect(w.submitted).toHaveLength(1)
  })
}

// C6 (puma-eslxj.7), a changed expected value. SOURCE: the C6 CASE, RULING 4467: a body of the mark's week reading it
// lower lags the stop; its earlier reset only shortens a mark that guessed a week from the stop.
test('a Fable mark with no reset time from the usage, then a check that lists the Fable week lower, stands until that week\'s reset, and then the session can move back', async ($, on) => {
  const w = fresh()
  const clock = await markedWithNoRow($, on, w, {})
  // The week the body reads resets three hours after the start, long before the week-long guess.
  w.fableResets = '2026-10-12T13:00:00Z'
  w.usage['tok-1'] = [20, 30, 40]
  await pastNextRead(clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
  // Past that reset, login 1 is free again.
  await clock.advance(3 * HOUR)
  w.usage['tok-1'] = [20, 30, 10]
  await pastNextRead(clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2, ''])
})

/** What the terminal is told when a Fable stop finds no account with Fable room. */
const ALL_SPENT_NOTICE = /^Every Claude account has used its Fable week; the next frees up in 4d \d+h\.$/

/** Stops the session in a row, a 10-minute check between: the notice is the person's, so it is not repeated. */
const FABLE_NOTICE_CASES: { name: string; logins: Record<string, [number, number, number?]>; atStop: Record<string, [number, number, number?]>; stop: { error: string; last_assistant_message?: string }; notice: RegExp }[] = [
  {
    name: 'one login whose read shows the week spent',
    logins: { 'tok-1': [20, 30, 100] },
    atStop: { 'tok-1': [20, 30, 100] },
    stop: FABLE_STOP,
    notice: ALL_SPENT_NOTICE,
  },
  {
    name: 'one login, a stop that says nothing, on a read that shows the week spent by then',
    logins: { 'tok-1': [20, 30, 60] },
    atStop: { 'tok-1': [20, 30, 100] },
    stop: { error: 'rate_limit' },
    notice: ALL_SPENT_NOTICE,
  },
  {
    name: 'one login whose read lists no Fable week',
    logins: { 'tok-1': [20, 30] },
    atStop: { 'tok-1': [20, 30] },
    stop: FABLE_STOP,
    // The usage gave no reset time, so the mark stands a week from the stop.
    notice: /^Every Claude account has used its Fable week; the next frees up in 7d 0h\.$/,
  },
  {
    name: 'two logins, both weeks spent',
    logins: { 'tok-1': [20, 30, 100], 'tok-2': [10, 30, 100] },
    atStop: { 'tok-1': [20, 30, 100], 'tok-2': [10, 30, 100] },
    stop: FABLE_STOP,
    notice: ALL_SPENT_NOTICE,
  },
]

for (const { name, logins, atStop, stop, notice } of FABLE_NOTICE_CASES) {
  test(`with ${name}, a Fable stop tells the terminal that every account has used its Fable week, once however many stops follow`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    Object.assign(w.usage, logins)
    const clock = world(on, w, { accounts: Object.keys(logins).map((_, i) => TWO_LOGINS.accounts[i]) })
    await start($, clock)
    Object.assign(w.usage, atStop)
    await pastLastRead(clock)
    for (let i = 0; i < 3; i++) {
      await $.classic.StopFailure(stop)
      await clock.settle()
      await clock.advance(36_000)
      // Within the first 10 minutes, so the mark a stop left on a login with no Fable row stands.
      expect(w.notices.filter(t => /Fable week/.test(t))).toHaveLength(1)
    }
    expect(w.notices.filter(t => /Fable week/.test(t))[0]).toMatch(notice)
    expect(w.envSets).toEqual([])
    expect(w.submitted).toEqual([])
  })
}

test('a Fable stop that moves to a login with room tells the terminal nothing of the Fable week, the stop that then finds none tells once, and a plain stop never does', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.notices.filter(t => /Fable week/.test(t))).toEqual([])
  // A plain stop with every Fable week spent is the 5-hour window's, not told as the Fable week.
  w.usage['tok-2'] = [100, 30, 100]
  await pastLastRead(clock)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: "You've hit your session limit" })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.notices.filter(t => /Fable week/.test(t))).toEqual([])
  w.usage['tok-2'] = [10, 30, 100]
  await pastLastRead(clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  const told = w.notices.filter(t => /Fable week/.test(t))
  expect(told).toHaveLength(1)
  expect(told[0]).toMatch(ALL_SPENT_NOTICE)
})

/** A Fable stop on login 1, which login 2 answers with Fable room; the store as given. */
async function fableSwitch($: Engine, on: On, store: Record<string, unknown>): Promise<World> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  const clock = world(on, w, { ...TWO_LOGINS, ...store })
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  return w
}

test('after a Fable switch the line sent to carry on is the one kept in the store under fable-continue-text, as the person\'s own words', async ($, on) => {
  const w = await fableSwitch($, on, { 'fable-continue-text': '  Go on on Fable-free ground.  ' })
  expect(w.submitted).toEqual(['Go on on Fable-free ground.'])
  expect(w.asUser).toEqual([true])
})

test('after a Fable switch with no line kept, the mod\'s own line is sent under its name', async ($, on) => {
  const w = await fableSwitch($, on, {})
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
  expect(w.asUser).toEqual([false])
})

/** Switches that are not for the Fable week, each with the stored Fable line set: they carry on with the mod's own line. */
const OTHER_SWITCHES: { name: string; run: ($: Engine, on: On, w: World) => Promise<void> }[] = [
  {
    name: 'a plain usage-limit stop',
    run: async ($, on, w) => {
      w.keychain['Claude Code-credentials'] = blob('tok-1')
      w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
      w.usage['tok-1'] = [60, 40]
      w.usage['tok-2'] = [10, 30]
      const clock = world(on, w, { ...TWO_LOGINS, 'fable-continue-text': 'Go on on Fable-free ground.' })
      await start($, clock)
      w.usage['tok-1'] = [100, 41]
      await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: "You've hit your session limit" })
      await clock.settle()
      await clock.advance(36_000)
    },
  },
  {
    name: 'a rejected sign-in',
    run: async ($, on, w) => {
      w.keychain['Claude Code-credentials'] = blob('tok-1')
      w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
      w.usage['tok-1'] = [60, 40]
      w.usage['tok-2'] = [10, 30]
      const clock = world(on, w, { ...TWO_LOGINS, 'fable-continue-text': 'Go on on Fable-free ground.' })
      await start($, clock)
      await $.classic.StopFailure({ error: 'authentication_failed' })
      await clock.settle()
      await clock.advance(36_000)
    },
  },
  {
    name: 'a usage-limit stop while the session visits the Claude in Chrome account',
    run: async ($, on, w) => {
      w.chrome = { extensions: [SLOT2] }
      await spentTwo(w)
      const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2', 'fable-continue-text': 'Go on on Fable-free ground.' })
      await start($, clock)
      await $.classic.StopFailure({ error: 'rate_limit' })
      await clock.settle()
      await clock.advance(72_000)
    },
  },
]

for (const { name, run } of OTHER_SWITCHES) {
  test(`${name} carries on with the mod's own line, not the stored Fable one, under the mod's name`, async ($, on) => {
    const w = fresh()
    await run($, on, w)
    expect(w.envSets.length).toBeGreaterThan(0)
    expect(w.submitted).toHaveLength(1)
    expect(w.submitted[0]).toMatch(/Continue where you left off/)
    expect(w.asUser).toEqual([false])
  })
}

test('a switch is confirmed once a response reports the new login usage, and an idle session is not told it failed', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [93, 40]
  w.usage['tok-2'] = [10, 30]
  // Login 1's week resets at another time than login 2's, whose week the responses below carry.
  w.weekResets = { 'tok-1': OTHER_WEEK }
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  // Minutes with no response: the last one is still login 1's, which says nothing of the switch.
  w.limits = [{ kind: 'five_hour', percentUsed: 93, resetsAt: '2026-10-12T12:00:00Z' }]
  await clock.advance(5 * 60_000)
  expect(w.toasts.filter(t => /has not shown/.test(t))).toEqual([])
  w.limits = [
    { kind: 'five_hour', percentUsed: 11, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-18T03:00:00Z' },
  ]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  // Confirmed: the next response's usage is login 2's own again.
  w.limits = [
    { kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-18T03:00:00Z' },
  ]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // Room left, as the footer counts it: login 2 has used 20% of its 5-hour window and 30% of its week.
  expect(await pane.find({ text: /^▰{2}▱{8} 20%$/ })).toBeDefined()
  expect(await pane.find({ text: /^▰{3}▱{7} 30%$/ })).toBeDefined()
  expect(w.toasts.filter(t => /has not shown/.test(t))).toEqual([])
  await pane.unmount()
})

// puma-eslxj.2 (C1): a typed command is the person's, so an agent can open the pane without a mouse.
test('/accounts is listed, opens the accounts pane, and a second /accounts closes it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  await start($, clock)
  expect(registered).toEqual(['accounts'])
  await $.command.run({ command: 'accounts' })
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
  await $.command.run({ command: 'accounts' })
  await clock.settle()
  expect(w.panes).toEqual([])
})

/** A world with tok-1 on login 1 and a `command.register` that records each spec it is given. */
function commandWorld(on: On, specs: unknown[] = []): { clock: MockClock; w: World } {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  on('command.register', (_$, e) => {
    specs.push(e)
    return { value: { command: e.name } }
  })
  return { clock, w }
}

// Review C1 r2 F1 and r1 REFUSED-COMMAND-HIJACK, class REGISTRATION-LIFECYCLE: the command exists only once it is known to.
test('/accounts is registered with its whole spec before the first session.start resolves', async ($, on) => {
  const specs: unknown[] = []
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  world(on, w, TWO_LOGINS)
  on('command.register', async (_$, e) => {
    await new Promise(resolve => setTimeout(resolve, 20))
    specs.push(e)
    return { value: { command: e.name } }
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  expect(specs).toEqual([{ name: 'accounts', description: 'Open or close the Claude accounts panel', immediate: true }])
})

test('a refused /accounts registration leaves the command to its owner and opens no pane', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  on('command.register', () => ({ deny: 'built-in name' }))
  on('command.run', { command: 'accounts' }, () => ({ text: 'built-in accounts' }))
  await start($, clock)
  expect((await $.command.run({ command: 'accounts' })).text).toBe('built-in accounts')
  expect(w.panes).toEqual([])
})

test('an accounts command of the person\'s own is left to them: /accounts is not registered over it', async ($, on) => {
  const specs: unknown[] = []
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  on('command.list', () => ({ value: [{ name: 'accounts', description: 'mine', source: 'user' as const }] }))
  on('command.register', (_$, e) => {
    specs.push(e)
    return { value: { command: e.name } }
  })
  on('command.run', { command: 'accounts' }, () => ({ text: 'my accounts' }))
  await start($, clock)
  expect(specs).toEqual([])
  expect((await $.command.run({ command: 'accounts' })).text).toBe('my accounts')
  expect(w.panes).toEqual([])
})

// Review C1 r1 PANE-COMMAND-EMPTY-OUTPUT and r2 CONTRACT-DRIFT: a command that only shows a pane prints no text.
test('/accounts answers with no text', async ($, on) => {
  const { clock } = commandWorld(on)
  await start($, clock)
  expect((await $.command.run({ command: 'accounts' })).text).toBeUndefined()
})

// Review C1 r2 F2, class STATE-BEFORE-EFFECT: the pane's state follows what open and close did.
test('after a refused open, the next /accounts opens the accounts pane', async ($, on) => {
  let refusals = 1
  on('ui.open', { id: 'claude-accounts' }, (_$, e, next) => {
    if (refusals === 0) return next(e)
    refusals -= 1
    return { deny: 'another plugin refused the open' }
  })
  const { clock, w } = commandWorld(on)
  await start($, clock)
  await $.command.run({ command: 'accounts' }).catch(() => undefined)
  await clock.settle()
  expect(w.panes).toEqual([])
  await $.command.run({ command: 'accounts' }).catch(() => undefined)
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
})

test('after a refused close, the next /accounts closes the accounts pane', async ($, on) => {
  let refusals = 0
  on('ui.close', { id: 'claude-accounts' }, (_$, e, next) => {
    if (refusals === 0) return next(e)
    refusals -= 1
    return { deny: 'another plugin refused the close' }
  })
  const { clock, w } = commandWorld(on)
  await start($, clock)
  await $.command.run({ command: 'accounts' }).catch(() => undefined)
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
  refusals = 1
  await $.command.run({ command: 'accounts' }).catch(() => undefined)
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
  await $.command.run({ command: 'accounts' }).catch(() => undefined)
  await clock.settle()
  expect(w.panes).toEqual([])
})

test('one press on the footer opens the accounts pane, the next closes it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // Switching works here: no warning beside the glyphs.
  expect(await footer.find({ key: 'switch-blocked' })).toBeUndefined()
  await footer.press(GLYPHS)
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
  await footer.press(GLYPHS)
  await clock.settle()
  expect(w.panes).toEqual([])
  await footer.unmount()
})

test('under the pointer the footer names its rows and lights its glyphs on a shade, drawn swapped for the inverting control', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await footer.find({ text: 'Session:' })).toBeDefined()
  expect(await footer.find({ text: 'Weekly:' })).toBeDefined()
  const [line, one] = painted((await footer.find(GLYPHS))?.children[0])
  expect(line).toMatchObject({ color: 'subtle', hover: { color: 'userMessageBackground', backgroundColor: 'inactive' } })
  expect(one).toMatchObject({ color: roomColor(80), hover: { color: 'userMessageBackground', backgroundColor: roomColor(80, true) } })
  await footer.unmount()
})

test('Rotate now moves to the login with the most room; the one in use is marked in use at the right end, with no switching left on it', async ($, on) => {
  const w = fresh()
  const SLOT3 = '/Users/tester/.claude/accounts/3'
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [60, 30]
  w.usage['tok-3'] = [40, 50]
  const three = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }] }
  const clock = world(on, w, three)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT3 }])
  await pane.redraw()
  expect((await pane.find({ type: 'Text', text: /^● in use$/ }))?.props).toMatchObject({ color: 'warning' })
  expect(await pane.find({ text: /switching/ })).toBeUndefined()
  // Each line ends in its use, rightmost: Remove, where a login has one, stands before it.
  const ends = (await pane.findAll({ text: /^(Remove|Use now|● in use)$/ })).filter(e => e.type !== 'Box')
  expect(ends.map(e => e.text)).toEqual(['Use now', 'Remove', 'Use now', 'Remove', '● in use'])
  await pane.unmount()
})

test('with next in list picked, Rotate now moves to the login after the one in use, not the one with the most room', async ($, on) => {
  const w = fresh()
  const SLOT3 = '/Users/tester/.claude/accounts/3'
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [60, 30]
  w.usage['tok-3'] = [40, 50]
  const three = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }] }
  const clock = world(on, w, three)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^● soonest reset$/ })).toBeDefined()
  await pane.press({ key: 'rotate-to-order' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^● next in list$/ })).toBeDefined()
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.unmount()
})

// puma-4q7j2.4: the pane's first line no longer states the rule; the settings rows do.
test('with the 5-hour limit off, the account in use past 90% of its 5-hour window stays, and the pane names no 5-hour rule at its top; turned on in the pane, it moves', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [92, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'five-hour-limit': 'off' })
  await start($, clock)
  await clock.advance(11 * 60_000)
  expect(w.envSets).toEqual([])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^Once the account in use/ })).toBeUndefined()
  expect(await pane.find({ text: /5-hour/ })).toBeUndefined()
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await clock.advance(10 * 60_000)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.unmount()
})

// Bug puma-4q7j2.3: an account with no 5-hour window has only its week to run out, so a stop marks the week, never a 5-hour window.
test('a plain usage-limit stop on an account that reports no 5-hour window moves, and marks its week spent until the week resets, with no 5-hour row', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'five-hour-limit': 'off' })
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: /^5h(?: | –)$/ })).toHaveLength(0)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /: account 1 has 0% of its week left\.$/.test(t))).toHaveLength(1)
  await pane.redraw()
  expect(await pane.find({ text: /^  resets [0-9]+h/ })).toBeUndefined()
  expect(await pane.findAll({ type: 'Text', text: /^5h(?: | –)$/ })).toHaveLength(0)
  await pane.unmount()
})

/** A turn that died on the week, in Claude Code's words as seats on a Mac got them, its accounts reporting no 5-hour window. */
const WEEKLY_STOP = { error: 'rate_limit', last_assistant_message: "You've hit your weekly limit · resets Nov 10 at 11am (Europe/Tallinn)" }

// Bug puma-4q7j2.3: the stop went out on the login being left, and was marked on the one moved to.
test('a session that starts on a login whose week is spent moves at once; a turn that dies on that week before the switch lands marks nothing on the login moved to, and carries on once it lands', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 100]
  w.usage['tok-2'] = [null, 7]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await $.classic.StopFailure(WEEKLY_STOP)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: /^5h(?: | –)$/ })).toHaveLength(0)
  expect(await pane.find({ text: /^  resets [0-9]+h/ })).toBeUndefined()
  await pane.unmount()
  expect(w.envSets).toHaveLength(1)
  expect(w.submitted).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
})

// Bug puma-4q7j2.3, RULING 4226: the store as the bug left it on a Mac, a 5-hour mark on an account that reports none.
test('a 5-hour stop mark already stored on a login whose usage reports no 5-hour window counts for nothing: the session moves there at once', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [null, 100]
  w.usage['tok-2'] = [null, 7]
  w.usage['tok-3'] = [null, 10]
  const bogus = { pct: 100, resetsAt: '2026-10-12T14:00:00Z', at: NOW - HOUR }
  const store = new Map<string, unknown>(Object.entries({ ...THREE_LOGINS, 'mark:2': bogus, 'mark:3': bogus }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const isClear = async () => {
    await pane.redraw()
    return (await pane.findAll({ type: 'Text', text: /^5h(?: | –)$/ })).length === 0 && (await pane.find({ text: /^  resets [0-9]+h/ })) === undefined
  }
  expect(await isClear()).toBe(true)
  // A session on an older version saves login 3's reading as it reads it, knowing nothing of the 5-hour window it lacks.
  store.set('reading:3', { sevenDay: { pct: 10, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW + 60_000 })
  await clock.advance(61_000)
  expect(await isClear()).toBe(true)
  await pane.unmount()
})

test('two turns that die before one switch lands carry on once', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 100]
  w.usage['tok-2'] = [null, 7]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await $.classic.StopFailure(WEEKLY_STOP)
  await clock.settle()
  await clock.advance(5_000)
  await $.classic.StopFailure(WEEKLY_STOP)
  await clock.settle()
  await clock.advance(40_000)
  expect(w.submitted).toHaveLength(1)
})

// Review R2 of #6 mixed_writer: a session on an older version saved a reading over the week a stop marked.
test('a stop\'s week mark stands when a session on an older version saves the login\'s reading as the usage endpoint still lags', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 90]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure(WEEKLY_STOP)
  await clock.settle()
  expect(w.envSets).toHaveLength(1)
  store.set('reading:1', { sevenDay: { pct: 90, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW + 60_000 })
  await clock.advance(61_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.envSets).toHaveLength(1)
  await pane.unmount()
})

test('a turn that dies on the weekly limit marks the week spent, never a 5-hour window, and moves', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 90]
  w.usage['tok-2'] = [null, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([])
  await $.classic.StopFailure(WEEKLY_STOP)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /^Switched to Claude account 2.*: account 1 has 0% of its week left\.$/.test(t))).toHaveLength(1)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: /^5h(?: | –)$/ })).toHaveLength(0)
  expect(await pane.find({ text: /^  resets [0-9]+h/ })).toBeUndefined()
  await pane.unmount()
})

test('a stored stop mark with no reset time, on an account whose token is not live to read it again, stops counting five hours after its read', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  // Login 2's access token has run out: no check reads its usage again.
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW - HOUR)
  w.usage['tok-1'] = [null, 40]
  const stale = { fiveHour: { pct: 100 }, sevenDay: { pct: 10, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - 6 * HOUR, by: '2', v: 1, src: 'body' }
  const clock = world(on, w, { ...TWO_LOGINS, 'usage:2': stale })
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // C7 (puma-eslxj.8), a changed expected value. SOURCE: the bead's decision "Draw a 5h line only when the newest
  // accepted body or response lists a window, or a stop mark stands" (RULING 4490). Login 1 reports no 5-hour window;
  // login 2's only window was an older version's stop mark, passed, and no body said it has one: neither draws a 5h row.
  expect(await pane.findAll({ type: 'Text', text: /^5h(?: | –)$/ })).toHaveLength(0)
  expect(await pane.findAll({ type: 'Text', text: /^5h(?: | –)$/ })).toHaveLength(0)
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.unmount()
})

test('turning the 5-hour limit off moves at once to a login held back only by its 5-hour window', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 100]
  w.usage['tok-2'] = [95, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'five-hour-limit-off' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.unmount()
})

test('a stop\'s mark on a login that reports a 5-hour window stands when the 5-hour limit is turned off', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [50, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'five-hour-limit-off' })
  await clock.settle()
  await pane.redraw()
  // Login 2's read window is dropped; login 1's mark stays until its reset.
  // With the limit off, the login known to have a 5-hour window keeps its line, its window dropped from the count.
  expect(await pane.findAll({ type: 'Text', text: /^5h –$/ })).toHaveLength(1)
  await pane.unmount()
})

// Review R1 mark_lifetime: a check or response whose read lists no 5-hour window ended a stop's mark early.
// The mark is the week's since bug puma-4q7j2.3: such an account has no 5-hour window.
test('a plain stop\'s week mark on an account that reports no 5-hour window stands through the next account check', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'five-hour-limit': 'off' })
  await start($, clock)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await clock.advance(11 * 60_000)
  await pane.redraw()
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await pane.unmount()
})

// Review R1 mark_lifetime, the class: every writer of a reading, under every rotation choice and both switch values.
test('a stop\'s week mark on an account that reports no 5-hour window stands through every reading writer, under every setting', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 96]
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // C7 (puma-eslxj.8), a changed step. SOURCE: the bead's decision that the "5h limit" row shows only while some account
  // is known to have a window (RULING 4490). Neither account here has one, so the limit is set in the store every
  // session shares, as another session's press sets it, and this session takes it at its next merge.
  const setLimit = async (limit: 'on' | 'off') => {
    store.set('five-hour-limit', limit)
    await clock.advance(61_000)
  }
  const markVisible = async () => {
    await pane.redraw()
    return (await pane.find({ text: /^▰{10} 100%$/ })) !== undefined
  }
  const offenders: string[] = []
  for (const rotateTo of ['reset', 'room', 'order', 'off'] as const) {
    await pane.press({ key: `rotate-to-${rotateTo}` })
    for (const limit of ['on', 'off'] as const) {
      await setLimit(limit)
      await clock.settle()
      await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
      await clock.settle()
      if (!(await markVisible())) offenders.push(`stop / ${rotateTo} / ${limit}`)
      await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
      await clock.settle()
      if (!(await markVisible())) offenders.push(`response / ${rotateTo} / ${limit}`)
      await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
      await clock.settle()
      if (!(await markVisible())) offenders.push(`restop / ${rotateTo} / ${limit}`)
      await clock.advance(11 * 60_000)
      if (!(await markVisible())) offenders.push(`account check / ${rotateTo} / ${limit}`)
    }
  }
  await pane.unmount()
  expect(offenders).toEqual([])
})

// Review R1 toggle_restore: the store kept the counted reading, so turning the limit back on could not restore a window.
test('turning the 5-hour limit off and back on restores a reported 5-hour window at once', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [80, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰{8}▱{2} 80%$/ })).toBeDefined()
  await pane.press({ key: 'five-hour-limit-off' })
  await clock.settle()
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{8}▱{2} 80%$/ })).toBeDefined()
  await pane.unmount()
})

test('a read saved while the 5-hour limit is off keeps its 5-hour window in the store, shown at once when turned on', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [80, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'five-hour-limit': 'off' })
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰{8}▱{2} 80%$/ })).toBeUndefined()
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{8}▱{2} 80%$/ })).toBeDefined()
  await pane.unmount()
})

test('another session turning the 5-hour limit on shows this session\'s reported windows at its next store merge', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [80, 40]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'five-hour-limit': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰{8}▱{2} 80%$/ })).toBeUndefined()
  // Another session's press.
  store.set('five-hour-limit', 'on')
  await clock.advance(61_000)
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{8}▱{2} 80%$/ })).toBeDefined()
  await pane.unmount()
})

test('with the 5-hour limit off, a plain stop on a login that reports a 5-hour window marks it until that window\'s reset', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [50, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'five-hour-limit': 'off' })
  await start($, clock)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^  resets 2h 0m$/ })).toBeDefined()
  await pane.unmount()
})

test('a Fable stop while the 5-hour limit is off keeps the login\'s reported 5-hour window for when it is turned on', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [50, 40, 50]
  w.usage['tok-2'] = [10, 30, 10]
  const clock = world(on, w, { ...TWO_LOGINS, 'five-hour-limit': 'off' })
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{5}▱{5} 50%$/ })).toBeDefined()
  await pane.unmount()
})

/** Another session's stop mark on login 1, as it stores it. */
const OTHER_MARK = { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW }

/**
 * A store another session writes into: once armed, it stores OTHER_MARK the moment
 * this session saves login 1's reading, as a stop in another session would land
 * between this session's read and write of that login.
 */
class OtherSessionStore extends Map<string, unknown> {
  site = ''
  injected: string[] = []
  set(key: string, value: unknown): this {
    if (this.site !== '' && key === 'usage:1') {
      super.set('mark:1', OTHER_MARK)
      this.injected.push(this.site)
      this.site = ''
    }
    return super.set(key, value)
  }
}

// Review R2 race_mark: a save of a reading erased a stop mark another session wrote between its read and its write.
test('another session\'s stop mark, landing as a response saves the reading, stands in the store and in the view', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  // Logins that report a 5-hour window: one with none takes no 5-hour mark.
  w.usage['tok-1'] = [30, 40]
  w.usage['tok-2'] = [30, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new OtherSessionStore(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  store.site = 'response'
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  expect(store.injected).toEqual(['response'])
  expect(store.get('mark:1')).toEqual(OTHER_MARK)
  await clock.advance(61_000)
  await pane.redraw()
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await pane.unmount()
})

// Review R2 race_mark, the class: every writer that saves a reading, each shown to have met the other session's mark.
test('another session\'s stop mark stands through every save of a reading on the same login', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [30, 40, 40]
  w.usage['tok-2'] = [30, 30, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  const store = new OtherSessionStore(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const offenders: string[] = []
  const writers: [string, () => Promise<unknown>][] = [
    ['response', () => $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })],
    ['usage check', () => pastNextRead(clock)],
    ['Fable stop', () => $.classic.StopFailure(FABLE_STOP)],
  ]
  for (const [site, write] of writers) {
    store.delete('mark:1')
    store.site = site
    await write()
    await clock.settle()
    await clock.advance(61_000)
    await pane.redraw()
    const isShown = (await pane.find({ text: /^▰{10} 100%$/ })) !== undefined
    if (JSON.stringify(store.get('mark:1')) !== JSON.stringify(OTHER_MARK) || !isShown) offenders.push(site)
  }
  await pane.unmount()
  expect(store.injected).toEqual(writers.map(([site]) => site))
  expect(offenders).toEqual([])
})

test('a Fable stop on a login with a standing 5-hour mark leaves the mark standing', async ($, on) => {
  const w = fresh()
  // Login 1's token has run out: no check reads it again, so only the stop writes its reading.
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-2'] = [null, 30, 10]
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    // A 5-hour window read an hour before the stop that marked it.
    'reading:1': { fiveHour: { pct: 50, resetsAt: '2026-10-12T12:00:00Z' }, sevenDay: { pct: 40, resetsAt: '2026-10-18T03:00:00Z' }, fable: { pct: 50, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - HOUR, by: '1' },
    'mark:1': { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW - 30 * 60_000 },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(61_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await pane.unmount()
})

test('removing a login removes its stop mark with its reading', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'mark:2': { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW } }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  expect(store.has('reading:2')).toBe(false)
  expect(store.has('mark:2')).toBe(false)
  await pane.unmount()
})

test('two sessions\' stops, on two logins at once, each leave their mark', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [30, 40]
  w.usage['tok-2'] = [30, 30]
  w.usage['tok-3'] = [20, 20]
  const store = new Map<string, unknown>(Object.entries(THREE_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  // The other session's stop on login 2, stored as this session's stop on login 1 runs.
  store.set('mark:2', { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW })
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(store.get('mark:1')).toBeDefined()
  expect(store.get('mark:2')).toBeDefined()
  // Neither marked login is a target: the session moves to login 3.
  expect(w.envSets.at(-1)).toEqual({ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT3 })
})

// Review R1 toggle_restore, the class: a reported window through a save, off, on and a store merge, under every rotation choice.
test('a reported 5-hour window survives a save, the limit off and on, and a store merge, under every rotation choice', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [80, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const visible = async () => {
    await pane.redraw()
    return (await pane.find({ text: /^▰{8}▱{2} 80%$/ })) !== undefined
  }
  const offenders: string[] = []
  for (const rotateTo of ['reset', 'room', 'order', 'off'] as const) {
    await pane.press({ key: `rotate-to-${rotateTo}` })
    await clock.settle()
    await clock.advance(11 * 60_000)
    if (!(await visible())) offenders.push(`saveReading / ${rotateTo} / on`)
    await pane.press({ key: 'five-hour-limit-off' })
    await clock.settle()
    if (await visible()) offenders.push(`setFiveHourLimit / ${rotateTo} / off`)
    await pane.press({ key: 'five-hour-limit-on' })
    await clock.settle()
    if (!(await visible())) offenders.push(`setFiveHourLimit / ${rotateTo} / on`)
    await clock.advance(61_000)
    if (!(await visible())) offenders.push(`mergeStore / ${rotateTo} / on`)
  }
  await pane.unmount()
  expect(offenders).toEqual([])
})

test('a switch held back for a token about to refresh is said once and made once, when the refresh lands', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  await clock.advance(2 * 60_000)
  expect(w.envSets).toEqual([])
  expect(w.toasts.filter(t => /Switching to Claude account 2/.test(t))).toHaveLength(1)
  // Claude Code refreshes the token: the next try goes through, once.
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 8 * HOUR)
  await clock.advance(3 * 60_000)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /Switched to Claude account 2/.test(t))).toHaveLength(1)
  await pane.unmount()
})

// puma-eslxj.29 [HELD-LOST-AT-RELOAD] (RULING 4708): the kit cannot reload a module, so these pin what survives one.
function watchedView(on: On): () => View | undefined {
  let view: View | undefined
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view') view = value
    return next(e)
  })
  return () => view
}

test('a switch held back is in the view until it lands, and session.start\'s minute tick lands it', async ($, on) => {
  const w = fresh()
  const clock = await guarded(on, w, {}, [20, 30])
  const view = watchedView(on)
  await start($, clock)
  // Between two ticks, so a wait of the switch's own would come due after the next one.
  await clock.set(NOW + 70_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect([view()?.activeId, view()?.held?.target.id, w.envSets]).toEqual(['1', '2', []])
  refresh(w)
  await clock.set(NOW + 121_000)
  expect([view()?.held, w.envSets]).toEqual([undefined, [{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }]])
  await pane.unmount()
})

test('a held switch\'s retry that throws is logged', async ($, on) => {
  const w = fresh()
  const clock = await guarded(on, w, {}, [20, 30])
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  w.breakEnv = true
  refresh(w)
  await clock.advance(60_000)
  expect((w.logged ?? []).filter(line => line.includes('held switch retry failed'))).toHaveLength(1)
  await pane.unmount()
})

// Bug puma-4q7j2.3, the slot-4 overwrite: a session that starts on a login whose token has already run out refreshes it
// first, and a switch made before that refresh lands saved the login's refreshed sign-in under the account moved to.
test('a session that starts on a spent login whose token has run out holds the switch until Claude Code refreshes the token there', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 100]
  w.usage['tok-2'] = [null, 30]
  // Another session read login 1's spent week while its token was live.
  const clock = world(on, w, { ...TWO_LOGINS, 'usage:1': { sevenDay: { pct: 100, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - 2 * HOUR, by: '1', v: 1, src: 'body' } })
  await start($, clock)
  await clock.advance(2 * 60_000)
  expect(w.envSets).toEqual([])
  expect(w.toasts.filter(t => /Switching to Claude account 2/.test(t))).toHaveLength(1)
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 8 * HOUR)
  await clock.advance(61_000)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

// RULING 4232: a usage check that fails says so in the pane and the store, until one succeeds.
test('a usage check that fails shows its HTTP status on the login\'s line and in the store, and a later check that succeeds clears both', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 30]
  w.usage['tok-2'] = [null, 40]
  w.failing = { 'tok-2': 429 }
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const failedTexts = (await pane.findAll({ type: 'Text', text: /^(\d\d:\d\d Failed to update| \(HTTP 429\)|, next try \d\d:\d\d)$/ })).map(t => t.text?.replace(/\d\d:\d\d/g, 'HH:MM'))
  expect(failedTexts).toEqual(['HH:MM Failed to update', ' (HTTP 429)', ', next try HH:MM'])
  expect(store.get('check-error:2')).toEqual({ why: 'the usage call answered HTTP 429', at: NOW + USAGE_CLAIM_WAIT_MS })
  w.failing = {}
  await clock.advance(10 * 60_000)
  await pane.redraw()
  expect(await pane.find({ text: /Failed to update/ })).toBeUndefined()
  expect(store.has('check-error:2')).toBe(false)
  await pane.unmount()
})

// Review R1 of the slot-4 fix, stuck_hold: a rejected sign-in whose token has run out refreshes nothing, so nothing holds the switch.
test('a rejected sign-in on a login whose token has run out moves off it at once, not held for a refresh that will not come', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-2'] = [null, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([])
  await $.classic.StopFailure({ error: 'authentication_failed' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

// Review R1 of the slot-4 fix, cross_session_clear: a good check clears a failure another session stored.
test('a usage check that succeeds clears the failure another session stored, though this session never saw it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 30]
  w.usage['tok-2'] = [null, 40]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  // A minute on, past the minute's merge, so the stop reads the usage again.
  await pastLastRead(clock)
  // Another session's check of login 1 failed; this session's next check of it, the stop's own, succeeds before any merge.
  store.set('check-error:1', { why: 'the usage call answered HTTP 429', at: NOW })
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(store.has('check-error:1')).toBe(false)
})

test('a session on a login whose sign-in has run out, token and all, moves off it at once: nothing will refresh there', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = JSON.stringify({
    claudeAiOauth: { accessToken: 'tok-1', refreshToken: 'refresh-tok-1', expiresAt: NOW - HOUR, refreshTokenExpiresAt: NOW - 60_000, scopes: ['user:inference'], subscriptionType: 'max' },
  })
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-2'] = [null, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

test('a login whose plan reports no weekly limit leaves its week blank in the footer', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, null]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // Login 1, in use, has no week: blank below its braille, and no week percent at the right.
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣷   80% \n│ │▆       ')
  await footer.unmount()
})

test('with no weekly limit on any login, the footer leaves the week row out', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, null]
  w.usage['tok-2'] = [10, null]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣷   80% ')
  await footer.unmount()
})

// Bug puma-4q7j2.9: a plan with no 5-hour window (Ultra) drew a 5h row in the pane and a session glyph in the footer.
test('a login whose usage reports no 5-hour window has no 5h row in the pane; a login that reports one keeps it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: /^5h $/ })).toHaveLength(1)
  expect(await pane.findAll({ type: 'Text', text: /^Used $/ })).toHaveLength(2)
  expect(await pane.find({ text: /^5h –$/ })).toBeUndefined()
  expect(await pane.find({ text: /^▰{1}▱{9} 10%$/ })).toBeDefined()
  await pane.unmount()
})

test('a login whose usage reports no 5-hour window leaves its session place blank in the footer', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // Login 1, in use, has no 5-hour window: blank above its week, and no session percent at the right.
  expect((await footer.find(GLYPHS))?.text).toBe('│ │⣷       \n│▅│▆   60% ')
  await footer.unmount()
})

test('with no 5-hour window on any login, the footer leaves the session row out', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(await footer.find({ text: 'Session:' })).toBeUndefined()
  expect(await footer.find({ text: 'Weekly:' })).toBeDefined()
  expect((await footer.find(GLYPHS))?.text).toBe('│▅│▆   60% ')
  await footer.unmount()
})

test('with the session row left out, the week row says which login needs a sign-in', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [null, 40]
  const clock = world(on, w, { ...TWO_LOGINS, 'no-five-hour:2': true })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find(GLYPHS))?.text).toBe('│▅│⚠   60% ')
  await footer.unmount()
})

// Review R2 MARKLOST: the sign-in mark rode the first row drawn, which may draw no glyph columns.
test('with no 5-hour window on any login and the week glyphs off, the footer still says which login needs a sign-in', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [null, 40]
  const clock = world(on, w, { ...TWO_LOGINS, 'no-five-hour:2': true, footer: { ...DEFAULT_FOOTER, week: 'none' } })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // The session row stays for the mark, blank but for it.
  expect((await footer.find(GLYPHS))?.text).toBe('│ │⚠       \n│ │    60% ')
  await footer.unmount()
})

// Review R1 PREEXISTING-MARK-VISIBILITY, folded into R2 MARKLOST: a session row drawn for its percent alone took the mark.
test('with the session glyphs off and its percent on, the week row says which login needs a sign-in', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 40]
  const clock = world(on, w, { ...TWO_LOGINS, footer: { ...DEFAULT_FOOTER, session: 'none' } })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const [, week] = ((await footer.find(GLYPHS))?.text ?? '').split('\n')
  expect(week).toContain('⚠')
  await footer.unmount()
})

// Review R2 MARKLOST, the class: every footer setting that picks glyphs for some row, with the session row left out.
test('with the session row left out, every footer setting that picks glyphs for a row shows the sign-in mark', { timeoutMs: 30_000 }, async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [null, 40]
  const clock = world(on, w, { ...TWO_LOGINS, 'no-five-hour:2': true })
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const glyphs = ['bars', 'pie', 'braille', 'none'] as const
  const percents = [true, false] as const
  const actives = ['lines', 'tile', 'dim'] as const
  const fills = ['left', 'used'] as const
  let sessionPercent: boolean = DEFAULT_FOOTER.sessionPercent
  let weekPercent: boolean = DEFAULT_FOOTER.weekPercent
  const offenders: string[] = []
  let swept = 0
  for (const session of glyphs) for (const week of glyphs) for (const sp of percents) for (const wp of percents) for (const active of actives) for (const fill of fills) {
    if (session === 'none' && week === 'none') continue
    await pane.press({ key: `footer-session-${session}` })
    await pane.press({ key: `footer-week-${week}` })
    if (sessionPercent !== sp) await pane.press({ key: 'footer-percent-session' })
    if (weekPercent !== wp) await pane.press({ key: 'footer-percent-week' })
    sessionPercent = sp
    weekPercent = wp
    await pane.press({ key: `footer-active-${active}` })
    await pane.press({ key: `footer-fill-${fill}` })
    await clock.settle()
    await footer.redraw()
    await pane.redraw()
    swept += 1
    const text = (await footer.find(GLYPHS))?.text ?? ''
    if (!text.includes('⚠')) offenders.push(`session=${session} week=${week} sessionPercent=${sp} weekPercent=${wp} active=${active} fill=${fill}: ${JSON.stringify(text)}`)
  }
  // 15 glyph pairs with a row's glyphs picked, each with every percent, highlight and fill.
  expect(swept).toBe(15 * 2 * 2 * 3 * 2)
  expect(offenders.length === 0 ? 'none' : `${offenders.length} settings lose login 2's ⚠ (draw the mark on the first row that keeps glyph columns):\n${offenders.join('\n')}`).toBe('none')
  await footer.unmount()
  await pane.unmount()
})

// Review R2 UNPINNED-BRANCH: the store's flag decides the pane's 5h row while a login has no reading yet.
test('a login with no reading yet whose store says it has no 5-hour window has no 5h row in the pane', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 40]
  const clock = world(on, w, { ...TWO_LOGINS, 'no-five-hour:2': true })
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: /^5h $/ })).toHaveLength(1)
  await pane.unmount()
})

// Review R2 UNPINNED-BRANCH: the demo previews every row.
// Review R2 MARKLOST ledger row 5: the dot for a login with no reading yet rode row 0, which may be left out or draw no glyphs.
test('with the session glyphs off, the week row shows the dot of a login with no reading yet', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.failing = { 'tok-2': 429 }
  const clock = world(on, w, { ...TWO_LOGINS, footer: { ...DEFAULT_FOOTER, session: 'none' } })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const [, week] = ((await footer.find(GLYPHS))?.text ?? '').split('\n')
  expect(week).toContain('·')
  await footer.unmount()
})

test('the demo keeps the session row when no login has a 5-hour window', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  await pane.press({ key: 'footer-preview-demo' })
  await clock.settle()
  await footer.redraw()
  expect(await footer.find({ text: 'Session:' })).toBeDefined()
  await footer.unmount()
  await pane.unmount()
})

test('the pane picks each footer row\'s style for every session, and previews it with demo values', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find(GLYPHS))?.text).toBe('│⣷│⣷   80% \n│▆│▆   70% ')
  await pane.press({ key: 'footer-session-bars' })
  await pane.press({ key: 'footer-week-none' })
  await clock.settle()
  await footer.redraw()
  // The week's glyphs are off but its percent is still on: the row keeps just that, under the other's.
  expect((await footer.find(GLYPHS))?.text).toBe('│▇│▇   80% \n│ │    70% ')
  // Kept in the store every session reads: the next sync from it keeps the picks.
  await clock.advance(61_000)
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│▇│▇   80% \n│ │    70% ')
  // The demo draws imitated usage (login 1: 85% now, 70% of its week; login 2: 60%, 40%), this session only.
  await pane.press({ key: 'footer-preview-demo' })
  await pane.press({ key: 'footer-week-pie' })
  await clock.settle()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│▇│▅   85% \n│◕│◑   70% ')
  // Each row's percent switches off on its own; a row with no glyphs keeps just its percent.
  await pane.press({ key: 'footer-percent-week' })
  await pane.press({ key: 'footer-session-none' })
  await clock.settle()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('│ │    85% \n│◕│◑       ')
  // 'tile': the column in use on the theme's dim gray, padded half a cell each side, kept under the pointer.
  await pane.press({ key: 'footer-active-tile' })
  await clock.settle()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('▐ ▌    85% \n▐◕▌◑       ')
  const [padBefore, tiledOne, padAfter, untiled] = painted((await footer.find(GLYPHS))?.children[2])
  expect(padBefore).toMatchObject({ color: 'subtle', hover: { color: 'userMessageBackground', backgroundColor: 'subtle' } })
  expect(tiledOne).toMatchObject({ color: roomColor(70), backgroundColor: 'subtle', hover: { color: 'subtle', backgroundColor: roomColor(70, true) } })
  expect(padAfter).toMatchObject({ color: 'subtle' })
  expect(untiled).toMatchObject({ color: roomColor(40), hover: { color: 'userMessageBackground' } })
  expect(untiled?.backgroundColor).toBeUndefined()
  // 'dim the rest': no marks beside the columns, the logins not in use dimmed.
  await pane.press({ key: 'footer-active-dim' })
  await clock.settle()
  await footer.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('       85% \n ◕ ◑       ')
  const [brightOne, dimTwo] = painted((await footer.find(GLYPHS))?.children[2])
  expect(brightOne?.dimColor).toBeUndefined()
  expect(dimTwo).toMatchObject({ color: roomColor(40), dimColor: true })
  // Showing what is used fills by it, in the footer and the pane; the colors still follow the room left.
  await pane.press({ key: 'footer-fill-used' })
  await clock.settle()
  await footer.redraw()
  await pane.redraw()
  expect((await footer.find(GLYPHS))?.text).toBe('       15% \n ◔ ◑       ')
  const [usedOne, usedTwo] = painted((await footer.find(GLYPHS))?.children[2])
  expect(usedOne).toMatchObject({ color: roomColor(70) })
  expect(usedTwo).toMatchObject({ color: roomColor(40) })
  // The pane's bars draw the percent used whatever the footer fills with.
  expect(await pane.find({ text: /^▰{2}▱{8} 20%$/ })).toBeDefined()
  await pane.unmount()
  await footer.unmount()
})

test('in Terminal.app, which draws block characters from its font, the tile pads its column with whole cells', async ($, on) => {
  const w = fresh()
  w.env.TERM_PROGRAM = 'Apple_Terminal'
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, footer: { active: 'tile' } })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.find(GLYPHS))?.text).toBe(' ⣷ ⣷   80% \n ▆ ▆   70% ')
  const [padBefore, tiled, padAfter, untiled] = painted((await footer.find(GLYPHS))?.children[0])
  expect(padBefore).toMatchObject({ backgroundColor: 'subtle', hover: { color: 'subtle' } })
  expect(tiled).toMatchObject({ color: roomColor(80), backgroundColor: 'subtle' })
  expect(padAfter).toMatchObject({ backgroundColor: 'subtle', hover: { color: 'subtle' } })
  expect(untiled).toMatchObject({ color: roomColor(90) })
  expect(untiled?.backgroundColor).toBeUndefined()
  await footer.unmount()
})

const SLOT3 = `${HOME}/.claude/accounts/3`
const THREE_LOGINS = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }] }
/** The person types /login at the prompt. */
const LOGIN = { command: 'login', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

/** Three logins, each signed in as its own account; the session on login 3, as the mod leaves it after a switch. */
async function onThree(w: World): Promise<void> {
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT3
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  w.usage['tok-3'] = [40, 50]
  w.owners = { 'tok-1': 'one@example.com', 'tok-2': 'two@example.com', 'tok-3': 'three@example.com' }
}

test('a /login in a session on login 3 that signs in login 2\'s account leaves 3 needing its own sign-in, and the session moves to 2', async ($, on) => {
  const w = fresh()
  await onThree(w)
  const clock = world(on, w, THREE_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([])
  // The browser was signed in to claude.ai as login 2's account.
  w.loginToken = 'tok-2b'
  w.usage['tok-2b'] = [10, 30]
  w.owners['tok-2b'] = 'two@example.com'
  await $.command.run(LOGIN)
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} } })
  expect(await band.find({ text: /account 3 \(three@example.com\) needs a sign-in \(signed in as account 2 now\)/ })).toBeDefined()
  await band.unmount()
  // The session moves off it, to the login the rotation picks: 2, with the most room.
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /^Switched to Claude account 2 .*: account 3 needs a sign-in\.$/.test(t))).toHaveLength(1)
  // A later check, its token run out, keeps 3 needing a sign-in: the sign-in it holds is still 2's.
  w.keychain[await keychainItem(SLOT3)] = blob('tok-2b', NOW + 30 * 60_000)
  await clock.advance(41 * 60_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^⚠ sign in needed$/ })).toBeDefined()
  await pane.unmount()
  expect(w.envSets).toHaveLength(1)
})

test('a /login in a session on login 3 that signs in an account not on the list makes 3 that account, and says /login signs in the account the session is on', async ($, on) => {
  const w = fresh()
  await onThree(w)
  const clock = world(on, w, THREE_LOGINS)
  await start($, clock)
  w.loginToken = 'tok-x'
  w.usage['tok-x'] = [5, 10]
  w.owners['tok-x'] = 'x@example.com'
  await $.command.run(LOGIN)
  await clock.settle()
  expect(w.toasts.filter(t => /^Claude account 3 is x@example.com · Org now: a \/login in a session on account 3 signs in there, not Claude Code's login\.$/.test(t))).toHaveLength(1)
  expect(w.envSets).toEqual([])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: 'x@example.com' })).toBeDefined()
  expect(await pane.find({ text: 'three@example.com' })).toBeUndefined()
  await pane.unmount()
})

test('a /login in a session on login 3 as its own account again, as a new token is, changes nothing', async ($, on) => {
  const w = fresh()
  await onThree(w)
  const clock = world(on, w, THREE_LOGINS)
  await start($, clock)
  w.loginToken = 'tok-3b'
  w.usage['tok-3b'] = [40, 50]
  w.owners['tok-3b'] = 'three@example.com'
  await $.command.run(LOGIN)
  await clock.settle()
  expect(w.toasts).toEqual([])
  expect(w.envSets).toEqual([])
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^⚠/ })).toBeUndefined()
  expect(await pane.find({ text: 'three@example.com' })).toBeDefined()
  await pane.unmount()
})

// RULING 4230: a stop whose words name the session limit proves a 5-hour window, whatever the last usage check said.
test('a session-limit stop on an account whose usage reported no 5-hour window marks five hours and says the account has one', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('no-five-hour:1')).toBe(true)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: "You've hit your session limit · resets 3pm" })
  await clock.settle()
  expect(store.get('no-five-hour:1')).toBe(false)
  expect(store.get('mark:1')).toMatchObject({ pct: 100 })
  expect(store.get('week-mark:1')).toBeUndefined()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

// RULING 4230: the two writers of no-five-hour:<id> beside the usage check, each with a test.
test('a response that reports a 5-hour window clears no-five-hour, and Remove deletes it with the week mark and the check error', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  // Login 2's week resets at its own time, so a response with login 1's week proves login 1.
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const week = { pct: 100, resetsAt: OTHER_WEEK, at: NOW }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'week-mark:2': week, 'fable-mark:2': week, 'check-error:2': { why: 'x', at: NOW } }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('no-five-hour:1')).toBe(true)
  w.limits = [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-12T12:00:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  expect(store.get('no-five-hour:1')).toBe(false)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  // Its schedule goes too: a login added later under the number 2 is read at once.
  expect([store.has('usage-due:2'), store.has('usage:2')]).toEqual([true, true])
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  expect(['no-five-hour:2', 'week-mark:2', 'fable-mark:2', 'check-error:2', 'usage-due:2', 'usage:2'].filter(k => store.has(k))).toEqual([])
  await pane.unmount()
})

// puma-4q7j2.4: the week left at which the session leaves, set in the pane by - and +, 0 to 99.
test('the Week row steps the week left by one with - and +, stops at 0 and at 99, and the session leaves at it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 97]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // At the default, 0, login 1 with 3% of its week left stays; - does nothing.
  expect(await pane.find({ type: 'Text', text: /^leave at 0% left$/ })).toBeDefined()
  await pane.press({ key: 'week-leave-down' })
  await clock.settle()
  expect(store.get('week-leave')).toBe(0)
  expect(w.envSets).toEqual([])
  for (const _ of [1, 2, 3]) {
    await pane.press({ key: 'week-leave-up' })
    await clock.settle()
    await pane.redraw()
  }
  // At 3% left, it leaves.
  expect(store.get('week-leave')).toBe(3)
  expect(await pane.find({ type: 'Text', text: /^leave at 3% left$/ })).toBeDefined()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  store.set('week-leave', 99)
  await clock.advance(61_000)
  await pane.redraw()
  await pane.press({ key: 'week-leave-up' })
  await clock.settle()
  expect(store.get('week-leave')).toBe(99)
  await pane.unmount()
})

// puma-4q7j2.5: the login a launcher starts new sessions on, stored for bin/account-rotator-launch.
test('the login new sessions start on is stored for a launcher, by the New on setting, skipping a login with a limit at 0% left', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 100]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('launch-slot')).toMatchObject({ id: '2', slot: SLOT2, why: 'it has the most room' })
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'launch-on-account:1' })
  await clock.settle()
  expect(store.get('launch-on')).toBe('account:1')
  expect(store.get('launch-slot')).toMatchObject({ id: '2', why: 'account 1 has no room, and it is the next with room' })
  await pane.unmount()
})

// Review R1 of 181dc8e, removed_pick: a launcher must never start a session on an account just removed.
test('removing the account the launcher would start on picks another at once', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'launch-on': 'account:2' }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('launch-slot')).toMatchObject({ id: '2' })
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  expect(store.get('launch-slot')).toMatchObject({ id: '1' })
  await pane.unmount()
})

// puma-eslxj.21: a shared key this session writes keeps what another session stored since this session's view last
// read the store. Each test writes the store as that other session, between this session's read and its write.
test('a footer pick keeps the row style another session picked since this session last read the store', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  store.set('footer', { week: 'none' })
  await pane.press({ key: 'footer-session-bars' })
  await clock.settle()
  expect(store.get('footer')).toMatchObject({ session: 'bars', week: 'none' })
  await pane.unmount()
})

test('Remove keeps an account another session added since this session last read the store', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  store.set('accounts', [...TWO_LOGINS.accounts, { id: '3', slot: `${HOME}/.claude/accounts/3`, email: 'three@example.com' }])
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  expect((store.get('accounts') as { id: string }[]).map(a => a.id)).toEqual(['1', '3'])
  await pane.unmount()
})

test('the launch pick follows the New on setting another session stored since this session last read the store', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('launch-slot')).toMatchObject({ id: '2', why: 'it has the most room' })
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // The other session stores only the setting; this session's next pick must be made, and written, from it.
  store.set('launch-on', 'account:1')
  // Any press that runs the rotation stores the pick again, before the minute's merge.
  await pane.press({ key: 'week-leave-up' })
  await clock.settle()
  expect(store.get('launch-slot')).toMatchObject({ id: '1', why: 'you picked it' })
  await pane.unmount()
})

test('a Chrome guess that finds no browser stores no miss once another session has named the extension\'s account', async ($, on) => {
  const w = fresh()
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  // The other session names the extension's account while this session's guess is asking Chrome.
  const extensions = Object.defineProperty([SLOT2], 'includes', {
    value(this: string[], slot: string) {
      store.set('chrome-account', '2')
      return Array.prototype.includes.call(this, slot)
    },
  })
  w.chrome = { extensions }
  await spentOne(w)
  const clock = world(on, w, store)
  await start($, clock)
  expect(w.chromeAsked).toEqual([''])
  expect(store.has('chrome-miss')).toBe(false)
})

// Review R1 CHROME-OWNER-REMOVE (Codex, #32): Remove clears chrome-account only while the store still names the removed account.
test('Remove keeps a Chrome account another session named since this session last read the store', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'chrome-account': '2' }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  store.set('chrome-account', '1')
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  expect(store.get('chrome-account')).toBe('1')
  await pane.unmount()
})

// Review R1 F1 [STALE-VIEW-WRITE] (Opus, #32), the class: every write of `chrome-account` that this session's view
// decided (Remove's forget, learnChrome's "none named yet") is decided by the store as it stands. Each case has another
// session write `chrome-account` after this session's last merge and before the write. A new writer joins this table.
type ChromeWriteCase = { name: string; run: ($: Engine, on: On) => Promise<{ got: unknown; want: unknown }> }

const removeTwoWith = async ($: Engine, on: On, before: string | undefined, after: string): Promise<unknown> => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  w.usage['tok-3'] = [null, 30]
  const three = { id: '3', slot: SLOT3, email: 'three@example.com' }
  const seed: Record<string, unknown> = { accounts: [...TWO_LOGINS.accounts, three], ...(before === undefined ? {} : { 'chrome-account': before }) }
  const store = new Map<string, unknown>(Object.entries(seed))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await mountPane($)
  store.set('chrome-account', after)
  await pane.press({ key: 'ask-remove-2' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'remove-2' })
  await clock.settle()
  await pane.unmount()
  return store.get('chrome-account')
}

const CHROME_WRITE_CASES: ChromeWriteCase[] = [
  {
    name: 'Remove of the account the view names, another session having named another since: that other stays',
    run: async ($, on) => ({ got: await removeTwoWith($, on, '2', '3'), want: '3' }),
  },
  {
    // freeId hands the removed id to the next account added: a name left on it would follow it there.
    name: 'Remove of the account another session named since, the view naming none: the name goes with the account',
    run: async ($, on) => ({ got: await removeTwoWith($, on, undefined, '2'), want: undefined }),
  },
  {
    name: 'a browser answering as Claude Code\'s login, another session having named the extension\'s account since: that name stays',
    run: async ($, on) => {
      const w = fresh()
      const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
      // The other session names account 2 the extension's while this session asks Chrome; the browser answers as login 1.
      const extensions = Object.defineProperty([''], 'includes', {
        value(this: string[], slot: string) {
          store.set('chrome-account', '2')
          return Array.prototype.includes.call(this, slot)
        },
      })
      w.chrome = { extensions }
      await spentOne(w)
      const clock = world(on, w, store)
      await start($, clock)
      return { got: store.get('chrome-account'), want: '2' }
    },
  },
]

for (const { name, run } of CHROME_WRITE_CASES) {
  test(`chrome-account from the store: ${name}`, async ($, on) => {
    const { got, want } = await run($, on)
    expect(got, `chrome-account was written from this session's view: ${name}. Decide it by $.store.get('chrome-account') at the write`).toEqual(want)
  })
}

/**
 * The shared store, logging each merge (by `week-leave`, a key only mergeStore reads) and each write, in order.
 * Map's constructor calls `set` before the field exists, hence the `?.`.
 */
class MergeLog extends Map<string, unknown> {
  log: string[] = []
  get(key: string): unknown {
    if (key === 'week-leave') this.log.push('merge')
    return super.get(key)
  }
  set(key: string, value: unknown): this {
    this.log?.push(`set ${key}`)
    return super.set(key, value)
  }
  delete(key: string): boolean {
    this.log.push(`delete ${key}`)
    return super.delete(key)
  }
}

// Review R1 F2 [REDUNDANT-MERGE] (Opus, #32), the class: every way into maybeRotate or saveLaunchPick merges the store
// at most once more than it reads anew; the minute's tick twice (its own merge, then the launch pick's after the checks).
// Each event runs alone, the log emptied before it; a path that stacks a merge on a merge fails here.
type MergeCostCase = { name: string; most: number; run: ($: Engine, clock: MockClock, w: World) => Promise<void> }

const pressPane = async ($: Engine, clock: MockClock, keys: string[]): Promise<void> => {
  const pane = await mountPane($)
  for (const key of keys) {
    await pane.press({ key })
    await clock.settle()
    await pane.redraw()
  }
  await pane.unmount()
}

const MERGE_COST_CASES: MergeCostCase[] = [
  { name: 'the minute\'s tick', most: 2, run: async (_$, clock) => { await clock.advance(60_000); await clock.settle() } },
  {
    name: 'a response',
    most: 1,
    run: async ($, clock, w) => {
      w.limits = [
        { kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-12T12:00:00Z' },
        { kind: 'seven_day', percentUsed: 30, resetsAt: WEEK_RESET },
      ]
      await respond($, clock, w)
    },
  },
  { name: 'a Week press', most: 1, run: ($, clock) => pressPane($, clock, ['week-leave-up']) },
  { name: 'Remove', most: 1, run: ($, clock) => pressPane($, clock, ['ask-remove-2', 'remove-2']) },
]

for (const { name, most, run } of MERGE_COST_CASES) {
  test(`${name} merges the store at most ${most} time(s)`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [20, 30]
    w.usage['tok-2'] = [10, 30]
    const store = new MergeLog(Object.entries(TWO_LOGINS))
    const clock = world(on, w, store)
    await start($, clock)
    store.log = []
    await run($, clock, w)
    const merges = store.log.filter(e => e === 'merge').length
    expect(merges, `${name} merged the store ${merges} times (most ${most}): ${store.log.join(', ')}. A merge right after a merge reads nothing new`).toBeLessThanOrEqual(most)
  })
}

// puma-eslxj.22: a check judges a new sign-in against the holder the store names, not this session's view, so a sign-in
// another session already named keeps the usage that session stored for it.
test('a /login on a sign-in another session already named deletes none of the usage that session stored for it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const store = new MergeLog(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  // The other session found login 1 signed in as nine@example.com and stored that sign-in, its usage and its schedule;
  // this session's view still holds one@example.com's sign-in.
  w.owners['tok-9'] = 'nine@example.com'
  w.usage['tok-9'] = [5, 15]
  w.loginToken = 'tok-9'
  store.set('holder:1', { token: await fingerprint('refresh-tok-9'), who: { email: 'nine@example.com' } })
  store.set('usage:1', { sevenDay: { pct: 15, resetsAt: WEEK_RESET }, at: NOW, by: '1', v: 1, src: 'body' })
  store.set('usage-due:1', { next: NOW + 10 * 60_000, fails: 0, at: NOW, v: 1 })
  store.log = []
  await $.command.run(LOGIN)
  await clock.settle()
  expect(store.log.filter(e => /^delete (usage|no-five-hour|usage-due):1$/.test(e)), store.log.join(', ')).toEqual([])
  // The check ran (it stored login 1's health), and what the other session stored stands (Review R1 [ABSENCE-ONLY-PIN],
  // Opus, #34): its schedule says the next read is ten minutes off, so no usage is read now.
  expect(store.log, `the /login checked nothing: ${store.log.join(', ')}`).toContain('set health:1')
  expect(store.get('holder:1')).toEqual({ token: await fingerprint('refresh-tok-9'), who: { email: 'nine@example.com' } })
  expect(store.get('usage:1')).toMatchObject({ sevenDay: { pct: 15 }, by: '1' })
})

/**
 * The other session finishes its check of login 1 (names the sign-in, stores its usage and schedule) while this
 * session's own check waits on the profile call: `owners[token]` is read inside that call, so its getter runs after
 * holderOf first read the holder and before it decides what to drop.
 */
function otherSessionNamesDuringProfileCall(w: World, store: MergeLog, token: string, email: string, writes: (s: MergeLog) => void): { done: boolean } {
  const probe = { done: false }
  Object.defineProperty(w.owners, token, {
    enumerable: true,
    configurable: true,
    get() {
      if (!probe.done) {
        probe.done = true
        // Synchronous writes, as the other session's land in the shared store between two of this one's awaits.
        writes(store)
        store.log = []
      }
      return email
    },
  })
  return probe
}

// Review R1 F1 [STALE-HOLDER-DECISION] (Opus, #34): every branch of holderOf that deletes a stored key on a new token
// (another person: dropSignInUsage; the same person: usage-due), under one interleave: the other session names this
// token while this session's profile call runs.
const HOLDER_DROP_BRANCHES = [
  { name: 'another person', token: 'tok-9', email: 'nine@example.com', keys: /^delete (usage|usage-due):1$/ },
  { name: 'the same person under a new token', token: 'tok-7', email: 'one@example.com', keys: /^delete usage-due:1$/ },
] as const

for (const branch of HOLDER_DROP_BRANCHES) {
  test(`${branch.name}: a check deletes nothing another session stored for this token during its profile call`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [20, 30]
    w.usage['tok-2'] = [10, 30]
    const store = new MergeLog(Object.entries(TWO_LOGINS))
    const clock = world(on, w, store)
    await start($, clock)
    const named = { token: await fingerprint(`refresh-${branch.token}`), who: { email: branch.email } }
    const probe = otherSessionNamesDuringProfileCall(w, store, branch.token, branch.email, s => {
      s.set('holder:1', named)
      s.set('usage:1', { sevenDay: { pct: 15, resetsAt: WEEK_RESET }, at: NOW, by: '1', v: 1, src: 'body' })
      s.set('usage-due:1', { next: NOW + 10 * 60_000, fails: 0, at: NOW, v: 1 })
    })
    w.usage[branch.token] = [5, 15]
    w.loginToken = branch.token
    await $.command.run(LOGIN)
    await clock.settle()
    // The sweep inspected something: the other session's write ran inside this session's check.
    expect(probe.done, `${branch.name}: the other session's write never ran inside this session's profile call`).toBe(true)
    expect(
      store.log.filter(e => branch.keys.test(e)),
      `${branch.name}: holderOf deleted what another session stored for this token while the profile call ran (${store.log.join(', ')}). ` +
        'Re-read holder:<id> after fetchIdentity; a holder that names this token is returned, nothing dropped.',
    ).toEqual([])
  })
}

// Review R1 of 181dc8e, footer_week_leave: the footer counts the week by the same setting the rotation does.
test('the footer shows no room now on a login whose week is down to the Week setting, as the rotation counts it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 96]
  const clock = world(on, w, { accounts: [TWO_LOGINS.accounts[0]], 'rotate-to': 'off', 'week-leave': 5 })
  await start($, clock)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  // 4% of its week left, at a Week setting of 5: nothing to serve now, so 0% where 90% of the 5-hour window would show.
  expect((await footer.find(GLYPHS))?.text).toMatch(/ 0% /)
  await footer.unmount()
})

// puma-4q7j2.5: the pane no longer names Claude Code's login; New on picks where new sessions start.
test('the pane names no "Claude Code\'s login" line, on the login or after a move off it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  w.owners = { 'tok-1': 'one@example.com', 'tok-2': 'two@example.com' }
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /Claude Code's login|New sessions start on it/ })).toBeUndefined()
  await pane.press({ key: 'rotate' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /Claude Code's login|\/login in this session signs in/ })).toBeUndefined()
  await pane.unmount()
})

test('a /login on Claude Code\'s login that signs in a Team seat on the list leaves login 1 needing its own sign-in, and the session moves to the seat', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW + 6 * HOUR, 'team')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  w.owners = { 'tok-1': 'one@example.com', 'tok-2': 'two@example.com' }
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  w.loginToken = 'tok-2b'
  w.loginPlan = 'team'
  w.usage['tok-2b'] = [10, 30]
  w.owners['tok-2b'] = 'two@example.com'
  await $.command.run(LOGIN)
  await clock.settle()
  expect(w.toasts.filter(t => /^Claude account 1 \(one@example.com · Org\) needs a sign-in \(signed in as account 2 now\)/.test(t))).toHaveLength(1)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
})

test('a view kept from the code before a hot reload, which lacks what this code added, still draws and checks', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  w.owners = { 'tok-1': 'one@example.com' }
  const clock = world(on, w, TWO_LOGINS)
  // A hot reload keeps the view as the version before this one wrote it, lacking what this code added: the first read finds that.
  const before ={ accounts: TWO_LOGINS.accounts, readings: {}, health: {}, activeId: '1', footer: DEFAULT_FOOTER, rotateTo: 'reset', hasFontBlocks: false }
  let isKept = false
  on('state.get', async (_$, e, next) => {
    const read = await next(e)
    if (isKept || e.plugin !== 'account-rotator' || e.key !== 'view') return read
    isKept = true
    return { value: { value: before, version: read.value?.version ?? 0 } }
  })
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // The settings this code added draw at their defaults from a view that lacks them.
  expect(await pane.find({ type: 'Text', text: /^leave at 0% left$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^● most room$/ })).toBeDefined()
  await pane.unmount()
})

const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 9 }, view: {} } as const

/**
 * A call to one of Claude in Chrome's tools, as Claude makes one: its input
 * typed loosely, as the type root lists only the MCP tools this machine has.
 */
const browse = ($: Engine, tool: string, args: Record<string, unknown> = {}) =>
  $.tool.call({ tool: `mcp__claude-in-chrome__${tool}`, ...args } as unknown as ToolCallArgs)

/** Login 1 spent and login 2 with room, both signed in. */
async function spentOne(w: World): Promise<void> {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [92, 40]
  w.usage['tok-2'] = [10, 30]
}

/** Login 1 with room and login 2 spent, both signed in. */
async function spentTwo(w: World): Promise<void> {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [100, 30]
}

/** A session with no person at it, as `claude -p` runs. */
async function startHeadless($: Engine, clock: MockClock): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
}

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
const mountBand = ($: Engine) => $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
const slots = (w: World) => w.envSets.map(e => e.value ?? '')

test('before the rotation moves the session off Claude Code\'s login, Claude in Chrome connects there, where the extension answers, and goes on answering as the session moves', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.emails = { '': 'one@example.com', [SLOT2]: 'two@example.com' }
  // Named owners, whose profiles name the organization the pane shows.
  w.owners = { 'tok-1': 'one@example.com', 'tok-2': 'two@example.com' }
  await spentOne(w)
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  // Asked once, on login 1, and only then moved to login 2.
  expect(w.chromeAsked).toEqual([''])
  expect(slots(w)).toEqual([SLOT2])
  const learned = /^Claude in Chrome connects as Claude account 1 \(one@example\.com[^)]*\): your Chrome extension is signed in to it\.$/
  expect(w.toasts.filter(t => learned.test(t))).toHaveLength(1)
  // On login 2 a browser call is answered, the connection still login 1's, and Claude is told nothing more.
  const called = await browse($, 'tabs_context_mcp')
  expect(called.isError).toBeUndefined()
  expect(called.context).toBeUndefined()
  // Kept in the store every session reads: the next sync from it keeps it.
  await clock.advance(61_000)
  const pane = await mountPane($)
  // C5: the plan by its name; a max with a 5-hour window is Max.
  const shown = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(aboutAfter(shown, shown.indexOf('one@example.com'))).toBe('Org · Max · Chrome')
  expect(await pane.find({ type: 'Text', text: 'Active Claude extension accounts from your Chrome windows:' })).toBeDefined()
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  expect(await pane.find({ key: 'chrome-use-1' })).toBeUndefined()
  // No Chrome extension has answered as login 2: it waits behind Other accounts.
  expect(await pane.find({ key: 'chrome-row-2' })).toBeUndefined()
  expect((await pane.find({ key: 'chrome-others' }))?.text).toBe('▸ Other accounts')
  await pane.unmount()
})

test('a Chrome opened later on an account the box hasn\'t listed is a press away: Other accounts lists the rest, and Try to connect connects there and lists it, the one before with Use for Chrome', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '1' })
  await start($, clock)
  // As it opened: connected on login 1, where the session is, and a browser answered there.
  expect(w.chromeAsked).toEqual([''])
  const pane = await mountPane($)
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  expect(await pane.find({ key: 'chrome-row-2' })).toBeUndefined()
  // Chrome opens in a second profile, signed in to login 2's account.
  w.chrome.extensions.push(SLOT2)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  expect((await pane.find({ key: 'chrome-others' }))?.text).toBe('▾ Other accounts')
  expect((await pane.find({ key: 'chrome-try-2' }))?.text).toBe('Try to connect')
  await pane.press({ key: 'chrome-try-2' })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  await clock.advance(36_000)
  expect(w.commands).toEqual(['/mcp reconnect claude-in-chrome'])
  expect(w.chromeAsked).toEqual(['', SLOT2])
  expect(w.toasts).toContain('Claude in Chrome is connected as Claude account 2 (two@example.com).')
  expect(slots(w)).toEqual([SLOT2, ''])
  // Kept in the store every session reads: both listed from now on, login 2 in use, none left behind the press.
  await clock.advance(61_000)
  await pane.redraw()
  expect((await pane.find({ key: 'chrome-row-2' }))?.text).toMatch(/● in use$/)
  expect((await pane.find({ key: 'chrome-use-1' }))?.text).toBe('Use for Chrome')
  expect(await pane.find({ key: 'chrome-others' })).toBeUndefined()
  await pane.unmount()
})

test('Try to connect as an account no Chrome answers as changes nothing: the box keeps the accounts that answered, lists none that didn\'t as active, and Claude in Chrome goes back to the one picked before', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '1' })
  await start($, clock)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: 'No Chrome extension is known to answer as these:' })).toBeDefined()
  await pane.press({ key: 'chrome-try-2' })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  await clock.advance(36_000)
  expect(w.chromeAsked).toEqual(['', SLOT2])
  expect(w.toasts).toContain(
    'No Chrome extension answers as Claude account 2 (two@example.com). Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome and try again. ' +
      'Claude in Chrome goes back to account 1 (one@example.com).',
  )
  // Back on login 1, Claude in Chrome connects there again once the move lands.
  expect(slots(w)).toEqual([SLOT2, ''])
  await clock.advance(36_000)
  expect(w.commands).toEqual(['/mcp reconnect claude-in-chrome', '/mcp reconnect claude-in-chrome'])
  expect(w.chromeAsked).toEqual(['', SLOT2, ''])
  expect(w.toasts).toContain('Claude in Chrome is connected as Claude account 1 (one@example.com).')
  // Kept in the store every session reads: login 1 still picked, listed and in use; login 2 only behind Other accounts.
  await clock.advance(61_000)
  await pane.redraw()
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  expect(await pane.find({ key: 'chrome-try-2' })).toBeDefined()
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ key: 'chrome-row-2' })).toBeUndefined()
  expect((await pane.find({ key: 'account-1' }))?.text).toMatch(/one@example\.com.*Chrome/)
  expect((await pane.find({ key: 'account-2' }))?.text).toMatch(/two@example\.com/)
  expect((await pane.find({ key: 'account-2' }))?.text).not.toMatch(/Chrome/)
  await pane.unmount()
})

test('Use for Chrome on a listed account whose Chrome has closed since finds no browser: the box lists it no more, Try to connect under Other accounts, and Claude in Chrome goes back to the one picked before', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: ['', SLOT2] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '1', 'chrome-accounts': ['1', '2'] })
  await start($, clock)
  const pane = await mountPane($)
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  expect((await pane.find({ key: 'chrome-use-2' }))?.text).toBe('Use for Chrome')
  expect(await pane.find({ key: 'chrome-others' })).toBeUndefined()
  // The Chrome profile signed in to login 2's account closes.
  w.chrome.extensions = ['']
  await pane.press({ key: 'chrome-use-2' })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  await clock.advance(36_000)
  expect(w.chromeAsked).toEqual(['', SLOT2])
  expect(w.toasts).toContain(
    'No Chrome extension answers as Claude account 2 (two@example.com). Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome and try again. ' +
      'Claude in Chrome goes back to account 1 (one@example.com).',
  )
  expect(slots(w)).toEqual([SLOT2, ''])
  await clock.advance(36_000)
  expect(w.chromeAsked).toEqual(['', SLOT2, ''])
  // Kept in the store every session reads: login 1 picked and in use, login 2 behind Other accounts, to try again.
  await clock.advance(61_000)
  await pane.redraw()
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  expect(await pane.find({ key: 'chrome-row-2' })).toBeUndefined()
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  expect((await pane.find({ key: 'chrome-try-2' }))?.text).toBe('Try to connect')
  await pane.unmount()
})

test('a window opening while the picked account\'s Chrome is closed lists that account no more, and a browser call answered there lists it in use again', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '1', 'chrome-accounts': ['1', '2'] })
  await start($, clock)
  expect(w.chromeAsked).toEqual([''])
  // Kept in the store every session reads: login 2, not checked, still listed.
  await clock.advance(61_000)
  const pane = await mountPane($)
  expect(await pane.find({ key: 'chrome-row-1' })).toBeUndefined()
  expect((await pane.find({ key: 'chrome-use-2' }))?.text).toBe('Use for Chrome')
  expect((await pane.find({ key: 'chrome-others' }))?.text).toBe('▸ Other accounts')
  expect(
    await pane.find({
      type: 'Text',
      text: '⚠ No Chrome extension answers as account 1 (one@example.com). Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome.',
    }),
  ).toBeDefined()
  // Chrome opens, signed in to login 1's account.
  w.chrome.extensions.push('')
  expect((await browse($, 'tabs_context_mcp')).isError).toBeUndefined()
  await clock.advance(61_000)
  await pane.redraw()
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  expect(await pane.find({ type: 'Text', text: /^⚠/ })).toBeUndefined()
  await pane.unmount()
})

test('as a session opens it visits the extension\'s account to connect Claude in Chrome there, whatever usage that has left, and comes back; browser calls wait meanwhile', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  await spentTwo(w)
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2' })
  await start($, clock)
  expect(slots(w)).toEqual([SLOT2])
  // Not asked before Claude Code reads login 2's sign-in, which a call would connect as.
  expect(w.chromeAsked).toEqual([])
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: '◌ Connecting Chrome as account 2 (two@example.com)…' })).toBeDefined()
  await band.unmount()
  // The visit is no switch: login 2's line says so, not "in use".
  const visiting = await mountPane($)
  expect(await visiting.find({ type: 'Text', text: '◌ Connecting Chrome…' })).toBeDefined()
  expect(await visiting.find({ type: 'Text', text: '● in use' })).toBeUndefined()
  await visiting.unmount()
  const held = await $.tool.check({ tool: 'mcp__claude-in-chrome__navigate', input: { url: 'https://example.com' } })
  expect(held.decision).toBe('deny')
  expect(held.reason).toMatch(/^The account-rotator mod is connecting Claude in Chrome as Claude account 2 \(two@example\.com\).* End your turn now/)
  await clock.advance(36_000)
  // A first connection, nothing to reconnect; then back on login 1, which has room. No switch was told: the visit is the band's.
  expect(w.chromeAsked).toEqual([SLOT2])
  expect(w.commands).toEqual([])
  expect(slots(w)).toEqual([SLOT2, ''])
  expect(w.toasts.filter(t => /^Switched to/.test(t))).toEqual([])
  expect((await $.tool.check({ tool: 'mcp__claude-in-chrome__navigate', input: {} })).decision).toBe('allow')
  const pane = await mountPane($)
  expect((await pane.find({ key: 'chrome-row-2' }))?.text).toMatch(/● in use$/)
  await pane.unmount()
  // The connection stays login 2's on login 1.
  expect((await browse($, 'navigate', { url: 'https://example.com' })).isError).toBeUndefined()
})

test('a turn that hits the usage limit while the session visits a spent extension account carries on once it is back', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  await spentTwo(w)
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2' })
  await start($, clock)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2, ''])
  expect(w.submitted).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
})

test('when the connection drops and comes back as the account in use, the next browser call has the mod reconnect it as the extension\'s account, not /login, and tell Claude to carry on once one answers', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  await spentOne(w)
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '1' })
  await start($, clock)
  // As it opened: on login 1 to connect there, spent as it is, then back on login 2.
  await clock.advance(36_000)
  expect(w.chromeAsked).toEqual([''])
  expect(slots(w)).toEqual(['', SLOT2])
  await clock.advance(36_000)
  // The connection drops and comes back as login 2, which the extension doesn't answer.
  w.chrome.as = SLOT2
  const called = await browse($, 'navigate', { url: 'https://example.com' })
  expect(called.isError).toBe(true)
  expect(called.context?.[0]).toBe(
    'Claude in Chrome connected as Claude account 1 (one@example.com) and found no browser. ' +
      "The account-rotator mod is now reconnecting it as Claude account 1 (one@example.com), the account the user's Chrome extension is signed in to, which takes under a minute. " +
      "End your turn now: you'll get a message once it's connected. Don't suggest /login: it doesn't fix this.",
  )
  await clock.settle()
  expect(slots(w)).toEqual(['', SLOT2, ''])
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: '◌ Connecting Chrome as account 1 (one@example.com)…' })).toBeDefined()
  await band.unmount()
  await clock.advance(36_000)
  expect(w.commands).toEqual(['/mcp reconnect claude-in-chrome'])
  expect(w.chromeAsked).toEqual(['', ''])
  expect(w.toasts).toContain('Claude in Chrome is connected as Claude account 1 (one@example.com).')
  // Back on login 2, and Claude is told to carry on once that lands.
  expect(slots(w)).toEqual(['', SLOT2, '', SLOT2])
  expect(w.submitted).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toEqual(['Claude in Chrome is connected as Claude account 1 (one@example.com). Continue where you left off.'])
  expect((await browse($, 'navigate', { url: 'https://example.com' })).isError).toBeUndefined()
  expect(w.toasts.filter(t => /Something went wrong/.test(t))).toEqual([])
})

test('a session Claude Code stops from switching, on another account than the extension\'s, can\'t connect Claude in Chrome: Claude and the band give the command that brings the conversation back connected', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  w.refuseEnv = true
  await spentOne(w)
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '1' })
  await start($, clock)
  const called = await browse($, 'tabs_context_mcp')
  expect(called.context?.[0]).toMatch(/Tell the user that to use Chrome, they quit Claude Code and run `claude --resume session-1` in this terminal/)
  const band = await mountBand($)
  expect(
    await band.find({ type: 'Text', text: "⚠ This window can't switch to account 1 (one@example.com). Quit, then run: claude --resume session-1" }),
  ).toBeDefined()
  expect(await band.find({ key: 'chrome-connect-band' })).toBeUndefined()
  await band.unmount()
  expect(w.envSets).toEqual([])
  expect(w.commands).toEqual([])
  // Connected after all, the box says why the accounts behind Other accounts can't be tried here.
  await clock.advance(61_000)
  w.chrome.as = ''
  expect((await browse($, 'tabs_context_mcp')).isError).toBeUndefined()
  const pane = await mountPane($)
  expect(await pane.find({ key: 'chrome-use-2' })).toBeUndefined()
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ key: 'chrome-row-1' })).toBeDefined()
  expect(await pane.find({ key: 'chrome-try-1' })).toBeUndefined()
  expect(
    await pane.find({ type: 'Text', text: "⚠ This window can't switch accounts, so Chrome can't move to another one here. Quit, then run: claude --resume session-1" }),
  ).toBeDefined()
  await pane.unmount()
})

test('with no account named for the Chrome extension, a browser call that finds no browser has Claude ask which it is; picked in the pane, Connect connects there, comes back, and tells Claude to carry on', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const called = await browse($, 'tabs_context_mcp')
  expect(called.context?.[0]).toMatch(/^Claude in Chrome connected as Claude account 2 \(two@example\.com\) and found no browser\. .* Ask the user to press Use for Chrome or Try to connect next to it under Chrome in the Claude accounts panel/)
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: '⚠ Claude in Chrome: which account is your Chrome extension signed in to?' })).toBeDefined()
  await band.press({ key: 'chrome-pick' })
  await clock.settle()
  expect(w.panes).toEqual(['claude-accounts'])
  await band.unmount()
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Text', text: 'No Chrome extension found yet. Which account is yours signed in to?' })).toBeDefined()
  expect(await pane.find({ key: 'chrome-try-2' })).toBeDefined()
  await pane.press({ key: 'chrome-try-1' })
  await clock.settle()
  expect(slots(w)).toEqual([''])
  await clock.advance(36_000)
  await pane.redraw()
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  expect(await pane.find({ key: 'chrome-row-2' })).toBeUndefined()
  await pane.unmount()
  // Back on login 2, where the session was; Claude is told once that lands.
  expect(slots(w)).toEqual(['', SLOT2])
  await clock.advance(36_000)
  expect(w.submitted).toEqual(['Claude in Chrome is connected as Claude account 1 (one@example.com). Continue where you left off.'])
})

test('a Connect that finds no browser says to check Chrome and its extension\'s email, and a call that finds none then asks the person instead of connecting again', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: ['a browser signed in elsewhere'] }
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  await spentOne(w)
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '1' })
  await start($, clock)
  // As it opened: no browser as login 1, quietly, and back on login 2.
  await clock.advance(36_000)
  expect(w.chromeAsked).toEqual([''])
  expect(slots(w)).toEqual(['', SLOT2])
  expect(w.toasts.filter(t => /Chrome extension answers/.test(t))).toEqual([])
  const called = await browse($, 'tabs_context_mcp')
  expect(called.context?.[0]).toMatch(
    /^No Chrome extension answers as Claude account 1 \(one@example\.com\).*Ask the user to open Chrome and check the email its Claude extension is signed in with\..*press Connect above the prompt/,
  )
  await clock.settle()
  expect(slots(w)).toEqual(['', SLOT2])
  const band = await mountBand($)
  const noBrowser = '⚠ No Chrome extension answers as account 1 (one@example.com). Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome.'
  expect(await band.find({ type: 'Text', text: noBrowser })).toBeDefined()
  await band.press({ key: 'chrome-connect-band' })
  await clock.settle()
  await band.unmount()
  await clock.advance(36_000)
  expect(w.commands).toEqual(['/mcp reconnect claude-in-chrome'])
  expect(w.toasts).toContain('No Chrome extension answers as Claude account 1 (one@example.com). Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome.')
  expect(slots(w)).toEqual(['', SLOT2, '', SLOT2])
  await clock.advance(36_000)
  expect(w.submitted).toEqual([])
})

test('a browser answering as another account than the one picked for the extension lists that account in use, and leaves the pick as it is', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2' })
  // With no person at it, the session doesn't connect as it opens: the first browser call connects as login 1.
  await startHeadless($, clock)
  expect(w.envSets).toEqual([])
  expect((await browse($, 'tabs_context_mcp')).isError).toBeUndefined()
  await clock.advance(61_000)
  const pane = await mountPane($)
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  // Login 2, picked but never answered as, isn't listed as active: it waits behind Other accounts.
  expect(await pane.find({ key: 'chrome-row-2' })).toBeUndefined()
  expect((await pane.find({ key: 'chrome-others' }))?.text).toBe('▸ Other accounts')
  // Still the account new sessions connect as.
  expect(await pane.find({ type: 'Text', text: 'Chrome' })).toBeDefined()
  await pane.unmount()
})

test('a guess at Claude Code\'s login that finds no browser leaves the extension\'s account to be picked, and is not tried again', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  await spentOne(w)
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.chromeAsked).toEqual([''])
  expect(w.toasts.filter(t => /^Claude in Chrome connects as/.test(t))).toEqual([])
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Text', text: 'No Chrome extension found yet. Which account is yours signed in to?' })).toBeDefined()
  // Back on login 1 and off it again: no second guess.
  await pane.press({ key: 'use-1' })
  await clock.settle()
  await clock.advance(36_000)
  await pane.press({ key: 'use-2' })
  await clock.settle()
  expect(w.envSets).toHaveLength(3)
  expect(w.chromeAsked).toEqual([''])
  await pane.unmount()
})

test('a session that a guess at Claude Code\'s login found no browser for before does not guess it again', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  await spentOne(w)
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-miss': '1' })
  await start($, clock)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.chromeAsked).toEqual([])
})

test('a session without Claude in Chrome is asked once, and its pane has no Chrome box', async ($, on) => {
  const w = fresh()
  await spentOne(w)
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.chromeAsked).toEqual([''])
  const pane = await mountPane($)
  await pane.press({ key: 'use-1' })
  await clock.settle()
  await clock.advance(36_000)
  await pane.press({ key: 'use-2' })
  await clock.settle()
  expect(w.envSets).toHaveLength(3)
  expect(w.chromeAsked).toEqual([''])
  await pane.redraw()
  expect(await pane.find({ key: 'chrome-row-1' })).toBeUndefined()
  expect(await pane.find({ text: /Chrome/ })).toBeUndefined()
  await pane.unmount()
})

// ---------------------------------------------------------------- a switch held back, a stay told, a carry-on that is still current

/** Claude Code's own way out of the Fable limit, which every notice of a stay ends on. */
const WAY_OUT = 'Run /usage-credits to continue or switch models with /model.'

/** Login 1's token refreshes in 5 minutes, inside the refresh guard: a switch off it waits for the refresh. */
async function guarded(on: On, w: World, store: Record<string, unknown>, atStop: [number, number, number?]): Promise<MockClock> {
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = atStop
  w.usage['tok-2'] = [10, 30, 10]
  return world(on, w, { ...TWO_LOGINS, ...store })
}

/** Claude Code refreshes login 1's token: the next try at the switch goes through. */
const refresh = (w: World) => {
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 8 * HOUR)
}

for (const rotateTo of ['reset', 'room', 'order']) {
  for (const line of [undefined, 'Go on on Fable-free ground.']) {
    test(`with the rotation going by ${rotateTo} and ${line === undefined ? 'no' : 'a'} line kept, a Fable stop held back for a token about to refresh moves when the refresh lands and carries on once`, async ($, on) => {
      const w = fresh()
      const clock = await guarded(on, w, { 'rotate-to': rotateTo, ...(line === undefined ? {} : { 'fable-continue-text': line }) }, [20, 30, 100])
      await start($, clock)
      await $.classic.StopFailure(FABLE_STOP)
      await clock.settle()
      await clock.advance(2 * 60_000)
      expect(w.envSets).toEqual([])
      expect(w.submitted).toEqual([])
      refresh(w)
      await clock.advance(60_000)
      expect(slots(w)).toEqual([SLOT2])
      // The carry-on waits for the switch to land, 35 s on, as for a switch made at once.
      expect(w.submitted).toEqual([])
      await clock.advance(36_000)
      expect(w.submitted).toHaveLength(1)
      expect(w.submitted[0]).toMatch(line === undefined ? /Continue where you left off/ : /^Go on on Fable-free ground\.$/)
      expect(w.asUser).toEqual([line !== undefined])
      await clock.advance(5 * 60_000)
      expect(w.submitted).toHaveLength(1)
    })
  }
}

test('a second Fable stop while the first is held back adds no second carry-on', async ($, on) => {
  const w = fresh()
  const clock = await guarded(on, w, {}, [20, 30, 100])
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(60_000)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  refresh(w)
  await clock.advance(2 * 60_000)
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.submitted).toHaveLength(1)
})

/** The stops that are not the Fable week's: a plain limit in three wordings, and a rejected sign-in. */
const NOT_FABLE_STOPS = [...PLAIN_STOPS.map(last_assistant_message => ({ error: 'rate_limit', last_assistant_message })), { error: 'authentication_failed' }]

for (const stop of NOT_FABLE_STOPS) {
  test(`${stop.error === 'rate_limit' ? `a plain usage-limit stop ("${stop.last_assistant_message}")` : 'a rejected sign-in'} held back for a token about to refresh moves when the refresh lands and, as before, carries on with nothing`, async ($, on) => {
    const w = fresh()
    const clock = await guarded(on, w, {}, [100, 41])
    await start($, clock)
    await $.classic.StopFailure(stop)
    await clock.settle()
    await clock.advance(2 * 60_000)
    expect(w.envSets).toEqual([])
    refresh(w)
    await clock.advance(60_000)
    expect(slots(w)).toEqual([SLOT2])
    await clock.advance(5 * 60_000)
    expect(w.submitted).toEqual([])
  })
}

/**
 * Review RT1 (HELD-INTENT-SPLIT). The switch held back is one intent: where it
 * goes and what it carries on with. A later stop replaces both; a tick, which
 * is no stop, leaves a held Fable recovery as it is.
 */
for (const stop of NOT_FABLE_STOPS) {
  test(`${stop.error === 'rate_limit' ? `a plain usage-limit stop ("${stop.last_assistant_message}")` : 'a rejected sign-in'} after a Fable stop held back for a token about to refresh takes its place: the switch lands, and no Fable carry-on goes`, async ($, on) => {
    const w = fresh()
    const clock = await guarded(on, w, { 'fable-continue-text': 'Go on on Fable-free ground.' }, [20, 30, 100])
    await start($, clock)
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    await $.classic.StopFailure(stop)
    await clock.settle()
    refresh(w)
    await clock.advance(60_000)
    await clock.advance(36_000)
    expect(slots(w)).toEqual([SLOT2])
    expect(w.submitted).toEqual([])
  })
}

for (const rotateTo of ['reset', 'room', 'order']) {
  for (const [window, atStop] of [['5-hour window', [90, 30, 100]], ['week', [20, 95, 100]]] as const) {
    test(`with the rotation going by ${rotateTo}, a Fable stop held back for a token about to refresh keeps its login with Fable room when the ${window} of the login in use fills and the minute's tick runs`, async ($, on) => {
      const w = fresh()
      w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 5 * 60_000)
      w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
      w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
      w.usage['tok-1'] = [20, 30, 100]
      w.usage['tok-2'] = [10, 30, 100]
      w.usage['tok-3'] = [40, 30, 10]
      const clock = world(on, w, { ...THREE_LOGINS, 'rotate-to': rotateTo })
      await start($, clock)
      w.usage['tok-1'] = [...atStop]
      await $.classic.StopFailure(FABLE_STOP)
      await clock.settle()
      expect(w.envSets).toEqual([])
      // The minute's tick finds login 1 spent by its own windows, with the Fable recovery still held.
      await clock.advance(61_000)
      refresh(w)
      await clock.advance(60_000)
      await clock.advance(36_000)
      expect(slots(w)).toEqual([SLOT3])
      expect(w.submitted).toHaveLength(1)
    })
  }
}

/** Presses in the pane that move the session to login 2: the pane's key for each. */
const PRESSES_TO_TWO = [['Use now', 'use-2'], ['Rotate now', 'rotate']] as const

/**
 * Review RT2 (HELD-INTENT-SPLIT). Once the token has refreshed and before the
 * retry fires, a press toward the held login is the person's own move: it
 * carries on with nothing, as every press does.
 */
for (const rotateTo of ['reset', 'room', 'order']) {
  for (const [name, key] of PRESSES_TO_TWO) {
    test(`with the rotation going by ${rotateTo}, ${name} toward the login a Fable stop was held back for, once the token has refreshed, moves there and sends no Fable carry-on`, async ($, on) => {
      const w = fresh()
      const clock = await guarded(on, w, { 'rotate-to': rotateTo, 'fable-continue-text': 'Go on on Fable-free ground.' }, [20, 30, 100])
      await start($, clock)
      await $.classic.StopFailure(FABLE_STOP)
      await clock.settle()
      expect(w.envSets).toEqual([])
      refresh(w)
      const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
      await pane.press({ key })
      await clock.settle()
      await pane.unmount()
      await clock.advance(2 * 60_000)
      expect(slots(w)).toEqual([SLOT2])
      expect(w.submitted).toEqual([])
    })
  }
}

/**
 * Review RT2 (HELD-RETRY-POLICY). A switch the rotation asked for, held back
 * for a token refresh, is asked again of the rotation when it is retried:
 * turned off meanwhile, it is dropped. A switch the person pressed for is theirs.
 */
for (const rotateTo of ['reset', 'room', 'order']) {
  for (const [kind, stop, atStop] of [['a Fable stop', FABLE_STOP, [20, 30, 100]], ['a plain usage-limit stop', { error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] }, [100, 41]]] as const) {
    test(`with the rotation going by ${rotateTo}, a switch ${kind} asked for, held back for a token about to refresh, is dropped when the rotation is turned off before the refresh lands`, async ($, on) => {
      const w = fresh()
      const clock = await guarded(on, w, { 'rotate-to': rotateTo }, [...atStop])
      await start($, clock)
      await $.classic.StopFailure(stop)
      await clock.settle()
      const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
      await pane.press({ key: 'rotate-to-off' })
      await clock.settle()
      await pane.unmount()
      refresh(w)
      await clock.advance(2 * 60_000)
      expect(w.envSets).toEqual([])
      expect(w.submitted).toEqual([])
    })
  }
}

test('a switch the rotation asked for leaves the view once the rotation is off: turned on again, the rotation asks afresh', async ($, on) => {
  const w = fresh()
  const clock = await guarded(on, w, {}, [20, 30, 100])
  const view = watchedView(on)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(view()?.held?.isRotation).toBe(true)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate-to-off' })
  await clock.advance(60_000)
  expect(view()?.held).toBe(undefined)
  await pane.unmount()
})

test('Use now held back for a token about to refresh still lands when the rotation is turned off meanwhile: the person pressed for it', async ($, on) => {
  const w = fresh()
  const clock = await guarded(on, w, {}, [20, 30])
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'use-2' })
  await clock.settle()
  expect(w.envSets).toEqual([])
  await pane.press({ key: 'rotate-to-off' })
  await clock.settle()
  await pane.unmount()
  refresh(w)
  await clock.advance(2 * 60_000)
  expect(slots(w)).toEqual([SLOT2])
})

/** A Fable stop on login 1 of a session that has settled in, `setup` having shaped the world; the notices about the Fable limit it left. */
type StayCase = {
  name: string
  /** What its words say. */
  notice: RegExp
  /** The usage of each login and the store the case starts from. */
  usage: Record<string, [number, number, number?]>
  store?: Record<string, unknown>
  /** The policy refuses switching. */
  isBlocked?: boolean
  /** The session visits the Claude in Chrome account while the stops come. */
  isVisiting?: boolean
}

const STAY_CASES: StayCase[] = [
  { name: 'the other login has its 5-hour window full', notice: /^Fable limit reached on account 1, and no other Claude account can take over/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [95, 30, 10] } },
  { name: 'the other login has its week full', notice: /^Fable limit reached on account 1, and no other Claude account can take over/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [10, 100, 10] } },
  { name: 'the rotation is off', notice: /^Fable limit reached on account 1, and usage based rotation is disabled/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [10, 30, 10] }, store: { 'rotate-to': 'off' } },
  { name: 'Claude Code\'s policy refuses switching', notice: /^Fable limit reached on account 1, and Claude Code's policy stops this session from switching accounts/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [10, 30, 10] }, isBlocked: true },
  { name: 'Connect holds the session on the Claude in Chrome account', notice: /^Fable limit reached on account 2 while Claude in Chrome connects/, usage: { 'tok-1': [20, 30], 'tok-2': [100, 30] }, store: { 'chrome-account': '2' }, isVisiting: true },
]

for (const { name, notice, usage, store = {}, isBlocked = false, isVisiting = false } of STAY_CASES) {
  test(`when ${name}, a Fable stop that cannot move tells the terminal why and the way out, once however many stops follow`, async ($, on) => {
    const w = fresh()
    w.refuseEnv = isBlocked
    if (isVisiting) w.chrome = { extensions: [SLOT2] }
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    Object.assign(w.usage, usage)
    const clock = world(on, w, { ...TWO_LOGINS, ...store })
    await start($, clock)
    for (let i = 0; i < 3; i++) {
      await $.classic.StopFailure(FABLE_STOP)
      await clock.settle()
      // A visit lasts until the clock moves on; the other stays are over at the next stop.
      if (!isVisiting) await clock.advance(36_000)
      expect(w.notices.filter(t => /Fable/.test(t))).toHaveLength(1)
    }
    const told = w.notices.filter(t => /Fable/.test(t))[0] ?? ''
    expect(told).toMatch(notice)
    expect(told.endsWith(WAY_OUT)).toBe(true)
    if (!isVisiting) expect(w.envSets).toEqual([])
  })
}

test('with every login\'s Fable week spent, and one of them full besides, a Fable stop that cannot move tells the Fable week\'s words, not the full login\'s', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [95, 30, 100]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(w.notices.filter(t => /Fable/.test(t))).toHaveLength(1)
  expect(w.notices.filter(t => /Fable/.test(t))[0]).toMatch(ALL_SPENT_NOTICE)
})

test('each reason a Fable stop stays for is told once in a session: a new reason is told, the same one never again', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [95, 30, 10]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const stop = async () => {
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
  }
  await stop()
  await stop()
  expect(w.notices.filter(t => /Fable/.test(t))).toHaveLength(1)
  // The person turns the rotation off in the pane: that is a new reason.
  const pane = await mountPane($)
  await pane.press({ key: 'rotate-to-off' })
  await clock.settle()
  await pane.unmount()
  await stop()
  await stop()
  const told = w.notices.filter(t => /Fable/.test(t))
  expect(told).toHaveLength(2)
  expect(told[0]).toMatch(/no other Claude account can take over/)
  expect(told[1]).toMatch(/usage based rotation is disabled/)
})

test('a Fable stop that moves, or is held back for a token about to refresh, says nothing of staying', async ($, on) => {
  const moved = fresh()
  const clockMoved = world(on, moved, TWO_LOGINS)
  moved.keychain['Claude Code-credentials'] = blob('tok-1')
  moved.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  moved.usage['tok-1'] = [20, 30, 100]
  moved.usage['tok-2'] = [10, 30, 10]
  await start($, clockMoved)
  await $.classic.StopFailure(FABLE_STOP)
  await clockMoved.settle()
  await clockMoved.advance(36_000)
  expect(slots(moved)).toEqual([SLOT2])
  expect(moved.notices.filter(t => /Fable/.test(t))).toEqual([])
})

test('a Fable stop held back for a token about to refresh says nothing of staying', async ($, on) => {
  const w = fresh()
  const clock = await guarded(on, w, {}, [20, 30, 100])
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(2 * 60_000)
  expect(w.envSets).toEqual([])
  expect(w.notices.filter(t => /Fable/.test(t))).toEqual([])
})

/** Three logins; a Fable stop on login 1 moves to login 2 (next in the list), and the carry-on is 35 s away. */
async function threeLogins($: Engine, on: On, w: World): Promise<MockClock> {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  w.usage['tok-3'] = [10, 30, 10]
  const three = { accounts: [...TWO_LOGINS.accounts, { id: '3', slot: SLOT3, email: 'three@example.com' }], 'rotate-to': 'order' }
  const clock = world(on, w, three)
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  return clock
}

/** What the person or the rotation does in the 35 s before the carry-on: later switches, or nothing. */
const LATER_SWITCHES: { name: string; keys: string[]; slots: string[]; submitted: number }[] = [
  { name: 'nothing', keys: [], slots: [SLOT2], submitted: 1 },
  { name: 'Use now on a third login', keys: ['use-3'], slots: [SLOT2, SLOT3], submitted: 0 },
  { name: 'Use now back on the login the stop left', keys: ['use-1'], slots: [SLOT2, ''], submitted: 0 },
  { name: 'Rotate now', keys: ['rotate'], slots: [SLOT2, SLOT3], submitted: 0 },
  { name: 'Use now on a third login and then back on the one the Fable stop moved to', keys: ['use-3', 'use-2'], slots: [SLOT2, SLOT3, SLOT2], submitted: 0 },
]

for (const { name, keys, slots: expected, submitted } of LATER_SWITCHES) {
  test(`${name} between a Fable switch and its carry-on ${submitted === 1 ? 'leaves the carry-on to go out' : 'cancels the carry-on, a later switch having been made'}`, async ($, on) => {
    const w = fresh()
    const clock = await threeLogins($, on, w)
    await clock.advance(10_000)
    const pane = await mountPane($)
    for (const key of keys) {
      await pane.press({ key })
      await clock.settle()
    }
    await pane.unmount()
    await clock.advance(36_000)
    expect(slots(w)).toEqual(expected)
    expect(w.submitted).toHaveLength(submitted)
    // And it does not come late.
    await clock.advance(5 * 60_000)
    expect(w.submitted).toHaveLength(submitted)
  })
}

// Review R1 of #4 clock_skew.
test('a later stop still counts when an earlier reading came from a session clock one hour ahead', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'reading:1': { fiveHour: { pct: 30, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW + HOUR, by: '1' },
    'mark:1': { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await pane.unmount()
})

// Review R1 of #4 clock_skew, the class.
test('a later stop survives clock skew at every view recount site', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'reading:1': { fiveHour: { pct: 30, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW + HOUR, by: '1' },
    'mark:1': { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const offenders: string[] = []
  const marked = async () => { await pane.redraw(); return (await pane.find({ text: /^▰{10} 100%$/ })) !== undefined }
  if (!(await marked())) offenders.push('mergeStore at boot')
  await pane.press({ key: 'five-hour-limit-off' })
  await clock.settle()
  if (!(await marked())) offenders.push('setFiveHourLimit off')
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  if (!(await marked())) offenders.push('setFiveHourLimit on')
  await clock.advance(61_000)
  if (!(await marked())) offenders.push('mergeStore timer')
  await pane.unmount()
  expect(offenders).toEqual([])
})

// Review R1 of #4 legacy_marks.
test('a current usage check preserves an unexpired 0.4 stop mark left in a reading by another session', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [30, 40]
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'reading:1': { fiveHour: { pct: 100, resetsAt: '2026-10-12T15:00:00Z', isStop: true }, at: NOW - HOUR },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await pane.unmount()
})

// Review R1 of #4 legacy_marks, the class.
test('current reading writers retain every legacy unexpired stop format on the shared store', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'reading:1': { fiveHour: { pct: 100, resetsAt: '2026-10-12T15:00:00Z', isStop: true }, at: NOW - HOUR },
    'reading:2': { fiveHour: { pct: 100 }, at: NOW - HOUR },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  const offenders: string[] = []
  for (const [id, version] of [['1', '0.4'], ['2', '0.3']] as const) {
    const mark = store.get(`mark:${id}`) as { pct?: number } | undefined
    const reading = store.get(`reading:${id}`) as { fiveHour?: { pct?: number } } | undefined
    if (mark?.pct !== 100 && reading?.fiveHour?.pct !== 100) offenders.push(`usage check / ${version} / account ${id}`)
  }
  const oldMark = { fiveHour: { pct: 100, resetsAt: '2026-10-12T15:00:00Z', isStop: true }, at: NOW - HOUR }
  store.set('reading:1', oldMark)
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  if ((store.get('reading:1') as { fiveHour?: { pct?: number } })?.fiveHour?.pct !== 100 && store.get('mark:1') === undefined) offenders.push('response / 0.4 / account 1')
  store.set('reading:1', oldMark)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  if ((store.get('reading:1') as { fiveHour?: { pct?: number } })?.fiveHour?.pct !== 100 && store.get('mark:1') === undefined) offenders.push('Fable stop / 0.4 / account 1')
  expect(offenders).toEqual([])
})

// Review R1 of #4 fable_stale_mark.
test('a Fable stop does not restamp an older 5-hour window over a mark written since the last merge', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'reading:1': { fiveHour: { pct: 50, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW - HOUR, by: '1' },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  store.set('mark:1', { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW - 30 * 60_000 })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(61_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await pane.unmount()
})

// Review R1 of #4 fable_stale_mark, the class.
test('a Fable stop preserves an unseen concurrent mark through every 5-hour limit setting', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW - HOUR)
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'five-hour-limit': 'off',
    'reading:1': { fiveHour: { pct: 50, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW - HOUR, by: '1' },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  store.set('mark:1', { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW - 30 * 60_000 })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(61_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const offenders: string[] = []
  if (!(await pane.find({ text: /^▰{10} 100%$/ }))) offenders.push('Fable stop / limit off / mergeStore')
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  if (!(await pane.find({ text: /^▰{10} 100%$/ }))) offenders.push('Fable stop / limit on / setFiveHourLimit')
  await pane.unmount()
  expect(offenders).toEqual([])
})

test('an older version\'s mark carried to the mark key never shortens a mark that stands longer there', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [null, 40]
  const longer = { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW - 30 * 60_000 }
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'reading:1': { fiveHour: { pct: 100, resetsAt: '2026-10-12T13:00:00Z', isStop: true }, at: NOW - HOUR },
    'mark:1': longer,
  }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('mark:1')).toEqual(longer)
})

// Review R1 of #4 mark_revival, rewritten by RULING 4113: it asserted that a newer read window ends a mark; no read
// ends one now, so a replaced mark cannot revive, and the test holds the mark through the same reads instead.
test('a stop\'s mark stands until its reset through a newer reported 5-hour window and a later read that lists none', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 40]
  w.usage['tok-2'] = [null, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'mark:1': { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW - HOUR } }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  // A response proves its login by its week: this one reports login 1's, and a 5-hour window.
  w.limits = [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-12T12:00:00Z' }, { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await clock.advance(61_000)
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{10} 100%$/ })).toBeDefined()
  await pane.unmount()
})

// Review R1 of #4 mark_revival, the class, rewritten as above: every reading writer, with and without a 5-hour window.
test('a stop\'s mark stands until its reset through every reading writer, whether its read lists a 5-hour window or not', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [30, 40]
  w.usage['tok-2'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'mark:1': { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW - HOUR } }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const offenders: string[] = []
  const marked = async () => { await pane.redraw(); return (await pane.find({ text: /^▰{10} 100%$/ })) !== undefined }
  if (!(await marked())) offenders.push('usage check with a window')
  w.limits = [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-12T12:00:00Z' }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  if (!(await marked())) offenders.push('response with a window')
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  if (!(await marked())) offenders.push('response without one')
  // Bug puma-4q7j2.3: the usage endpoint saying the account has no 5-hour window is the one read that ends the mark.
  w.usage['tok-1'] = [null, 40]
  await pastNextRead(clock)
  if (await marked()) offenders.push('usage check reporting none')
  await pane.unmount()
  expect(offenders).toEqual([])
})

// Review R1 of #9, SWITCH-FALSE-CONFIRM: a response that matches both logins confirms no switch.
for (const [name, one, two, first, second, kept] of [
  ['equal weeks', [null, 40], [null, 40], { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }, 55, 40],
  ['one shared 5-hour window', [30, 40], [32, 80], { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-12T12:00:00Z' }, 45, 80],
] as const) {
  test(`a switch is not confirmed by a response that matches the login left as well (${name})`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [...one]
    w.usage['tok-2'] = [...two]
    const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
    const clock = world(on, w, store)
    await start($, clock)
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    await pane.press({ key: 'use-2' })
    await clock.settle()
    await clock.advance(36_000)
    w.limits = [first]
    await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
    await clock.settle()
    w.limits = [{ kind: 'seven_day', percentUsed: second, resetsAt: '2026-10-18T03:00:00Z' }]
    await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
    await clock.settle()
    expect((store.get('usage:2') as { sevenDay?: { pct?: number } }).sevenDay?.pct).toBe(kept)
    await pane.unmount()
  })
}

// Review R1 of #9, UNOWNED-READING-REUSED: a reading no login owns is not re-stamped by a stop.
for (const [name, by] of [['no owner', undefined], ['another login as owner', '2']] as const) {
  test(`a Fable stop does not re-stamp a stored reading with ${name}`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.failing = { 'tok-1': 429 }
    const store = new Map<string, unknown>(Object.entries({
      accounts: [TWO_LOGINS.accounts[0]], 'rotate-to': 'off',
      'reading:1': { sevenDay: { pct: 11, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - HOUR, ...(by ? { by } : {}) },
    }))
    const clock = world(on, w, store)
    await start($, clock)
    await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'You have reached your Fable limit' })
    await clock.settle()
    // C6 (puma-eslxj.7), a changed expected value. SOURCE: the C6 CASE, RULING 4467: the stop stores its Fable mark
    // under fable-mark:1, not usage:1, so it writes no reading at all and takes no week from the one no login owns.
    expect(markOf(store.get('fable-mark:1'))[0]).toBe(100)
    expect(store.get('usage:1')).toBeUndefined()
  })
}

// RULING 4278: a week mark still spends a login whose reading was dropped as no one's.
test('a week mark spends a login whose stored reading has no owner: the pane shows its week spent, and it is not the launch pick', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.failing = { 'tok-1': 429 }
  w.usage['tok-2'] = [null, 99]
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'launch-on': 'account:1',
    'reading:1': { sevenDay: { pct: 11, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - HOUR },
    'week-mark:1': { pct: 100, resetsAt: '2026-10-18T03:00:00Z', at: NOW - HOUR },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  expect((store.get('launch-slot') as { id?: string } | undefined)?.id).not.toBe('1')
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰+ 100%$/ })).toBeDefined()
  await pane.unmount()
})

// puma-4q7j2.8: account 3's reading was stored under account 1, and the launch pick named spent account 1.
test('a response measured before the session knows its login is stored under no other login', async ($, on) => {
  const w = fresh()
  w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.failing = { 'tok-1': 429 }
  w.usage['tok-2'] = [null, 11]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  w.limits = [{ kind: 'seven_day', percentUsed: 11, resetsAt: '2026-10-18T03:00:00Z' }]
  // The first response can land while the session is still starting, before it has read its own login.
  const started = $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await started
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
  expect(store.get('usage:1')).toBeUndefined()
  expect((store.get('usage:2') as { sevenDay?: { pct?: number } } | undefined)?.sevenDay?.pct).toBe(11)
})

test('a stored reading no login can be shown to own is dropped, and a login whose usage check fails with no reading of its own is never the launch pick', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.failing = { 'tok-1': 429 }
  w.usage['tok-2'] = [null, 50]
  // Left by an older version: another login's numbers under account 1, with no owner on them.
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'reading:1': { sevenDay: { pct: 11, resetsAt: '2026-10-18T03:00:00.000Z' }, at: NOW - HOUR },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  expect((store.get('launch-slot') as { id?: string } | undefined)?.id).toBe('2')
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰▱{9} 11%$/ })).toBeUndefined()
  await pane.unmount()
})

// ---------------------------------------------------------------- one usage schedule per store

/** How many usage calls the mod made with `token`. */
const callsWith = (w: World, token: string) => w.usageCalls.filter(t => t === token).length

test('boot makes no usage call for a login another session has scheduled, and calls for one nobody has', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 30]
  // Another session read account 2 a minute ago: its next read is due in nine minutes.
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'usage-due:2': { next: NOW + 9 * 60_000, fails: 0, at: NOW - 60_000 },
    'usage:2': { sevenDay: { pct: 30, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - 60_000, by: '2', v: 1, src: 'body' },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(callsWith(w, 'tok-1')).toBe(1)
  expect(callsWith(w, 'tok-2')).toBe(0)
  expect(store.get('usage-due:1')).toMatchObject({ fails: 0, at: expect.any(Number) })
})

test('after a 429 with Retry-After 1800 no session calls for 30 minutes, and the pane names the wait', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.failing = { 'tok-2': 429 }
  w.retryAfter = { 'tok-2': '1800' }
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  expect(callsWith(w, 'tok-2')).toBe(1)
  // Stored for every session: the back-off is the header's, not the two-minute floor.
  expect((store.get('usage-due:2') as { next?: number; fails?: number } | undefined)?.next).toBeGreaterThanOrEqual(NOW + 30 * 60_000)
  expect((store.get('check-error:2') as { why?: string } | undefined)?.why).toMatch(/HTTP 429.*1800/)
  await clock.advance(10 * 60_000 + 1000)
  expect(callsWith(w, 'tok-2')).toBe(1)
  // The back-off ends just after the 30th minute: the minute's tick after it reads again, whatever the 10-minute check's phase.
  await clock.advance(19 * 60_000)
  expect(callsWith(w, 'tok-2')).toBe(1)
  await clock.advance(2 * 60_000)
  expect(callsWith(w, 'tok-2')).toBe(2)
})

test('after a switch on an idle session, the minutes it settles make no usage call', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [92, 40]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  const before = w.usageCalls.length
  await clock.advance(5 * 60_000)
  expect(w.usageCalls.length).toBe(before)
})

test('a usage-limit stop calls again only when the last read is over a minute old and no back-off stands', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [50, 20]
  const store = new Map<string, unknown>(Object.entries({ accounts: [{ id: '1', slot: '', email: 'one@example.com' }] }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(callsWith(w, 'tok-1')).toBe(1)
  // Seconds after the boot's read: nothing new to learn.
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(callsWith(w, 'tok-1')).toBe(1)
  await clock.advance(2 * 60_000)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(callsWith(w, 'tok-1')).toBe(2)
  // A back-off another session stored holds a stop's call too, and a /login's.
  store.set('usage-due:1', { next: NOW + HOUR, fails: 2, at: NOW })
  await clock.advance(2 * 60_000)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await $.command.run({ command: 'login', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  await clock.settle()
  expect(callsWith(w, 'tok-1')).toBe(2)
})

test('a login no response read is read every 30 minutes, and once responses come, every 10', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 20]
  const clock = world(on, w, { accounts: [{ id: '1', slot: '', email: 'one@example.com' }] })
  await start($, clock)
  expect(callsWith(w, 'tok-1')).toBe(1)
  await clock.advance(25 * 60_000)
  expect(callsWith(w, 'tok-1')).toBe(1)
  // A response stored after the boot's read: the login is in use from the next read on.
  w.limits = [{ kind: 'five_hour', percentUsed: 12, resetsAt: '2026-10-12T12:00:00Z' }, { kind: 'seven_day', percentUsed: 21, resetsAt: '2026-10-18T03:00:00Z' }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.advance(6 * 60_000)
  expect(callsWith(w, 'tok-1')).toBe(2)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.advance(10 * 60_000)
  expect(callsWith(w, 'tok-1')).toBe(3)
})

test('a /login reads the usage of the login in use again only past a minute since its last read', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [50, 20]
  w.owners = { 'tok-1': 'one@example.com' }
  w.loginToken = 'tok-1'
  const clock = world(on, w, { accounts: [{ id: '1', slot: '', email: 'one@example.com' }] })
  await start($, clock)
  const login = { command: 'login', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const
  await $.command.run(login)
  await clock.settle()
  expect(callsWith(w, 'tok-1')).toBe(1)
  await pastLastRead(clock)
  await $.command.run(login)
  await clock.settle()
  expect(callsWith(w, 'tok-1')).toBe(2)
})

test('a usage call that throws backs off as a failed one, for every session', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.throwing = ['tok-1']
  const store = new Map<string, unknown>(Object.entries({ accounts: [{ id: '1', slot: '', email: 'one@example.com' }] }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(callsWith(w, 'tok-1')).toBe(1)
  expect(store.get('usage-due:1')).toMatchObject({ fails: 1 })
  // Past the claim, inside the two-minute back-off: a stop reads nothing.
  await clock.advance(100_000)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(callsWith(w, 'tok-1')).toBe(1)
})

test('a claimed read of a login whose token has run out releases its claim, and its row says it failed to update', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  // Login 2 is idle: its access token ran out an hour ago and no session has refreshed it.
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW - HOUR)
  w.usage['tok-1'] = [10, 20]
  const lastRead = NOW - 3 * HOUR
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'holder:2': { token: await fingerprint('refresh-tok-2'), who: { email: 'two@example.com' } },
      'usage:2': { fiveHour: { pct: 0 }, sevenDay: { pct: 10, resetsAt: WEEK_RESET }, at: lastRead, by: '2', v: 1, src: 'body' },
      'usage-due:2': { next: NOW - 1, fails: 0, at: lastRead, v: 1 },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  expect(callsWith(w, 'tok-2')).toBe(0)
  expect(store.get('usage-due:2')).not.toHaveProperty('claim')
  expect(store.get('usage-due:2')).toMatchObject({ fails: 0, at: lastRead })
  expect((store.get('usage-due:2') as { next: number }).next).toBeGreaterThanOrEqual(NOW + USAGE_IDLE_MS)
  expect(lineOne(store, '2')).toMatch(/ Failed to update \(token run out\), until a session refreshes its token$/)
})

test('a login whose token has run out and that has no reading saves no failure for its skipped read, so it stays in the pick', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW - HOUR)
  w.usage['tok-1'] = [10, 20]
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('check-error:2')).toBeUndefined()
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.unmount()
})

// Review codex-r1 F1 [CLAIM-OWNERSHIP]: the release took any claim under this session's id.
test('a skipped read gives back only the claim its check made: a read this session started since keeps its own', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW - HOUR)
  w.usage['tok-1'] = [10, 20]
  const lastRead = NOW - 3 * HOUR
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'usage:2': { fiveHour: { pct: 0 }, sevenDay: { pct: 10, resetsAt: WEEK_RESET }, at: lastRead, by: '2', v: 1, src: 'body' },
      'usage-due:2': { next: NOW - 1, fails: 0, at: lastRead, v: 1 },
    }),
  )
  // Between the skip and the release, a stop or a /login in this session renews login 2's claim for a read of its own.
  const renewed = { next: NOW + 10 * 60_000, fails: 0, claim: 'session-1', at: lastRead, v: 1 }
  w.afterStoreSet = key => {
    if (key === 'check-error:2' && w.afterStoreSet !== undefined) {
      w.afterStoreSet = undefined
      store.set('usage-due:2', renewed)
    }
  }
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('usage-due:2')).toEqual(renewed)
})

/** A response's rate limits: the 5-hour window and the week, in percent used, and when the week resets. */
const limitsOf = (five: number, week: number, weekReset = '2026-10-18T03:00:00Z'): SessionRateLimit[] => [
  { kind: 'five_hour', percentUsed: five, resetsAt: '2026-10-12T12:00:00Z' },
  { kind: 'seven_day', percentUsed: week, resetsAt: weekReset },
]

/** A response measured with the world's limits, and what it set off run out. */
async function respond($: Engine, clock: MockClock, w: World): Promise<void> {
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
}

// Review opus-r1 F1 [STALE-COMPARISON], the instance: the settle read the target at the base; gated, it must still read it once.
test('a switch that took is confirmed though its login was spent elsewhere since its last read', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [50, 40]
  w.usage['tok-2'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([])
  await clock.advance(25 * 60_000)
  // Login 2 was used outside this store meanwhile; login 1's response crosses the leave line.
  w.usage['tok-2'] = [30, 32]
  w.usage['tok-1'] = [93, 40]
  w.limits = limitsOf(93, 40)
  await respond($, clock, w)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  // The switch took: responses report login 2's real usage and week, before its schedule reads it.
  w.limits = limitsOf(30, 32, OTHER_WEEK)
  await clock.advance(60_000)
  await respond($, clock, w)
  await clock.advance(3 * 60_000 + 10_000)
  await respond($, clock, w)
  expect(w.toasts.filter(t => /has not shown/.test(t))).toEqual([])
})

// Review opus-r1 F1 [STALE-COMPARISON], the class: every reading the settle compares, each window sameUsage compares,
// and the cost: at most two usage calls per switch.
const SETTLE_CASES: { name: string; spent: [number, number]; landed: 'confirmed' | 'reverted' }[] = [
  { name: 'switch took, target spent elsewhere since its read', spent: [30, 32], landed: 'confirmed' },
  { name: 'switch did not take, the source\'s 5-hour window climbed 4 points', spent: [97, 40], landed: 'reverted' },
  { name: 'switch did not take, the source\'s week climbed 4 points', spent: [93, 44], landed: 'reverted' },
]
for (const c of SETTLE_CASES) {
  test(`the settle judges a response against readings no older than the switch, at two usage calls at most (${c.name})`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [93, 40]
    w.usage['tok-2'] = [10, 30]
    w.weekResets = { 'tok-2': OTHER_WEEK }
    const clock = world(on, w, TWO_LOGINS)
    await start($, clock)
    expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
    const before = w.usageCalls.length
    // The login the responses report spends on, its week among it; the usage endpoint agrees with them.
    w.usage[c.landed === 'confirmed' ? 'tok-2' : 'tok-1'] = c.spent
    w.limits = limitsOf(...c.spent, c.landed === 'confirmed' ? OTHER_WEEK : '2026-10-18T03:00:00Z')
    await clock.advance(60_000)
    await respond($, clock, w)
    await clock.advance(4 * 60_000)
    await respond($, clock, w)
    const landed = w.toasts.some(t => /did not take/.test(t)) ? 'reverted' : w.toasts.some(t => /has not shown/.test(t)) ? 'told not shown' : 'confirmed'
    expect([c.name, landed]).toEqual([c.name, c.landed])
    expect(w.usageCalls.length - before).toBeLessThanOrEqual(2)
  })
}

// Review opus-r1 F2 [GATE-OWNED-BY-SIGN-IN], the instance: a /login that signs in another person reads the new sign-in at once.
test('a /login that signs another person in reads the new sign-in at once', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [80, 20]
  w.usage['tok-9'] = [5, 5]
  w.owners = { 'tok-1': 'one@example.com', 'tok-9': 'nine@example.com' }
  w.loginToken = 'tok-9'
  const store = new Map<string, unknown>(Object.entries({ accounts: [{ id: '1', slot: '', email: 'one@example.com' }] }))
  const clock = world(on, w, store)
  await start($, clock)
  await $.command.run({ command: 'login', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
  await clock.settle()
  expect(w.toasts.filter(t => /is nine@example.com/.test(t))).toHaveLength(1)
  const five = (store.get('usage:1') as { fiveHour?: { pct?: number } } | undefined)?.fiveHour?.pct
  expect([callsWith(w, 'tok-9'), five]).toEqual([1, 5])
})

// Review opus-r1 F2 [GATE-OWNED-BY-SIGN-IN], the class: every gate an old sign-in leaves on a forced read.
const SIGN_IN_GATES: { name: string; before: (w: World) => void; wait: number }[] = [
  { name: 'the old sign-in read under a minute ago', before: () => undefined, wait: 0 },
  { name: 'the old sign-in under a Retry-After back-off', before: w => { w.failing = { 'tok-1': 429 }; w.retryAfter = { 'tok-1': '1800' } }, wait: 2 * 60_000 },
]
for (const c of SIGN_IN_GATES) {
  test(`a new sign-in is read past every gate the old one left (${c.name})`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.usage['tok-1'] = [80, 20]
    w.usage['tok-9'] = [5, 5]
    w.owners = { 'tok-1': 'one@example.com', 'tok-9': 'nine@example.com' }
    w.loginToken = 'tok-9'
    c.before(w)
    const clock = world(on, w, new Map<string, unknown>(Object.entries({ accounts: [{ id: '1', slot: '', email: 'one@example.com' }] })))
    await start($, clock)
    await clock.advance(c.wait)
    await $.command.run({ command: 'login', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
    await clock.settle()
    expect([c.name, callsWith(w, 'tok-9')]).toEqual([c.name, 1])
  })
}

// ---------------------------------------------------------------- readings that cannot cross (C4)

/** What the store holds as a login's reading, under either key: the current one or the legacy one. */
const storedOf = (store: Map<string, unknown>, id: string) => (store.get(`usage:${id}`) ?? store.get(`reading:${id}`)) as { sevenDay?: { pct?: number; resetsAt?: string }; by?: string } | undefined

/** Account 2's week resets a day before account 1's, so a response tells by its reset whose week it is. */
const OTHER_WEEK = '2026-10-17T05:00:00Z'

test('a usage body for a token whose holder is unknown, its profile call answering 429, is stored for no login', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 30]
  w.owners = { 'tok-1': 'one@example.com' }
  w.profileFailing = { 'tok-2': 429 }
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  expect(storedOf(store, '1')?.sevenDay?.pct).toBe(20)
  expect(storedOf(store, '2')).toBeUndefined()
})

test('a response whose week resets with another login\'s, not the login in use\'s, is stored for no login', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  // Login 1 is in use, but the response carries login 2's week: it went out on login 2's sign-in.
  w.limits = [{ kind: 'seven_day', percentUsed: 77, resetsAt: OTHER_WEEK }]
  await respond($, clock, w)
  expect(storedOf(store, '1')?.sevenDay?.pct).toBe(20)
  expect(storedOf(store, '2')?.sevenDay?.pct).toBe(30)
})

test('a response whose week resets with two logins at once is stored for neither: its reset cannot tell them apart', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  w.limits = [{ kind: 'seven_day', percentUsed: 31, resetsAt: WEEK_RESET }]
  await respond($, clock, w)
  expect(storedOf(store, '1')?.sevenDay?.pct).toBe(20)
})

test('a switch whose responses still carry the week of the login left, within 3 points of both, is not confirmed and stores nothing under the login moved to', async ($, on) => {
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
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  // The switch did not take: responses still carry login 1's week, within 3 points of both logins' weeks.
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(60_000)
  await respond($, clock, w)
  await clock.advance(4 * 60_000)
  await respond($, clock, w)
  expect(w.toasts.filter(t => /did not take/.test(t))).toHaveLength(1)
  expect(storedOf(store, '2')?.sevenDay?.resetsAt).toBe(OTHER_WEEK)
})

test('a stop that moves nothing leaves a settling switch settling: responses still judge it', async ($, on) => {
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
  // Past the settle window, a turn dies on a limit; the rotation is off, so nothing moves.
  await clock.advance(40_000)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(20_000)
  await respond($, clock, w)
  await clock.advance(4 * 60_000)
  await respond($, clock, w)
  expect(w.toasts.filter(t => /did not take/.test(t))).toHaveLength(1)
})

test('a reading an older version writes after this session started says, once, to restart that session', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 20]
  const store = new Map<string, unknown>(Object.entries({ accounts: [{ id: '1', slot: '', email: 'one@example.com' }] }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(await bandText($)).not.toMatch(/older account-rotator/)
  // An older version writes only reading:<id>, never usage:<id>.
  store.set('reading:1', { sevenDay: { pct: 50, resetsAt: WEEK_RESET }, at: NOW + 30_000, by: '1' })
  await clock.advance(61_000)
  expect(await bandText($)).toMatch(/^An older account-rotator still runs in another session; restart it\.$/)
})

// Regression guard (passes at the base): the crossed pair the operator saw, reading:3 and reading:5 with no `by`.
test('readings stored with no owner, as an older version left accounts 3 and 5, are never drawn', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 20]
  const store = new Map<string, unknown>(Object.entries({
    ...THREE_LOGINS,
    'reading:2': { sevenDay: { pct: 13, resetsAt: WEEK_RESET }, at: NOW - 60_000 },
    'reading:3': { sevenDay: { pct: 11, resetsAt: WEEK_RESET }, at: NOW - 59_720 },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ text: /^▰▱{9} 1[13]%$/ })).toBeUndefined()
  await pane.unmount()
})

test('a login whose only reading is an older version\'s is read at boot, though its schedule says later; a back-off still holds', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'reading:1': { sevenDay: { pct: 50, resetsAt: WEEK_RESET }, at: NOW - 60_000, by: '1' },
    'usage-due:1': { next: NOW + 20 * 60_000, fails: 0, at: NOW - 60_000 },
    'usage-due:2': { next: NOW + 20 * 60_000, fails: 2, at: NOW - HOUR },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  expect([callsWith(w, 'tok-1'), callsWith(w, 'tok-2')]).toEqual([1, 0])
  expect(storedOf(store, '1')?.sevenDay?.pct).toBe(20)
})

// puma-eslxj.16: nothing reads writer:<sessionId>, so boot writes none; an older version's records stay as they stand.
test('a session writes no writer: key at boot, and leaves the writer: records of older versions as they stand', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 20]
  const old = { 'writer:gone': { version: 1, at: NOW - 25 * HOUR }, 'writer:recent': { version: 1, at: NOW - HOUR } }
  const store = new Map<string, unknown>(Object.entries({
    accounts: [{ id: '1', slot: '', email: 'one@example.com' }],
    ...old,
  }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  expect(Object.fromEntries([...store].filter(([key]) => key.startsWith('writer:')))).toEqual(old)
})

/** Every text the pane draws, one per line. */
async function paneText($: Engine): Promise<string> {
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')
  await pane.unmount()
  return texts.join('\n')
}

/**
 * A switch to login 2 by Use now, unproven by any response, with a turn dying on a limit `delay` after it; `last`,
 * where given, the response measured between, by whose week it says which login it spent.
 */
async function stopDuringSwitch(
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
const SETTLE_WAIT = 36_000

// Review codex-c4 STOP-OWNER-CROSS [STOP-CROSSING], the instance: a stop with no response since an unproven switch
// marks the login moved to provisionally, and the settle that finds the switch did not take drops it.
test('a stop before any response proves a switch, when the switch then proves not to have taken, leaves the login moved to unmarked', async ($, on) => {
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(4 * 60_000 + 10_000)
  await respond($, clock, w)
  expect(w.toasts.some(t => /did not take/.test(t))).toBe(true)
  expect(store.get('mark:2')).toBeUndefined()
})

// Review codex-c4 STOP-OWNER-CROSS [STOP-CROSSING], the class: every moment after the settle window, every kind of stop.
const UNPROVEN_STOPS: [string, string, string][] = [
  ['5-hour', "You've hit your session limit", 'mark:2'],
  ['weekly', "You've hit your weekly limit", 'week-mark:2'],
  ['plain', 'Claude usage limit reached.', 'mark:2'],
]
for (const delay of [36_000, 50_000]) {
  for (const [kind, said, key] of UNPROVEN_STOPS) {
    test(`a ${kind} stop ${delay / 1000} s into a switch that proves not to have taken leaves no ${key}`, async ($, on) => {
      const { w, store, clock } = await stopDuringSwitch($, on, delay, said)
      w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
      await clock.advance(4 * 60_000 + 10_000)
      await respond($, clock, w)
      expect([kind, delay, store.get(key)]).toEqual([kind, delay, undefined])
    })
  }
}

// Review opus-c4 F3 [STOP-CROSSING]: a response since the switch names the stop's login by its week.
for (const [kind, said, key] of UNPROVEN_STOPS) {
  test(`a ${kind} stop whose last response since an unproven switch carries the login left's week marks that login, not the one moved to`, async ($, on) => {
    const last = [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-12T12:00:00Z' }, { kind: 'seven_day', percentUsed: 41, resetsAt: WEEK_RESET }]
    const { store } = await stopDuringSwitch($, on, 61_000, said, last)
    expect([kind, store.get(key), store.get(key.replace(':2', ':1')) !== undefined]).toEqual([kind, undefined, true])
  })
}

// Review opus-c4 F1 [STICKY-NOTICE]: the line stands while an older version writes, and falls once it has stopped.
test('the older-session line falls once no older version has written for half an hour, on any login', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const offenders: string[] = []
  for (const id of ['1', '2']) {
    store.set(`reading:${id}`, { sevenDay: { pct: 50, resetsAt: WEEK_RESET }, at: clock.now() + 1, by: id })
    await clock.advance(61_000)
    if (!/older account-rotator still runs/.test(await bandText($))) offenders.push(`reading:${id} just written: no line`)
    await clock.advance(31 * 60_000)
    if (/older account-rotator still runs/.test(await bandText($))) offenders.push(`reading:${id} quiet half an hour: line still up`)
  }
  expect(offenders).toEqual([])
})

// Review opus-c4 F2 [SILENT-UNREAD]: a login no profile call names is unread, and the pane says why, whatever the failure.
for (const status of [429, 500, 401]) {
  test(`a login whose profile call answers ${status} is not read, and its check error says why`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [10, 20]
    w.usage['tok-2'] = [10, 30]
    w.profileFailing = { 'tok-2': status }
    const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
    const clock = world(on, w, store)
    await start($, clock)
    await clock.advance(10 * 60_000)
    expect(callsWith(w, 'tok-2')).toBe(0)
    expect((store.get('check-error:2') as { why?: string } | undefined)?.why).toMatch(new RegExp(`profile call answered HTTP ${status}`))
    // The row says the update failed and names the profile call's status, which is not the usage call's.
    expect(lineOne(store, '2')).toMatch(new RegExp(`  \\d\\d:\\d\\d Failed to update \\(profile HTTP ${status}\\)$`))
    // The released claim holds the usage read's next try; the profile call is tried again by the 10-minute check, so the row names none.
    expect(store.get('usage-due:2')).toHaveProperty('next')
  })
}

/** The band's text above the prompt, or '' where no band is drawn. */
async function bandText($: Engine): Promise<string> {
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

/** A week reset neither login has: within no hour, and no whole number of weeks, of either. */
const STRANGE_WEEK = '2026-10-15T20:00:00Z'

/** Presses Use now on `id` in the pane. */
async function useNow($: Engine, clock: MockClock, id: string): Promise<void> {
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: `use-${id}` })
  await clock.settle()
  await pane.unmount()
}

/** Ends the session with the engine's reason word: by default as /exit does. */
async function endSession($: Engine, clock: MockClock, reason = 'prompt_input_exit'): Promise<void> {
  await $.session.end({ reason, sessionId: 'session-1', resume: { id: 'session-1' } } as Parameters<Engine['session']['end']>[0])
  await clock.settle()
}

// puma-eslxj.20 (RULING 4713): a press that finishes during the stop's own usage read leaves a record naming the switch
// it replaced. The next end of a switch gives that mark back too: left, it reads spent for every session until its reset.
for (const isProven of [false, true]) {
  test(`a stop whose usage read a press outlasts leaves the login moved to unmarked at the next press, ${isProven ? 'that press\'s switch proven' : 'its switch still unproven'}`, async ($, on) => {
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
    await clock.advance(90_000)
    let isPressed = false
    w.beforeFetch = async () => {
      if (isPressed) return
      isPressed = true
      await pane.press({ key: 'use-1' })
    }
    await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
    await clock.settle()
    expect([isPressed, store.get('mark:2') !== undefined]).toEqual([true, true])
    if (isProven) {
      await clock.advance(SETTLE_WAIT)
      w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
      await respond($, clock, w)
    }
    await pane.press({ key: 'use-2' })
    await clock.settle()
    expect(store.get('mark:2')).toBeUndefined()
    await pane.unmount()
  })
}

test('a stop before any response proves a switch, when a press replaces the switch, leaves the login moved to unmarked', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  expect(store.get('mark:2')).toBeDefined()
  await useNow($, clock, '1')
  expect(store.get('mark:2')).toBeUndefined()
})

test('a stop before any response proves a switch, when the switch gives up unproven, leaves the login moved to unmarked', async ($, on) => {
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: STRANGE_WEEK }]
  await clock.advance(4 * 60_000 + 10_000)
  await respond($, clock, w)
  expect(w.toasts.some(t => /has not shown/.test(t))).toBe(true)
  expect(store.get('mark:2')).toBeUndefined()
})

test('a stop before any response proves a switch, when the session ends first, leaves the login moved to unmarked', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  await endSession($, clock)
  expect(store.get('mark:2')).toBeUndefined()
})

test('a 5-hour stop the revert drops leaves the login as having no 5-hour window again, as its usage said', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 40_000, "You've hit your session limit", undefined, { 'tok-2': [null, 41] })
  expect(store.get('no-five-hour:2')).toBe(false)
  await endSession($, clock)
  expect([store.get('mark:2'), store.get('no-five-hour:2')]).toEqual([undefined, true])
})

test('a stop before any response proves a switch keeps its mark once a response proves the switch, through the session\'s end', async ($, on) => {
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  w.limits = [{ kind: 'seven_day', percentUsed: 41, resetsAt: OTHER_WEEK }]
  await respond($, clock, w)
  await endSession($, clock)
  expect(store.get('mark:2')).toBeDefined()
})

test('a 5-hour stop the revert drops leaves the 5-hour window a usage read since reported', async ($, on) => {
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, "You've hit your session limit", undefined, { 'tok-2': [null, 41] })
  // The settle reads login 2 at the response: its usage now reports a 5-hour window, and the response is login 1's.
  w.usage['tok-2'] = [20, 41]
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(4 * 60_000 + 10_000)
  await respond($, clock, w)
  expect(w.toasts.some(t => /did not take/.test(t))).toBe(true)
  expect([store.get('mark:2'), store.get('no-five-hour:2')]).toEqual([undefined, false])
})

test('a stop that left a login\'s 5-hour window as it was changes nothing there when it is reverted', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.', undefined, { 'tok-2': [null, 41] })
  store.set('no-five-hour:2', false)
  await endSession($, clock)
  expect(store.get('no-five-hour:2')).toBe(false)
})

test('two 5-hour stops on one unproven switch revert to what was there before the first', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 40_000, "You've hit your session limit", undefined, { 'tok-2': [null, 41] })
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: "You've hit your session limit" })
  await clock.settle()
  await endSession($, clock)
  expect(store.get('no-five-hour:2')).toBe(true)
})

test('a Fable stop the revert drops is no Fable stop of this session: a later read that finds every Fable week spent draws no notice', async ($, on) => {
  const { w, clock } = await stopDuringSwitch($, on, 40_000, FABLE_STOP.last_assistant_message, undefined, { 'tok-1': [10, 40, 100], 'tok-2': [10, 41, 30] })
  await useNow($, clock, '1')
  w.usage['tok-2'] = [10, 41, 100]
  await clock.advance(USAGE_IDLE_MS + 60_000)
  expect(await bandText($)).not.toMatch(/has used its Fable week/)
})

test('a login whose schedule this version wrote is not read at boot before its time, though it has no reading of this version', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'usage-due:2': { next: NOW + 20 * 60_000, fails: 0, at: NOW - 60_000, v: 1 },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(callsWith(w, 'tok-2')).toBe(0)
  expect(store.get('usage-due:2')).toMatchObject({ next: NOW + 20 * 60_000, v: 1 })
})

test('a schedule an older version writes after boot does not hold off a login with no reading of this version', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 20]
  w.usage['tok-2'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({
    ...TWO_LOGINS,
    'rotate-to': 'off',
    'usage-due:2': { next: NOW + 12 * 60_000, fails: 1, retryAfter: 720_000, v: 1 },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(10 * 60_000 + 10_000)
  expect(callsWith(w, 'tok-2')).toBe(0)
  // An older version read login 2 before its back-off ended, into its own key, and scheduled the next in 30 minutes.
  store.set('reading:2', { sevenDay: { pct: 30, resetsAt: OTHER_WEEK }, at: clock.now() })
  store.set('usage-due:2', { next: clock.now() + USAGE_IDLE_MS, fails: 0, at: clock.now() })
  const before = callsWith(w, 'tok-2')
  await clock.advance(61_000)
  expect(callsWith(w, 'tok-2')).toBe(before + 1)
  expect((store.get('usage:2') as { sevenDay?: { pct?: number } } | undefined)?.sevenDay?.pct).toBe(30)
})

/** The unproven ends of a switch a revert follows: the session's end, a press of Use now on login 1, the give-up. */
const UNPROVEN_ENDS: [string, ($: Engine, w: World, clock: MockClock) => Promise<void>][] = [
  ['the session end', async ($, _w, clock) => endSession($, clock)],
  ['Use now on login 1', async ($, _w, clock) => useNow($, clock, '1')],
  ['the give-up', async ($, w, clock) => {
    w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: STRANGE_WEEK }]
    await clock.advance(4 * 60_000 + 10_000)
    await respond($, clock, w)
  }],
]

// Review codex-e17 SHARED-MARK-ERASURE [UNDO-OWNERSHIP]: a mark another session wrote since the stop is not the stop's to drop.
for (const [kind, said, key] of UNPROVEN_STOPS) {
  for (const [name, end] of UNPROVEN_ENDS) {
    test(`${name} of an unproven switch keeps a ${kind} ${key} another session wrote after the stop`, async ($, on) => {
      const { w, store, clock } = await stopDuringSwitch($, on, 40_000, said)
      const later = { pct: 100, resetsAt: '2026-10-19T03:00:00Z', at: clock.now() + 1 }
      store.set(key, later)
      await end($, w, clock)
      expect([kind, name, store.get(key)]).toEqual([kind, name, later])
    })
  }
}

// Review opus-e17 F1 [UNDO-OWNERSHIP]: the stop's own forced read is no read since the stop; it moves no-five-hour before the stop does.
for (const delay of [40_000, 90_000, 150_000]) {
  for (const [name, end] of UNPROVEN_ENDS) {
    test(`${name} of a switch a 5-hour stop ${delay / 1000} s in left unproven gives back no-five-hour:2 true`, async ($, on) => {
      const { w, store, clock } = await stopDuringSwitch($, on, delay, "You've hit your session limit", undefined, { 'tok-2': [null, 41] })
      expect(store.get('no-five-hour:2')).toBe(false)
      await end($, w, clock)
      expect([name, delay, store.get('no-five-hour:2')]).toEqual([name, delay, true])
    })
  }
}

// Review opus-e17 F3 [UNDO-OWNERSHIP]: a Fable stop proven login 1's after the provisional one stands when the provisional one goes.
const ONES_WEEK: SessionRateLimit[] = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
const F3_ENDS: [string, ($: Engine, w: World, clock: MockClock) => Promise<void>][] = [
  ['the session end', async ($, _w, clock) => endSession($, clock)],
  ['Use now on login 1', async ($, _w, clock) => useNow($, clock, '1')],
  ['the did-not-take settle', async ($, w, clock) => {
    await clock.advance(4 * 60_000 + 10_000)
    await respond($, clock, w)
  }],
]
for (const [name, end] of F3_ENDS) {
  test(`${name} of an unproven switch keeps a proven Fable stop that came after the provisional one`, async ($, on) => {
    const { w, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.', undefined, { 'tok-1': [10, 40, 100], 'tok-2': [10, 41, 100] })
    w.limits = ONES_WEEK
    await respond($, clock, w)
    await $.classic.StopFailure(FABLE_STOP)
    await clock.settle()
    expect([name, 'before', /has used its Fable week/.test(await bandText($))]).toEqual([name, 'before', true])
    await end($, w, clock)
    expect([name, 'after', /has used its Fable week/.test(await bandText($))]).toEqual([name, 'after', true])
  })
}

// Review opus-e17 F2 [END-IS-NOT-EXIT]: an end the process outlives (a /clear, a resume) leaves the switch, and its stop, unsettled.
for (const reason of ['clear', 'resume']) {
  for (const [kind, said, key] of UNPROVEN_STOPS) {
    test(`a session end for ${reason}, which the process outlives, keeps a ${kind} stop's ${key} for the proof that follows`, async ($, on) => {
      const { w, store, clock } = await stopDuringSwitch($, on, 40_000, said)
      await endSession($, clock, reason)
      w.limits = [{ kind: 'seven_day', percentUsed: 41, resetsAt: OTHER_WEEK }]
      await respond($, clock, w)
      expect([reason, kind, store.get(key) !== undefined]).toEqual([reason, kind, true])
    })
  }
}

// puma-9arph.3: /clear, /resume and /branch reset every $.state value to its default, and session.start does not fire
// again; classic.SessionStart fires after each, with source clear, resume or fork. The kit never resets $.state, so
// `clearable` does: after `clear()` a read of the view finds the default until the mod writes the view again, and
// `view()` is what such a read finds.
function clearable(on: On): { clear: () => void; view: () => View | undefined } {
  let isCleared = false
  let last: View | undefined
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
    }
    return next(e)
  })
  return { clear: () => { isCleared = true }, view: () => (isCleared ? EMPTY_VIEW : last) }
}

/** A reset as Claude Code runs it: the session ends for /clear or /resume (no end is fired for fork), $.state resets, classic.SessionStart fires. */
async function clearSession($: Engine, clock: MockClock, clear: () => void, source: 'clear' | 'resume' | 'fork' = 'clear'): Promise<void> {
  if (source !== 'fork') await endSession($, clock, source)
  clear()
  await $.classic.SessionStart({ source } as never)
  await clock.settle()
}

for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`after ${source}, the session's own login is in use again and its mark is back when the event completes`, async ($, on) => {
    const w = fresh()
    w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }
    // Login 2 signed in, so its row ends in use rather than with a sign-in.
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-2'] = [10, 30]
    const s = clearable(on)
    const clock = world(on, w, TWO_LOGINS)
    on('classic.SessionStart', () => ({}))
    await start($, clock)
    const mark = s.view()?.sessionMark
    expect(mark).toMatch(/^session-/)
    if (source !== 'fork') await endSession($, clock, source)
    s.clear()
    await $.classic.SessionStart({ source })
    expect([source, s.view()?.activeId, s.view()?.sessionMark]).toEqual([source, '2', mark])
    await clock.settle()
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
    // Login 1 is Claude Code's own (no Remove) and unread here (no Use now); login 2's row ends Remove, then in use.
    const ends = (await pane.findAll({ text: /^(Remove|Use now|● in use)$/ })).filter(e => e.type !== 'Box')
    expect([source, ends.map(e => e.text)]).toEqual([source, ['Remove', '● in use']])
    await pane.unmount()
  })
}

// The start and a compaction keep $.state: the hook leaves the view alone for them.
for (const source of ['startup', 'compact'] as const) {
  test(`classic.SessionStart for ${source} writes nothing to the view`, async ($, on) => {
    const w = fresh()
    w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }
    const s = clearable(on)
    const clock = world(on, w, TWO_LOGINS)
    on('classic.SessionStart', () => ({}))
    await start($, clock)
    const before = s.view()
    await $.classic.SessionStart({ source })
    await clock.settle()
    expect([source, s.view() === before]).toEqual([source, true])
  })
}

test('Review REBIND-ORDER instance: after /clear the account is rebound when classic.SessionStart completes', async ($, on) => {
  const w = fresh()
  w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  await endSession($, clock, 'clear')
  s.clear()
  await $.classic.SessionStart({ source: 'clear' })
  expect(s.view()?.activeId, 'the event has completed').toBe('2')
})

test('Review REBIND-ORDER class: every reset source, one after another, completes with the account rebound', async ($, on) => {
  const w = fresh()
  w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const observed: Array<string | undefined> = []
  for (const source of ['clear', 'resume', 'fork'] as const) {
    s.clear()
    await $.classic.SessionStart({ source })
    observed.push(s.view()?.activeId)
  }
  expect(observed).toEqual(['2', '2', '2'])
})

// The reset comes before classic.SessionStart: a tick in between finds the view at its defaults, login 1 in use.
test('Review REBIND-ORDER window: a minute tick between the reset and classic.SessionStart switches no login', async ($, on) => {
  const w = fresh()
  w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [100, 100]
  w.usage['tok-2'] = [10, 30]
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const setsBefore = w.envSets.length
  await endSession($, clock, 'clear')
  s.clear()
  await clock.advance(60_000)
  expect(['switches in the window', w.envSets.slice(setsBefore), w.toasts.filter(t => /^Switched/.test(t))]).toEqual(['switches in the window', [], []])
  await $.classic.SessionStart({ source: 'clear' })
  expect(s.view()?.activeId).toBe('2')
})

// The other side of the window's gate: once a rebind has ended, by its end or by a throw, a check rotates as before.
for (const isThrowing of [false, true]) {
  test(`Review REBIND-ORDER window: after a rebind that ${isThrowing ? 'threw' : 'ended'}, a check still leaves a spent login`, async ($, on) => {
    const w = fresh()
    w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [10, 30]
    w.usage['tok-2'] = [20, 30]
    let isFailing = false
    // The shared store, whose next read of the accounts throws while `isFailing`.
    const store = new (class extends Map<string, unknown> {
      get(key: string): unknown {
        if (!isFailing || key !== 'accounts') return super.get(key)
        isFailing = false
        throw new Error('the store is down')
      }
    })(Object.entries(TWO_LOGINS))
    const s = clearable(on)
    const clock = world(on, w, store)
    on('classic.SessionStart', () => ({}))
    await start($, clock)
    await endSession($, clock, 'clear')
    s.clear()
    isFailing = isThrowing
    w.logged = []
    await $.classic.SessionStart({ source: 'clear' })
    await clock.settle()
    expect(['the rebind threw', w.logged.some(line => line.includes('rebind after clear failed'))]).toEqual(['the rebind threw', isThrowing])
    w.usage['tok-2'] = [100, 100]
    await pastNextRead(clock)
    expect(w.toasts.filter(t => /^Switched to Claude account 1\b/.test(t))).toHaveLength(1)
  })
}

test('Review F1 instance: after /clear in Terminal.app the view still says the font draws block characters', async ($, on) => {
  const w = fresh()
  w.env = { TERM_PROGRAM: 'Apple_Terminal', CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const before = s.view()?.hasFontBlocks
  await clearSession($, clock, s.clear)
  expect(['hasFontBlocks before, after /clear', before, s.view()?.hasFontBlocks]).toEqual(['hasFontBlocks before, after /clear', true, true])
})

// Every view field the start set, in every start the scenarios cover, is the same once /clear's hook has run.
const REVIEW_F1_STARTS: [string, (w: World) => void][] = [
  ['plain start on login 2', w => { w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 } }],
  ['Terminal.app on login 2', w => { w.env = { TERM_PROGRAM: 'Apple_Terminal', CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 } }],
  ['switching refused by policy, on login 2', w => { w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2 }; w.refuseEnv = true }],
]
for (const [name, arrange] of REVIEW_F1_STARTS) {
  test(`Review F1 class: ${name}: every view field the start set is back after /clear`, async ($, on) => {
    const w = fresh()
    arrange(w)
    const s = clearable(on)
    const clock = world(on, w, TWO_LOGINS)
    on('classic.SessionStart', () => ({}))
    await start($, clock)
    const before = { ...(s.view() ?? EMPTY_VIEW) } as Record<string, unknown>
    // sessionMark is Review F3's, swept there.
    const set = Object.keys(before).filter(k => k !== 'sessionMark' && JSON.stringify(before[k]) !== JSON.stringify((EMPTY_VIEW as Record<string, unknown>)[k]))
    expect(set.length).toBeGreaterThan(0)
    await clearSession($, clock, s.clear)
    const after = { ...(s.view() ?? EMPTY_VIEW) } as Record<string, unknown>
    const lost = set.filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])).map(k => `${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`)
    expect([name, 'lost at /clear', lost]).toEqual([name, 'lost at /clear', []])
  })
}

test('Review MISSING-RESTORE class: after /resume the font and the switch policy are back, and the refusal is not said again', async ($, on) => {
  const w = fresh()
  w.env = { TERM_PROGRAM: 'Apple_Terminal' }
  w.refuseEnv = true
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const refusal = (t: string) => /^Can't switch accounts in this session/.test(t)
  expect([w.toasts.filter(refusal).length, w.notices.filter(refusal).length]).toEqual([1, 1])
  await clearSession($, clock, s.clear, 'resume')
  expect(
    [s.view()?.hasFontBlocks, s.view()?.isSwitchBlocked, w.toasts.filter(refusal).length, w.notices.filter(refusal).length],
    'terminal font, switch policy, and the refusal said once',
  ).toEqual([true, true, 1, 1])
})

test('Review SESSION-STATE-SOURCE isFableStopped: after /clear a session whose turn died on the Fable week still says so', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 100]
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  const before = s.view()?.isFableStopped
  await clearSession($, clock, s.clear)
  expect(['isFableStopped before, after /clear', before, s.view()?.isFableStopped]).toEqual(['isFableStopped before, after /clear', true, true])
})

// The undo of a provisional Fable stop clears the band: /clear brings back the cleared band, not the stop's.
test('Review SESSION-STATE-SOURCE isFableStopped: a Fable stop undone by Use now stays undone after /clear', async ($, on) => {
  const s = clearable(on)
  on('classic.SessionStart', () => ({}))
  const { clock } = await stopDuringSwitch($, on, 40_000, FABLE_STOP.last_assistant_message)
  const stopped = s.view()?.isFableStopped
  await useNow($, clock, '1')
  const undone = s.view()?.isFableStopped
  await clearSession($, clock, s.clear)
  expect(['isFableStopped at the stop, after the undo, after /clear', stopped, undone, s.view()?.isFableStopped]).toEqual(['isFableStopped at the stop, after the undo, after /clear', true, false, false])
})

// The slot a switch set, not the variable read again: the kit's $.env.get answers the start's value after a set.
test('Review SESSION-STATE-SOURCE slot: after Use now moves the session to login 2, /clear keeps login 2 in use', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 41]
  const s = clearable(on)
  const clock = world(on, w, new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' })))
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  await useNow($, clock, '2')
  const moved = s.view()?.activeId
  await clearSession($, clock, s.clear)
  expect(['activeId after Use now, after /clear', moved, s.view()?.activeId]).toEqual(['activeId after Use now, after /clear', '2', '2'])
})

/** The shared store, whose first read of the accounts throws: a boot whose bind fails once. */
const storeFailingFirstAccountsRead = (entries: Record<string, unknown>) => {
  let isFailing = true
  return new (class extends Map<string, unknown> {
    get(key: string): unknown {
      if (!isFailing || key !== 'accounts') return super.get(key)
      isFailing = false
      throw new Error('transient accounts read')
    }
  })(Object.entries(entries))
}

test('Review BOOT-GATE-STARVES instance: a transient bind failure at boot does not stop a later tick rotating', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [100, 100]
  w.usage['tok-2'] = [10, 20]
  const clock = world(on, w, storeFailingFirstAccountsRead(TWO_LOGINS))
  await start($, clock)
  expect(w.logged?.some(line => line.includes('start failed'))).toBe(true)
  await clock.advance(10 * 60_000)
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
  expect(w.envSets, 'rotation stayed gated after the store recovered').toContainEqual({ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 })
})

test('Review BOOT-GATE-STARVES class: the minute and the ten-minute checks both recover a failed first bind', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [100, 100]
  w.usage['tok-2'] = [10, 20]
  const clock = world(on, w, storeFailingFirstAccountsRead(TWO_LOGINS))
  await start($, clock)
  expect(w.logged?.some(line => line.includes('start failed'))).toBe(true)
  const stalled: string[] = []
  for (const [name, delay] of [['minute', 60_000], ['ten-minute', 9 * 60_000]] as const) {
    await clock.advance(delay)
    await clock.settle()
    await clock.advance(USAGE_CLAIM_WAIT_MS)
    if (!w.envSets.some(set => set.name === 'CLAUDE_SECURESTORAGE_CONFIG_DIR' && set.value === SLOT2)) stalled.push(name)
  }
  expect(stalled, 'rotation entry points still gated after a failed first bind').toEqual([])
})

// The other side of the heal: a session whose boot never read the slot has nothing to bind, so it binds and moves nothing.
test('Review BOOT-GATE-STARVES other side: a stop before boot has read the slot binds no view and switches no login', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [100, 100]
  w.usage['tok-2'] = [10, 20]
  const view = watchedView(on)
  const clock = world(on, w, TWO_LOGINS)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(['bound, switches', view()?.isBound, w.envSets]).toEqual(['bound, switches', undefined, []])
})

test('Review RESET-RM-ACTIVE instance: rm during a clear window cannot sign out the account this session uses', async ($, on) => {
  const w = fresh()
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-2'] = [10, 20]
  const s = clearable(on)
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  expect(s.view()?.activeId).toBe('2')
  s.clear()
  w.files[`${REQUESTS}/${N1}.json`] = rmRequest(N1, '2', store.get('store-id'), clock.now())
  await untilTick(clock)
  expect([w.logouts ?? [], resultOf(w, N1)?.ok], 'rm signed out the slot still used by this session').toEqual([[], false])
})

test('Review RESET-RM-ACTIVE class: rm of the slot in use stays refused across every reset source', async ($, on) => {
  const w = fresh()
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-2'] = [10, 20]
  const s = clearable(on)
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const offenders: string[] = []
  for (const [index, source] of (['clear', 'resume', 'fork'] as const).entries()) {
    const nonce = `${N1.slice(0, -1)}${index}`
    s.clear()
    w.files[`${REQUESTS}/${nonce}.json`] = rmRequest(nonce, '2', store.get('store-id'), clock.now())
    const before = (w.logouts ?? []).length
    await untilTick(clock)
    if ((w.logouts ?? []).length !== before || resultOf(w, nonce)?.ok !== false) offenders.push(source)
    delete w.files[`${REQUESTS}/${nonce}.json`]
    delete w.files[`${REQUESTS}/${nonce}.result.json`]
    store.set('accounts', TWO_LOGINS.accounts)
    await $.classic.SessionStart({ source })
  }
  expect(offenders, 'reset sources that let rm sign out the account still in use').toEqual([])
})

test('Review F3 instance: a session whose mark was refused does not take its parent session\'s mark after /clear', async ($, on) => {
  const w = fresh()
  w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2, ACCOUNT_ROTATOR_SESSION: 'parent-session-mark' }
  w.refuseMark = true
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const before = s.view()?.sessionMark
  await clearSession($, clock, s.clear)
  expect(['sessionMark before, after /clear', before, s.view()?.sessionMark]).toEqual(['sessionMark before, after /clear', undefined, undefined])
})

// Whatever the start's mark came to (set, refused) and whatever the inherited variable held, /clear keeps it.
const REVIEW_F3_ROWS: [string, boolean, string | undefined][] = [
  ['refused, a parent mark inherited', true, 'parent-session-mark'],
  ['refused, nothing inherited', true, undefined],
  ['set, a parent mark inherited', false, 'parent-session-mark'],
  ['set, nothing inherited', false, undefined],
]
for (const [name, isRefused, inherited] of REVIEW_F3_ROWS) {
  test(`Review F3 class: mark ${name}: the session's mark after /clear is the one its start left`, async ($, on) => {
    const w = fresh()
    w.env = { CLAUDE_SECURESTORAGE_CONFIG_DIR: SLOT2, ...(inherited === undefined ? {} : { ACCOUNT_ROTATOR_SESSION: inherited }) }
    w.refuseMark = isRefused
    const s = clearable(on)
    const clock = world(on, w, TWO_LOGINS)
    on('classic.SessionStart', () => ({}))
    await start($, clock)
    const before = s.view()?.sessionMark
    await clearSession($, clock, s.clear)
    expect([name, s.view()?.sessionMark]).toEqual([name, before])
  })
}

// [UNDO-OWNERSHIP]: what the stop's own usage read stored is the login's, not the stop's: it stands after the revert.
test('the usage read a stop makes 90 s into an unproven switch stands once the stop is reverted', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 90_000, "You've hit your session limit", undefined, { 'tok-2': [null, 41] })
  const read = store.get('usage:2') as { at?: number; src?: string } | undefined
  expect(read?.src).toBe('body')
  await endSession($, clock)
  expect(store.get('usage:2')).toEqual(read)
})

// [UNDO-OWNERSHIP]: a move the stop itself makes is why the mark exists: the mark stays, whatever ends the switch after.
// puma-eslxj.32 [PROVISIONAL-LOST-AT-RELOAD] (RULING 4719): a reload loses a module's variables, so the record lives in the
// view. The kit cannot reload a module, and a stop needs a billed prompt live: these pin where the record is, at each end.
test('a provisional stop\'s record is in the view after the stop, and gone after the undo', async ($, on) => {
  const view = watchedView(on)
  const { store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  expect([view()?.provisionalStop?.id, Object.keys(view()?.provisionalStop?.writes ?? {})]).toEqual(['2', ['mark:2']])
  await useNow($, clock, '1')
  expect([view()?.provisionalStop, store.get('mark:2')]).toEqual([undefined, undefined])
})

test('a provisional stop\'s record leaves the view once a response proves the switch, its mark kept', async ($, on) => {
  const view = watchedView(on)
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  expect(view()?.provisionalStop?.id).toBe('2')
  w.limits = [{ kind: 'seven_day', percentUsed: 41, resetsAt: OTHER_WEEK }]
  await respond($, clock, w)
  expect([view()?.provisionalStop, store.get('mark:2') !== undefined]).toEqual([undefined, true])
})

test('a provisional stop\'s record leaves the view at the stop\'s own move, its mark kept', async ($, on) => {
  const view = watchedView(on)
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 41]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  await useNow($, clock, '2')
  await clock.advance(40_000)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect([view()?.provisionalStop, store.get('mark:2') !== undefined]).toEqual([undefined, true])
})

test('a stop that moves the session on from an unproven switch keeps its mark through the session\'s end', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 41]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  await useNow($, clock, '2')
  await clock.advance(40_000)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(w.toasts.some(t => /^Switched to Claude account 1/.test(t))).toBe(true)
  await endSession($, clock)
  expect(store.get('mark:2')).toBeDefined()
})

// Review opus-e17 F3 [UNDO-OWNERSHIP]: a proven Fable stop after a provisional Fable stop keeps the session's Fable stop.
test('a proven Fable stop after a provisional one keeps the every-Fable notice once the provisional one is reverted', async ($, on) => {
  const { w, clock } = await stopDuringSwitch($, on, 40_000, FABLE_STOP.last_assistant_message, undefined, { 'tok-1': [10, 40, 100], 'tok-2': [10, 41, 100] })
  w.limits = ONES_WEEK
  await respond($, clock, w)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await endSession($, clock)
  expect(await bandText($)).toMatch(/has used its Fable week/)
})

// [END-IS-NOT-EXIT]: a reason the engine may add later keeps the mark, as 0.5.5 did.
test('a session end for a reason the mod does not know keeps an unproven stop\'s mark', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  await endSession($, clock, 'a-reason-to-come')
  expect(store.get('mark:2')).toBeDefined()
})

// [UNDO-OWNERSHIP]: a second stop's mark on the same unproven switch is the stop's own too.
test('two plain stops on one unproven switch leave no mark once the session ends', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  await clock.advance(70_000)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  await endSession($, clock)
  expect(store.get('mark:2')).toBeUndefined()
})

// Review opus-e17 F2 [END-IS-NOT-EXIT], the other half: every end the process does not outlive reverts.
for (const reason of ['prompt_input_exit', 'logout', 'other']) {
  test(`a session end for ${reason} reverts an unproven stop's mark`, async ($, on) => {
    const { store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
    await endSession($, clock, reason)
    expect([reason, store.get('mark:2')]).toEqual([reason, undefined])
  })
}

// puma-eslxj.6 (C5): the plan by its name, and the Company only where it is not the account's own.

/** The texts the pane draws for login 1, `one@example.com`'s, under its email: its organization and plan. */
async function aboutOne(on: On, $: Engine, w: World): Promise<string[]> {
  const clock = world(on, w, { ...TWO_LOGINS, 'rotate-to': 'off' })
  await start($, clock)
  const pane = await mountPane($)
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')
  await pane.unmount()
  const at = texts.indexOf('one@example.com')
  return at < 0 ? texts : [aboutAfter(texts, at) ?? '']
}

/** What a row's line 1 says after the email at `at`: its ` · Company`, ` · Plan` and ` · Chrome` parts, joined. */
function aboutAfter(texts: string[], at: number): string | undefined {
  const parts: string[] = []
  for (let i = at + 1; texts[i]?.startsWith(' · '); i += 1) parts.push(texts[i] ?? '')
  return parts.length === 0 ? undefined : parts.join('').slice(' · '.length)
}

/** Login 1 signed in by `blobOne`, its usage `usage`; login 2 not signed in. */
function planWorld(blobOne: string, usage: [number | null, number | null, number?]): World {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blobOne
  w.usage['tok-1'] = usage
  return w
}

const PLAN_CASES: [string, () => World, string][] = [
  ['max whose usage reports no 5-hour window', () => planWorld(blob('tok-1'), [null, 30]), 'Ultra'],
  ['max with a 5-hour window', () => planWorld(blob('tok-1'), [10, 30]), 'Max'],
  ['a sign-in whose tier is Max 20x, with a 5-hour window', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'max', 'default_claude_max_20x'), [10, 30]), 'Ultra'],
  ['a sign-in whose tier is Max 5x', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'max', 'default_claude_max_5x'), [null, 30]), 'Max'],
  ['a profile that names the plan', () => {
    const w = planWorld(blob('tok-1'), [10, 30])
    w.planNames = { 'tok-1': 'Ultra' }
    return w
  }, 'Ultra'],
  ['a pro sign-in', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'pro'), [10, 30]), 'Pro'],
  ['a team sign-in', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'team'), [10, 30]), 'Team'],
  ['an enterprise sign-in', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'enterprise'), [10, 30]), 'Enterprise'],
  ['a plan word the mod does not know', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'galaxy'), [10, 30]), 'galaxy'],
]
for (const [name, make, expected] of PLAN_CASES) {
  test(`the pane names ${name} "${expected}"`, async ($, on) => {
    expect([name, await aboutOne(on, $, make())]).toEqual([name, [expected]])
  })
}

test('an account stored before the tier was kept, all else the same, reads Ultra by its sign-in\'s Max 20x tier', async ($, on) => {
  const w = planWorld(blob('tok-1', NOW + 6 * HOUR, 'max', 'default_claude_max_20x'), [10, 30])
  const kept = { accounts: [{ id: '1', slot: '', email: 'one@example.com', orgId: 'org-one@example.com', plan: 'max' }, TWO_LOGINS.accounts[1]] }
  const clock = world(on, w, { ...kept, 'rotate-to': 'off' })
  await start($, clock)
  expect(await paneText($)).toMatch(/^ · Ultra$/m)
})

test('an account in the organization named for its own email draws no Company', async ($, on) => {
  const w = planWorld(blob('tok-1'), [10, 30])
  w.orgNames = { 'tok-1': "one@example.com's Organization" }
  expect(await aboutOne(on, $, w)).toEqual(['Max'])
})

test('an account in another organization draws it as its Company, before the plan', async ($, on) => {
  const w = planWorld(blob('tok-1'), [10, 30])
  w.orgNames = { 'tok-1': 'Lutso Health' }
  expect(await aboutOne(on, $, w)).toEqual(['Lutso Health · Max'])
})

// #21 round 1, [SIGN-IN-OWNED-STATE]: what a sign-in owns (its plan's name, its tier, its usage and no-five-hour) goes
// with it when a new sign-in takes the account.

/** The text the pane draws under `email`: its Company, plan and Chrome. */
async function aboutOf($: Engine, email: string): Promise<string | undefined> {
  const pane = await mountPane($)
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')
  await pane.unmount()
  const at = texts.indexOf(email)
  return at < 0 ? `(no row for ${email})` : aboutAfter(texts, at)
}

// Review codex-c5 STALE-PLAN-NAME and STALE-TIER: a stored account another sign-in now holds keeps neither.
for (const [plan, tier, want] of [
  ['max', 'default_claude_max_5x', 'Max'],
  ['pro', undefined, 'Pro'],
  ['team', undefined, 'Team'],
  ['enterprise', undefined, 'Enterprise'],
] as const) {
  for (const [kept, field] of [[{ planName: 'Ultra' }, 'planName'], [{ tier: 'default_claude_max_20x' }, 'tier']] as const) {
    test(`a new ${plan} sign-in on an account whose old one left ${field} keeps none of it`, async ($, on) => {
      const w = planWorld(blob('tok-1', NOW + 6 * HOUR, plan, tier), [10, 30])
      const store = new Map<string, unknown>(Object.entries({ accounts: [{ id: '1', slot: '', email: 'old@example.com', ...kept }], 'rotate-to': 'off' }))
      const clock = world(on, w, store)
      await start($, clock)
      const stored = (store.get('accounts') as Record<string, unknown>[])[0]
      expect([plan, field, field === 'tier' && tier !== undefined ? undefined : stored[field]]).toEqual([plan, field, undefined])
      expect([plan, field, await paneText($)]).toEqual([plan, field, expect.stringMatching(new RegExp(`^ · ${want}$`, 'm'))])
    })
  }
}

// Review opus-c5 F1: a /login that brings another sign-in replaces the plan the old one named.
type SignInCase = { name: string; first: string; firstNames: Record<string, string>; second: string; owner: string; secondNames?: Record<string, string>; want: string }
const SIGN_IN_CASES: SignInCase[] = [
  { name: 'another person on Max 5x, after a profile named Ultra', first: blob('tok-1'), firstNames: { 'tok-1': 'Ultra' }, second: blob('tok-9', NOW + 6 * HOUR, 'max', 'default_claude_max_5x'), owner: 'nine@example.com', want: 'Org · Max' },
  { name: 'another person on Pro, after a Max 20x tier', first: blob('tok-1', NOW + 6 * HOUR, 'max', 'default_claude_max_20x'), firstNames: {}, second: blob('tok-9', NOW + 6 * HOUR, 'pro'), owner: 'nine@example.com', want: 'Org · Pro' },
  { name: 'the same person, now on Pro, after a profile named Ultra', first: blob('tok-1'), firstNames: { 'tok-1': 'Ultra' }, second: blob('tok-1b', NOW + 6 * HOUR, 'pro'), owner: 'one@example.com', want: 'Org · Pro' },
  { name: 'the same person, now on Pro, after a Max 20x tier', first: blob('tok-1', NOW + 6 * HOUR, 'max', 'default_claude_max_20x'), firstNames: {}, second: blob('tok-1b', NOW + 6 * HOUR, 'pro'), owner: 'one@example.com', want: 'Org · Pro' },
  { name: 'another person whose profile names Max, after a profile named Ultra', first: blob('tok-1'), firstNames: { 'tok-1': 'Ultra' }, second: blob('tok-9', NOW + 6 * HOUR, 'max'), owner: 'nine@example.com', secondNames: { 'tok-9': 'Max' }, want: 'Org · Max' },
]
for (const c of SIGN_IN_CASES) {
  test(`a /login as ${c.name} draws the new sign-in's plan`, async ($, on) => {
    const w = fresh()
    const secondToken = (JSON.parse(c.second) as { claudeAiOauth: { accessToken: string } }).claudeAiOauth.accessToken
    w.keychain['Claude Code-credentials'] = c.first
    w.usage['tok-1'] = [10, 30]
    w.usage[secondToken] = [5, 5]
    w.owners = { 'tok-1': 'one@example.com', [secondToken]: c.owner }
    w.planNames = { ...c.firstNames, ...(c.secondNames ?? {}) }
    const clock = world(on, w, { accounts: [{ id: '1', slot: '', email: 'one@example.com' }], 'rotate-to': 'off' })
    await start($, clock)
    expect([c.name, 'before', await aboutOf($, 'one@example.com')]).toEqual([c.name, 'before', 'Org · Ultra'])
    w.keychain['Claude Code-credentials'] = c.second
    await $.command.run(LOGIN)
    await clock.settle()
    expect([c.name, 'after', await aboutOf($, c.owner)]).toEqual([c.name, 'after', c.want])
  })
}

// [SIGN-IN-OWNED-STATE] (Opus advisory STALE-READING-ON-NEW-SIGN-IN): a minute on, past the merge that reads the store
// back, the new sign-in still shows neither the last one's usage nor a plan inferred from it.
test('a minute after a /login as another max login whose read fails, the row shows neither the old usage nor Ultra', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [null, 30]
  w.usage['tok-9'] = [10, 5]
  w.owners = { 'tok-1': 'one@example.com', 'tok-9': 'nine@example.com' }
  w.loginToken = 'tok-9'
  w.loginPlan = 'max'
  const clock = world(on, w, { accounts: [{ id: '1', slot: '', email: 'one@example.com' }], 'rotate-to': 'off' })
  await start($, clock)
  expect(await paneText($)).toMatch(/^▰{3}▱{7} 30%$/m)
  w.failing = { 'tok-9': 503 }
  await $.command.run(LOGIN)
  await clock.settle()
  await clock.advance(61_000)
  const text = await paneText($)
  expect([/^▰{3}▱{7} 30%$/m.test(text), await aboutOf($, 'nine@example.com')]).toEqual([false, 'Org · Max'])
})

// [SIGN-IN-OWNED-STATE], RULING 4455: a refresh of the same account (a new refresh token, the profile naming the same
// account) is no new sign-in: the account keeps its reading and no-five-hour, and only its schedule goes.
test('a token refresh that brings a new refresh token keeps the account\'s reading and its no-five-hour', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [null, 30]
  w.owners = { 'tok-1': 'one@example.com', 'tok-1r': 'one@example.com' }
  const store = new Map<string, unknown>(Object.entries({ accounts: [{ id: '1', slot: '', email: 'one@example.com' }], 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const read = (key: string) => store.get(key)
  expect([read('usage:1') !== undefined, read('no-five-hour:1')]).toEqual([true, true])
  // Claude Code refreshed the token: a new access token and a new refresh token, the same account. Its next read fails.
  w.keychain['Claude Code-credentials'] = blob('tok-1r')
  w.failing = { 'tok-1r': 503 }
  await clock.advance(10 * 60_000 + 1000)
  expect([read('usage:1') !== undefined, read('no-five-hour:1')]).toEqual([true, true])
  // Its schedule was the old token's: the new token is read at the next minute, not when the old schedule says.
  await clock.advance(61_000)
  expect(callsWith(w, 'tok-1r')).toBeGreaterThan(0)
})

// Review opus-c5 F2: the old sign-in's no-five-hour and reading infer nothing about the new one.
for (const status of [503, 429, 500]) {
  test(`a /login as another max login whose first usage read answers ${status} is not drawn Ultra by the old one's usage`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.usage['tok-1'] = [null, 30]
    w.usage['tok-9'] = [10, 5]
    w.owners = { 'tok-1': 'one@example.com', 'tok-9': 'nine@example.com' }
    w.loginToken = 'tok-9'
    w.loginPlan = 'max'
    const clock = world(on, w, { accounts: [{ id: '1', slot: '', email: 'one@example.com' }], 'rotate-to': 'off' })
    await start($, clock)
    expect([status, 'before', await aboutOf($, 'one@example.com')]).toEqual([status, 'before', 'Org · Ultra'])
    w.failing = { 'tok-9': status }
    await $.command.run(LOGIN)
    await clock.settle()
    expect([status, 'after', await aboutOf($, 'nine@example.com')]).toEqual([status, 'after', 'Org · Max'])
  })
}

// C6 (puma-eslxj.7): the Fable week per account in the pane, and the mark a Fable stop leaves under fable-mark:<id>.

/** What the pane draws after each `Fable` row's label, in order: one entry per row. */
async function fableRows($: Engine): Promise<string[]> {
  const texts = (await paneText($)).split('\n')
  return texts.flatMap((t, i) => (t === ' Fable ' ? [texts[i + 1] ?? ''] : t === ' Fable –' ? ['–'] : []))
}

test('a reading with Fable 66% draws a Fable row under the week with its bar at 66%', async ($, on) => {
  const w = planWorld(blob('tok-1'), [10, 30, 66])
  const clock = world(on, w, { ...TWO_LOGINS, 'rotate-to': 'off', footer: { ...DEFAULT_FOOTER, fill: 'used' } })
  await start($, clock)
  expect(await fableRows($)).toEqual([`${longBar(66)} 66%`])
  const text = await paneText($)
  expect(text.indexOf(' Fable ')).toBeGreaterThan(text.indexOf('Used '))
})

const FABLE_ROW_CASES: [string, () => World, string[]][] = [
  ['Max whose usage lists no Fable week', () => planWorld(blob('tok-1'), [10, 30]), ['–']],
  ['Ultra whose usage lists no Fable week', () => planWorld(blob('tok-1'), [null, 30]), ['–']],
  ['Max with its Fable week at 66%', () => planWorld(blob('tok-1'), [10, 30, 66]), [`${longBar(66)} 66%`]],
  ['Pro whose usage lists no Fable week', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'pro'), [10, 30]), []],
  ['Team whose usage lists no Fable week', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'team'), [10, 30]), []],
  ['Enterprise whose usage lists no Fable week', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'enterprise'), [10, 30]), []],
  ['a plan word the mod does not know, with no Fable week', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'galaxy'), [10, 30]), []],
  ['Pro whose usage lists a Fable week at 50%', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'pro'), [10, 30, 50]), [`${longBar(50)} 50%`]],
]
for (const [name, make, expected] of FABLE_ROW_CASES) {
  test(`the pane's Fable rows for ${name}: ${JSON.stringify(expected)}`, async ($, on) => {
    const clock = world(on, make(), { ...TWO_LOGINS, 'rotate-to': 'off' })
    await start($, clock)
    expect([name, await fableRows($)]).toEqual([name, expected])
  })
}

/** Login 1 at 60% of its Fable week, login 2's spent, login 2's week its own: a Fable stop on login 1 stays there. */
async function fableStopStays($: Engine, on: On, seed: Record<string, unknown> = {}): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 60]
  w.usage['tok-2'] = [10, 30, 100]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, ...seed }))
  const clock = world(on, w, store)
  await start($, clock)
  return { w, store, clock }
}

const markOf = (value: unknown) => [(value as { pct?: unknown } | undefined)?.pct, (value as { resetsAt?: unknown } | undefined)?.resetsAt]
const fableOf = (value: unknown) => (value as { fable?: unknown } | undefined)?.fable

test('a Fable stop marks its week spent under fable-mark:<id>, and neither the stored reading nor a response after it carries the mark', async ($, on) => {
  const { w, store, clock } = await fableStopStays($, on)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(markOf(store.get('fable-mark:1'))).toEqual([100, FABLE_RESET])
  expect(fableOf(store.get('usage:1'))).toEqual({ pct: 60, resetsAt: FABLE_RESET })
  w.limits = [
    { kind: 'five_hour', percentUsed: 21, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 30, resetsAt: WEEK_RESET },
  ]
  await respond($, clock, w)
  expect((store.get('usage:1') as { src?: unknown } | undefined)?.src).toBe('response')
  expect(fableOf(store.get('usage:1'))).toEqual({ pct: 60, resetsAt: FABLE_RESET })
  // The pane still draws login 1's Fable week spent, by the mark.
  expect((await fableRows($))[0]).toBe(`${longBar(100)} 100%`)
})

test('a Fable mark another session stored is laid on the login\'s reading, over a lower body of the same week', async ($, on) => {
  await fableStopStays($, on, { 'fable-mark:1': { pct: 100, resetsAt: FABLE_RESET, at: NOW } })
  expect((await fableRows($))[0]).toBe(`${longBar(100)} 100%`)
})

test('a Fable stop writing its mark keeps a mark another session stored since that ends later', async ($, on) => {
  const later = '2026-10-17T03:30:00Z'
  const { store, clock } = await fableStopStays($, on)
  store.set('fable-mark:1', { pct: 100, resetsAt: later, at: NOW })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(markOf(store.get('fable-mark:1'))).toEqual([100, later])
})

test('a Fable stop writing its mark replaces a mark another session stored since that ends sooner', async ($, on) => {
  const sooner = '2026-10-16T03:00:00Z'
  const { store, clock } = await fableStopStays($, on)
  store.set('fable-mark:1', { pct: 100, resetsAt: sooner, at: NOW })
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(markOf(store.get('fable-mark:1'))).toEqual([100, FABLE_RESET])
})

// The undo's class (STOP_KEYS): a Fable stop marked during an unproven switch goes when the switch proves not to have taken.
test('a Fable stop before any response proves a switch marks fable-mark on the login moved to, and the switch proving not to have taken drops it', async ($, on) => {
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, FABLE_STOP.last_assistant_message, undefined, { 'tok-2': [10, 41, 50] })
  expect(markOf(store.get('fable-mark:2'))).toEqual([100, FABLE_RESET])
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(4 * 60_000 + 10_000)
  await respond($, clock, w)
  expect(w.toasts.some(t => /did not take/.test(t))).toBe(true)
  expect(store.get('fable-mark:2')).toBeUndefined()
  // This session's view drops it too: login 2 draws its body's week again.
  expect(await fableRows($)).toEqual(['–', `${longBar(50)} 50%`])
})

test('a check whose usage lists no Fable week after a Fable stop keeps the stored week in usage:<id>, never the mark', async ($, on) => {
  const { w, store, clock } = await fableStopStays($, on)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  const calls = w.usageCalls.filter(t => t === 'tok-1').length
  w.usage['tok-1'] = [20, 30]
  await pastNextRead(clock)
  expect(w.usageCalls.filter(t => t === 'tok-1').length).toBeGreaterThan(calls)
  expect(fableOf(store.get('usage:1'))).toEqual({ pct: 60, resetsAt: FABLE_RESET })
})

test('a Fable mark another session stored on a login with no reading yet counts: the pane draws that login\'s Fable week spent', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 10]
  w.failing = { 'tok-2': 429 }
  const clock = world(on, w, { ...TWO_LOGINS, 'rotate-to': 'off', 'fable-mark:2': { pct: 100, resetsAt: FABLE_RESET, at: NOW } })
  await start($, clock)
  expect(await fableRows($)).toEqual([`${longBar(10)} 10%`, `${longBar(100)} 100%`])
})

// Review codex-c6 MARK-RETAINED and opus-c6 F3 [VIEW-OUTLIVES-STORE-DELETE] (RULING 4481): a store key another session
// deletes (its provisional-stop undo, Remove, a sign-in as another account) leaves this session's view at the next
// merge, at every key mergeStore folds that some path deletes.
const DELETED_KEYS: [string, unknown][] = [
  ['mark:2', { pct: 100, resetsAt: FABLE_RESET, at: NOW }],
  ['week-mark:2', { pct: 100, resetsAt: FABLE_RESET, at: NOW }],
  ['fable-mark:2', { pct: 100, resetsAt: FABLE_RESET, at: NOW }],
  ['no-five-hour:2', true],
  ['usage:2', { sevenDay: { pct: 30, resetsAt: WEEK_RESET }, fable: { pct: 40, resetsAt: FABLE_RESET }, at: NOW - 60_000, by: '2', v: 1, src: 'body' }],
]
/** Login 2's lines in the pane, its usage call answering 429, with `seed` in the store and then, where `deleted`, gone from it as another session deletes it. */
async function loginTwoAfter($: Engine, on: On, seed: Record<string, unknown>, deleted: string | undefined): Promise<string> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 10]
  w.failing = { 'tok-2': 429 }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', ...seed }))
  const clock = world(on, w, store)
  await start($, clock)
  if (deleted !== undefined) store.delete(deleted)
  await clock.advance(61_000)
  const text = await paneText($)
  return text.slice(text.indexOf('two@example.com'), text.indexOf(' Accounts '))
}
/** Login 2's lines with nothing seeded: the reference every deleted key returns to; set by the test below, which runs first. */
let neverSet = '(the reference test did not run)'
test('with nothing seeded, login 2 draws no reading yet: the reference a deleted key returns to', async ($, on) => {
  neverSet = await loginTwoAfter($, on, {}, undefined)
  expect(neverSet).toMatch(/no reading yet/)
})
for (const [key, value] of DELETED_KEYS) {
  // The seed shows while it stands, or its deleted case proves nothing.
  test(`${key} seeded by another session shows in this session's pane`, async ($, on) => {
    expect([key, await loginTwoAfter($, on, { [key]: value }, undefined)]).not.toEqual([key, neverSet])
  })
  test(`${key} another session deletes leaves this session's pane as if it was never set`, async ($, on) => {
    expect([key, await loginTwoAfter($, on, { [key]: value }, key)]).toEqual([key, neverSet])
  })
}

// Review opus-c6 F2 [UNDO-OWNERSHIP] (RULING 4481): another session's proven Fable stop on the login, written after a
// provisional one, is that session's write: no end of the unproven switch takes it back, whatever reset it carries.
const THEIR_RESETS: [string, string][] = [
  ['the same reset', FABLE_RESET],
  ['a sooner reset', '2026-10-16T03:00:00Z'],
  ['a later reset', '2026-10-19T03:00:00Z'],
]
for (const [endName, end] of F3_ENDS) {
  for (const [theirName, resetsAt] of THEIR_RESETS) {
    test(`${endName} of an unproven switch keeps the Fable mark another session's proven stop wrote after the provisional one, with ${theirName}`, async ($, on) => {
      const { w, store, clock } = await stopDuringSwitch($, on, 40_000, FABLE_STOP.last_assistant_message, undefined, { 'tok-2': [10, 41, 50] })
      expect(markOf(store.get('fable-mark:2'))).toEqual([100, FABLE_RESET])
      // Exactly saveFableMark's store write in the other session, the harness running one engine, a second after the
      // provisional stop.
      await clock.advance(1000)
      store.set('fable-mark:2', laterMark(markFrom(store.get('fable-mark:2')), { pct: 100, resetsAt, at: clock.now() }))
      await end($, w, clock)
      const kept = markFrom(store.get('fable-mark:2'))
      const isKept = kept !== undefined && Date.parse(kept.resetsAt) >= Date.parse(resetsAt)
      expect([endName, theirName, isKept ? 'kept' : `dropped: ${JSON.stringify(store.get('fable-mark:2'))}`]).toEqual([endName, theirName, 'kept'])
    })
  }
}

// C7 (puma-eslxj.8, problem e): a 5-hour window is drawn only where an account is known to have one. No reading and no
// no-five-hour key is unknown, and unknown draws nothing.

/** Two logins, `one` and `two` their usage (undefined: the usage call answers 429), with `store` seeded. */
async function fiveHourWorld($: Engine, on: On, one: World['usage'][string] | undefined, two: World['usage'][string] | undefined, store: Record<string, unknown> = {}): Promise<{ w: World; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.failing = {}
  if (one === undefined) w.failing['tok-1'] = 429
  else w.usage['tok-1'] = one
  if (two === undefined) w.failing['tok-2'] = 429
  else w.usage['tok-2'] = two
  const clock = world(on, w, { ...TWO_LOGINS, 'rotate-to': 'off', ...store })
  await start($, clock)
  return { w, clock }
}

/** The pane's lines from login 2's email to the end of the accounts box. */
const loginTwoLines = (text: string) => text.slice(text.indexOf('two@example.com'), text.indexOf(' Accounts ')).split('\n')

/** A row's 5-hour line starts with its label: `5h ` before a bar, or `5h –` where the 5h limit set off drops the window. */
const isFiveHourText = (t: string) => t === '5h ' || t === '5h –'
const hasFiveHourText = (lines: string[]) => lines.some(isFiveHourText)

test('a login with no reading, no no-five-hour key and a usage call answering 429 draws no 5h row', async ($, on) => {
  await fiveHourWorld($, on, [20, 30], undefined)
  expect(hasFiveHourText(loginTwoLines(await paneText($)))).toBe(false)
})

test('with every account unknown, the footer has no Session: label and the pane no 5h limit row', async ($, on) => {
  await fiveHourWorld($, on, undefined, undefined)
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect((await footer.findAll({ type: 'Text' })).map(t => t.text)).not.toContain('Session:')
  await footer.unmount()
  expect((await paneText($)).split('\n')).not.toContain('5h limit')
})

test('with every account reporting no 5-hour window, the pane has no 5h limit row', async ($, on) => {
  await fiveHourWorld($, on, [null, 30], [null, 40])
  expect((await paneText($)).split('\n')).not.toContain('5h limit')
})

test('with the 5h limit set off, the pane keeps its 5h limit row though no account is known to have a window, so it can be set on again', async ($, on) => {
  await fiveHourWorld($, on, undefined, undefined, { 'five-hour-limit': 'off' })
  expect((await paneText($)).split('\n')).toContain('5h limit')
})

test('with an account known to have a 5-hour window, the pane keeps its 5h limit row', async ($, on) => {
  await fiveHourWorld($, on, [null, 30], [20, 40])
  expect((await paneText($)).split('\n')).toContain('5h limit')
})

// [BLANK-SESSION-ROW]
test('with the session glyphs off and its percent on, the login in use without a 5-hour window draws no blank footer row though another has one', async ($, on) => {
  await fiveHourWorld($, on, [null, 30], [20, 40], { footer: { ...DEFAULT_FOOTER, session: 'none', sessionPercent: true } })
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const lines = ((await footer.find(GLYPHS))?.text ?? '').split('\n')
  await footer.unmount()
  // A row with no glyph and no percent: spaces and the highlight's lines alone.
  expect(lines.filter(l => l.replace(/[\s│]/g, '') === '')).toEqual([])
  expect(lines.length).toBeGreaterThan(0)
})

// Kept green: Claude's own words name the 5-hour window, so its account draws the row, whatever its usage said.
test('a 5-hour stop on a login whose usage said it has no 5-hour window draws its 5h row', async ($, on) => {
  const { clock } = await fiveHourWorld($, on, [null, 30], [20, 40])
  expect((await paneText($)).split('\n').filter(isFiveHourText)).toHaveLength(1)
  await pastLastRead(clock)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: "You've hit your session limit" })
  await clock.settle()
  expect((await paneText($)).split('\n').filter(isFiveHourText)).toHaveLength(2)
})

// C6's lesson, per input of the predicate: a key another session deletes turns the row back to unknown.
const FIVE_HOUR_INPUTS: [string, unknown][] = [
  ['no-five-hour:2', false],
  ['mark:2', { pct: 100, resetsAt: '2026-10-12T12:00:00Z', at: NOW }],
  ['usage:2', { fiveHour: { pct: 30, resetsAt: '2026-10-12T12:00:00Z' }, sevenDay: { pct: 30, resetsAt: WEEK_RESET }, at: NOW - 60_000, by: '2', v: 1, src: 'body' }],
]
for (const [key, value] of FIVE_HOUR_INPUTS) {
  test(`${key} saying login 2 has a 5-hour window draws its 5h row`, async ($, on) => {
    await fiveHourWorld($, on, [20, 30], undefined, { [key]: value })
    expect([key, hasFiveHourText(loginTwoLines(await paneText($)))]).toEqual([key, true])
  })
  test(`${key} another session deletes leaves login 2 with no 5h row at the next merge`, async ($, on) => {
    const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', [key]: value }))
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.usage['tok-1'] = [20, 30]
    w.failing = { 'tok-2': 429 }
    const clock = world(on, w, store)
    await start($, clock)
    store.delete(key)
    await clock.advance(61_000)
    expect([key, hasFiveHourText(loginTwoLines(await paneText($)))]).toEqual([key, false])
  })
}

// Review opus-c7 A3 [UNEXERCISED-WRITER] (RULING 4498): the 5h limit press rewrites every reading in the view; a week
// mark standing on a login with no 5-hour window stays through it, both ways.
test('pressing the 5h limit off and on keeps a standing week mark on a login with no 5-hour window', async ($, on) => {
  const { clock } = await fiveHourWorld($, on, [20, 40], [null, 30], { 'week-mark:2': { pct: 100, resetsAt: WEEK_RESET, at: NOW } })
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const weekOfTwo = async () => {
    await pane.redraw()
    const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const lines = texts.slice(texts.indexOf('two@example.com'))
    return lines[lines.indexOf('Used ') + 1]
  }
  const seen: string[] = [await weekOfTwo()]
  for (const limit of ['off', 'on'] as const) {
    await pane.press({ key: `five-hour-limit-${limit}` })
    await clock.settle()
    seen.push(await weekOfTwo())
  }
  await pane.unmount()
  expect(seen).toEqual([`${longBar(100)} 100%`, `${longBar(100)} 100%`, `${longBar(100)} 100%`])
})

// Review codex-c7 C7-R1-01 and opus-c7 F1 [LIMIT-DEPENDENT-KNOWLEDGE]: whether a login has a 5-hour window does not
// depend on the 5h limit. Every input that says so, under both settings, on both surfaces hasFiveHour drives.
/** Whether the pane draws a 5h row in `lines` and the footer its Session: label. */
async function knownSurfaces($: Engine, lines: string[]): Promise<{ paneRow: boolean; footerSession: boolean }> {
  const footer = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  const footerSession = (await footer.findAll({ type: 'Text' })).map(t => t.text).includes('Session:')
  await footer.unmount()
  return { paneRow: hasFiveHourText(lines), footerSession }
}
for (const [key, value] of FIVE_HOUR_INPUTS) {
  for (const limit of ['on', 'off'] as const) {
    test(`${key} saying login 2 has a 5-hour window, with the 5h limit ${limit}, draws its 5h row and the footer's Session: row`, async ($, on) => {
      await fiveHourWorld($, on, [null, 30], undefined, { 'five-hour-limit': limit, [key]: value })
      const label = `${key} / limit ${limit}`
      expect([label, await knownSurfaces($, loginTwoLines(await paneText($)))]).toEqual([label, { paneRow: true, footerSession: true }])
    })
  }
}
for (const limit of ['on', 'off'] as const) {
  test(`a response listing login 1's 5-hour window, with no no-five-hour key and the 5h limit ${limit}, draws its 5h row and the footer's Session: row`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    w.failing = { 'tok-1': 429 }
    w.usage['tok-2'] = [null, 40]
    w.weekResets = { 'tok-2': '2026-10-19T03:00:00Z' }
    const week = { sevenDay: { pct: 30, resetsAt: WEEK_RESET }, at: NOW - 60_000, by: '1', v: 1, src: 'body' }
    const clock = world(on, w, { ...TWO_LOGINS, 'rotate-to': 'off', 'five-hour-limit': limit, 'usage:1': week })
    await start($, clock)
    w.limits = [
      { kind: 'five_hour', percentUsed: 20, resetsAt: '2026-10-12T12:00:00Z' },
      { kind: 'seven_day', percentUsed: 30, resetsAt: WEEK_RESET },
    ]
    await respond($, clock, w)
    const text = await paneText($)
    const lines = text.slice(text.indexOf('one@example.com'), text.indexOf('two@example.com')).split('\n')
    const label = `response / limit ${limit}`
    expect([label, await knownSurfaces($, lines)]).toEqual([label, { paneRow: true, footerSession: true }])
  })
}

// C8 (puma-eslxj.9, problem g part 1): every session's merge writes each login's row under `rows`, for the CLI, built
// from the store alone. The updated time is the last good usage read's (`usage-due:<id>.at`), never a response's.

type RowsKey = Partial<StoredRows>
const rowsOf = (store: Map<string, unknown>) => store.get('rows') as RowsKey | undefined
/** Each login's stored lines as a reader in this machine's zone prints them at `now`, by default when they were written. */
const rowsText = (store: Map<string, unknown>, now = rowsOf(store)?.at ?? NaN) =>
  rowsOf(store)?.rows?.map(r => ({ id: r.id, lines: r.lines.map(l => storedLineText(l, now)) }))
const lineOne = (store: Map<string, unknown>, id: string) => rowsText(store)?.find(r => r.id === id)?.lines[0] ?? '(no row)'
/** When a login's last good usage read came, as its schedule holds it. */
const goodReadAt = (store: Map<string, unknown>, id: string) => (store.get(`usage-due:${id}`) as { at?: number } | undefined)?.at ?? NaN
/** When a login's schedule says its next read is due. */
const nextTryAt = (store: Map<string, unknown>, id: string) => (store.get(`usage-due:${id}`) as { next?: number } | undefined)?.next ?? NaN
/** HH:MM of `at` in this machine's zone, as a session writes the rows. */
const localTime = (at: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)

/** Two logins read at boot, or failing with 429 where `isFailing`, then a minute on, past the minute's merge. */
async function rowsWorld($: Engine, on: On, isFailing = false): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
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

test('the merge stores each login\'s row lines under rows, stamped with when and the writer\'s version', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const rows = rowsOf(store)
  expect([rows?.v, typeof rows?.at, rows?.rows?.map(r => r.id)]).toEqual([1, 'number', ['1', '2']])
  expect(lineOne(store, '1')).toMatch(new RegExp(`^one@example\\.com.*  updated ${localTime(goodReadAt(store, '1'))}$`))
  expect(rowsText(store, clock.now())?.[0]?.lines[1]).toBe('Used ▰▰▰▱▱▱▱▱▱▱ 30% Fable ▰▰▰▰▱▱▱▱▱▱ 40%  resets 5d 16h 59m · Fable 4d 16h 59m')
  expect(clock.now()).toBeLessThan(NOW + 2 * 60_000)
})

test('a response that rewrites login 1\'s reading leaves its row\'s updated time at the last good usage read', async ($, on) => {
  const { w, store, clock } = await rowsWorld($, on)
  const readAt = goodReadAt(store, '1')
  await clock.advance(4 * 60_000)
  w.limits = [{ kind: 'seven_day', percentUsed: 31, resetsAt: WEEK_RESET }]
  await respond($, clock, w)
  const bumped = (store.get('usage:1') as { at?: number; src?: string } | undefined) ?? {}
  // The seed: the response did rewrite the reading, at a minute the row would show.
  expect([bumped.src, localTime(bumped.at ?? NaN) === localTime(readAt)]).toEqual(['response', false])
  await clock.advance(61_000)
  expect(lineOne(store, '1')).toMatch(new RegExp(`  updated ${localTime(readAt)}$`))
})

test('another session\'s good read of login 2 moves this session\'s row to that read\'s time', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  // The seed: this session's own read shows first.
  expect(lineOne(store, '2')).toMatch(new RegExp(`  updated ${localTime(goodReadAt(store, '2'))}$`))
  await clock.advance(4 * 60_000)
  const theirs = clock.now()
  store.set('usage-due:2', { ...(store.get('usage-due:2') as object), at: theirs })
  await clock.advance(61_000)
  expect(lineOne(store, '2')).toMatch(new RegExp(`  updated ${localTime(theirs)}$`))
  expect(localTime(theirs)).not.toBe(localTime(NOW))
})

test('login 2\'s schedule another session deletes is read again at once, and the row says that read\'s time', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const before = goodReadAt(store, '2')
  expect(lineOne(store, '2')).toMatch(new RegExp(`  updated ${localTime(before)}$`))
  await clock.advance(4 * 60_000)
  store.delete('usage-due:2')
  await clock.advance(60_000)
  // The seed: with no schedule the login was read again, later than before.
  expect(goodReadAt(store, '2')).toBeGreaterThan(before)
  expect(lineOne(store, '2')).toMatch(new RegExp(`  updated ${localTime(goodReadAt(store, '2'))}$`))
})

test('a failure another session stores for login 2 shows on this session\'s row, and its delete brings the updated time back', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const readAt = goodReadAt(store, '2')
  await clock.advance(4 * 60_000)
  const failedAt = clock.now()
  store.set('check-error:2', { why: 'the usage call answered HTTP 429', at: failedAt })
  await clock.advance(60_000)
  expect(lineOne(store, '2')).toMatch(new RegExp(`  ${localTime(failedAt)} Failed to update \\(HTTP 429\\), next try ${localTime(nextTryAt(store, '2'))}$`))
  store.delete('check-error:2')
  await clock.advance(60_000)
  expect(lineOne(store, '2')).toMatch(new RegExp(`  updated ${localTime(readAt)}$`))
})

// The pick treats a login with a failure and no reading as unread (isUnread). A stop's forced read stored no failure
// for a usage call that threw, so it must not now: the pick stays as it was.
test('a forced read whose usage call throws stores no failure, so a login with no reading stays in the pick', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.throwing = ['tok-1']
  // Not due at boot, so the boot check reads nothing and the login has no reading.
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'usage-due:1': { next: NOW + HOUR, fails: 0, v: 1 } }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(callsWith(w, 'tok-1')).toBe(0)
  await clock.advance(10_000)
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(callsWith(w, 'tok-1')).toBe(1)
  expect(store.get('usage-due:1')).toMatchObject({ fails: 1 })
  expect(store.get('check-error:1')).toBeUndefined()
})

test('a claimed usage read does not show its claim expiry as the failed row’s next try', async ($, on) => {
  const { store, clock } = await rowsWorld($, on, true)
  const due = store.get('usage-due:2') as object
  store.set('usage-due:2', { ...due, next: clock.now() + 90_000, claim: 'other-session' })
  await clock.advance(60_000)
  expect(lineOne(store, '2')).toMatch(/Failed to update \(HTTP 429\)$/)
})

test('a claimed usage read leaves the updated time at the last good read', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const readAt = goodReadAt(store, '2')
  const due = store.get('usage-due:2') as object
  store.set('usage-due:2', { ...due, next: clock.now() + 90_000, claim: 'other-session' })
  await clock.advance(60_000)
  expect(lineOne(store, '2')).toMatch(new RegExp(`  updated ${localTime(readAt)}$`))
})

test('rows another session stored with this session\'s own lines are not written again', async ($, on) => {
  const { store, clock } = await rowsWorld($, on, true)
  const ours = rowsOf(store)
  // The seed: the failures, which hold the lines still until the next read, are on the rows.
  expect(lineOne(store, '1')).toMatch(/Failed to update \(HTTP 429\), next try \d\d:\d\d$/)
  store.set('rows', { ...ours, at: 1 })
  await clock.advance(60_000)
  expect(rowsOf(store)).toEqual({ ...ours, at: 1 })
})

test('rows another session stored with other lines are written again from the store, whatever this session wrote last', async ($, on) => {
  const { store, clock } = await rowsWorld($, on, true)
  const ours = rowsOf(store)
  store.set('rows', { ...ours, at: 1, rows: [] })
  await clock.advance(60_000)
  const now = rowsOf(store)
  expect([now?.rows, now?.at === 1]).toEqual([ours?.rows, false])
})

// C10 (puma-eslxj.11; [STORED-RELATIVE-TIME], [WRITER-ZONE-PINGPONG], RULING 4566): the rows hold their times as epoch
// ms, so a minute that reads nothing new changes no byte of them, and the sessions on one store write them once.
test('a minute on with nothing new read, the merge leaves rows as they stand', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const ours = rowsOf(store)
  await clock.advance(60_000)
  expect(rowsOf(store)).toEqual(ours)
})

test('rows a 0.5.11 session stored as text are written again as runs, which read as the same lines', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const [ours, at] = [rowsOf(store), clock.now()]
  const asText = rowsText(store, at)
  // The seed: the older session's text is what these rows read as.
  expect(asText?.every(r => r.lines.every(l => typeof l === 'string' && l.length > 0))).toBe(true)
  store.set('rows', { v: 1, at: 1, rows: asText })
  await clock.advance(60_000)
  expect([rowsOf(store)?.rows, rowsOf(store)?.at === 1]).toEqual([ours?.rows, false])
  expect(rowsText(store, at)).toEqual(asText)
})

// Review C8-R1 F1 (Opus) [UPDATED-WITHOUT-READING] (RULING 4521): a usage answer that stores no reading is no good
// read: the row's updated time stays at the last read that stored one, and a login never read so has none.
test('a usage answer that stores no reading leaves login 2\'s row at its last good read', async ($, on) => {
  const { w, store, clock } = await rowsWorld($, on)
  const readAt = goodReadAt(store, '2')
  const before = store.get('usage:2')
  // The endpoint answers 200 with no window the mod can read: checkAccount stores no reading.
  w.usage['tok-2'] = [null, null]
  const calls = w.usageCalls.filter(t => t === 'tok-2').length
  await clock.advance(USAGE_IDLE_MS + 2 * 60_000)
  // The seed: login 2 was read again, and its reading is the boot read's still.
  expect([w.usageCalls.filter(t => t === 'tok-2').length > calls, store.get('usage:2') === before]).toEqual([true, true])
  expect(lineOne(store, '2')).toMatch(new RegExp(`  updated ${localTime(readAt)}$`))
})

test('the login in use, a response since, read by its schedule into no reading, keeps its updated time', async ($, on) => {
  const { w, store, clock } = await rowsWorld($, on)
  const readAt = goodReadAt(store, '1')
  await clock.advance(4 * 60_000)
  w.limits = [{ kind: 'seven_day', percentUsed: 31, resetsAt: WEEK_RESET }]
  await respond($, clock, w)
  w.usage['tok-1'] = [null, null]
  const calls = w.usageCalls.filter(t => t === 'tok-1').length
  await clock.advance(USAGE_IDLE_MS)
  expect(w.usageCalls.filter(t => t === 'tok-1').length > calls).toBe(true)
  expect(lineOne(store, '1')).toMatch(new RegExp(`  updated ${localTime(readAt)}$`))
})

test('a login whose only usage answer stored no reading draws no updated time over no reading yet', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 30, 40]
  w.usage['tok-2'] = [null, null]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  // The seed: login 2 was read, and stored no reading.
  expect([w.usageCalls.includes('tok-2'), store.has('usage:2')]).toEqual([true, false])
  expect(lineOne(store, '2')).not.toMatch(/updated/)
})

// Review C8-R1 boot-stale (Codex) [ROWS-LAG-ONE-MERGE] (RULING 4521, 4538): a session's own read reaches the rows at
// once, not at the next minute's merge, so a session that ends within that minute leaves them current.
test('boot success refreshes the exported row before the first minute tick', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [null, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.has('usage:1')).toBe(true)
  expect((store.get('usage-due:1') as { at?: number } | undefined)?.at).toBeDefined()
  expect(lineOne(store, '1')).toMatch(/  updated \d\d:\d\d$/)
})

test('boot failure refreshes the exported row before the first minute tick', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.failing = { 'tok-1': 429 }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('check-error:1')).toMatchObject({ why: expect.stringMatching(/HTTP 429/) })
  expect(lineOne(store, '1')).toMatch(new RegExp(`Failed to update \\(HTTP 429\\), next try ${localTime(nextTryAt(store, '1'))}$`))
})

test('a usage call that throws names its back-off as the next try', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.throwing = ['tok-1']
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('check-error:1')).toMatchObject({ why: expect.stringMatching(/^the usage call threw \(\w+\)$/) })
  expect(lineOne(store, '1')).toMatch(new RegExp(`Failed to update \\(usage call threw\\), next try ${localTime(nextTryAt(store, '1'))}$`))
})

const FAILED_USAGE_CALLS: [string, (w: World) => void][] = [
  ['a throwing token', w => { w.throwing = ['tok-1'] }],
  ['a token the usage call answers 429', w => { w.failing = { 'tok-1': 429 } }],
]
for (const [name, fail] of FAILED_USAGE_CALLS) {
  test(`a row names a next try exactly when its schedule holds a failed read's back-off: ${name}`, async ($, on) => {
    const w = fresh()
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    fail(w)
    const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
    const clock = world(on, w, store)
    await start($, clock)
    expect((store.get('usage-due:1') as { fails?: number } | undefined)?.fails).toBeGreaterThan(0)
    expect(lineOne(store, '1')).toMatch(/ next try \d\d:\d\d$/)
  })
}

test('a login with a failed read and no reading, whose token has since run out, says it waits for a session, not a next try nothing will take', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW - HOUR)
  w.usage['tok-1'] = [10, 20]
  const store = new Map<string, unknown>(
    Object.entries({
      ...TWO_LOGINS,
      'check-error:2': { why: 'the usage call answered HTTP 429', at: NOW - 2 * HOUR },
      'usage-due:2': { next: NOW - 1, fails: 2, v: 1 },
    }),
  )
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  expect(callsWith(w, 'tok-2')).toBe(0)
  expect(lineOne(store, '2')).toMatch(/ Failed to update \(token run out\), until a session refreshes its token$/)
})

// C9 (puma-eslxj.10, problem g part 2): the pane draws each account's row fitted to its body's width, the buttons at
// the end of the line that holds them, with no id column and no separate failure line.

type DrawnNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
/** The text an element shows: its strings, and its Texts' strings, in order; the buttons' box at a line's end left out. */
const shownText = (n: unknown): string => {
  if (typeof n === 'string') return n
  if (typeof n !== 'object' || n === null) return ''
  const { type, props, children } = n as DrawnNode
  if (type === 'Button' || String(props?.key ?? '').startsWith('end-')) return ''
  return (children ?? []).map(shownText).join('')
}
/** The Buttons under an element, by key. */
const buttonsIn = (n: unknown): string[] => {
  if (typeof n !== 'object' || n === null) return []
  const { type, props, children } = n as DrawnNode
  return type === 'Button' ? [String(props?.key ?? '')] : (children ?? []).flatMap(buttonsIn)
}
/** The pane's row lines at `bodyColumns`, by their Box's key `line-<id>-<n>`: each line's text and its Buttons. */
async function drawnLines($: Engine, bodyColumns: number): Promise<Record<string, { text: string; buttons: string[] }>> {
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: { ...PANE_PROPS, bodyColumns } })
  const tree = await pane.drawn()
  await pane.unmount()
  const out: Record<string, { text: string; buttons: string[] }> = {}
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const { type, props, children } = n as DrawnNode
    const key = props?.key
    if (type === 'Box' && typeof key === 'string' && key.startsWith('line-')) out[key] = { text: shownText(n), buttons: buttonsIn(n) }
    ;(children ?? []).forEach(walk)
  }
  walk(tree)
  return out
}

test('at 82 columns the pane draws each account\'s two row lines as the rows key holds them, the buttons ending line 1', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const lines = await drawnLines($, 82)
  const stored = rowsText(store, clock.now()) ?? []
  // The seed: both accounts have stored rows.
  expect(stored.map(r => r.id)).toEqual(['1', '2'])
  for (const r of stored) {
    expect([r.id, [lines[`line-${r.id}-0`]?.text, lines[`line-${r.id}-1`]?.text]]).toEqual([r.id, r.lines])
  }
  // Login 2, not in use, ends line 1 with Remove and Use now.
  expect(lines['line-2-0']?.buttons).toEqual(['ask-remove-2', 'use-2'])
  expect(Object.keys(lines).filter(k => k.startsWith('line-2-'))).toEqual(['line-2-0', 'line-2-1'])
})

test('a pane too narrow for any row line and its buttons gives the buttons a line of their own after line 2', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const lines = await drawnLines($, 50)
  expect([lines['line-2-0']?.buttons, lines['line-2-1']?.buttons, lines['line-2-2']?.text]).toEqual([[], [], ''])
  expect(lines['line-2-2']?.buttons).toContain('ask-remove-2')
  expect(lines['line-2-1']?.text).toBe(rowsText(store, clock.now())?.find(r => r.id === '2')?.lines[1])
})

// Mutations V1 and V2 survived: the buttons' place is decided by the row's width less the accounts box's frame (4) and
// by Remove's width beside the slot (23 in all, after a gap of 2).
test('login 2\'s buttons end line 1 only where the pane, less its frame, holds line 1, the gap and Remove with Use now', async ($, on) => {
  const { store } = await rowsWorld($, on)
  const width = [...lineOne(store, '2')].length + 2 + 23 + 4
  expect((await drawnLines($, width))['line-2-0']?.buttons).toEqual(['ask-remove-2', 'use-2'])
  expect((await drawnLines($, width - 1))['line-2-0']?.buttons).toEqual([])
})

// Mutation V4 survived: the pane asks for the operator's 82-cell row and the accounts box's frame around it.
test('the pane asks the dock for the operator\'s 82-cell row and the 4 cells of the accounts box\'s frame', () => {
  expect(PANE_COLUMNS).toBe(82 + 4)
})

// Mutation P1 survived: a bar is drawn in the color of the room its account has left.
test('a row\'s bars are drawn in the color of the room left: login 1\'s week, 30% used, in the color of 70% left', async ($, on) => {
  await rowsWorld($, on)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: { ...PANE_PROPS, bodyColumns: 86 } })
  const colors: unknown[] = []
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const { type, props, children } = n as DrawnNode
    if (type === 'Text' && shownText(n) === '▰▰▰▱▱▱▱▱▱▱ 30%') colors.push(props?.color)
    ;(children ?? []).forEach(walk)
  }
  walk(await pane.drawn())
  await pane.unmount()
  expect(colors).toEqual([roomColor(70)])
})

/** An element's whole text, its buttons' boxes included. */
function rawText(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null) return ''
  return ((node as DrawnNode).children ?? []).map(rawText).join('')
}
/** The first element under `node` with `key`, or the first Text whose whole text is `text`. */
function findDrawn(node: unknown, match: { key?: string; text?: string }): DrawnNode | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const n = node as DrawnNode
  if ((match.key !== undefined && n.props?.key === match.key) || (match.text !== undefined && n.type === 'Text' && rawText(n) === match.text)) return n
  for (const child of n.children ?? []) {
    const found = findDrawn(child, match)
    if (found !== undefined) return found
  }
  return undefined
}

// Review C9-R1 END-SLOT-UNDERCOUNTS-STATUS (Codex) and END-WIDTH-UNDERCOUNT (Opus) [END-WIDTH-UNDERCOUNT] (RULING 4555):
// the end of a line is counted as wide as what lineEnd draws there, so the line with its end fits the row.
for (const spare of [0, 1, 2]) {
  test(`a signing-in status fits the line it ends, ${spare} cells over the slot's width`, async ($, on) => {
    const { store, clock } = await rowsWorld($, on)
    store.set('health:2', { kind: 'logging-in', since: NOW })
    await clock.advance(61_000)
    const bodyColumns = [...lineOne(store, '2')].length + 2 + 11 + 4 + spare
    const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: { ...PANE_PROPS, bodyColumns } })
    const tree = await pane.drawn()
    await pane.unmount()
    const line = findDrawn(tree, { key: 'line-2-0' })
    const end = findDrawn(line, { key: 'end-2' })
    const cells = [...shownText(line)].length + (end === undefined ? 0 : 2 + [...rawText(end)].length)
    expect([spare, cells <= bodyColumns - 4]).toEqual([spare, true])
  })
}

// Review C9-R1 FAILED-BAR-LOSES-COLOR (Codex) [FAILED-BAR-LOSES-COLOR] (RULING 4555): a failed row's bars stay in the
// color of their room left, drawn dim.
test('a failed row\'s bars keep the color of their room left, dim', async ($, on) => {
  const { w, store, clock } = await rowsWorld($, on)
  w.failing = { 'tok-1': 429, 'tok-2': 429 }
  store.delete('usage-due:1')
  store.delete('usage-due:2')
  await clock.advance(61_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const tree = await pane.drawn()
  await pane.unmount()
  for (const [id, text, left] of [['1', '▰▰▰▱▱▱▱▱▱▱ 30%', 70], ['2', '▰▰▰▰▱▱▱▱▱▱ 40%', 60]] as const) {
    const bar = findDrawn(findDrawn(tree, { key: `line-${id}-1` }), { text })
    expect([id, bar?.props?.dimColor, bar?.props?.color]).toEqual([id, true, roomColor(left)])
  }
})

test('the pane draws no id column and no separate failure line: a failed read ends line 1 instead', async ($, on) => {
  const { store } = await rowsWorld($, on, true)
  const lines = await drawnLines($, 82)
  const text = await paneText($)
  expect([text.includes('its last usage check failed'), text.split('\n').includes('1'), text.split('\n').includes('2')]).toEqual([false, false, false])
  expect(lines['line-1-0']?.text).toMatch(/  \d\d:\d\d Failed to update \(HTTP 429\), next try \d\d:\d\d$/)
  expect(lines['line-1-0']?.text).toBe(lineOne(store, '1'))
})

// Review C9-R1 ROWS-FROM-STALE-VIEW (Opus) [ROWS-FROM-STALE-VIEW] (RULING 4555): a check's rows are written from the
// store as it stands then, never from this session's view merged before the check's claim wait.
test('a check never puts back an older row over the one another session stored meanwhile', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  // Login 1's schedule comes due at the next minute tick, so that tick's check claims it and waits.
  store.set('usage-due:1', { ...(store.get('usage-due:1') as object), next: clock.now() })
  await clock.advance(NOW + 2 * 60_000 - clock.now())
  // The seed: the check holds its claim on login 1, its merge done.
  expect((store.get('usage-due:1') as { claim?: string } | undefined)?.claim).toBe('session-1')
  // Another session reads login 2 now and stores its row, as its merge does.
  const bAt = clock.now()
  store.set('usage-due:2', { ...(store.get('usage-due:2') as object), at: bAt, next: bAt + USAGE_IDLE_MS })
  const atRead = (run: StoredRows['rows'][number]['lines'][number][number]) => (typeof run === 'object' && 'clock' in run ? { clock: bAt } : run)
  const newer = (rowsOf(store)?.rows ?? []).map(r => (r.id === '2' ? { ...r, lines: [(r.lines[0] ?? []).map(atRead), ...r.lines.slice(1)] } : r))
  expect(storedLineText(newer.find(r => r.id === '2')?.lines[0] ?? [], bAt)).toMatch(new RegExp(`updated ${localTime(bAt)}$`))
  store.set('rows', { v: 1, at: bAt, rows: newer })
  await clock.advance(USAGE_CLAIM_WAIT_MS + 1000)
  expect(lineOne(store, '2')).toMatch(new RegExp(`updated ${localTime(bAt)}$`))
})

/** The shared store, checking every `rows` write against the store as it stands then: each `updated` is the last good read's. */
class RowsWatch extends Map<string, unknown> {
  offenders?: string[]
  writes?: number
  override set(key: string, value: unknown): this {
    if (key === 'rows' && this.offenders !== undefined) {
      this.writes = (this.writes ?? 0) + 1
      for (const r of (value as RowsKey).rows ?? []) {
        const shown = /updated (\d\d:\d\d)$/.exec(storedLineText(r.lines[0] ?? [], 0))?.[1]
        const at = (super.get(`usage-due:${r.id}`) as { at?: number } | undefined)?.at
        if (shown !== undefined && at !== undefined && shown !== localTime(at)) this.offenders.push(`login ${r.id}: updated ${shown}, the store's last good read ${localTime(at)}`)
      }
    }
    return super.set(key, value)
  }
}

test('no rows write names a good read older than the store holds then, whichever path writes it', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [null, 30, 40]
  w.usage['tok-2'] = [null, 40]
  const store = new RowsWatch(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  store.offenders = []
  const clock = world(on, w, store)
  await start($, clock)
  const otherReads = (at: number) => store.set('usage-due:2', { ...(store.get('usage-due:2') as object), at, next: at + USAGE_IDLE_MS })
  for (let minute = 1; minute <= 11; minute++) {
    // Login 1 comes due at each tick, so each tick's check claims it and waits; the other session reads login 2 in that wait.
    store.set('usage-due:1', { ...(store.get('usage-due:1') as object), next: clock.now() })
    await clock.advance(NOW + minute * 60_000 - clock.now())
    otherReads(clock.now())
    await clock.advance(USAGE_CLAIM_WAIT_MS + 1000)
  }
  expect(store.writes ?? 0).toBeGreaterThan(2)
  expect([...new Set(store.offenders)]).toEqual([])
})

// C11 (puma-eslxj.12, RULING 4593 and 4595): `account-rotator account select` drops a request file in the config
// folder's account-rotator-requests; a session's minute tick applies one only when it names this store's store-id.
const REQUESTS = `${HOME}/.claude/account-rotator-requests`
/** A nonce as the CLI writes one, a uuid's hex. */
const N1 = '0f3c2a9e1b7d4c55a6e8f00112233445'
/** A select request for login `id`, read from the store whose id is `storeId`, as bin/account-rotator writes it. */
const selectRequest = (nonce: string, id: string, storeId: unknown, at: number) => JSON.stringify({ kind: 'select', nonce, at, id, store: storeId })
const resultOf = (w: World, nonce: string): Record<string, unknown> | undefined => {
  const text = w.files[`${REQUESTS}/${nonce}.result.json`]
  return typeof text === 'string' ? (JSON.parse(text) as Record<string, unknown>) : undefined
}

/** Two logins, with room unless the test spends a week, a session started on login 1, a minute's merge done. */
async function selectWorld($: Engine, on: On, login2: [number, number] = [10, 20], login1: [number, number] = [10, 20], w: World = fresh()): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
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

test('a store holds a store-id, which the first session that finds none writes', async ($, on) => {
  const { store } = await selectWorld($, on)
  expect(typeof store.get('store-id')).toBe('string')
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
  expect(resultOf(w, N1)?.message).toMatch(/new sessions start on account 1 \(account 2 has no room/)
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
test('a request file that does not parse, or one no read can reach, is passed over and the next is applied', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  w.files[`${REQUESTS}/torn-00001.json`] = '{"kind": "sel'
  w.files[`${REQUESTS}/noread-001.json`] = null
  w.files[`${REQUESTS}/${N1}.json`] = selectRequest(N1, '2', store.get('store-id'), clock.now())
  await clock.advance(60_000)
  expect([store.get('launch-on'), resultOf(w, 'torn-00001'), resultOf(w, 'noread-001'), resultOf(w, N1)?.ok]).toEqual(['account:2', undefined, undefined, true])
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

const USE_COMMAND = 'account-rotator account use --account 2'
/** A use request as bin/account-rotator writes it, aimed at the session whose mark is `session`. */
const useRequest = (nonce: string, id: string, storeId: unknown, at: number, session: unknown) => JSON.stringify({ kind: 'use', nonce, at, id, store: storeId, session })
const ownMark = (w: World) => w.otherEnv.ACCOUNT_ROTATOR_SESSION

/** A Bash call as Claude makes one, running until `finish`; the test writes the request the command would. */
function bashCall($: Engine, w: World, command: string): { finish: () => Promise<unknown> } {
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
const beat = async (clock: MockClock) => {
  await clock.advance(REQUEST_POLL_MS)
  await clock.settle()
}

/** The next minute's tick, whatever the time now. */
const untilTick = async (clock: MockClock) => {
  await clock.advance(60_000)
  await clock.settle()
}

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
  expect(resultOf(w, N1)?.message).toMatch(/this session now uses account 2/)
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
  expect(resultOf(w, N1)).toMatchObject({ ok: false, message: blockedText(true), activeId: '1' })
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
  expect(resultOf(w, N1)?.message).toMatch(/this session moves to account 2 .*in a few minutes, once account 1's token has refreshed/)
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
  expect(resultOf(w, N1)?.message).toMatch(/this session already uses account 1/)
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
  expect(resultOf(w, N1)?.message).toMatch(/account 2 .*cannot take over: its sign-in has run out/)
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
  expect(resultOf(w, N1)).toMatchObject({ ok: false, message: blockedText(true), activeId: '1' })
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
  const text = blockedText(true)
  const said = [...w.notices, ...w.toasts].map(String)
  if (!said.some(t => t.includes(text))) offenders.push('checkSwitching (useSlot): the boot check says nothing of the hold')
  const pane = await mountPane($)
  const useButton = await pane.find({ key: 'use-2' })
  expect(useButton, 'the sweep found no Use now to press').toBeDefined()
  await pane.press({ key: 'use-2' })
  await clock.settle()
  const claimed = w.toasts.filter(t => t.startsWith('Switched to Claude account 2'))
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
    ...w.toasts.filter(t => t.startsWith('Switched to Claude account 1')).map(t => `the toast: "${t}"`),
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
  await clock.advance(REQUEST_TTL_MS + 60_000)
  await clock.settle()
  count.looks = 0
  for (let i = 0; i < 40; i += 1) await beat(clock)
  const { looks } = count
  await call.finish()
  await beat(clock)
  return looks
}

test('no command shape holds the watch past the time a request lasts', { timeoutMs: 120_000 }, async ($, on) => {
  const count = { looks: 0 }
  const { w, clock } = await selectWorld($, onCountingLooks(on, count))
  const commands = ['tail -f /var/log/account-rotator.log', 'cd ~/Projects/claude-account-rotator && npm run dev', 'account-rotator account use --account 2; sleep 36000']
  const offenders: string[] = []
  for (const command of commands) {
    const looks = await looksPastTheTtl($, w, clock, count, command)
    if (looks >= 5) offenders.push(`${command}: ${looks} looks in 40 beats`)
  }
  expect(commands.length).toBeGreaterThan(0)
  expect(offenders, `commands the watch polls for without end; bound watchRequests by REQUEST_TTL_MS: ${offenders.join('; ')}`).toEqual([])
})

// Review C12-R2 C12-BOUNDARY (Codex) [WATCH-BOUNDARY] -> [WATCH-IS-NOT-THE-MINUTE].
test('a watch takes neither kind of request on its deadline beat', { timeoutMs: 30_000 }, async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const offenders: string[] = []
  for (const [nonce, make] of [['deadline-use01', useRequest], ['deadline-sel01', selectRequest]] as const) {
    const call = bashCall($, w, USE_COMMAND)
    await clock.settle()
    await clock.advance(REQUEST_TTL_MS - REQUEST_POLL_MS)
    await clock.settle()
    w.files[`${REQUESTS}/${nonce}.json`] = make(nonce, '2', store.get('store-id'), clock.now(), ownMark(w))
    await beat(clock)
    if (resultOf(w, nonce)) offenders.push(nonce)
    await call.finish()
  }
  expect(offenders, `taken at REQUEST_TTL_MS; check the deadline after the sleep too: ${offenders.join(', ')}`).toEqual([])
})

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

/** What the CLI read of each login these tests remove. */
const SEEN: Record<string, { slot: string; email: string }> = {
  '1': { slot: '', email: 'one@example.com' },
  '2': { slot: SLOT2, email: 'two@example.com' },
  '3': { slot: SLOT3, email: 'three@example.com' },
}
const rmRequest = (nonce: string, id: string, storeId: unknown, at: number) => JSON.stringify({ kind: 'rm', nonce, at, id, store: storeId, ...SEEN[id] })
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
  expect(resultOf(w, N1)?.message).toMatch(/account 2 is removed; new sessions start on account 1/)
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
  expect(resultOf(w, N1)?.message).toMatch(/account 2 is already gone/)
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
  expect(w.logouts ?? [], 'the logout signed out account 3, which stays listed').toEqual([])
  expect(resultOf(w, N1)?.ok).toBe(false)
  expect(resultOf(w, N1)?.message).toMatch(/account 2 shares its sign-in with account 3/)
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
  expect(resultOf(w, N1)?.message).toMatch(/account 2 is in use and no other account can take over yet; not removed/)
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
    expect(resultOf(w, N1)?.message).toMatch(/account 2 .*could not be signed out/)
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
  expect(resultOf(w, N1)?.message).toMatch(/account 2 is removed; no account has room, so new sessions start on Claude Code's login/)
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
  expect(resultOf(w, N1)?.message).toMatch(/account 7 .*seven@example\.com.* is added/)
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
  expect(resultOf(w, N1)).toMatchObject({ ok: true, accountId: '2', message: 'already account 2', pickId: (store.get('launch-slot') as { id: string }).id })
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
    if (result?.ok !== false || !said.includes(`account ${twin.id}`) || !said.includes(SLOT7) || !said.includes('claude auth logout')) offenders.push(`${twin.id}: ${said}`)
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
  expect(String(resultOf(w, N2)?.message)).toMatch(/account 9 /)
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
  expect(resultOf(w, N1)).toMatchObject({ ok: true, accountId: '7', message: 'already account 7' })
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
  expect([resultOf(w, N1)?.accountId, resultOf(w, N2)?.message]).toEqual(['7', 'already account 7'])
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
const debugLines = (w: World, text: string) => (w.logged ?? []).filter(line => line.includes(text))

test('a request over 4 KB is skipped unread, in one debug line, and one of exactly 4 KB is taken', async ($, on) => {
  const { w, store, clock } = await selectWorld($, on)
  const size = paddedSelect(N1, store.get('store-id'), clock.now()).length
  w.files[`${REQUESTS}/${N1}.json`] = paddedSelect(N1, store.get('store-id'), clock.now(), 4097 - size)
  await untilTick(clock)
  w.files[`${REQUESTS}/${N1}.json`] = paddedSelect(N1, store.get('store-id'), clock.now(), 4097 - size)
  await untilTick(clock)
  expect(resultOf(w, N1)).toBeUndefined()
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
  expect(JSON.stringify(store.get('health:3'))).toMatch(/account 2/)
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
