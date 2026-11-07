import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunResult, SessionRateLimit, ToolCallArgs } from 'claude-code'

import { DEFAULT_FOOTER, USAGE_CLAIM_WAIT_MS, USAGE_FORCE_AFTER_MS, USAGE_IDLE_MS, keychainItem, roomColor } from './model'

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
  /** credentials file -> stored text, or null where it cannot be read */
  files: Record<string, string | null>
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
function sharedStore(on: On, entries: Map<string, unknown>): void {
  on('store.get', (_$, e) => ({ value: entries.get(e.key) }))
  on('store.set', (_$, e) => {
    entries.set(e.key, e.value)
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
  if (store instanceof Map) sharedStore(on, store)
  else mock.store(on, store)
  mock.env(on, { USER: 'tester', HOME, ...w.env })
  let slot = w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? ''
  on('env.set', (_$, e) => {
    if (w.refuseEnv) return { deny: `env (managed): ${e.name} is not for plugins outside policy to change` }
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
    if (cmd === 'claude' && sub === 'auth' && verb === 'status') {
      const email = w.emails[e.init?.env?.CLAUDE_SECURESTORAGE_CONFIG_DIR ?? '']
      const status = email ? { loggedIn: true, email, orgId: `org-${email}`, orgName: 'Org', subscriptionType: 'max' } : { loggedIn: false }
      return { value: ran(0, JSON.stringify(status)) }
    }
    if (cmd === 'claude' && sub === 'auth' && verb === 'logout') return { value: ran(0, '') }
    throw new Error(`unexpected command: ${e.argv.join(' ')}`)
  })
  on('http.fetch', (_$, e) => {
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
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
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
  on('ui.log', () => ({ value: undefined }))
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
  on('fs.write', () => ({ value: undefined }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/System/Library/CoreServices/SystemVersion.plist' && w.system === 'macOS' }))
  on('fs.read', (_$, e) => {
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
const ONE_AT_20 = /^▰{8}▱{2} 80% left$/

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

test('a check whose usage lists a Fable week replaces the mark a stop left, so the session can move back to the login whose week it reads below 95%', async ($, on) => {
  const w = fresh()
  const clock = await markedThenReread($, on, w, {})
  w.usage['tok-1'] = [20, 30, 40]
  await pastNextRead(clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2, ''])
  expect(w.submitted).toHaveLength(2)
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

test('a Fable mark with no reset time from the usage is replaced by a check that lists the Fable week, so the session can move back', async ($, on) => {
  const w = fresh()
  const clock = await markedWithNoRow($, on, w, {})
  w.usage['tok-1'] = [20, 30, 40]
  await pastNextRead(clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2, ''])
  expect(w.submitted).toHaveLength(2)
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
  expect(await pane.find({ text: /^▰{8}▱{2} 80% left$/ })).toBeDefined()
  expect(await pane.find({ text: /^▰{7}▱{3} 70% left$/ })).toBeDefined()
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
  expect(await pane.findAll({ type: 'Text', text: /^5h$/ })).toHaveLength(0)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /: account 1 has 0% of its week left\.$/.test(t))).toHaveLength(1)
  await pane.redraw()
  expect(await pane.find({ text: /^resets in 5h/ })).toBeUndefined()
  expect(await pane.findAll({ type: 'Text', text: /^5h$/ })).toHaveLength(0)
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
  expect(await pane.findAll({ type: 'Text', text: /^5h$/ })).toHaveLength(0)
  expect(await pane.find({ text: /^resets in 5h/ })).toBeUndefined()
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
    return (await pane.findAll({ type: 'Text', text: /^5h$/ })).length === 0 && (await pane.find({ text: /^resets in [0-9]+h/ })) === undefined
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
  expect(await pane.findAll({ type: 'Text', text: /^5h$/ })).toHaveLength(0)
  expect(await pane.find({ text: /^resets in 5h/ })).toBeUndefined()
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
  // Login 1 reports no 5-hour window, so it has no 5h row; login 2's dropped 5-hour reading leaves its row with none reported.
  expect(await pane.findAll({ type: 'Text', text: /none reported$/ })).toHaveLength(1)
  expect(await pane.findAll({ type: 'Text', text: /^5h$/ })).toHaveLength(1)
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
  expect(await pane.findAll({ type: 'Text', text: /none reported$/ })).toHaveLength(1)
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
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
  await clock.advance(11 * 60_000)
  await pane.redraw()
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
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
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const markVisible = async () => {
    await pane.redraw()
    return (await pane.find({ text: /^▱{10} 0% left$/ })) !== undefined
  }
  const offenders: string[] = []
  for (const rotateTo of ['reset', 'room', 'order', 'off'] as const) {
    await pane.press({ key: `rotate-to-${rotateTo}` })
    for (const limit of ['on', 'off'] as const) {
      await pane.press({ key: `five-hour-limit-${limit}` })
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
  expect(await pane.find({ text: /^▰{2}▱{8} 20% left$/ })).toBeDefined()
  await pane.press({ key: 'five-hour-limit-off' })
  await clock.settle()
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{2}▱{8} 20% left$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▰{2}▱{8} 20% left$/ })).toBeUndefined()
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{2}▱{8} 20% left$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▰{2}▱{8} 20% left$/ })).toBeUndefined()
  // Another session's press.
  store.set('five-hour-limit', 'on')
  await clock.advance(61_000)
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{2}▱{8} 20% left$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^resets in 2h 0m$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▰{5}▱{5} 50% left$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
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
    const isShown = (await pane.find({ text: /^▱{10} 0% left$/ })) !== undefined
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
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
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
    return (await pane.find({ text: /^▰{2}▱{8} 20% left$/ })) !== undefined
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
  expect((await pane.findAll({ type: 'Text', text: /its last usage check failed: the usage call answered HTTP 429$/ })).length).toBe(1)
  expect(store.get('check-error:2')).toEqual({ why: 'the usage call answered HTTP 429', at: NOW + USAGE_CLAIM_WAIT_MS })
  w.failing = {}
  await clock.advance(10 * 60_000)
  await pane.redraw()
  expect(await pane.find({ text: /its last usage check failed/ })).toBeUndefined()
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
  expect(await pane.findAll({ type: 'Text', text: /^5h$/ })).toHaveLength(1)
  expect(await pane.findAll({ type: 'Text', text: /^week$/ })).toHaveLength(2)
  expect(await pane.find({ text: /none reported$/ })).toBeUndefined()
  expect(await pane.find({ text: /^▰{9}▱ 90% left$/ })).toBeDefined()
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
test('with the session row left out, every footer setting that picks glyphs for a row shows the sign-in mark', async ($, on) => {
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
  expect(await pane.findAll({ type: 'Text', text: /^5h$/ })).toHaveLength(1)
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
  expect(await pane.find({ text: /^▰{2}▱{8} 20% used$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^⚠ signed in as account 2 now$/ })).toBeDefined()
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
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'week-mark:2': week, 'check-error:2': { why: 'x', at: NOW } }))
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
  expect(['no-five-hour:2', 'week-mark:2', 'check-error:2', 'usage-due:2', 'usage:2'].filter(k => store.has(k))).toEqual([])
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
  // A hot reload keeps the view as the version before this one wrote it, with no `holders`: the first read finds that.
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
  expect(await pane.find({ type: 'Text', text: 'Org · max · Chrome' })).toBeDefined()
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
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
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
  const marked = async () => { await pane.redraw(); return (await pane.find({ text: /^▱{10} 0% left$/ })) !== undefined }
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
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
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
  if (!(await pane.find({ text: /^▱{10} 0% left$/ }))) offenders.push('Fable stop / limit off / mergeStore')
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  if (!(await pane.find({ text: /^▱{10} 0% left$/ }))) offenders.push('Fable stop / limit on / setFiveHourLimit')
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
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
  await clock.advance(61_000)
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▱{10} 0% left$/ })).toBeDefined()
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
  const marked = async () => { await pane.redraw(); return (await pane.find({ text: /^▱{10} 0% left$/ })) !== undefined }
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
    // The stop stores its Fable mark under usage:1, and takes no week from the reading no login owns.
    const stored = store.get('usage:1') as { sevenDay?: unknown; src?: string } | undefined
    expect(stored?.src).toBe('stop')
    expect(stored?.sevenDay).toBeUndefined()
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
  expect(await pane.find({ text: /^▱+ 0% left$/ })).toBeDefined()
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
  expect(await pane.find({ text: /89% left/ })).toBeUndefined()
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
  expect(await pane.find({ text: /8[79]% left/ })).toBeUndefined()
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

test('a session records the version it writes as, and drops the records of sessions gone a day', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 20]
  const store = new Map<string, unknown>(Object.entries({
    accounts: [{ id: '1', slot: '', email: 'one@example.com' }],
    'writer:gone': { version: 1, at: NOW - 25 * HOUR },
    'writer:recent': { version: 1, at: NOW - HOUR },
  }))
  const clock = world(on, w, store)
  await start($, clock)
  expect(store.get('writer:session-1')).toEqual({ version: 1, at: NOW })
  expect([store.has('writer:gone'), store.has('writer:recent')]).toEqual([false, true])
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
    expect(await paneText($)).toMatch(new RegExp(`profile call answered HTTP ${status}`))
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

// [UNDO-OWNERSHIP]: what the stop's own usage read stored is the login's, not the stop's: it stands after the revert.
test('the usage read a stop makes 90 s into an unproven switch stands once the stop is reverted', async ($, on) => {
  const { store, clock } = await stopDuringSwitch($, on, 90_000, "You've hit your session limit", undefined, { 'tok-2': [null, 41] })
  const read = store.get('usage:2') as { at?: number; src?: string } | undefined
  expect(read?.src).toBe('body')
  await endSession($, clock)
  expect(store.get('usage:2')).toEqual(read)
})

// [UNDO-OWNERSHIP]: a move the stop itself makes is why the mark exists: the mark stays, whatever ends the switch after.
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
  return at < 0 ? texts : texts.slice(at + 1, at + 2)
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
