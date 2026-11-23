import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, ProcessRunResult, SessionRateLimit, ToolCallArgs } from 'claude-code'
import type { StoredRows, View } from '../types'

import { DEFAULT_FOOTER, EMPTY_VIEW, NUDGE_LEAD_MS, NUDGE_TEXT, USAGE_CLAIM_WAIT_MS, USAGE_FORCE_AFTER_MS, USAGE_IDLE_MS, fingerprint, keychainItem, roomColor } from './model'
import { OWN_CONTINUE_MARGIN_MS, laterMark, longBar, markFrom, storedLineText } from './model'
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
  on('store.get', (_$, e) => {
    const isRefused = (e.key === 'store-id' && w.storeIdFails === 'read') || (w.storeReadFails !== undefined && e.key.startsWith(w.storeReadFails))
    if (isRefused) return { deny: 'store: refused' }
    const value = entries.get(e.key)
    return w.afterStoreGet === undefined ? { value } : w.afterStoreGet(e.key).then(() => ({ value }))
  })
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
      five_hour: five === null ? null : { utilization: five, resets_at: w.fiveHourResets?.[token] ?? '2026-10-12T12:00:00Z' },
      seven_day: week === null ? null : { utilization: week, resets_at: w.weekResets?.[token] ?? WEEK_RESET },
      // A row for another model beside the Fable one, spent: read as Fable's, it would show.
      ...(fable === undefined ? {} : { limits: [limitRow('Sonnet', 100), limitRow('Fable 5.1', fable, w.fableResetsBy?.[token] ?? w.fableResets)] }),
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
    return { value: names.map(p => ({ name: p.slice(e.path.length + 1), kind: (w.linkFiles ?? []).includes(p.slice(e.path.length + 1)) ? 'other' : 'file', size: (w.files[p] ?? '').length, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', async (_$, e) => {
    await w.existsGate
    return { value: (e.path === '/System/Library/CoreServices/SystemVersion.plist' && w.system === 'macOS') || (w.folders ?? []).includes(e.path) }
  })
  on('fs.read', async (_$, e) => {
    await w.readGate
    // puma-9arph.26: the mod's own launcher file, wherever the host puts the plugin's folder.
    if (w.ownLauncher !== undefined && e.path.endsWith('/bin/account-rotator-claude')) return { value: w.ownLauncher }
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

/** What a refused switch says in the world's session, on login 1, Claude Code's login. */
const BLOCKED_ON_LOGIN = blockedText({ ...EMPTY_VIEW, ...TWO_LOGINS, activeId: '1', sessionId: 'session-1' })

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

/**
 * Starts the session and lets boot finish, its usage claims' wait included. A tick or a response moves a session only
 * while its main loop is failed (red in Orca), so unless a test is about that hold (`isClean`), the session starts red:
 * a main-loop StopFailure of an error that switches nothing, heard before boot.
 */
async function start($: Engine, clock: MockClock, isClean = false): Promise<void> {
  if (!isClean) await $.classic.StopFailure({ error: 'server_error' })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
}

/**
 * The resume a stop's carry-on starts, answering: the main loop's turn begins (the resume entered) and ends with an
 * answer, which ends the stop's episode (v4 s.2), so the next stop opens an episode of its own.
 */
async function resumeAnswers($: Engine, clock: MockClock, turnId = 'resumed'): Promise<void> {
  await $.turn.start({ text: 'go on', turnId })
  await $.turn.complete({ turnId, reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
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
    expect(await band.find({ text: /two@example.com needs a sign-in \(not signed in\)/ })).toBeDefined()
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
  const names = /two@example.com, 3@example.com, 4@example.com, 5@example.com needs a sign-in \(not signed in\)\./
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

test('a turn that dies on the usage limit moves to a login whose usage check failed with no reading, when no read login has room, and carries on (puma-9arph.34)', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [60, 40]
  // Login 2's check failed and it has no reading; its next read is not due within the test.
  const failed = { 'check-error:2': { why: 'the usage call answered HTTP 429', at: NOW, isUsageRead: true }, 'usage-due:2': { next: NOW + HOUR, fails: 1, v: 1 } }
  const clock = world(on, w, { ...TWO_LOGINS, ...failed })
  await start($, clock)
  expect(w.envSets).toEqual([])
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
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
  expect(w.toasts.find(notice)).toMatch(
    /session that starts on a Team or Enterprise account\. Fix: \/login with your personal \(Pro or Max\) account\. Quit \(in a background session, \/stop: \/exit only detaches\), then run: claude --resume session-1\./,
  )
  // The login in use runs out: no switch is tried, and what to do about it is said once.
  w.usage['tok-1'] = [95, 41]
  await clock.advance(21 * 60_000)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.toasts.filter(notice)).toHaveLength(1)
  expect(w.toasts.filter(t => /^Claude account one@example\.com is near its limit, and this window can't switch accounts\. \/login with your personal/.test(t))).toHaveLength(1)
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
  expect(notice[0]).toMatch(
    /starts or reloads plugins\. Fix: Quit \(in a background session, \/stop: \/exit only detaches\), then run: claude --resume session-1\. Not \/restart, which keeps this account\./,
  )
  expect(notice[0]).not.toMatch(/\/login/)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /^Can't switch accounts.*Fix: Quit \(in a background session, \/stop/ })).toBeDefined()
  await pane.unmount()
})

test('a window that can\'t switch, on a seat that runs out while another login has room, says once how to bring the conversation back where it can, /stop for a background session, which /exit leaves running', async ($, on) => {
  const w = fresh()
  w.refuseEnv = true
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  await spentTwo(w)
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  const stuck =
    "Claude account two@example.com is near its limit, and this window can't switch accounts. Quit (in a background session, /stop: /exit only detaches), then run: claude --resume session-1"
  expect(w.toasts.filter(t => t === stuck)).toHaveLength(1)
  const band = await mountBand($)
  expect((await band.find({ type: 'Text', text: `⚠ ${stuck}` }))?.props).toMatchObject({ color: 'warning' })
  await band.unmount()
  // Said once: the minute's checks and the usage checks after say no more.
  await clock.advance(21 * 60_000)
  expect(w.toasts.filter(t => t === stuck)).toHaveLength(1)
  expect(w.envSets).toEqual([])
})

// Review F1 (PR #85, round 1): upstream's isStuckTold lived only in the view, which /clear, /resume and /branch reset.
test('a window that can\'t switch, told once it is stuck, is not told again after /clear', async ($, on) => {
  const w = fresh()
  w.refuseEnv = true
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  await spentTwo(w)
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const stuck = (t: string) => /^Claude account two@example\.com is near its limit, and this window can't switch accounts\./.test(t)
  expect(['told before /clear', w.toasts.filter(stuck).length]).toEqual(['told before /clear', 1])
  await clearSession($, clock, s.clear)
  await clock.advance(21 * 60_000)
  expect(['stuck toasts after /clear', w.toasts.filter(stuck).length]).toEqual(['stuck toasts after /clear', 1])
})

// Review F1, the class: every once-only notice a window that can't switch gets (the policy refusal, the stuck window),
// through every reset that clears the view (/clear, /resume, /branch), on toasts and on the terminal's notifications.
test('no once-only notice of a window that can\'t switch is said again after any reset of the view', async ($, on) => {
  const NOTICES: [string, RegExp][] = [
    ['policy refusal', /^Can't switch accounts in this session\./],
    ['stuck window', /^Claude account two@example\.com is near its limit, and this window can't switch accounts\./],
  ]
  const w = fresh()
  w.refuseEnv = true
  w.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = SLOT2
  await spentTwo(w)
  const s = clearable(on)
  const clock = world(on, w, TWO_LOGINS)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const count = () => NOTICES.map(([name, re]) => [name, w.toasts.filter(t => re.test(t)).length, w.notices.map(String).filter(t => re.test(t)).length] as const)
  // The sweep inspected something: each notice was said at the start, once on each channel.
  expect(count().map(([name, toasts, notices]) => [name, toasts, notices])).toEqual(NOTICES.map(([name]) => [name, 1, 1]))
  const offenders: string[] = []
  for (const source of ['clear', 'resume', 'fork'] as const) {
    const at = count()
    await clearSession($, clock, s.clear, source)
    await clock.advance(21 * 60_000)
    count().forEach(([name, toasts, notices], i) => {
      if (toasts > at[i][1] || notices > at[i][2]) offenders.push(`${name} said again after ${source} (toasts ${at[i][1]} -> ${toasts}, notices ${at[i][2]} -> ${notices})`)
    })
  }
  // Fix: each once-only flag of the view (isSwitchBlocked, isStuckTold) goes in register.tsx's `kept` and back in rebindSession.
  expect(offenders).toEqual([])
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
  expect(w.toasts.filter(t => /did not take: responses still use one@example.com/.test(t))).toHaveLength(1)
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

// puma-9arph.28 item 1: another session removed the account a switch went to while the switch was unproven.
test('a switch whose account another session removed meanwhile ends with a notice that names no "?"', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [93, 40]
  w.usage['tok-2'] = [10, 30]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries(TWO_LOGINS))
  const clock = world(on, w, store)
  await start($, clock)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  store.set('accounts', TWO_LOGINS.accounts.filter(a => a.id !== '2'))
  w.limits = [
    { kind: 'five_hour', percentUsed: 93, resetsAt: '2026-10-12T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 40, resetsAt: '2026-10-18T03:00:00Z' },
  ]
  await clock.advance(5 * 60_000)
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
  const notices = w.toasts.filter(t => /^The switch to /.test(t))
  expect(notices.length).toBeGreaterThan(0)
  expect(notices.filter(t => /^The switch to \? | leaves [0-9]+ be /.test(t))).toEqual([])
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
const ONE_AT_20 = /^▰{2}▱{8} +20%$/

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
  expect(w.toasts.filter(t => /^Switched to Claude account two@example.com.*: one@example.com has 0% of its Fable week left\.$/.test(t))).toHaveLength(1)
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

/** The same stop as Claude Code 2.1.325 and later words it. */
const FABLE_HIT_STOP = { error: 'rate_limit', last_assistant_message: "You've hit your Fable limit · resets Nov 18 at 3pm" }

test('a Fable stop worded "hit your Fable limit" moves to the login with Fable room and carries on, and the toast names the Fable week', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30, 100]
  w.usage['tok-2'] = [10, 30, 10]
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  await clock.advance(2 * 60_000)
  expect(w.envSets).toEqual([])
  await $.classic.StopFailure(FABLE_HIT_STOP)
  await clock.settle()
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /^Switched to Claude account two@example.com.*: one@example.com has 0% of its Fable week left\.$/.test(t))).toHaveLength(1)
  expect(w.toasts.filter(t => /5-hour/.test(t))).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(w.submitted[0]).toMatch(/Continue where you left off/)
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
// v4 s.7: a wording that names no limit the mod knows ('Claude usage limit reached.') is read as no wording, so a spent
// Fable week makes it a Fable stop (row u's test); the plain stops here each name the 5-hour window.
const PLAIN_STOPS = ["You've hit your session limit · resets 3pm", "You've hit your 5-hour limit"]

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
    expect(w.toasts.filter(t => /^Switched to Claude account two@example.com.*: one@example.com has 0% of its 5-hour window left\.$/.test(t))).toHaveLength(1)
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

// v4 s.1: a login whose mark stands is still tried, last and soonest reset first, so the third stop moves to login 1.
test('with no login read for the Fable week a Fable stop takes one, the stop there moves on, and once all are marked spent the stop tries the one that frees soonest', async ($, on) => {
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
  await resumeAnswers($, clock)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  // Logins 2 and 3, each once; login 1 was marked at the first stop.
  expect([...slots(w)].sort()).toEqual([SLOT2, SLOT3])
  expect(w.submitted).toHaveLength(2)
  await resumeAnswers($, clock, 'resumed-2')
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  await clock.advance(36_000)
  expect(slots(w)).toEqual([SLOT2, SLOT3, ''])
  expect(w.submitted).toHaveLength(3)
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

// C6 (puma-eslxj.7), RULING 4467, a changed expected value: a body of the same week reading the Fable week lower lags
// the stop. puma-9arph.23, a DEFAULT of the plan, the MASTER's call: only for 30 minutes; a body read later ends the mark.
test('a check whose usage lists the same Fable week lower, 30 minutes or more after the stop, ends the mark the stop left, so the session can move back', async ($, on) => {
  const w = fresh()
  const clock = await markedThenReread($, on, w, {})
  w.usage['tok-1'] = [20, 30, 40]
  await pastNextRead(clock)
  // The first stop's resume answered, so this stop is an episode of its own (v4 s.2).
  await resumeAnswers($, clock)
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
  await resumeAnswers($, clock)
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
  await resumeAnswers($, clock)
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
  await resumeAnswers($, clock)
  // A plain stop with every Fable week spent is the 5-hour window's, not told as the Fable week.
  w.usage['tok-2'] = [100, 30, 100]
  await pastLastRead(clock)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: "You've hit your session limit" })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.notices.filter(t => /Fable week/.test(t))).toEqual([])
  await resumeAnswers($, clock, 'resumed-2')
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
  expect(await pane.find({ text: /^▰{2}▱{8} +20%$/ })).toBeDefined()
  expect(await pane.find({ text: /^▰{3}▱{7} +30%$/ })).toBeDefined()
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
  expect(w.toasts.filter(t => /: one@example.com has 0% of its week left\.$/.test(t))).toHaveLength(1)
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
  expect(w.toasts.filter(t => /^Switched to Claude account two@example.com.*: one@example.com has 0% of its week left\.$/.test(t))).toHaveLength(1)
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
  expect(await pane.find({ text: /^▰{8}▱{2} +80%$/ })).toBeDefined()
  await pane.press({ key: 'five-hour-limit-off' })
  await clock.settle()
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{8}▱{2} +80%$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▰{8}▱{2} +80%$/ })).toBeUndefined()
  await pane.press({ key: 'five-hour-limit-on' })
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{8}▱{2} +80%$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▰{8}▱{2} +80%$/ })).toBeUndefined()
  // Another session's press.
  store.set('five-hour-limit', 'on')
  await clock.advance(61_000)
  await clock.settle()
  await pane.redraw()
  expect(await pane.find({ text: /^▰{8}▱{2} +80%$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▰{5}▱{5} +50%$/ })).toBeDefined()
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
    return (await pane.find({ text: /^▰{8}▱{2} +80%$/ })) !== undefined
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
  expect(w.toasts.filter(t => /Switching to Claude account two@example.com/.test(t))).toHaveLength(1)
  // Claude Code refreshes the token: the next try goes through, once.
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 8 * HOUR)
  await clock.advance(3 * 60_000)
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /Switched to Claude account two@example.com/.test(t))).toHaveLength(1)
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
  expect(w.toasts.filter(t => /Switching to Claude account two@example.com/.test(t))).toHaveLength(1)
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
  // A failed usage read is marked as one (Review PROFILE-1): the rotation may still try the login, its sign-in named.
  expect(store.get('check-error:2')).toEqual({ why: 'the usage call answered HTTP 429', at: NOW + USAGE_CLAIM_WAIT_MS, isUsageRead: true })
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
  expect(await pane.find({ text: /^▰{1}▱{9} +10%$/ })).toBeDefined()
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
  expect(await pane.find({ text: /^▰{2}▱{8} +20%$/ })).toBeDefined()
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
  expect(await band.find({ text: /Claude account three@example.com needs a sign-in \(signed in as two@example.com now\)/ })).toBeDefined()
  await band.unmount()
  // The session moves off it, to the login the rotation picks: 2, with the most room.
  expect(w.envSets).toEqual([{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }])
  expect(w.toasts.filter(t => /^Switched to Claude account two@example.com: three@example.com needs a sign-in\.$/.test(t))).toHaveLength(1)
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
  expect(w.toasts.filter(t => /^The Claude account that was three@example.com is x@example.com now: a \/login in a session on it signs in there, not Claude Code's login\.$/.test(t))).toHaveLength(1)
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
  expect(store.get('launch-slot')).toMatchObject({ id: '2', why: 'one@example.com has no room, and it is the next with room' })
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
  expect(w.toasts.filter(t => /^Claude account one@example.com needs a sign-in \(signed in as two@example.com now\)/.test(t))).toHaveLength(1)
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

// puma-9arph.10: a hot reload empties the module's `kept` while the view survives it; boot copies the surviving view's
// Fable stop mark into `kept`, so a /clear after the reload gives it back.
/** A session whose view survived a reload as `surviving` (none: a fresh start), then a /clear: the view the rebind wrote. */
async function reloadThenClear($: Engine, on: On, surviving: Partial<View> | undefined): Promise<View | undefined> {
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

test('Review RELOAD-FABLE-LOSS: after a hot reload, then /clear, the Fable stop mark the surviving view held comes back', async ($, on) => {
  expect((await reloadThenClear($, on, { isFableStopped: true }))?.isFableStopped).toBe(true)
})

test('Review RELOAD-FABLE-LOSS other side: a surviving view whose Fable stop mark is false gives back false', async ($, on) => {
  expect((await reloadThenClear($, on, { isFableStopped: false }))?.isFableStopped).toBe(false)
})

test('Review RELOAD-FABLE-LOSS other side: a fresh start, with no view surviving, leaves the Fable stop mark unset after /clear', async ($, on) => {
  const after = await reloadThenClear($, on, undefined)
  expect([after?.isBound, after?.isFableStopped]).toEqual([true, undefined])
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
  const learned = /^Claude in Chrome connects as Claude account one@example\.com: your Chrome extension is signed in to it\.$/
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
  expect(w.toasts).toContain('Claude in Chrome is connected as Claude account two@example.com.')
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
    'No Chrome extension answers as Claude account two@example.com. Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome and try again. ' +
      'Claude in Chrome goes back to one@example.com.',
  )
  // Back on login 1, Claude in Chrome connects there again once the move lands.
  expect(slots(w)).toEqual([SLOT2, ''])
  await clock.advance(36_000)
  expect(w.commands).toEqual(['/mcp reconnect claude-in-chrome', '/mcp reconnect claude-in-chrome'])
  expect(w.chromeAsked).toEqual(['', SLOT2, ''])
  expect(w.toasts).toContain('Claude in Chrome is connected as Claude account one@example.com.')
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
    'No Chrome extension answers as Claude account two@example.com. Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome and try again. ' +
      'Claude in Chrome goes back to one@example.com.',
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
      text: '⚠ No Chrome extension answers as one@example.com. Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome.',
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

test('list_connected_browsers answering an empty list leaves Chrome unpaired and lists no account; once a browser answers, it is in use', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, [])
  await start($, world(on, w, store))
  expect((await browse($, 'list_connected_browsers')).context).toBeUndefined()
  expect(store.get('chrome-accounts') ?? []).toEqual([])
  w.chrome?.extensions.push('')
  await browse($, 'list_connected_browsers')
  expect(store.get('chrome-accounts')).toEqual(['1'])
  const pane = await mountPane($)
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  await pane.unmount()
})

test('an empty list of browsers, with the extension\'s account named and the window on another, starts no Connect: no move, no command, no prompt', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, [SLOT2])
  store.set('chrome-account', '2')
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(72_000)
  expect(slots(w)).toEqual([SLOT2, ''])
  // Chrome closes; the connection, made as login 2, stays.
  w.chrome = { extensions: [], as: SLOT2 }
  const before = { slots: slots(w), commands: [...w.commands], submitted: [...w.submitted] }
  expect((await browse($, 'list_connected_browsers')).context).toBeUndefined()
  await clock.advance(72_000)
  expect({ slots: slots(w), commands: w.commands, submitted: w.submitted }).toEqual(before)
  expect(store.get('chrome-accounts')).toEqual(['2'])
  const pane = await mountPane($)
  expect((await pane.find({ key: 'chrome-row-2' }))?.text).toMatch(/Use for Chrome$/)
  await pane.unmount()
})

test('only list_connected_browsers reads an empty list as no browser, and only a list it answered: another tool\'s "[]", a text that is no list, or an error reading "[]" leaves Chrome as before', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, [''])
  await start($, world(on, w, store))
  const answers = [['tabs_context_mcp', '[]', false], ['list_connected_browsers', 'Browsers: none listed', false], ['list_connected_browsers', '[]', true]] as const
  for (const [tool, text, isError] of answers) {
    w.chromeText = text
    w.isChromeError = isError
    await browse($, tool)
    const pane = await mountPane($)
    expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
    await pane.unmount()
  }
})

