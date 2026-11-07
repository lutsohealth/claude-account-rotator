import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunResult, SessionRateLimit, ToolCallArgs } from 'claude-code'

import { DEFAULT_FOOTER, keychainItem, roomColor } from './model'

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
  /** access token -> the email of the account it signs in, as the profile endpoint answers */
  owners: Record<string, string>
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

const blob = (token: string, expiresAt = NOW + 6 * HOUR, plan = 'max') =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: `refresh-${token}`,
      expiresAt,
      refreshTokenExpiresAt: NOW + 20 * 24 * HOUR,
      scopes: ['user:inference', 'user:profile'],
      subscriptionType: plan,
    },
  })

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
      const email = w.owners[token]
      if (email === undefined) return { value: { status: 404, ok: false, headers: {}, text: '' } }
      const profile = {
        account: { uuid: `account-${email}`, email },
        organization: { uuid: `org-${email}`, name: 'Org', organization_type: 'claude_max' },
      }
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(profile) } }
    }
    const usage = w.usage[token]
    if (usage === undefined) return { value: { status: 401, ok: false, headers: {}, text: '' } }
    const [five, week, fable] = usage
    const body = {
      five_hour: five === null ? null : { utilization: five, resets_at: '2026-10-12T12:00:00Z' },
      seven_day: week === null ? null : { utilization: week, resets_at: '2026-10-18T03:00:00Z' },
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

async function start($: Engine, clock: MockClock): Promise<void> {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
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
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  // Responses go on reporting login 1's usage.
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
  // The week is spent by the time the stop's own read comes in.
  w.usage['tok-1'] = [20, 30, 100]
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
    await $.classic.StopFailure(stop)
    await clock.settle()
    // Login 2's Fable week is spent too: a Fable stop has nowhere to go.
    expect(w.envSets).toEqual([])
    expect(await hasFableBand($)).toBe(true)
    // The read shows the 5-hour window spent instead: a plain stop, which moves.
    w.usage['tok-1'] = [100, 30, 60]
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
  await clock.advance(11 * 60_000)
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
  await clock.advance(11 * 60_000)
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
  await clock.advance(11 * 60_000)
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
  await clock.advance(11 * 60_000)
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
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: "You've hit your session limit" })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.notices.filter(t => /Fable week/.test(t))).toEqual([])
  w.usage['tok-2'] = [10, 30, 100]
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
  expect(await pane.find({ text: /moves to the account whose 5-hour window, or else week, resets soonest/ })).toBeDefined()
  await pane.press({ key: 'rotate-to-order' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /moves to the next account in the list with room/ })).toBeDefined()
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.unmount()
})

test('with the 5-hour limit off, the account in use past 90% of its 5-hour window stays and the pane\'s rule names the week alone; turned on in the pane, it moves', async ($, on) => {
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
  expect(await pane.find({ text: /^Once the account in use has 5% of its week left, moves to the account whose week resets soonest\.$/ })).toBeDefined()
  expect(await pane.find({ text: /5-hour/ })).toBeUndefined()
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await clock.advance(10 * 60_000)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.redraw()
  expect(await pane.find({ text: /10% of its 5-hour window, where it reports one, or 5% of its week left/ })).toBeDefined()
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
  expect(await pane.findAll({ type: 'Text', text: /none reported$/ })).toHaveLength(2)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /: account 1 has 0% of its week left\.$/.test(t))).toHaveLength(1)
  await pane.redraw()
  expect(await pane.find({ text: /^resets in 5h/ })).toBeUndefined()
  expect(await pane.findAll({ type: 'Text', text: /none reported$/ })).toHaveLength(2)
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
  expect(await pane.findAll({ type: 'Text', text: /none reported$/ })).toHaveLength(2)
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
    return (await pane.findAll({ type: 'Text', text: /none reported$/ })).length === 3 && (await pane.find({ text: /^resets in [0-9]+h/ })) === undefined
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
  expect(await pane.findAll({ type: 'Text', text: /none reported$/ })).toHaveLength(2)
  expect(await pane.find({ text: /^resets in 5h/ })).toBeUndefined()
  await pane.unmount()
})