// Claude in Chrome answers list_connected_browsers with the list, then a note block naming the browser in use.
const NOTE = '1 browser is connected; "Browser 1" (deviceId device-1) is the one picked last and will be used.'

test('puma-9arph.17: a note block after the list of browsers still counts the list: Connect at open finds the browser, and the Chrome box lists its account in use', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, [''])
  w.chromeNote = NOTE
  await start($, world(on, w, store))
  expect(w.chromeAsked).toEqual([''])
  const pane = await mountPane($)
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  await pane.unmount()
})

test('puma-9arph.17: an empty list of browsers with a note block after it still leaves Chrome unpaired and lists no account', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, [])
  w.chromeNote = NOTE
  await start($, world(on, w, store))
  expect((await browse($, 'list_connected_browsers')).context).toBeUndefined()
  expect(store.get('chrome-accounts') ?? []).toEqual([])
})

test('as a session opens it visits the extension\'s account, which has room, to connect Claude in Chrome there, and comes back; browser calls wait meanwhile', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [40, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2', 'chrome-accounts': ['2'] })
  await start($, clock)
  expect(slots(w)).toEqual([SLOT2])
  // Not asked before Claude Code reads login 2's sign-in, which a call would connect as.
  expect(w.chromeAsked).toEqual([])
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: '◌ Connecting Chrome as two@example.com…' })).toBeDefined()
  await band.unmount()
  // The visit is no switch: login 2's line says so, not "in use".
  const visiting = await mountPane($)
  expect(await visiting.find({ type: 'Text', text: '◌ Connecting Chrome…' })).toBeDefined()
  expect(await visiting.find({ type: 'Text', text: '● in use' })).toBeUndefined()
  await visiting.unmount()
  const held = await $.tool.check({ tool: 'mcp__claude-in-chrome__navigate', input: { url: 'https://example.com' } })
  expect(held.decision).toBe('deny')
  expect(held.reason).toMatch(/^The account-rotator mod is connecting Claude in Chrome as Claude account two@example\.com.* End your turn now/)
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

test('as a session opens it leaves a spent extension account be; the first browser call that finds no browser connects there, comes back, and tells Claude to carry on', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  await spentTwo(w)
  const spent = { fiveHour: { pct: 100, resetsAt: '2026-10-12T12:00:00Z' }, at: NOW - 60_000, by: '2', v: 1, src: 'body' }
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2', 'chrome-accounts': ['2'], 'usage:2': spent })
  await start($, clock)
  await clock.advance(36_000)
  // A prompt sent now goes out as login 1, which has room: the window stays there.
  expect(slots(w)).toEqual([])
  expect(w.chromeAsked).toEqual([])
  // Claude in Chrome connects as login 1, which no extension answers: the mod visits login 2 now.
  const called = await browse($, 'navigate', { url: 'https://example.com' })
  expect(called.isError).toBe(true)
  expect(called.context?.[0]).toMatch(/^Claude in Chrome connected as Claude account one@example\.com and found no browser\. The account-rotator mod is now connecting it as Claude account two@example\.com/)
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  await clock.advance(36_000)
  expect(w.commands).toEqual(['/mcp reconnect claude-in-chrome'])
  expect(w.chromeAsked).toEqual([SLOT2])
  expect(slots(w)).toEqual([SLOT2, ''])
  await clock.advance(36_000)
  expect(w.submitted).toEqual(['Claude in Chrome is connected as Claude account two@example.com. Continue where you left off.'])
  expect((await browse($, 'navigate', { url: 'https://example.com' })).isError).toBeUndefined()
})

test('as a session opens it leaves be an extension account whose week is down to the Week setting, as the rotation counts it', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 85]
  const atLine = { fiveHour: { pct: 10, resetsAt: '2026-10-12T12:00:00Z' }, sevenDay: { pct: 85, resetsAt: '2026-10-18T03:00:00Z' }, at: NOW - 60_000, by: '2', v: 1, src: 'body' }
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2', 'chrome-accounts': ['2'], 'usage:2': atLine, 'week-leave': 20 })
  await start($, clock)
  await clock.advance(36_000)
  // 15% of its week left at a Week setting of 20: a prompt sent during a visit would leave it again at once.
  expect(slots(w)).toEqual([])
  expect(w.chromeAsked).toEqual([])
})

test('as a session opens it leaves be an extension account no browser answered as last time, while one did as another', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2', 'chrome-accounts': ['1'] })
  await start($, clock)
  await clock.advance(36_000)
  expect(slots(w)).toEqual([])
  expect(w.chromeAsked).toEqual([])
  // The extension answers as login 1, the one in use: the first browser call just works.
  expect((await browse($, 'tabs_context_mcp')).isError).toBeUndefined()
  await clock.settle()
  expect(slots(w)).toEqual([])
})

test('a turn that hits the usage limit while the session visits an extension account it didn\'t know was spent carries on once it is back', async ($, on) => {
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
    'Claude in Chrome connected as Claude account one@example.com and found no browser. ' +
      "The account-rotator mod is now reconnecting it as Claude account one@example.com, the account the user's Chrome extension is signed in to, which takes under a minute. " +
      "End your turn now: you'll get a message once it's connected. Don't suggest /login: it doesn't fix this.",
  )
  await clock.settle()
  expect(slots(w)).toEqual(['', SLOT2, ''])
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: '◌ Connecting Chrome as one@example.com…' })).toBeDefined()
  await band.unmount()
  await clock.advance(36_000)
  expect(w.commands).toEqual(['/mcp reconnect claude-in-chrome'])
  expect(w.chromeAsked).toEqual(['', ''])
  expect(w.toasts).toContain('Claude in Chrome is connected as Claude account one@example.com.')
  // Back on login 2, and Claude is told to carry on once that lands.
  expect(slots(w)).toEqual(['', SLOT2, '', SLOT2])
  expect(w.submitted).toEqual([])
  await clock.advance(36_000)
  expect(w.submitted).toEqual(['Claude in Chrome is connected as Claude account one@example.com. Continue where you left off.'])
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
  expect(called.context?.[0]).toMatch(
    /Tell the user that to use Chrome, they quit Claude Code \(in a background session, with \/stop: \/exit only detaches\) and run `claude --resume session-1` in a terminal/,
  )
  const band = await mountBand($)
  expect(
    await band.find({
      type: 'Text',
      text: "⚠ This window can't switch to one@example.com. Quit (in a background session, /stop: /exit only detaches), then run: claude --resume session-1",
    }),
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
    await pane.find({
      type: 'Text',
      text: "⚠ This window can't switch accounts, so Chrome can't move to another one here. Quit (in a background session, /stop: /exit only detaches), then run: claude --resume session-1",
    }),
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
  expect(called.context?.[0]).toMatch(/^Claude in Chrome connected as Claude account two@example\.com and found no browser\. .* Ask the user to press Use for Chrome or Try to connect next to it under Chrome in the Claude accounts panel/)
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
  expect(w.submitted).toEqual(['Claude in Chrome is connected as Claude account one@example.com. Continue where you left off.'])
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
    /^No Chrome extension answers as Claude account one@example\.com.*Ask the user to open Chrome and check the email its Claude extension is signed in with\..*press Connect above the prompt/,
  )
  await clock.settle()
  expect(slots(w)).toEqual(['', SLOT2])
  const band = await mountBand($)
  const noBrowser = '⚠ No Chrome extension answers as one@example.com. Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome.'
  expect(await band.find({ type: 'Text', text: noBrowser })).toBeDefined()
  await band.press({ key: 'chrome-connect-band' })
  await clock.settle()
  await band.unmount()
  await clock.advance(36_000)
  expect(w.commands).toEqual(['/mcp reconnect claude-in-chrome'])
  expect(w.toasts).toContain('No Chrome extension answers as Claude account one@example.com. Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome.')
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

// ---------------------------------------------------------------- puma-9arph.18: a Use now press that does not move says why on its row

test('puma-9arph.18: Use now held back for a token about to refresh says so on the pressed row while it waits, and moves when the refresh lands', async ($, on) => {
  const w = fresh()
  const clock = await guarded(on, w, {}, [20, 30])
  await start($, clock)
  const pane = await mountPane($)
  await pane.press({ key: 'use-2' })
  await clock.settle()
  expect(slots(w)).toEqual([])
  expect((await pane.find({ key: 'held-2' }))?.text).toBe("switching here once one@example.com's token has refreshed, at the next request on it")
  refresh(w)
  await clock.advance(60_000)
  expect(slots(w)).toEqual([SLOT2])
  expect(w.toasts.filter(t => /^Switched to Claude account two@example.com: you picked it\.$/.test(t))).toHaveLength(1)
  await pane.redraw()
  expect(await pane.find({ key: 'held-2' })).toBeUndefined()
  await pane.unmount()
})

test('puma-9arph.18: Use now during Connect\'s visit moves nothing and says why', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [SLOT2] }
  await spentTwo(w)
  const clock = world(on, w, { ...TWO_LOGINS, 'chrome-account': '2' })
  await start($, clock)
  expect(slots(w)).toEqual([SLOT2])
  const pane = await mountPane($)
  await pane.press({ key: 'use-1' })
  await clock.settle()
  expect(slots(w)).toEqual([SLOT2])
  expect(w.toasts.filter(t => /^Claude in Chrome is connecting, which moves this session and back/.test(t))).toHaveLength(1)
  await pane.unmount()
})

// ---------------------------------------------------------------- a switch held back, a stay told, a carry-on that is still current

/** Claude Code's own way out of the Fable limit, which every notice of a stay ends on. */
const WAY_OUT = 'Run /usage-credits to continue or switch models with /model.'

/**
 * Login 1's token runs out in 7 minutes, inside the refresh guard: a switch off it waits for the refresh, which these
 * tests bring before the refresh nudge's NUDGE_LEAD_MS would (puma-9arph.57).
 */
async function guarded(on: On, w: World, store: Record<string, unknown>, atStop: [number, number, number?]): Promise<MockClock> {
  w.keychain['Claude Code-credentials'] = blob('tok-1', NOW + 7 * 60_000)
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
  test(`${stop.error === 'rate_limit' ? `a plain usage-limit stop ("${stop.last_assistant_message}")` : 'a rejected sign-in'} held back for a token about to refresh moves when the refresh lands and carries on once, with the mod's own line (puma-9arph.34 B1)`, async ($, on) => {
    const w = fresh()
    const clock = await guarded(on, w, {}, [100, 41])
    await start($, clock)
    await $.classic.StopFailure(stop)
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
    expect(w.submitted[0]).toMatch(/Continue where you left off/)
    expect(w.asUser).toEqual([false])
    await clock.advance(5 * 60_000)
    expect(w.submitted).toHaveLength(1)
  })
}

/**
 * Review RT1 (HELD-INTENT-SPLIT). The switch held back is one intent: where it
 * goes and what it carries on with. A later stop replaces both; a tick, which
 * is no stop, leaves a held Fable recovery as it is.
 */
for (const stop of NOT_FABLE_STOPS) {
  test(`${stop.error === 'rate_limit' ? `a plain usage-limit stop ("${stop.last_assistant_message}")` : 'a rejected sign-in'} after a Fable stop held back for a token about to refresh takes its place: the switch lands, and the carry-on is the mod's own line, never the Fable one (puma-9arph.34 B1)`, async ($, on) => {
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
    expect(w.submitted).toHaveLength(1)
    expect(w.submitted[0]).toMatch(/Continue where you left off/)
    expect(w.asUser).toEqual([false])
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
}

const STAY_CASES: StayCase[] = [
  { name: 'the other login has its 5-hour window full', notice: /^Fable limit reached on one@example\.com, and no other Claude account can take over/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [95, 30, 10] } },
  { name: 'the other login has its week full', notice: /^Fable limit reached on one@example\.com, and no other Claude account can take over/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [10, 100, 10] } },
  { name: 'the rotation is off', notice: /^Fable limit reached on one@example\.com, and usage based rotation is disabled/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [10, 30, 10] }, store: { 'rotate-to': 'off' } },
  { name: 'Claude Code\'s policy refuses switching', notice: /^Fable limit reached on one@example\.com, and Claude Code's policy stops this session from switching accounts/, usage: { 'tok-1': [20, 30, 100], 'tok-2': [10, 30, 10] }, isBlocked: true },
]