test('a stored stop mark with no reset time, on an account whose token is not live to read it again, stops counting five hours after its read', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  // Login 2's access token has run out: no check reads its usage again.
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW - HOUR)
  w.usage['tok-1'] = [null, 40]
  const stale = { fiveHour: { pct: 100 }, sevenDay: { pct: 10, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - 6 * HOUR }
  const clock = world(on, w, { ...TWO_LOGINS, 'reading:2': stale })
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.findAll({ type: 'Text', text: /none reported$/ })).toHaveLength(2)
  await pane.press({ key: 'rotate' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await pane.unmount()
})

test('turning the 5-hour limit off moves at once to a login held back only by its 5-hour window', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 96]
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
    if (this.site !== '' && key === 'reading:1') {
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
  w.limits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' }]
  const store = new OtherSessionStore(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const offenders: string[] = []
  const writers: [string, () => Promise<unknown>][] = [
    ['response', () => $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })],
    ['usage check', () => clock.advance(10 * 60_000)],
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
    'reading:1': { fiveHour: { pct: 50, resetsAt: '2026-10-12T12:00:00Z' }, sevenDay: { pct: 40, resetsAt: '2026-10-18T03:00:00Z' }, fable: { pct: 50, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - HOUR },
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

test('the pane names Claude Code\'s own login, where new sessions start, and its plan; on another login it says /login there signs that one in', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2', NOW + 6 * HOUR, 'team')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  w.owners = { 'tok-1': 'one@example.com', 'tok-2': 'two@example.com' }
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: "Claude Code's login: account 1 (one@example.com), personal Max. New sessions start on it." })).toBeDefined()
  await pane.press({ key: 'rotate' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ type: 'Text', text: /^Claude Code's login: account 1 \(one@example\.com\), personal Max\. New sessions start on it\. \/login in this session signs in account 2 instead\.$/ })).toBeDefined()
  await pane.unmount()
})

test('a Team seat as Claude Code\'s own login is told in the pane: new sessions start on it, and can\'t switch', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 6 * HOUR, 'team')
  w.usage['tok-1'] = [20, 30]
  w.owners = { 'tok-1': 'one@example.com' }
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const line = await pane.find({ type: 'Text', text: /^Claude Code's login: account 1 \(one@example\.com\), a Team seat\. New sessions start on it, and can't switch accounts: / })
  expect(line?.props).toMatchObject({ color: 'warning' })
  await pane.unmount()
})

test('a /login on Claude Code\'s login that signs in a Team seat on the list leaves login 1 needing its own sign-in, and the pane names the seat as Claude Code\'s login', async ($, on) => {
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
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const line = await pane.find({ type: 'Text', text: /^Claude Code's login: account 1 \(two@example\.com\), a Team seat\. New sessions start on it, and can't switch accounts: .* \/login in this session signs in account 2 instead\.$/ })
  expect(line?.props).toMatchObject({ color: 'warning' })
  await pane.unmount()
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
  expect(await pane.find({ type: 'Text', text: "Claude Code's login: account 1 (one@example.com), personal Max. New sessions start on it." })).toBeDefined()
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
}

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
const mountBand = ($: Engine) => $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
const slots = (w: World) => w.envSets.map(e => e.value ?? '')

test('before the rotation moves the session off Claude Code\'s login, Claude in Chrome connects there, where the extension answers, and goes on answering as the session moves', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.emails = { '': 'one@example.com', [SLOT2]: 'two@example.com' }
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
  { name: 'the other login has its week full', notice: /^Fable limit reached on account 1, and no other Claude account can take over/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [10, 96, 10] } },
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
    'reading:1': { fiveHour: { pct: 30, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW + HOUR },
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
    'reading:1': { fiveHour: { pct: 30, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW + HOUR },
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
    'reading:1': { fiveHour: { pct: 50, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW - HOUR },
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
    'reading:1': { fiveHour: { pct: 50, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW - HOUR },
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
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off', 'mark:1': { pct: 100, resetsAt: '2026-10-12T15:00:00Z', at: NOW - HOUR } }))
  const clock = world(on, w, store)
  await start($, clock)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  w.limits = [{ kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-12T12:00:00Z' }]
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
  await clock.advance(10 * 60_000)
  if (await marked()) offenders.push('usage check reporting none')
  await pane.unmount()
  expect(offenders).toEqual([])
})