for (const { name, notice, usage, store = {}, isBlocked = false } of STAY_CASES) {
  test(`when ${name}, a Fable stop that cannot move tells the terminal why and the way out, once however many stops follow`, async ($, on) => {
    const w = fresh()
    w.refuseEnv = isBlocked
    w.keychain['Claude Code-credentials'] = blob('tok-1')
    w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
    Object.assign(w.usage, usage)
    const clock = world(on, w, { ...TWO_LOGINS, ...store })
    await start($, clock)
    for (let i = 0; i < 3; i++) {
      await $.classic.StopFailure(FABLE_STOP)
      await clock.settle()
      await clock.advance(36_000)
      expect(w.notices.filter(t => /Fable/.test(t))).toHaveLength(1)
    }
    const told = w.notices.filter(t => /Fable/.test(t))[0] ?? ''
    expect(told).toMatch(notice)
    expect(told.endsWith(WAY_OUT)).toBe(true)
    expect(w.envSets).toEqual([])
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

// Claude Code 2.1.325 and later says "hit your Fable limit": the stop is read as the Fable week, not as a plain stop
// that marks the whole week spent.
test('a Fable stop worded "hit your Fable limit" stores the Fable mark, and no week mark and no 5-hour mark', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.failing = { 'tok-1': 429 }
  const store = new Map<string, unknown>(Object.entries({ accounts: [TWO_LOGINS.accounts[0]], 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  await $.classic.StopFailure(FABLE_HIT_STOP)
  await clock.settle()
  expect(markOf(store.get('fable-mark:1'))[0]).toBe(100)
  expect(store.get('usage:1')).toBeUndefined()
  expect(store.get('week-mark:1')).toBeUndefined()
  expect(store.get('mark:1')).toBeUndefined()
})

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
  expect(await pane.find({ text: /^▰▱{9} +11%$/ })).toBeUndefined()
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

test('a claimed read of a login whose token has run out releases its claim, and its row says it is idle', async ($, on) => {
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
  expect(lineOne(store, '2')).toMatch(/  updated \d\d:\d\d · idle$/)
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
    if (key === 'health:2' && w.afterStoreSet !== undefined) {
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
  // Login 2 was used outside this store meanwhile; login 1's response crosses the leave line (the session is red: `start` fails it).
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
    // A stop whose view or switch changed during its own read is stale: it writes no mark at all (round 4), so there is
    // nothing for the next press to give back, and the login stays unmarked throughout.
    expect([isPressed, store.get('mark:2') !== undefined]).toEqual([true, false])
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

// Restored: the press that ends an unproven switch (Use now on login 1), with a Fable stop after it. The proven Fable stop
// can no longer come first (it points the session back to login 1 itself), so the press comes before it.
test('Use now on login 1 ends an unproven switch, gives back its provisional mark, and a proven Fable stop after it stands', async ($, on) => {
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.', undefined, { 'tok-1': [10, 40, 21], 'tok-2': [10, 41] })
  expect(store.get('mark:2'), 'the provisional mark on login 2').toBeDefined()
  w.limits = ONES_WEEK
  await respond($, clock, w)
  await useNow($, clock, '1')
  expect(store.get('mark:2'), 'the press gave the provisional mark back').toBeUndefined()
  // A response carrying login 1's week proves the press's switch, then a Fable stop on it.
  await clock.advance(SETTLE_WAIT)
  await respond($, clock, w)
  await $.classic.StopFailure(FABLE_STOP)
  await clock.settle()
  expect(store.get('fable-mark:1'), "the proven Fable stop's mark stands once the provisional one is gone").toBeDefined()
  expect(store.get('mark:2')).toBeUndefined()
})

// Review opus-e17 F2 [END-IS-NOT-EXIT]: an end the process outlives (a /clear, a resume) leaves the switch, and its stop,
// unsettled, through the reset of $.state that follows the end.
for (const reason of ['clear', 'resume'] as const) {
  for (const [kind, said, key] of UNPROVEN_STOPS) {
    test(`a session end for ${reason}, which the process outlives, keeps a ${kind} stop's ${key} for the proof that follows`, async ($, on) => {
      const s = clearable(on)
      on('classic.SessionStart', () => ({}))
      const { w, store, clock } = await stopDuringSwitch($, on, 40_000, said)
      await clearSession($, clock, s.clear, reason)
      w.limits = [{ kind: 'seven_day', percentUsed: 41, resetsAt: OTHER_WEEK }]
      await respond($, clock, w)
      expect([reason, kind, store.get(key) !== undefined]).toEqual([reason, kind, true])
    })
  }
}

// puma-9arph.3: /clear, /resume and /branch reset every $.state value to its default, and session.start does not fire
// again; classic.SessionStart fires after each, with source clear, resume or fork. The kit never resets $.state, so
// `clearable` does: after `clear()` a read of the view finds the default until the mod writes the view again, and
// `view()` is what such a read finds, and `writes()` every view written.
function clearable(on: On): { clear: () => void; view: () => View | undefined; writes: () => View[] } {
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
    expect(w.toasts.filter(t => /^Switched to Claude account one@example.com\b/.test(t))).toHaveLength(1)
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

// puma-9arph.9: the Chrome link state the view alone held (hasChrome, chrome, chromeConnecting) after /clear.
/** Both logins signed in with room, the Chrome extension named as login 1's, the session on login 1. */
async function chromeWorld(w: World, extensions?: string[]): Promise<Map<string, unknown>> {
  if (extensions !== undefined) w.chrome = { extensions }
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 40]
  w.usage['tok-2'] = [10, 30]
  return new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'chrome-account': '1' }))
}

test('puma-9arph.9 hasChrome: after /clear a session without Claude in Chrome still says Chrome is not available here', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w)
  const s = clearable(on)
  const clock = world(on, w, store)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  expect(s.view()?.hasChrome, 'Connect at open found no Claude in Chrome').toBe(false)
  await clearSession($, clock, s.clear)
  const pane = await mountPane($)
  const shown = await pane.find({ type: 'Text', text: 'Not available in this window.' })
  expect(['hasChrome, the pane after /clear', s.view()?.hasChrome, shown !== undefined]).toEqual(['hasChrome, the pane after /clear', false, true])
  await pane.unmount()
})

test('puma-9arph.9 chrome: after /clear a session paired at open still shows Chrome in use on login 1', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, [''])
  const s = clearable(on)
  const clock = world(on, w, store)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const before = [s.view()?.hasChrome, s.view()?.chrome]
  expect(before).toEqual([true, { as: '1', isPaired: true }])
  await clearSession($, clock, s.clear)
  expect(['hasChrome and chrome after /clear', s.view()?.hasChrome, s.view()?.chrome]).toEqual(['hasChrome and chrome after /clear', ...before])
  const pane = await mountPane($)
  expect((await pane.find({ key: 'chrome-row-1' }))?.text).toMatch(/● in use$/)
  expect(await pane.find({ key: 'chrome-use-1' })).toBeUndefined()
  await pane.unmount()
})

// The connection made before /clear is login 1's: a Try to connect as login 2 must reconnect, or login 1's browser answers.
test('puma-9arph.9 chrome: after /clear Try to connect reconnects Claude in Chrome, so no other login\'s browser answers for it', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, [''])
  const s = clearable(on)
  const clock = world(on, w, store)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  await clearSession($, clock, s.clear)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'chrome-try-2' })
  await clock.settle()
  await clock.advance(36_000)
  expect(['the first reconnect, the extension\'s account', w.commands.slice(0, 1), store.get('chrome-account')]).toEqual([
    'the first reconnect, the extension\'s account',
    ['/mcp reconnect claude-in-chrome'],
    '1',
  ])
  await pane.unmount()
})

test('puma-9arph.9 chromeConnecting: a /clear during Connect keeps the connecting line until Connect ends', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, [''])
  const s = clearable(on)
  const clock = world(on, w, store)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'chrome-try-2' })
  await clock.settle()
  expect(s.view()?.chromeConnecting, 'Connect waits for its move to login 2 to land').toBe('2')
  s.clear()
  await $.classic.SessionStart({ source: 'clear' })
  const during = s.view()?.chromeConnecting
  // No browser answers as login 2: Connect goes back to login 1, a second move and settle.
  await clock.advance(36_000)
  await clock.advance(36_000)
  expect(['chromeConnecting during Connect, after it', during, s.view()?.chromeConnecting]).toEqual(['chromeConnecting during Connect, after it', '2', undefined])
  await pane.unmount()
})

// The other side: what a Connect writes between the reset and the rebind is newer than `kept`, and a Connect that has
// ended leaves no connecting line behind.
test('puma-9arph.9 a Connect that ends between the reset and classic.SessionStart keeps its own link and leaves no connecting line', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, ['', SLOT2])
  const s = clearable(on)
  const clock = world(on, w, store)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'chrome-try-2' })
  await clock.settle()
  s.clear()
  await clock.advance(36_000)
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(['chrome, chromeConnecting after /clear', s.view()?.chrome, s.view()?.chromeConnecting]).toEqual([
    'chrome, chromeConnecting after /clear',
    { as: '2', isPaired: true },
    undefined,
  ])
  await pane.unmount()
})

// Codex round 1 on #73: noteChrome writes hasChrome in the same window, and that newer answer stands too.
test('puma-9arph.9 a Connect that finds Claude in Chrome gone between the reset and classic.SessionStart leaves hasChrome false', async ($, on) => {
  const w = fresh()
  const store = await chromeWorld(w, ['', SLOT2])
  const s = clearable(on)
  const clock = world(on, w, store)
  on('classic.SessionStart', () => ({}))
  await start($, clock)
  expect(s.view()?.hasChrome).toBe(true)
  const pane = await mountPane($)
  await pane.press({ key: 'chrome-others' })
  await clock.settle()
  await pane.redraw()
  await pane.press({ key: 'chrome-try-2' })
  await clock.settle()
  s.clear()
  delete w.chrome
  await clock.advance(36_000)
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(['hasChrome after /clear, Claude in Chrome gone', s.view()?.hasChrome]).toEqual(['hasChrome after /clear, Claude in Chrome gone', false])
  await pane.unmount()
})

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

// The other side of the heal: a boot that failed before it read the slot has nothing to bind, so the ticks bind and
// move nothing.
test('Review BOOT-GATE-STARVES other side: a boot that failed before it read the slot binds no view and switches no login', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [100, 100]
  w.usage['tok-2'] = [10, 20]
  let isFailing = true
  let isBoundSeen = false
  on('state.set', async (_$, e, next) => {
    const { key, value } = e as unknown as { key: string; value: View }
    if (key === 'view' && isFailing) return { deny: 'the view cannot be written' }
    if (key === 'view' && value.isBound === true) isBoundSeen = true
    return next(e)
  })
  const clock = world(on, w, TWO_LOGINS)
  await start($, clock)
  expect(w.logged?.some(line => line.includes('start failed'))).toBe(true)
  isFailing = false
  await clock.advance(10 * 60_000)
  await clock.settle()
  expect(['bound, switches', isBoundSeen, w.envSets]).toEqual(['bound, switches', false, []])
})

// puma-9arph.11: after a boot whose first bind failed, a response and the Bash watch go by whether the view is bound,
// as the ticks do, not by a boot that will not finish. A minute passes first: its checks read each login, as a session's
// first minute does (login 1's week at 40%, which lets a response's week be told as login 1's), and at origin/main the
// boot gate stays shut through it.
const LOGIN1_WEEK = { ...TWO_LOGINS, 'rotate-to': 'off', 'store-id': 'store-test' }
const weekPct = (store: Map<string, unknown>) => (store.get('usage:1') as { sevenDay?: { pct?: number } } | undefined)?.sevenDay?.pct
const respondWeek = async ($: Engine, w: World, clock: MockClock, pct: number) => {
  w.limits = [{ kind: 'five_hour', percentUsed: 10, resetsAt: '2026-10-12T12:00:00Z' }, { kind: 'seven_day', percentUsed: pct, resetsAt: WEEK_RESET }]
  await $.session.measure({ context: { window: 200_000 }, rateLimits: w.limits, changed: ['rateLimits'] })
  await clock.settle()
}

test('Review BOOT-GATE-STARVES response: after a boot whose first bind failed once, the next response\'s reading is stored', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [10, 40]
  const store = storeFailingFirstAccountsRead(LOGIN1_WEEK)
  const clock = world(on, w, store)
  await start($, clock)
  expect(w.logged?.some(line => line.includes('start failed'))).toBe(true)
  await untilTick(clock)
  await respondWeek($, w, clock, 45)
  expect(weekPct(store), 'the response after a failed first bind was not stored').toBe(45)
})

test('Review BOOT-GATE-STARVES Bash watch: after a boot whose first bind failed once, a use request is applied within a beat', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 20]
  const clock = world(on, w, storeFailingFirstAccountsRead(LOGIN1_WEEK))
  await start($, clock)
  expect(w.logged?.some(line => line.includes('start failed'))).toBe(true)
  await untilTick(clock)
  const call = bashCall($, w, USE_COMMAND)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', 'store-test', clock.now(), ownMark(w))
  await beat(clock)
  expect([resultOf(w, N1)?.ok, w.envSets]).toEqual([true, [{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }]])
  await call.finish()
})

test('Review BOOT-GATE-STARVES other side, response and Bash watch: a boot that failed before it read the slot stores and applies nothing', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 20]
  let isFailing = true
  on('state.set', async (_$, e, next) => {
    const { key } = e as unknown as { key: string }
    if (key === 'view' && isFailing) return { deny: 'the view cannot be written' }
    return next(e)
  })
  const store = new Map<string, unknown>(Object.entries(LOGIN1_WEEK))
  const clock = world(on, w, store)
  await start($, clock)
  expect(w.logged?.some(line => line.includes('start failed'))).toBe(true)
  isFailing = false
  await untilTick(clock)
  await respondWeek($, w, clock, 45)
  const call = bashCall($, w, USE_COMMAND)
  w.files[`${REQUESTS}/${N1}.json`] = useRequest(N1, '2', 'store-test', clock.now(), ownMark(w))
  await beat(clock)
  expect([weekPct(store) === 45, resultOf(w, N1), w.envSets]).toEqual([false, undefined, []])
  await call.finish()
})

// Review R1 F1 (Codex, #72 round 1) [READING-WRONG-LOGIN]: a response in the window between a reset and
// classic.SessionStart binds the view first, which gives back a switch in flight; the switch settles on that response,
// so its reading is never stored under the target while the switch is unproven.
async function responseInResetWindow($: Engine, on: On, source: 'clear' | 'resume' | 'fork') {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.failing = { 'tok-1': 429 }
  w.usage['tok-2'] = [10, 20]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  const s = clearable(on)
  on('classic.SessionStart', () => ({}))
  const clock = world(on, w, store)
  await start($, clock)
  await useNow($, clock, '2')
  if (source !== 'fork') await endSession($, clock, source)
  s.clear()
  await clock.advance(40_000)
  await respondWeek($, w, clock, 45)
  return { store, view: s.view() }
}

test('Review R1 F1 instance: a response before the /clear rebind cannot store an unproven target reading', async ($, on) => {
  const { store } = await responseInResetWindow($, on, 'clear')
  expect(storedOf(store, '2')?.sevenDay?.pct, 'the clear window stored an unproven target response under login 2').not.toBe(45)
})

// The class: each reset source, in a world of its own, since the first response settles the switch.
for (const source of ['clear', 'resume', 'fork'] as const) {
  test(`Review R1 F1 class: a response before the ${source} rebind cannot store an unproven target reading`, async ($, on) => {
    const { store } = await responseInResetWindow($, on, source)
    expect(storedOf(store, '2')?.sevenDay?.pct, `the ${source} window stored an unproven target response under login 2`).not.toBe(45)
  })
}

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
  expect(w.toasts.some(t => /^Switched to Claude account one@example.com/.test(t))).toBe(true)
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

// puma-9arph.8, Review F2 [MISSING-RESTORE]: the records of a switch in flight (pending, provisionalStop, held) live in
// the view, which /clear, /resume and /branch reset. A switch still in flight keeps them; a finished one stays finished.
const IN_FLIGHT = ['pending', 'provisionalStop', 'held'] as const

/** One /clear, with each in-flight record the reset did not give back as it stood before, named by `step`. */
async function lostAtClear($: Engine, clock: MockClock, s: ReturnType<typeof clearable>, step: string): Promise<string[]> {
  const before = s.view() ?? EMPTY_VIEW
  await clearSession($, clock, s.clear)
  const after = s.view() ?? EMPTY_VIEW
  return IN_FLIGHT.filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])).map(k => `${step}: ${k} ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`)
}

/** Login 1 in use and login 2 signed in, each with its own week, rotation off: a switch is the person's alone. */
async function twoWeeks(on: On): Promise<{ w: World; store: Map<string, unknown>; clock: MockClock }> {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [10, 40]
  w.usage['tok-2'] = [10, 41]
  w.weekResets = { 'tok-2': OTHER_WEEK }
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, 'rotate-to': 'off' }))
  return { w, store, clock: world(on, w, store) }
}

test('Review F2 instance: a /clear between a provisional stop and the did-not-take settle still leaves login 2 unmarked', async ($, on) => {
  const s = clearable(on)
  on('classic.SessionStart', () => ({}))
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  await clearSession($, clock, s.clear)
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(4 * 60_000 + 10_000)
  await respond($, clock, w)
  expect(['mark:2 after /clear and the did-not-take settle', store.get('mark:2')]).toEqual(['mark:2 after /clear and the did-not-take settle', undefined])
})

for (const source of ['clear', 'resume', 'fork'] as const) {
  for (const [kind, said] of UNPROVEN_STOPS) {
    test(`Review F2 class: a ${kind} stop on an unproven switch, then ${source}: every in-flight record in the view outlives the reset`, async ($, on) => {
      const s = clearable(on)
      on('classic.SessionStart', () => ({}))
      const { clock } = await stopDuringSwitch($, on, 40_000, said)
      const before = s.view() ?? EMPTY_VIEW
      const recorded = IN_FLIGHT.filter(k => before[k] !== undefined)
      expect(recorded.length).toBeGreaterThan(0)
      await clearSession($, clock, s.clear, source)
      const after = s.view() ?? EMPTY_VIEW
      const lost = recorded.filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k]))
      expect([kind, source, 'in-flight records lost', lost]).toEqual([kind, source, 'in-flight records lost', []])
    })
  }
}

// Every write of a switch's records, set and cleared, reaches what the reset gives back: a /clear after each step.
test('Review F2 sweep, a switch that does not take: a /clear after each step finds the records as that step left them', async ($, on) => {
  const s = clearable(on)
  on('classic.SessionStart', () => ({}))
  const { w, store, clock } = await twoWeeks(on)
  await start($, clock)
  await useNow($, clock, '2')
  const lost = await lostAtClear($, clock, s, 'after Use now')
  await clock.advance(40_000)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  lost.push(...(await lostAtClear($, clock, s, 'after the stop')))
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(4 * 60_000 + 10_000)
  await respond($, clock, w)
  lost.push(...(await lostAtClear($, clock, s, 'after the did-not-take settle')))
  await clock.advance(5 * 60_000)
  await respond($, clock, w)
  const outcome = [store.get('mark:2'), s.view()?.activeId, w.toasts.filter(t => /did not take/.test(t)).length]
  expect([lost, outcome]).toEqual([[], [undefined, '1', 1]])
})

test('Review F2 sweep, a switch a response proves: a /clear after each step finds the records as that step left them', async ($, on) => {
  const s = clearable(on)
  on('classic.SessionStart', () => ({}))
  const { w, store, clock } = await twoWeeks(on)
  await start($, clock)
  await useNow($, clock, '2')
  const lost = await lostAtClear($, clock, s, 'after Use now')
  await clock.advance(40_000)
  await $.classic.StopFailure({ error: 'rate_limit', last_assistant_message: 'Claude usage limit reached.' })
  await clock.settle()
  lost.push(...(await lostAtClear($, clock, s, 'after the stop')))
  w.limits = [{ kind: 'seven_day', percentUsed: 41, resetsAt: OTHER_WEEK }]
  await respond($, clock, w)
  lost.push(...(await lostAtClear($, clock, s, 'after the proof')))
  // The proof kept the stop's mark: no later end reverts it.
  await endSession($, clock)
  expect([lost, store.get('mark:2') !== undefined]).toEqual([[], true])
})

test('Review F2 held: a switch held back for a token refresh is made after /clear once the refresh lands, and only once', async ($, on) => {
  const w = fresh()
  const s = clearable(on)
  on('classic.SessionStart', () => ({}))
  const clock = await guarded(on, w, {}, [20, 30])
  await start($, clock)
  // Between two ticks, so a wait of the switch's own would come due after the next one.
  await clock.set(NOW + 70_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  await pane.press({ key: 'rotate' })
  await clock.settle()
  await pane.unmount()
  const isHeld = s.view()?.held?.target.id === '2'
  const lost = await lostAtClear($, clock, s, 'held')
  refresh(w)
  await clock.set(NOW + 121_000)
  const landed = [s.view()?.held, w.envSets]
  lost.push(...(await lostAtClear($, clock, s, 'landed')))
  await clock.advance(3 * 60_000)
  const switches = w.envSets.filter(set => set.name === 'CLAUDE_SECURESTORAGE_CONFIG_DIR').length
  expect([isHeld, lost, landed, switches]).toEqual([true, [], [undefined, [{ name: 'CLAUDE_SECURESTORAGE_CONFIG_DIR', value: SLOT2 }]], 1])
})

// The copy is made from a bound view only: the reset's default, written before the hook rebinds, is no switch's end.
test('Review F2 gap: a write onto the reset view before the hook runs leaves the switch in flight for the hook to give back', async ($, on) => {
  const s = clearable(on)
  on('classic.SessionStart', () => ({}))
  const { w, store, clock } = await stopDuringSwitch($, on, 40_000, 'Claude usage limit reached.')
  const before = s.view() ?? EMPTY_VIEW
  await endSession($, clock, 'clear')
  s.clear()
  const at = s.writes().length
  // A minute's tick lands in the gap: its first write builds on the reset view.
  await clock.advance(60_000)
  await clock.settle()
  const unbound = s.writes().slice(at).filter(v => v.isBound !== true).length
  await $.classic.SessionStart({ source: 'clear' } as never)
  await clock.settle()
  const after = s.view() ?? EMPTY_VIEW
  const lost = IN_FLIGHT.filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k]))
  w.limits = [{ kind: 'seven_day', percentUsed: 42, resetsAt: WEEK_RESET }]
  await clock.advance(3 * 60_000 + 10_000)
  await respond($, clock, w)
  expect([unbound > 0, lost, store.get('mark:2')]).toEqual([true, [], undefined])
})

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
  expect(await paneText($)).toMatch(/^▰{3}▱{7} +30%$/m)
  w.failing = { 'tok-9': 503 }
  await $.command.run(LOGIN)
  await clock.settle()
  await clock.advance(61_000)
  const text = await paneText($)
  expect([/^▰{3}▱{7} +30%$/m.test(text), await aboutOf($, 'nine@example.com')]).toEqual([false, 'Org · Max'])
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
  return texts.flatMap((t, i) => (t === ' Fable ' ? [texts[i + 1] ?? ''] : t.trimEnd() === ' Fable –' ? ['–'] : []))
}

test('a reading with Fable 66% draws a Fable row under the week with its bar at 66%', async ($, on) => {
  const w = planWorld(blob('tok-1'), [10, 30, 66])
  const clock = world(on, w, { ...TWO_LOGINS, 'rotate-to': 'off', footer: { ...DEFAULT_FOOTER, fill: 'used' } })
  await start($, clock)
  expect(await fableRows($)).toEqual([`${longBar(66)}  66%`])
  const text = await paneText($)
  expect(text.indexOf(' Fable ')).toBeGreaterThan(text.indexOf('Used '))
})

const FABLE_ROW_CASES: [string, () => World, string[]][] = [
  ['Max whose usage lists no Fable week', () => planWorld(blob('tok-1'), [10, 30]), ['–']],
  ['Ultra whose usage lists no Fable week', () => planWorld(blob('tok-1'), [null, 30]), ['–']],
  ['Max with its Fable week at 66%', () => planWorld(blob('tok-1'), [10, 30, 66]), [`${longBar(66)}  66%`]],
  ['Pro whose usage lists no Fable week', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'pro'), [10, 30]), []],
  ['Team whose usage lists no Fable week', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'team'), [10, 30]), []],
  ['Enterprise whose usage lists no Fable week', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'enterprise'), [10, 30]), []],
  ['a plan word the mod does not know, with no Fable week', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'galaxy'), [10, 30]), []],
  ['Pro whose usage lists a Fable week at 50%', () => planWorld(blob('tok-1', NOW + 6 * HOUR, 'pro'), [10, 30, 50]), [`${longBar(50)}  50%`]],
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
  expect(await fableRows($)).toEqual(['–', `${longBar(50)}  50%`])
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
  expect(await fableRows($)).toEqual([`${longBar(10)}  10%`, `${longBar(100)} 100%`])
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
  expect(rowsText(store, clock.now())?.[0]?.lines[1]).toBe('Used ▰▰▰▱▱▱▱▱▱▱  30% Fable ▰▰▰▰▱▱▱▱▱▱  40%  resets 5d 16h 59m · Fable 4d 16h 59m')
  expect(clock.now()).toBeLessThan(NOW + 2 * 60_000)
})

// puma-9arph.28 item 5, RULING 5918: the store is JSON another session wrote; loadAccounts keeps an email only where it is a string.
test('an email stored as null or as a number is no email once loaded: its row names no stored value', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [null, 30, 40]
  const accounts = [TWO_LOGINS.accounts[0], { id: '2', slot: SLOT2, email: null }, { id: '3', slot: SLOT3, email: 7 }]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, accounts, 'rotate-to': 'off' }))
  const clock = world(on, w, store)
  await start($, clock)
  await clock.advance(61_000)
  expect([lineOne(store, '2'), lineOne(store, '3')].map(line => /^not signed in yet/.test(line ?? ''))).toEqual([true, true])
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

// The launch pick passes over a login with a failure and no reading (isUnread), and the rotation takes one only
// after every read login with room. A stop's forced read stored no failure for a usage call that threw, so it
// must not now: the pick stays as it was.
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

test('a login with a failed read and no reading, whose token has since run out, says it is idle, not a next try nothing will take', async ($, on) => {
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
  expect(lineOne(store, '2')).toMatch(/  idle$/)
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

test('at 82 columns the pane draws each account\'s two row lines as the rows key holds them, the buttons on a line of their own', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const lines = await drawnLines($, 82)
  const stored = rowsText(store, clock.now()) ?? []
  // The seed: both accounts have stored rows.
  expect(stored.map(r => r.id)).toEqual(['1', '2'])
  for (const r of stored) {
    expect([r.id, [lines[`line-${r.id}-0`]?.text, lines[`line-${r.id}-1`]?.text]]).toEqual([r.id, r.lines])
  }
  // Login 2, not in use, holds Remove and Use now on a line of their own after line 2 (puma-9arph.33).
  expect([lines['line-2-0']?.buttons, lines['line-2-1']?.buttons, lines['line-2-2']?.buttons]).toEqual([[], [], ['ask-remove-2', 'use-2']])
  expect(Object.keys(lines).filter(k => k.startsWith('line-2-'))).toEqual(['line-2-0', 'line-2-1', 'line-2-2'])
})

test('a pane too narrow for any row line and its buttons gives the buttons a line of their own after line 2', async ($, on) => {
  const { store, clock } = await rowsWorld($, on)
  const lines = await drawnLines($, 50)
  expect([lines['line-2-0']?.buttons, lines['line-2-1']?.buttons, lines['line-2-2']?.text]).toEqual([[], [], ''])
  expect(lines['line-2-2']?.buttons).toContain('ask-remove-2')
  expect(lines['line-2-1']?.text).toBe(rowsText(store, clock.now())?.find(r => r.id === '2')?.lines[1])
})

// puma-9arph.33: the buttons' place no longer follows the pane's width (puma-eslxj.10's rule moved them to line 1 where
// it fit): a pane wide enough for line 1 and its buttons still draws them on a line of their own.
test('login 2\'s buttons stand on a line of their own however wide the pane', async ($, on) => {
  const { store } = await rowsWorld($, on)
  for (const width of [[...lineOne(store, '2')].length + 2 + 23 + 4, 120]) {
    const lines = await drawnLines($, width)
    expect([width, lines['line-2-0']?.buttons, lines['line-2-2']?.buttons]).toEqual([width, [], ['ask-remove-2', 'use-2']])
  }
})

// Mutation V4 survived: the pane asks for the operator's 82-cell row and the accounts box's frame around it.
test('the pane asks the dock for the operator\'s 82-cell row and the 4 cells of the accounts box\'s frame', () => {
  expect(PANE_COLUMNS).toBe(82 + 4)
})

// The operator's order of 2026-11-14 20:17Z: "Remove colors from the percent bars showing usage".
test('a row\'s bars are drawn with no color: login 1\'s week, 30% used, plain', async ($, on) => {
  await rowsWorld($, on)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: { ...PANE_PROPS, bodyColumns: 86 } })
  const styles: unknown[] = []
  const walk = (n: unknown): void => {
    if (typeof n !== 'object' || n === null) return
    const { type, props, children } = n as DrawnNode
    if (type === 'Text' && /^▰{3}▱{7} +30%$/.test(shownText(n))) styles.push({ color: props?.color, backgroundColor: props?.backgroundColor })
    ;(children ?? []).forEach(walk)
  }
  walk(await pane.drawn())
  await pane.unmount()
  expect(styles).toEqual([{ color: undefined, backgroundColor: undefined }])
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

// Review C9-R1 FAILED-BAR-LOSES-COLOR (Codex) [FAILED-BAR-LOSES-COLOR] (RULING 4555), then the operator's order of
// 2026-11-14 20:17Z: a failed row's bars are drawn dim, with no color.
test('a failed row\'s bars are drawn dim, with no color', async ($, on) => {
  const { w, store, clock } = await rowsWorld($, on)
  w.failing = { 'tok-1': 429, 'tok-2': 429 }
  store.delete('usage-due:1')
  store.delete('usage-due:2')
  await clock.advance(61_000)
  const pane = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'Pane', requestId: 'claude-accounts', props: PANE_PROPS })
  const tree = await pane.drawn()
  await pane.unmount()
  for (const [id, text] of [['1', '▰▰▰▱▱▱▱▱▱▱  30%'], ['2', '▰▰▰▰▱▱▱▱▱▱  40%']] as const) {
    const bar = findDrawn(findDrawn(tree, { key: `line-${id}-1` }), { text })
    expect([id, bar?.props?.dimColor, bar?.props?.color]).toEqual([id, true, undefined])
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
const debugLines = (w: World, text: string) => (w.logged ?? []).filter(line => line.includes(text))

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
    expect([age, store.get('fable-mark:2')]).toEqual([age, isEnded ? undefined : mark])
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

type StopLogEntry = { at: number; what: string }
const DAY = 24 * HOUR
/** The stop-log's first line of a usage-limit stop: its wording class (model.ts's wordingClass) and the login in use. */
const stopHeard = (wording: 'none' | 'fable' | 'session' | 'weekly' | 'unknown', id = '1') => `stop heard: rate_limit (wording: ${wording}), login ${id} in use`
/** A stop with no words, and the plain stop (PLAIN, naming the session limit), on login 1. */
const STOP_RATE_LIMIT = stopHeard('none')
const STOP_SESSION = stopHeard('session')
/** The line a stop writes when it moves to a login with a fresh read, read just now; the one tried is login 1. */
const PICKED_TWO = 'picked 2: fresh, read 0 min ago; tried 1'

/** This session's stop-log: what the store holds under the session's mark. */
const stopLogOf = (store: Map<string, unknown>, w: World): StopLogEntry[] => (store.get(`stop-log:${w.otherEnv.ACCOUNT_ROTATOR_SESSION}`) ?? []) as StopLogEntry[]
const whats = (entries: readonly StopLogEntry[]) => entries.map(e => e.what)

/** Two logins on a store the test reads, login 1 in use with room; `extra` seeds the store. */
async function loggedWorld(on: On, w: World, extra: Record<string, unknown> = {}) {
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [60, 40]
  w.usage['tok-2'] = [10, 30]
  const store = new Map<string, unknown>(Object.entries({ ...TWO_LOGINS, ...extra }))
  return { store, clock: world(on, w, store) }
}

const PLAIN = { error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] }

test('a stop, its switch and its carry-on write their entries in order under this session\'s key (puma-9arph.34 B3)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w)
  await start($, clock)
  w.usage['tok-1'] = [100, 41]
  await $.classic.StopFailure({ error: 'rate_limit' })
  await clock.settle()
  await clock.advance(36_000)
  expect(w.submitted).toHaveLength(1)
  expect(whats(stopLogOf(store, w))).toEqual([STOP_RATE_LIMIT, PICKED_TWO, 'moved to 2', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
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
  expect(whats(stopLogOf(store, w))).toEqual([STOP_SESSION, PICKED_TWO, 'held for 2: the token in use refreshes soon', 'moved to 2', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
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
  expect(whats(stopLogOf(store, w))).toEqual([STOP_RATE_LIMIT, PICKED_TWO, 'moved to 2', 'carry-on armed', 'carry-on skipped: another switch since'])
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

test('a carry-on owed across a hot reload sends nothing where a main turn ran after the reload (puma-9arph.35)', async ($, on) => {
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

test('with every login spent, a switch to a spent login during the write clearing the carry-on owed sends nothing there (puma-9arph.35)', async ($, on) => {
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

/** The stop-log's line of the carry-on owed once a login frees up, as it goes. */
const isOwedCarryOnLine = (what: string) => what.startsWith('a login is free: carry-on')

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

test('with every login spent, Use now pressed during the write clearing the carry-on owed ends it: nothing goes there once that login frees up (puma-9arph.84)', async ($, on) => {
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
  expect(lines.filter(l => !isReadFailed('1')(l))).toEqual([STOP_SESSION, PICKED_ONE_MIN, 'moved to 2', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
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
  expect(lines.filter(l => !isReadFailed('1')(l))).toEqual([STOP_SESSION, PICKED_ONE_MIN, 'moved to 2', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
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
  expect(whats(stopLogOf(store, w))).toEqual([STOP_SESSION, 'stop read failed: HooksError, login 1', PICKED_ONE_MIN, 'moved to 2', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
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
  expect(lines.filter(l => !isReadFailed('1')(l))).toEqual([STOP_SESSION, PICKED_ONE_MIN, 'moved to 2', 'carry-on armed', 'carry-on queued', 'carry-on resolved'])
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

test('a stop-log keeps only its last 50 entries (puma-9arph.34 B6)', async ($, on) => {
  const w = fresh()
  const { store, clock } = await loggedWorld(on, w, { 'rotate-to': 'off' })
  await start($, clock)
  for (let i = 0; i < 30; i++) {
    await $.classic.StopFailure({ error: 'rate_limit' })
    await clock.settle()
  }
  const entries = whats(stopLogOf(store, w))
  expect(entries).toHaveLength(50)
  expect(entries.slice(-2)).toEqual([STOP_RATE_LIMIT, 'stayed: rotation off'])
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
  expect(whats(stopLogOf(store, w))).toEqual(['moved to 2 by the tick or a response, its usage read failed, no carry-on'])
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

/** What the look (every 15 s, v4 s.3) writes where it finds an open turn, or a fill that answers no 'dialog' (the kit's cannot). */
const WAITS_ON_TURN = 'owed resume waits: 1 turns open'
const FILL_NO_CAUSE = 'owed resume: fill answered no cause, no key'

/**
 * A world whose carry-on stays queued, in an Orca pane, its fill refused by a hook. The kit keeps no cause on the
 * mod's own fill, so no test here draws the engine's own 'dialog' that the Escape needs: model.test.ts holds that row,
 * and these hold every condition before it. Answers what lets the queued prompt enter.
 */
function queuedWorld(on: On, w: World): () => void {
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
async function turnStops($: Engine, clock: MockClock, stop: { error: 'rate_limit' | 'authentication_failed' } = { error: 'rate_limit' }, isEnded = true): Promise<void> {
  await $.turn.start({ text: 'go on', turnId: 'turn-1' })
  await $.classic.StopFailure(stop)
  if (isEnded) await $.turn.complete({ turnId: 'turn-1', reason: 'error', answer: '', durationMs: 1, isAborted: false })
  await clock.settle()
}

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

/** The pane after the carry-on answered, as the reading saw it (R6c): the countdown's footer under the prompt box. */
const COUNTDOWN_FOOTER = ['⏺ stand-in: done', '──────────', '❯ ', '──────────', '  ⚠ Usage limit reached · limit resets 1:06am', '    Continuing shortly · Esc to cancel']
/** The pane once the countdown is gone (R7): no footer. */
const NO_FOOTER = ['⏺ Automatic continue cancelled · /rate-limit-options to re-arm', '──────────', '❯ ', '──────────']
const OWN_ESCAPE = ['orca', 'terminal', 'send', '--terminal', 'term_test-pane', '--text', '\u001b', '--json']

/** A world in an Orca pane whose screen shows the countdown, every spawn recorded. */
function countdownWorld(on: On, w: World): void {
  w.env.ORCA_TERMINAL_HANDLE = 'term_test-pane'
  w.screen = COUNTDOWN_FOOTER
  on('process.spawn', async function* (_$, e) {
    w.spawned.push(e)
    yield* []
    return { value: { code: 0, signal: null } }
  })
}

/** The doubled path of card D196: a usage-limit stop, the switch, and the mod's carry-on entering and answering. */
async function carryOnAnswers($: Engine, clock: MockClock, w: World, stop: { error: 'rate_limit' | 'authentication_failed' } = { error: 'rate_limit' }): Promise<void> {
  w.usage['tok-1'] = [100, 41]
  await turnStops($, clock, stop)
  await clock.advance(36_000)
  await $.turn.start({ text: w.submitted[0] ?? '', turnId: 'turn-carry' })
  await $.turn.complete({ turnId: 'turn-carry', reason: 'answer', answer: 'done', durationMs: 1, isAborted: false })
  await clock.settle()
}

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
    'moved to 2',
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
    'moved to 3',
    'carry-on armed',
    'carry-on queued',
    FILL_NO_CAUSE,
  ])
})

// ---------------------------------------------------------------- puma-9arph.54: the owed resume (design v4)

/**
 * Three logins, each with room, login 1 in use and spent by the stop to come; the carry-on of a stop's switch stays
 * queued, in an Orca pane unless `isPane` is false. The kit cannot draw the engine's 'dialog' refusal (queuedWorld's
 * comment), so a test here that needs the Escape proves the wiring up to the fill, and model.test.ts holds the Escape's rows.
 */
async function owedWorld($: Engine, on: On, w: World, isPane = true) {
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
  expect(whats(stopLogOf(store, w)).filter(l => ['refresh nudge entered on login 1', 'moved to 2', 'resume entered'].includes(l))).toEqual(['refresh nudge entered on login 1', 'moved to 2'])
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

const isSwitchedToast = (t: unknown) => String(t).startsWith('Switched to ')
/**
 * Another session's read of login 1, spent, in the shared store as saveReading writes it: the minute's merge brings it
 * into the view, so both checks of the next tick find the login in use spent. This session's own read of it is due
 * only USAGE_IDLE_MS after the start's, a time no 10-minute mark meets.
 */
const spentElsewhere = (store: Map<string, unknown>, at: number) =>
  store.set('usage:1', { fiveHour: { pct: 100, resetsAt: '2026-10-12T12:00:00Z' }, sevenDay: { pct: 41, resetsAt: '2026-10-18T00:00:00Z' }, at, by: '1', v: 1, src: 'body' })
/** Lets the jobs of one tick finish in real time, as ticks a minute apart do, a late keychain answer included. */
async function settleReal(clock: MockClock): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 100))
  await clock.settle()
}

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

/** A state write as a test reads it, and a step around the rest of its handling: the kit takes one handler an event. */
type StateWrite = { key: string; value: View }
type Around = (e: StateWrite, inner: (e: StateWrite) => Promise<unknown>) => Promise<unknown>

/**
 * Refuses every view write that clears `carryDue` once one carry-on has been owed, as an engine that refuses the write.
 * `owed` is the debt the view was last written to hold.
 */
const carryClearRefusal = () => {
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
const refuseCarryClear = (on: On, outer?: Around) => {
  const { seen, around } = carryClearRefusal()
  on('state.set', async (_$, e, next) => {
    const inner = (x: StateWrite) => around(x, y => next(y as unknown as typeof e))
    const write = e as unknown as StateWrite
    return (await (outer === undefined ? inner(write) : outer(write, inner))) as Awaited<ReturnType<typeof next>>
  })
  return seen
}

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
/** The store's mark of the carry-on owed this session ended though its view kept it, as the debt it names. */
const carryEndedOf = (store: Map<string, unknown>, w: World) => {
  const mark = store.get(`carry-ended:${w.otherEnv.ACCOUNT_ROTATOR_SESSION}`) as { owedAt?: number } | undefined
  return mark === undefined ? undefined : { owedAt: mark.owedAt }
}
const carryEndedKeys = (store: Map<string, unknown>) => [...store.keys()].filter(k => k.startsWith('carry-ended:'))
/** Past login 1's reset at 12:00 and the grace after it: a carry-on owed for 12:00 has gone by then. */
const pastOwed = (clock: MockClock) => clock.advance(Date.parse('2026-10-12T12:00:00Z') - clock.now() + 10 * 60_000)

/**
 * Every login spent, every view write clearing carryDue refused, then a usage-limit stop on login 1: one carry-on owed at
 * 12:00. `outer` runs around the refusal; `setup` adds the test's own handlers of other events before the start.
 */
async function refusedOwedWorld($: Engine, on: On, w = fresh(), { outer, setup }: { outer?: Around; setup?: () => void } = {}) {
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

test('a reload whose debt has no owedAt is sent once though the store holds a mark with no owedAt (puma-9arph.40)', async ($, on) => {
  const { w, clock } = await reloadedWorld($, on, survivingDebt({}), { [`carry-ended:${RELOADED_MARK}`]: {} })
  await pastOwed(clock)
  expect(w.submitted).toHaveLength(1)
})

test('a reload whose marked debt\'s clear is refused again owes nothing and boots on (puma-9arph.40)', async ($, on) => {
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

test('Use now pressed during a refused clearing write ends the carry-on owed and leaves the ended mark (puma-9arph.40)', async ($, on) => {
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

test('a refused clear, then the held branch, leaves the debt owed with no ended mark for a reload to read (puma-9arph.40)', async ($, on) => {
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

test('a reload whose ended mark cannot be read owes the debt once more and boots on (puma-9arph.40)', async ($, on) => {
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

/**
 * A session whose view survived a hot reload as `surviving`, on two logins both spent, the store a shared one seeded by
 * `extra`; `around` runs around each state write.
 */
async function reloadedWorld($: Engine, on: On, surviving: Partial<View>, extra: Record<string, unknown> = {}, around?: Around, w = fresh()) {
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
  expect([slots(w).at(-1), whats(stopLogOf(store, w))]).toEqual([SLOT3, [STOP_RATE_LIMIT, PICKED_TWO, 'stop switch given up on: landed late, no carry-on']])
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

// puma-9arph.26: the mod keeps the launcher copy a person installed as `claude` current, at a session's start.
const COPY_DIR = `${HOME}/.claude/accounts/bin`
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
const kept = (w: World) => Object.keys(w.files).filter(path => path.startsWith(`${COPY_DIR}/`))

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

const sent = (w: World, notice: RegExp) => w.notices.some(t => notice.test(t))

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

/** No stop's recovery ended in this world: what the stop hook's catch writes. */
const isEnded = (store: Map<string, unknown>, w: World) => whats(stopLogOf(store, w)).some(x => x.startsWith('stop handling failed'))

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

test('86-B2: a carry-on owed whose held write is refused, the login spent again after the clearing write, is written into the view again at the next tick (puma-9arph.86)', async ($, on) => {
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
test('86-E1: a carry-on owed that a press ends while its write into the view again is held is not left in the view (puma-9arph.86)', async ($, on) => {
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

test('86-A1: a carry-on owed waits while a Connect visit runs, and goes once at the first tick after it (puma-9arph.86)', async ($, on) => {
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
test('86-A2: a carry-on owed whose clearing write is held while a Connect visit begins waits out the visit, and goes once after it (puma-9arph.86)', async ($, on) => {
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

test('87-A: a carry-on owed that a press ends while awaitFreeLogin\'s first view write is held is not left in the view (puma-9arph.87)', async ($, on) => {
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

test('87-A2: a carry-on owed that a press ends while the held branch\'s write is held is not left in the view (puma-9arph.87)', async ($, on) => {
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

test('87-B: a carry-on owed whose view read after the clear fails stays owed, and goes at a later tick (puma-9arph.87)', async ($, on) => {
  const { clock, views, w } = await owedWithRefusals($, on)
  views.refuseReadAfterClear()
  await pastOwed(clock)
  // The staging took: the one read after the clear was refused, and the tick's catch said so.
  expect([views.readsRefused(), debugLines(w, 'carry-on once a login is free failed').length]).toEqual([1, 1])
  expect(w.submitted).toHaveLength(1)
})

test('87-B2: a carry-on owed that a press ends during a refused clear, the read after it failing too, is marked ended (puma-9arph.87)', async ($, on) => {
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

test('87-B3: a carry-on owed that a press ends during a clear that lands, the read after it failing, is not owed again (puma-9arph.87)', async ($, on) => {
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

test('88-A: a newer carry-on owed whose first write is refused, the view holding an older ended one, is written into the view (puma-9arph.88)', async ($, on) => {
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
 * puma-9arph.91: the engine answers the next submit late, as `answer` says (drop, reject or take it), and only that one:
 * every later submit goes through at once, but for the `drops - 1` after it, which it drops at once. Returns what lets
 * the late answer go. The kit reads `submitHold` and `submitDrop` after it counts the submit, so the count names each.
 */
function answerNextLate(w: World, answer: 'drop' | 'reject' | 'resolve', drops = 1): () => void {
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

test('89-F: a carry-on owed as a thrown Connect visit closes waits out a visit begun meanwhile (puma-9arph.89)', async ($, on) => {
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

/**
 * Every login spent and a carry-on owed at 12:00; a Connect visit held from `from` to `to`, to login 2 (or, `isThree`,
 * to login 3, so its move back lands on login 2, freed by then); its cut turn begins two minutes in and stops on the
 * limit. Then every submit is tagged `<time> on <login>[+visit]` as the 10 s loop meets it and its turn starts, but for
 * the first one after the visit with `refuse` (`thrown` or `dropped`), after which `isPersonTurn` begins a person's turn.
 */
async function owedVisit90($: Engine, on: On, from: string, to: string, o: { refuse?: 'thrown' | 'dropped'; isPersonTurn?: boolean; isThree?: boolean } = {}) {
  const w = fresh()
  w.chrome = { extensions: [''] }
  if (o.isThree === true) {
    w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
    w.usage['tok-3'] = [100, 30]
  }
  const { store, clock } = await loggedWorld(on, w, { ...(o.isThree === true ? THREE_LOGINS : {}), 'chrome-account': '1' })
  const view = watchedView(on)
  // Each submit is tagged as the kit takes it, before it can throw: the time, the login, and `+visit` while one is open.
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
    await clock.advance(10_000)
    await clock.settle()
    while (seen < w.submitted.length) {
      seen += 1
      if (isThrown || w.submitDrop !== undefined) {
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
  expect([isCut, sends.filter(s => s.endsWith('+visit'))], 'the visit cut the stop, and nothing went while one was open').toEqual([true, []])
  // The one owed goes by the tick, whose log says so once; the visit's line says nothing before it goes.
  const owed = log.filter(what => what.startsWith('a login is free: carry-on on')).length
  return { sends, log, owed, isStoodDown: log.includes('carry-on not sent: the one owed went'), waits: log.filter(what => what === 'carry-on waits on the one owed').length }
}

test('90-A: a carry-on owed and a stop a Connect visit cut carry on once, the one owed going first (puma-9arph.90)', async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:00')
  expect([r.sends.length, r.owed, r.isStoodDown], 'one went, the one owed; the line stood down').toEqual([1, 1, true])
})

test('90-B: a carry-on owed and a stop a Connect visit cut carry on once, the visit\'s line due first (puma-9arph.90)', async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:30')
  expect([r.sends.length, r.waits, r.owed, r.isStoodDown], 'one went, the one owed; the line waited once, then stood down').toEqual([1, 1, 1, true])
})

test('90-C: a carry-on owed still goes once a login frees up after a Connect visit that ended with none free (puma-9arph.90)', async ($, on) => {
  const r = await owedVisit90($, on, '11:50:00', '11:55:00')
  expect([r.sends.filter(s => s >= '12:00').length, r.log.includes('a login is free: carry-on on 2')], 'the one owed went').toEqual([1, true])
})

test('90-D: a Connect visit that ended with no login free sends nothing on the spent login, and says it waits once (puma-9arph.90)', async ($, on) => {
  const r = await owedVisit90($, on, '11:50:00', '11:55:00')
  expect([r.sends.filter(s => s < '12:00'), r.waits]).toEqual([[], 1])
})

test('90-E: where the carry-on owed is dropped, the Connect visit\'s line goes after it (puma-9arph.90)', async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:30', { refuse: 'dropped' })
  expect([r.sends.length, r.log.includes('carry-on drop'), r.owed, r.isStoodDown], 'the one owed, dropped, then the line').toEqual([2, true, 1, false])
})

test('90-F: where the carry-on owed is dropped and a person\'s turn begins, the Connect visit\'s line still goes (puma-9arph.90)', async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:30', { refuse: 'dropped', isPersonTurn: true })
  expect([r.sends.length, r.owed, r.isStoodDown], 'the one owed, dropped, then the line').toEqual([2, 1, false])
})

test('90-G: where the carry-on owed is refused, the Connect visit\'s line goes after it (puma-9arph.90)', async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:00', { refuse: 'thrown' })
  expect([r.sends.length, r.owed, r.isStoodDown], 'the one owed, refused, then the line').toEqual([2, 1, false])
})

test('90-H: a Connect visit whose move back lands on a login just freed carries on once, not with the one the tick armed too (puma-9arph.90)', async ($, on) => {
  const r = await owedVisit90($, on, '11:58:00', '12:06:00', { isThree: true })
  expect([r.log.includes('carry-on armed'), r.sends.length, r.owed, r.isStoodDown], 'one went, the one the tick armed; the line stood down').toEqual([true, 1, 1, true])
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
  test(`90-${end === '11:55:00' ? 'I' : 'J'}: a carry-on owed dropped after its turn began, a Connect visit ending ${end} before, still leaves the visit's line to go (puma-9arph.90)`, async ($, on) => {
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

test('90-K: a person\'s turn begun after the tick cleared the carry-on owed and before its submit, that submit dropped: the Connect visit\'s line still goes (puma-9arph.90)', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  views90(on)
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
  // The line looks at least once while the read is held.
  await steps90(clock, 70_000)
  w.submitDrop = 'a Stop stands'
  const before = w.submitted.length
  release()
  await settleReal(clock)
  // The carry-on owed is armed after the read and goes SETTLE_MS later.
  await steps90(clock, 40_000)
  const dropped = w.submitted.length - before
  w.submitDrop = undefined
  await steps90(clock, 60_000)
  await pane.unmount()
  expect([isCut, isHeld], 'the visit cut the stop; the read after the clear was held').toEqual([true, true])
  expect(w.submitted.length - dropped, 'carry-ons that went and were not dropped').toBe(1)
})

test('90-L: a later Connect visit open as the line looks again, after the carry-on owed went and its turn began, sends no second line (puma-9arph.90)', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  const views = views90(on)
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
  expect([isCut, isOpen], 'the first visit cut the stop; a second visit opened after the owed one went').toEqual([true, true])
  expect(w.submitted, 'one carry-on in all').toHaveLength(1)
})

test('90-M: after a carry-on submit that throws, a later Connect visit with a carry-on owed stands its line down once that one went (puma-9arph.90)', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  w.keychain[await keychainItem(SLOT3)] = blob('tok-3')
  w.usage['tok-3'] = [100, 30]
  w.fiveHourResets = { 'tok-2': '2026-10-12T12:30:00Z', 'tok-3': '2026-10-12T12:30:00Z' }
  const { store, clock } = await loggedWorld(on, w, { ...THREE_LOGINS, 'chrome-account': '1' })
  views90(on)
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
  expect([thrown, isCut], 'one submit threw; the visit cut the stop').toEqual([1, true])
  expect([w.submitted.length - thrown, log.includes('carry-on not sent: the one owed went')]).toEqual([1, true])
})

test('90-N: a person\'s turn after a Connect visit, the carry-on owed unanswered as the line looks, its own turn begun, then dropped: the line still goes (puma-9arph.90)', async ($, on) => {
  const w = fresh()
  w.chrome = { extensions: [''] }
  const { store, clock } = await loggedWorld(on, w, { 'chrome-account': '1' })
  views90(on)
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
  expect([isCut, owed], 'the visit cut the stop; the carry-on owed went once before the drop').toEqual([true, 1])
  expect(w.submitted.length - 1, 'carry-ons that went and were not dropped').toBe(1)
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
 * own submit goes. `isNudgedFirst`: the first stop's switch is held and the refresh nudge goes first (nudgeFirst95).
 * Answers the carry-ons after the visit's end that were not dropped.
 */
async function oldSubmitVisit95($: Engine, on: On, ending: 'press' | 'zero' | 'turned' | 'quiet', isNudgedFirst = false) {
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
  if (ending !== 'quiet') {
    await $.turn.start({ text: 'a prompt of the person', turnId: '95-person' })
    await clock.settle()
  }
  const isQueuedOwed = ending !== 'press'
  const dropOwed = isQueuedOwed ? answerNextLate(w, 'drop') : () => {}
  const oldLook = ending === 'quiet' ? 1 : 3
  const owedAt = w.submitted.length + 1
  let isPressed = false
  let looks = 0
  let started = w.submitted.length
  while (clock.now() < at95(isQueuedOwed ? '10:24:00' : '10:21:00')) {
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
      // The debt's own submit stays queued (`zero`) or starts its turn above (`turned`).
      if (isQueuedOwed && started === owedAt) continue
      await $.turn.start({ text: w.submitted[started - 1] ?? '', turnId: `95-${started}` })
      await clock.settle()
    }
  }
  await pane.unmount()
  const dropped = isQueuedOwed && looks >= 15 ? 1 : 0
  return { old, isCut, notDropped: w.submitted.length - atEnd - dropped }
}

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
  return { isCut, isNudgeAfterS1: nudgeAt > s1, isS1Answered, phase, log: whats(stopLogOf(store, w)), carried }
}

test('90-U: the carry-on owed after a Connect visit, dropped once a later refresh nudge went: the line still goes (puma-9arph.100)', async ($, on) => {
  const r = await nudgedDebt100($, on, 'drop')
  expect([r.isCut, r.isNudgeAfterS1, r.isS1Answered, r.log.includes('carry-on drop'), r.phase], 'the visit cut the stop; the nudge after the owed one, which dropped; the hold dropped').toEqual([true, true, true, true, 'hold dropped'])
  expect(r.carried, 'carry-ons of the work after the visit ended that went through').toBe(1)
})

test('90-V: the carry-on owed after a Connect visit, answered once a later refresh nudge went: no second line (puma-9arph.100)', async ($, on) => {
  const r = await nudgedDebt100($, on, 'clean')
  expect([r.isCut, r.isNudgeAfterS1, r.isS1Answered, r.log.includes('carry-on drop'), r.phase], 'the visit cut the stop; the nudge after the owed one, which answered; the hold dropped').toEqual([true, true, true, false, 'hold dropped'])
  expect(r.carried, 'carry-ons of the work after the visit ended that went through').toBe(1)
})

test('90-X: the carry-on owed after a Connect visit, refused once a later refresh nudge went: the line still goes (puma-9arph.100)', async ($, on) => {
  const r = await nudgedDebt100($, on, 'reject')
  expect([r.isCut, r.isNudgeAfterS1, r.isS1Answered, r.log.includes('carry-on drop'), r.phase], 'the visit cut the stop; the nudge after the owed one, which was refused; the hold dropped').toEqual([true, true, true, false, 'hold dropped'])
  expect(r.carried, 'carry-ons of the work after the visit ended that went through').toBe(1)
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
 * run out where `isTwoIdle`. The schedule does not read either login before the stop.
 */
async function oldReadings($: Engine, on: On, live: { two: [number, number, number]; three: [number, number, number] }, options: { isTwoIdle?: boolean; isThreeRead?: boolean; isTwoRoomy?: boolean; text?: string; failing?: Record<string, number> } = {}) {
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
  const clock = world(on, w, store)
  await start($, clock)
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
  expect(log.filter(line => line.startsWith('picked '))).toEqual([expect.stringMatching(/^picked 2: spent-old, read 120 min ago; tried 1$/)])
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

// ---------------------------------------------------------------- puma-9arph.109.5: a window's marks end on a counter fall

/**
 * Login 1 is in use with its Fable week spent, login 2 is spent. Login 3 was stopped 15 minutes ago: its mark stands and its
 * stored body said `before` (week, Fable, 5-hour). Then the operator reset its usage by hand, and the endpoint says `live`
 * with every reset time as before (seen live: the reset time does not move). Its read is due in three minutes.
 */
async function manualResetOnThree($: Engine, on: On, kind: 'fable' | 'week' | 'five', before: { week: number; fable: number; five: number }, live: [number, number, number]) {
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
  // The schedule reads login 3: five minutes on, the read is due and claimed.
  await clock.advance(5 * 60_000)
  await clock.settle()
  await clock.advance(USAGE_CLAIM_WAIT_MS)
  await clock.settle()
  return { w, store, clock, key: Object.keys(marks)[0] ?? '' }
}

for (const [kind, stop] of [['fable', FABLE_STOP], ['week', { error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] }], ['five', { error: 'rate_limit', last_assistant_message: PLAIN_STOPS[0] }]] as const) {
  test(`MARKS-END-ON-FALL: a manual reset of login 3 (100 to 0, the same reset times) ends its ${kind} mark at the next read, and the next stop picks it fresh`, async ($, on) => {
    const { w, store, clock, key } = await manualResetOnThree($, on, kind, { week: 100, fable: 100, five: 100 }, [0, 0, 0])
    expect(store.get(key), 'the mark ended at the read, though it is 20 minutes old').toBeUndefined()
    await $.classic.StopFailure(stop)
    await clock.settle()
    expect(slotValues(w), 'the stop moves to login 3').toEqual([SLOT3])
    expect(whats(stopLogOf(store, w)).filter(line => line.startsWith('picked '))).toEqual([expect.stringMatching(/^picked 3: fresh, read \d+ min ago; tried 1$/)])
  })

  test(`guard: a lagging read that sits near its stop (96 then 97) keeps the ${kind} mark`, async ($, on) => {
    const { store, key } = await manualResetOnThree($, on, kind, { week: 96, fable: 96, five: 96 }, [97, 97, 97])
    expect(store.get(key), 'the mark stands').toBeDefined()
  })
}
