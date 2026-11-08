import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  HookStream,
  McpToolResult,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  Register,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import type { Account, CheckError, FiveHourLimit, FooterStyle, Health, Holder, LaunchOn, LaunchPick, Mark, Reading, ReadingSource, RotateTo, RotatorRequest, UsageDue, View } from '../types'
import {
  CHROME_SERVER,
  CHROME_TOOL,
  EMPTY_VIEW,
  FIVE_HOUR_MS,
  LEAVE_FIVE_HOUR,
  WEEK_MS,
  counted,
  fiveHourLimitFrom,
  weekLeaveFrom,
  launchOnFrom,
  pickLaunch,
  isSessionStop,
  WEEK_LEAVE_MAX,
  legacyMark,
  markFrom,
  spentMark,
  withMark,
  blockedText,
  browsersFrom,
  canConnectChrome,
  chromeNote,
  continueTextFrom,
  credentialFrom,
  credentialsFile,
  fableMark,
  fableStay,
  fingerprint,
  footerStyleFrom,
  freeId,
  healthOf,
  identityFromProfile,
  identityFromStatus,
  isFableSpent,
  isFableStop,
  isWeeklyStop,
  withWeekMark,
  withFableMark,
  laterMark,
  reportsNoFiveHour,
  isLoginOf,
  isNoBrowser,
  isOnNormalLogin,
  isPolicyRefusal,
  keepFable,
  keychainItem,
  keychainUser,
  label,
  pickTarget,
  rotateToFrom,
  readingFromLimits,
  readingFromUsage,
  holdsLogin,
  sameLogin,
  slotNumber,
  shouldLeave,
  WRITER_VERSION,
  whoseWeek,
  slotEnv,
  windowPct,
  USAGE_CLAIM_WAIT_MS,
  USAGE_IDLE_MS,
  afterUsage,
  claimDueReads,
  claimUsage,
  gatingDue,
  mayForceUsage,
  mayReadSince,
  renewClaim,
  retryAfterFrom,
  usageDueFrom,
  isSameRows,
  rowsOf,
  REQUEST_POLL_MS,
  REQUEST_TTL_MS,
  SwitchHeld,
  requestFrom,
  requestsDir,
} from './model'
import type { Credential, Identity, Need, StayReason } from './model'
import { Band, Footer, PANE_COLUMNS, Pane } from './view'
import type { Actions } from './view'

type Host = EngineInterface

const PANE = 'claude-accounts'
const TITLE = 'Claude accounts'
/** The slash command that opens and closes the pane. */
const ACCOUNTS_COMMAND = 'accounts'
/** Claude Code caches a keychain read for 30 s, so a switch lands within this. */
const SETTLE_MS = 35_000
/** A switch no response has shown after this long is reported as not taken. */
const CONFIRM_GIVE_UP_MS = 4 * 60_000
/**
 * Claude Code refreshes a token 5 minutes before it expires. A refresh that
 * runs while the old login's read is still cached is saved under the new
 * slot, overwriting that login: so no switch this close to the expiry.
 */
const REFRESH_GUARD_MS = 8 * 60_000
/** How long the mod waits on Claude in Chrome to list its browsers, connecting first, before going on without. */
const CHROME_WAIT_MS = 15_000
/** A file only macOS has: there Claude Code keeps logins in the keychain, elsewhere (Linux) in a file each. */
const MACOS_MARKER = '/System/Library/CoreServices/SystemVersion.plist'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const CONTINUE =
  'Claude Code switched to another of your Claude accounts because the previous one hit its usage limit or lost its sign-in. Continue where you left off.'

const viewAtom = atom({ plugin: 'account-rotator', key: 'view' } as const, EMPTY_VIEW)

/**
 * Whether this session's pane shows. A press opens or closes it in its own
 * turn, with no read before: the engine counts an open as the person's only
 * there, and places it at any width; one made after an await waits undrawn
 * below 144 columns. Kept in step with closes by the person and with reloads.
 */
let isPaneShown = false

/** Whether boot has set the view's login to the one this session uses. */
let isBooted = false
/** When this session's boot read the store: an older version's reading written after it says that version still runs. */
let bootedAt: number | undefined
/** An older version writes its reading at every check, every 10 minutes at most: one this old has stopped. */
const OLDER_WRITER_MS = 30 * 60_000
/** The last response this session measured, and when: it names the login a stop during an unproven switch belongs to. */
let lastMeasured: { at: number; reading: Reading | undefined } | undefined
/**
 * A stop marked on the login moved to before any response proved the switch (`since`, its start). `writes`: each
 * store key the stop changed, with what stood there once its own usage read was in (`before`, undefined for none)
 * and what it `written`. `setFableStop`: the stop set this session's Fable stop. `readAt`: when its own read was in.
 * Kept only when a settle proves the switch, or a stop's own move leaves it; undone by every other end of the
 * switch: a settle that finds it did not take, a give-up, another switch, the end of the process.
 */
type ProvisionalStop = {
  id: string
  since: number
  readAt: number
  writes: Record<string, { before: unknown; written: unknown }>
  setFableStop: boolean
}
let provisionalStop: ProvisionalStop | undefined

/**
 * The session ends whose process ends with them, by the engine's SessionEndReason: /exit and its keys, a logout, a
 * `-p` run done or a signal. A reason not named here keeps the stop's marks.
 */
const PROCESS_ENDS: ReadonlySet<string> = new Set(['prompt_input_exit', 'logout', 'other'])

/**
 * The one way a switch to `id` ends proven, by a response's week or a browser answering as the account: it settles,
 * and a stop marked on it provisionally is kept, so no later end of anything reverts it.
 */
async function proveSwitch($: Host, id: string): Promise<void> {
  untaken.delete(id)
  if (provisionalStop?.id === id) provisionalStop = undefined
  await setView($, v => (v.pending?.id === id ? { ...v, pending: undefined } : v))
}

/** The keys a stop writes for a login, every session's: its marks, its reading, its `no-five-hour`. */
const STOP_KEYS = (id: string) => [`mark:${id}`, `week-mark:${id}`, `fable-mark:${id}`, `usage:${id}`, `no-five-hour:${id}`]

async function stopKeys($: Host, id: string): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {}
  for (const key of STOP_KEYS(id)) values[key] = await $.store.get(key)
  return values
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The record of a provisional stop on `id` just marked, from what stood before it (`before`, after its own read).
 * A second stop on the same unproven switch adds what it wrote and keeps what stood before the first.
 */
async function recordStop($: Host, id: string, since: number, before: Record<string, unknown>, wasFableStopped: boolean, readAt: number): Promise<ProvisionalStop> {
  const kept = provisionalStop?.since === since && provisionalStop.id === id ? provisionalStop : { id, since, readAt, writes: {}, setFableStop: false }
  const after = await stopKeys($, id)
  const writes = { ...kept.writes }
  for (const key of STOP_KEYS(id)) {
    if (!sameValue(after[key], before[key])) writes[key] = { before: writes[key]?.before ?? before[key], written: after[key] }
  }
  const setsFable = !wasFableStopped && (await getView($)).isFableStopped === true
  return { ...kept, writes, setFableStop: kept.setFableStop || setsFable }
}
/** The `claude auth login` child of the sign-in under way, so Cancel can end it. */
let running: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined
/** The login this session is signing in; a stored 'logging-in' from a session that died is checked again. */
let signingIn: string | undefined
let signInQueue: Promise<void> = Promise.resolve()
/** The carry-on a switch owes: what the turn that stopped died on, which picks the line sent. */
type CarryOn = { need?: Need }
/** When the switch began whose landing a turn that died before it already carries on after. */
let carriedFor: number | undefined
/**
 * A switch the refresh guard holds back: the latest one asked for, tried again
 * each minute until it goes. A Fable stop's carry-on waits in it, and goes out
 * once the held switch lands; a plain stop's does not.
 */
let held: { target: Account; why: string; timer: Timer; carry?: CarryOn; isRotation: boolean } | undefined
/** How many switches this session has made: a carry-on goes out only if no switch came after the one it follows. */
let moves = 0
/** Logins a switch to did not take this session: the rotation leaves them be; Use now still tries. */
const untaken = new Set<string>()
/** When this session last moved to another login: until SETTLE_MS after, its requests may still go out as the one before. */
let movedAt: number | undefined
/** Connect is under way: the rotation waits for it, and browser calls are held back. */
let isConnectingChrome = false

// ---------------------------------------------------------------- state
// The view is this session's; the store is one JSON file every session of the
// mod shares: the list of logins, each login's last reading and health under a
// key of its own, so sessions writing different logins never collide, the
// footer's look, and which login the rotation moves to.

/** The view survives a hot reload as the code before wrote it: what this code added starts as in a new session. */
const current = (v: View): View => ({ ...EMPTY_VIEW, ...v })
const getView = async ($: Host): Promise<View> => current(await read($, viewAtom))
const setView = ($: Host, fn: (v: View) => View): Promise<View> => update($, viewAtom, v => fn(current(v)))
/** Something the person should know that nothing on screen says: a toast, on screen for a while. */
const tell = ($: Host, text: string) => $.ui.toast(text, { timeoutMs: 8000 })
const debug = ($: Host, text: string) => $.ui.log(`account-rotator: ${text}`, { to: 'debug' })

function isAccount(value: unknown): value is Account {
  if (typeof value !== 'object' || value === null) return false
  const { id, slot } = value as Record<string, unknown>
  return typeof id === 'string' && typeof slot === 'string'
}

async function loadAccounts($: Host): Promise<Account[]> {
  const stored = await $.store.get('accounts')
  return Array.isArray(stored) ? stored.filter(isAccount) : []
}

async function saveAccounts($: Host, accounts: Account[]): Promise<void> {
  await $.store.set('accounts', accounts)
  await setView($, v => ({ ...v, accounts }))
}

const asReading = (r: unknown): Reading | undefined =>
  typeof r === 'object' && r !== null && typeof (r as Reading).at === 'number' ? (r as Reading) : undefined

/**
 * A login's reading as stored: the read itself, before the 5-hour limit counts it. Only this version and later
 * write `usage:<id>`, so an older session still running can never cross it.
 */
async function storedReading($: Host, id: string): Promise<Reading | undefined> {
  const r = asReading(await $.store.get(`usage:${id}`))
  return r !== undefined && typeof r.v === 'number' && r.v >= 1 ? r : undefined
}

/** The reading an older version keeps under `reading:<id>`: read only for the stop marks it may carry, and to tell it runs. */
async function legacyReading($: Host, id: string): Promise<Reading | undefined> {
  return asReading(await $.store.get(`reading:${id}`))
}

/** A login's stored reading when that login produced it; one with no owner, or another's, is no one's to build on. */
async function ownedReading($: Host, id: string): Promise<Reading | undefined> {
  const r = await storedReading($, id)
  return r?.by === id ? r : undefined
}

/** What the store holds beside a login's reading, each under its own key: its stop marks, and whether it has no 5-hour window. */
type Beside = { mark?: Mark; weekMark?: Mark; fableMark?: Mark; noFiveHour?: boolean }

const besideOf = (v: View, id: string): Beside => ({ mark: v.marks?.[id], weekMark: v.weekMarks?.[id], fableMark: v.fableMarks?.[id], noFiveHour: v.noFiveHour?.[id] })

/**
 * A login's reading as the rules count it: the stored read with whether its usage endpoint
 * reports no 5-hour window, then its stop marks, under the 5-hour limit.
 */
function viewed(read: Reading, beside: Beside, limit: FiveHourLimit, now: number): Reading {
  const { noFiveHour: _stored, ...bare } = read
  const r: Reading = beside.noFiveHour === true ? { ...bare, noFiveHour: true } : bare
  const weekly = withFableMark(withWeekMark(r, beside.weekMark, now) ?? r, beside.fableMark, now) ?? r
  return counted(withMark(weekly, beside.mark, now) ?? weekly, limit, now)
}

/** Stores whether a login's usage endpoint said it has no 5-hour window, for every session. */
async function saveNoFiveHour($: Host, id: string, hasNoFiveHour: boolean): Promise<void> {
  await $.store.set(`no-five-hour:${id}`, hasNoFiveHour)
  await setView($, v => ({ ...v, noFiveHour: { ...v.noFiveHour, [id]: hasNoFiveHour } }))
}

/** Marks a login's week spent for every session, under its own key, which no save of a reading writes. */
async function saveWeekMark($: Host, id: string, weekMark: Mark): Promise<void> {
  await $.store.set(`week-mark:${id}`, weekMark)
  const now = await $.clock.now()
  const read = (await ownedReading($, id)) ?? { at: weekMark.at }
  await setView($, v => {
    const weekMarks = { ...v.weekMarks, [id]: weekMark }
    return { ...v, weekMarks, readings: { ...v.readings, [id]: viewed(read, { ...besideOf(v, id), weekMark }, v.fiveHourLimit, now) } }
  })
}

/**
 * Marks a login's Fable week spent for every session, under its own key, which no save of a reading writes. The
 * store has no conditional write: it reads the key again first, and a mark there that ends later stands.
 */
async function saveFableMark($: Host, id: string, mark: Mark): Promise<void> {
  const fableMark = laterMark(markFrom(await $.store.get(`fable-mark:${id}`)), mark)
  await $.store.set(`fable-mark:${id}`, fableMark)
  const now = await $.clock.now()
  const read = (await ownedReading($, id)) ?? { at: fableMark.at }
  await setView($, v => {
    const fableMarks = { ...v.fableMarks, [id]: fableMark }
    return { ...v, fableMarks, readings: { ...v.readings, [id]: viewed(read, { ...besideOf(v, id), fableMark }, v.fiveHourLimit, now) } }
  })
}

/**
 * Stores a read as read, so turning the 5-hour limit back on finds the windows
 * off hid. A stop's mark lives under its own key, which no save of a reading
 * writes; a mark an older version of the mod left inside the stored reading
 * moves to that key first, so a session still on that version keeps its stop.
 */
async function saveReading($: Host, id: string, read: Reading, src: ReadingSource): Promise<void> {
  const now = await $.clock.now()
  const legacy = legacyMark(await legacyReading($, id), now)
  if (legacy !== undefined) await keepLegacyMark($, id, legacy)
  await $.store.set(`usage:${id}`, { ...read, v: WRITER_VERSION, src })
  await setView($, v => ({ ...v, readings: { ...v.readings, [id]: viewed(read, besideOf(v, id), v.fiveHourLimit, now) } }))
}

/** Moves an older version's mark to the mark's own key, unless the mark there already stands longer. */
async function keepLegacyMark($: Host, id: string, legacy: Mark): Promise<void> {
  if (laterMark(markFrom(await $.store.get(`mark:${id}`)), legacy) !== legacy) return
  await $.store.set(`mark:${id}`, legacy)
  await setView($, v => ({ ...v, marks: { ...v.marks, [id]: legacy } }))
}

/** Marks a login's 5-hour window spent for every session, under the mark's own key. */
async function saveMark($: Host, id: string, mark: Mark): Promise<void> {
  await $.store.set(`mark:${id}`, mark)
  const now = await $.clock.now()
  const read = (await ownedReading($, id)) ?? { at: mark.at }
  await setView($, v => ({
    ...v,
    marks: { ...v.marks, [id]: mark },
    readings: { ...v.readings, [id]: viewed(read, { ...besideOf(v, id), mark }, v.fiveHourLimit, now) },
  }))
}

/** Stores a login's health; answers what it was before. */
async function saveHealth($: Host, id: string, health: Health): Promise<Health | undefined> {
  const before = (await getView($)).health[id]
  await $.store.set(`health:${id}`, health)
  await setView($, v => ({ ...v, health: { ...v.health, [id]: health } }))
  return before
}

/** A stored `holder:<id>` as the merge and a check both read it: a token and an email, or none. */
function holderFrom(value: unknown): Holder | undefined {
  const s = value as Holder | null | undefined
  return typeof s === 'object' && s !== null && typeof s.token === 'string' && typeof s.who?.email === 'string' ? s : undefined
}

async function saveHolder($: Host, id: string, holder: Holder): Promise<void> {
  await $.store.set(`holder:${id}`, holder)
}

/** Folds what other sessions stored into this session's view. */
async function mergeStore($: Host): Promise<void> {
  const accounts = await loadAccounts($)
  const readings: Record<string, Reading> = {}
  const marks: Record<string, Mark> = {}
  const noFiveHour: Record<string, boolean> = {}
  const weekMarks: Record<string, Mark> = {}
  const fableMarks: Record<string, Mark> = {}
  const checkErrors: Record<string, CheckError> = {}
  const readAt: Record<string, number> = {}
  const health: Record<string, Health> = {}
  let hasOlderWriter = false
  for (const a of accounts) {
    const r = await storedReading($, a.id)
    if (r?.by === a.id) readings[a.id] = r
    // An older version's reading is never read back; a stop it marked inside one keeps, and one written since this
    // session started says that version still runs.
    const old = await legacyReading($, a.id)
    const legacy = legacyMark(old, await $.clock.now())
    if (legacy !== undefined) await keepLegacyMark($, a.id, legacy)
    const now = await $.clock.now()
    if (bootedAt !== undefined && old !== undefined && old.at > bootedAt && now - old.at < OLDER_WRITER_MS) hasOlderWriter = true
    const m = markFrom(await $.store.get(`mark:${a.id}`))
    if (m !== undefined) marks[a.id] = m
    const n = await $.store.get(`no-five-hour:${a.id}`)
    if (typeof n === 'boolean') noFiveHour[a.id] = n
    const k = markFrom(await $.store.get(`week-mark:${a.id}`))
    if (k !== undefined) weekMarks[a.id] = k
    const f = markFrom(await $.store.get(`fable-mark:${a.id}`))
    if (f !== undefined) fableMarks[a.id] = f
    const e = await $.store.get(`check-error:${a.id}`)
    if (typeof e === 'object' && e !== null && typeof (e as CheckError).why === 'string' && typeof (e as CheckError).at === 'number') checkErrors[a.id] = e as CheckError
    // The last good usage read, any session's: a response rewrites `usage:<id>` and its `at`, so the schedule says it.
    const goodAt = usageDueFrom(await $.store.get(`usage-due:${a.id}`))?.at
    if (goodAt !== undefined) readAt[a.id] = goodAt
    const h = await $.store.get(`health:${a.id}`)
    if (typeof h === 'object' && h !== null && typeof (h as Health).kind === 'string') health[a.id] = h as Health
  }
  const footer = footerStyleFrom(await $.store.get('footer'))
  const rotateTo = rotateToFrom(await $.store.get('rotate-to'))
  const fiveHourLimit = fiveHourLimitFrom(await $.store.get('five-hour-limit'))
  const weekLeave = weekLeaveFrom(await $.store.get('week-leave'))
  const launchOn = launchOnFrom(await $.store.get('launch-on'))
  const now = await $.clock.now()
  const fableContinueText = continueTextFrom(await $.store.get('fable-continue-text'))
  const chrome = await $.store.get('chrome-account')
  const chromeAccountId = typeof chrome === 'string' && accounts.some(a => a.id === chrome) ? chrome : undefined
  const seen = await $.store.get('chrome-accounts')
  const chromeAccountIds = (Array.isArray(seen) ? seen : []).filter((id): id is string => typeof id === 'string' && accounts.some(a => a.id === id))
  await setView($, v => {
    const nextReadings: Record<string, Reading> = {}
    const nextMarks: Record<string, Mark> = {}
    const nextNoFiveHour: Record<string, boolean> = {}
    const nextWeekMarks: Record<string, Mark> = {}
    const nextFableMarks: Record<string, Mark> = {}
    const nextHealth: Record<string, Health> = {}
    for (const a of accounts) {
      // The reading, the marks and no-five-hour come from the store alone: every save writes the store before the
      // view, and a key another session deleted (its undo, Remove, a sign-in as another account) leaves this view too.
      const kept = readings[a.id]
      const mark = marks[a.id]
      if (mark !== undefined) nextMarks[a.id] = mark
      // With no word stored, a stored reading's own 5-hour window, as read whatever the 5h limit, says it has one.
      const none = noFiveHour[a.id] ?? (kept !== undefined && counted(kept, 'on', now).fiveHour !== undefined ? false : undefined)
      if (none !== undefined) nextNoFiveHour[a.id] = none
      const weekMark = weekMarks[a.id]
      if (weekMark !== undefined) nextWeekMarks[a.id] = weekMark
      const fableMark = fableMarks[a.id]
      if (fableMark !== undefined) nextFableMarks[a.id] = fableMark
      // A stop's mark still in force counts with no reading under it: a reading dropped as no one's takes no mark along.
      const inForce = (m: Mark | undefined) => m !== undefined && Date.parse(m.resetsAt) > now
      const reading = kept ?? (inForce(mark) || inForce(weekMark) || inForce(fableMark) ? { at: now, by: a.id } : undefined)
      if (reading !== undefined) nextReadings[a.id] = viewed(reading, { mark, weekMark, fableMark, noFiveHour: none }, fiveHourLimit, now)
      const own = v.health[a.id]
      const h = signingIn === a.id ? own : (health[a.id] ?? own)
      if (h !== undefined) nextHealth[a.id] = h
    }
    return { ...v, accounts, readings: nextReadings, marks: nextMarks, noFiveHour: nextNoFiveHour, weekMarks: nextWeekMarks, fableMarks: nextFableMarks, checkErrors, readAt, health: nextHealth, footer, rotateTo, fiveHourLimit, weekLeave, launchOn, fableContinueText, chromeAccountId, chromeAccountIds, hasOlderWriter }
  })
  await saveRows($, now)
  await saveStoreId($)
}

/**
 * Names this store for bin/account-rotator's requests, once: the first session that finds no `store-id` writes one.
 * Two sessions writing at once settle on the last write, since each reads the id from the store when it applies.
 */
async function saveStoreId($: Host): Promise<void> {
  if (typeof (await $.store.get('store-id')) === 'string') return
  await $.store.set('store-id', `store-${Math.random().toString(36).slice(2, 12)}`)
}

/** The requests this session has taken: one whose result it could not write is not applied again over a later press. */
const takenRequests = new Set<string>()

/**
 * Sets what this session's Bash children carry in ACCOUNT_ROTATOR_SESSION, for `account use` to name it by. Kept in the
 * view, which a reload keeps, so a child started before a later start still names this session. No session id: /clear
 * moves the id and not the variable, and two processes can resume one id. Refused, the view holds no mark: `use` finds
 * no session, the rest runs on.
 */
async function setSessionMark($: Host): Promise<void> {
  const mark = (await getView($)).sessionMark ?? `session-${Math.random().toString(36).slice(2, 12)}`
  try {
    const set = await $.env.set('ACCOUNT_ROTATOR_SESSION', mark)
    if (set.deny !== undefined) throw new Error(set.deny)
    await setView($, v => ({ ...v, sessionMark: mark }))
  } catch (error) {
    await debug($, `session mark refused: ${String(error)}`)
  }
}

/**
 * Applies each request in the requests folder that names this store's `store-id` and has no result yet, oldest first
 * so the newest stands, and writes its result beside it. A request another store's CLI read, one aimed at another
 * session, or a stale one, is left for the CLI to withdraw. `isMerging`: the store is merged first where any request is
 * there to take, for a caller the minute's merge does not stand before.
 */
async function applyRequests($: Host, isMerging = false): Promise<void> {
  const storeId = await $.store.get('store-id')
  if (typeof storeId !== 'string') return
  const { sessionMark } = await getView($)
  const dir = requestsDir(await $.env.get('CLAUDE_CONFIG_DIR'), (await $.env.get('HOME')) ?? '')
  const entries = await $.fs.list(dir).catch(() => [])
  const names = new Set(entries.map(e => e.name))
  const now = await $.clock.now()
  const requests: RotatorRequest[] = []
  for (const name of names) {
    const nonce = name.endsWith('.json') && !name.endsWith('.result.json') ? name.slice(0, -'.json'.length) : undefined
    if (nonce === undefined || names.has(`${nonce}.result.json`) || takenRequests.has(nonce)) continue
    // A file the CLI is still writing, or one that is no request, reads as none.
    const text = await $.fs.read(`${dir}/${name}`).catch(() => undefined)
    const request = requestFrom(parsed(typeof text === 'string' ? text : undefined), now)
    if (request === undefined || request.nonce !== nonce || request.store !== storeId) continue
    if (request.kind !== 'use' || request.session === sessionMark) requests.push(request)
  }
  if (isMerging && requests.length > 0) await mergeStore($)
  for (const request of requests.sort((a, b) => a.at - b.at)) {
    // The watch over a Bash call and the minute can read one listing: the first to reach a request takes it.
    if (takenRequests.has(request.nonce)) continue
    takenRequests.add(request.nonce)
    await takeRequest($, `${dir}/${request.nonce}.result.json`, request, now)
  }
}

/** Applies one request and writes its result. A failure of either is logged, so the minute's other work still runs. */
async function takeRequest($: Host, resultPath: string, request: RotatorRequest, now: number): Promise<void> {
  const result = (outcome: object) => $.fs.write(resultPath, JSON.stringify({ nonce: request.nonce, ...outcome, at: now }))
  try {
    await result(await applyRequest($, request))
  } catch (error) {
    await debug($, `request ${request.nonce} failed: ${String(error)}`)
    await result({ ok: false, message: `the session failed to apply it: ${String(error)}` }).catch(() => undefined)
  }
}

/**
 * What a request asks, done: `select` sets the login new sessions start on, as the panel's New on does. The result
 * names the pick that setting makes: a login with no room gives way to the next with room, or to Claude Code's login.
 * `use` moves this session. `rm` drops an account, as the panel's Remove does. `add` lists a folder signed in.
 */
async function applyRequest($: Host, request: RotatorRequest): Promise<{ ok: boolean; message: string; pickId?: string; activeId?: string; accountId?: string }> {
  if (request.kind === 'rm') return removeAccount($, request.id, request)
  if (request.kind === 'add') return adoptSlot($, request.slot)
  const target = (await getView($)).accounts.find(a => a.id === request.id)
  if (target === undefined) return { ok: false, message: `account ${request.id} is not listed in this store` }
  if (request.kind === 'use') return useAccount($, target)
  await setLaunchOn($, `account:${request.id}`)
  const { text, pickId } = await pickAnswer($)
  return { ok: true, message: text, pickId }
}

/** Where new sessions start now, in a request's words. */
async function pickAnswer($: Host): Promise<{ text: string; pickId?: string }> {
  const pick = (await $.store.get('launch-slot')) as LaunchPick | undefined
  if (pick === undefined) return { text: "no account has room, so new sessions start on Claude Code's login" }
  return { text: `new sessions start on account ${pick.id} (${pick.why})`, pickId: pick.id }
}

/** Why a request waits out Connect: its visit moves the session and back, unsaid. */
const CONNECTING_TEXT = 'Claude in Chrome is connecting, which moves this session and back: run this again in a minute'

/**
 * Moves this session as the panel's Use now does, under the same rule: only a login signed in. The result reads back
 * where it stands. Unlike a press, nobody watches what comes after: Connect's visit would move the session back
 * unsaid, so a use waits it out; and the account in use needs no switch, only the end of one held for later.
 */
async function useAccount($: Host, target: Account): Promise<{ ok: boolean; message: string; activeId: string }> {
  const view = await getView($)
  const name = label(target)
  if (isConnectingChrome) return { ok: false, message: CONNECTING_TEXT, activeId: view.activeId }
  if (view.activeId === target.id) {
    held?.timer.cancel()
    held = undefined
    return { ok: true, message: `this session already uses account ${name}`, activeId: target.id }
  }
  const health = view.health[target.id]
  if (health?.kind !== 'ok') return { ok: false, message: `account ${name} cannot take over: ${health?.kind === 'login-needed' ? health.why : 'it is not signed in yet'}`, activeId: view.activeId }
  const hasMoved = await switchTo($, target, 'a command asked for it')
  if (hasMoved) return { ok: true, message: `this session now uses account ${name}`, activeId: target.id }
  // switchTo holds a switch for a token about to refresh, and otherwise declines only on a policy refusal.
  if (held !== undefined) return { ok: true, message: `this session moves to account ${name} in a few minutes, once account ${view.activeId}'s token has refreshed`, activeId: view.activeId }
  return { ok: false, message: blockedText(isOnNormalLogin(view)), activeId: view.activeId }
}

/** What a Bash command spells to be watched: both bins' names hold it. */
const CLI_NAME = 'account-rotator'

/**
 * Applies requests each beat while `watch.isRunning`, for at most the time a request lasts: a command that only names
 * the CLI can run for hours, and the minute takes whatever comes later. Before boot has read the accounts, it would
 * answer that none is listed.
 */
async function watchRequests($: Host, watch: { isRunning: boolean }): Promise<void> {
  const until = (await $.clock.now()) + REQUEST_TTL_MS
  const isWatching = async () => watch.isRunning && (await $.clock.now()) < until
  while (await isWatching()) {
    await $.clock.sleep(REQUEST_POLL_MS)
    if (isBooted && (await isWatching())) await applyRequests($, true).catch(error => debug($, `requests failed: ${String(error)}`))
  }
}

/** JSON text as a value, or undefined where it does not parse. */
function parsed(text: string | undefined): unknown {
  try {
    return text === undefined ? undefined : JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Stores every login's row under `rows`, for the CLI, when the lines differ from what the store holds: whichever
 * session wrote them, so sessions that see the same store write them once between them.
 */
async function saveRows($: Host, now: number): Promise<void> {
  const rows = rowsOf(await getView($), now)
  if (isSameRows(await $.store.get('rows'), rows)) return
  await $.store.set('rows', { v: WRITER_VERSION, at: now, rows })
}

/** Changes the footer's look for every session. */
async function setFooter($: Host, change: Partial<FooterStyle>): Promise<void> {
  const footer = { ...footerStyleFrom(await $.store.get('footer')), ...change }
  await $.store.set('footer', footer)
  await setView($, v => ({ ...v, footer }))
}

/** Changes which login the rotation moves to, for every session. */
async function setRotateTo($: Host, rotateTo: RotateTo): Promise<void> {
  await $.store.set('rotate-to', rotateTo)
  await setView($, v => ({ ...v, rotateTo }))
}

/** Turns the 5-hour window's count on or off, for every session, recounting each stored read at once. */
async function setFiveHourLimit($: Host, fiveHourLimit: FiveHourLimit): Promise<void> {
  await $.store.set('five-hour-limit', fiveHourLimit)
  const now = await $.clock.now()
  const stored: Record<string, Reading> = {}
  for (const id of Object.keys((await getView($)).readings)) {
    const r = await ownedReading($, id)
    if (r !== undefined) stored[id] = r
  }
  await setView($, v => ({
    ...v,
    fiveHourLimit,
    readings: Object.fromEntries(Object.entries(v.readings).map(([id, r]) => [id, viewed(stored[id] ?? r, besideOf(v, id), fiveHourLimit, now)])),
  }))
  await maybeRotate($)
}

/** Sets, for every session, how much of its week is left when the session leaves the login in use: 0 to 99, a press one step. */
async function setWeekLeave($: Host, weekLeave: number): Promise<void> {
  const kept = Math.min(WEEK_LEAVE_MAX, Math.max(0, Math.round(weekLeave)))
  await $.store.set('week-leave', kept)
  await setView($, v => ({ ...v, weekLeave: kept }))
  await maybeRotate($)
}

/** Sets, for every session, which login new sessions start on. */
async function setLaunchOn($: Host, launchOn: LaunchOn): Promise<void> {
  await $.store.set('launch-on', launchOn)
  await setView($, v => ({ ...v, launchOn }))
  await saveLaunchPick($)
}

/**
 * Stores the login a launcher starts new sessions on, as the setting picks it
 * now, for `bin/account-rotator-launch`; none, while no login has room.
 */
async function saveLaunchPick($: Host): Promise<void> {
  // Picked from the store as it stands: a setting or account another session changed since this view last read it counts.
  await mergeStore($)
  const now = await $.clock.now()
  const pick = pickLaunch(await getView($), now)
  const held = await $.store.get('launch-slot')
  const was = typeof held === 'object' && held !== null ? (held as LaunchPick) : undefined
  if (pick === undefined) {
    if (was !== undefined) await $.store.delete('launch-slot')
    return
  }
  if (was?.id === pick.id && was.slot === pick.slot && was.why === pick.why) return
  await $.store.set('launch-slot', { ...pick, at: now })
}

/** Names the account the Chrome extension is signed in to, for every session; none forgets it. */
async function setChromeAccount($: Host, id: string | undefined): Promise<void> {
  if (id === undefined) await $.store.delete('chrome-account')
  else await $.store.set('chrome-account', id)
  await setView($, v => ({ ...v, chromeAccountId: id }))
}

/** A Chrome extension answered as `id`, or none did, or the account is gone: the Chrome box lists it, or not, for every session. */
async function noteChromeAccount($: Host, id: string, isSeen: boolean): Promise<void> {
  const stored = await $.store.get('chrome-accounts')
  const before = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
  const ids = isSeen ? [...new Set([...before, id])] : before.filter(x => x !== id)
  if (ids.length !== before.length) await $.store.set('chrome-accounts', ids)
  await setView($, v => ({ ...v, chromeAccountIds: ids }))
}

// ---------------------------------------------------------------- host

type Stored = { state: 'present'; credential: Credential | undefined } | { state: 'absent' } | { state: 'unreadable'; code: number }

/** A slot's stored login, from the keychain on macOS or its file elsewhere (Linux); the secret stays in this module. */
async function readStored($: Host, slot: string): Promise<Stored> {
  return (await $.fs.exists(MACOS_MARKER)) ? readKeychain($, slot) : readCredentialsFile($, slot)
}

async function readKeychain($: Host, slot: string): Promise<Stored> {
  const user = keychainUser(await $.env.get('USER'))
  const argv = ['security', 'find-generic-password', '-a', user, '-w', '-s', await keychainItem(slot)]
  const { exitCode, stdout } = await $.process.run(argv, { timeoutMs: 10_000 })
  if (exitCode === 44) return { state: 'absent' }
  if (exitCode !== 0) return { state: 'unreadable', code: exitCode }
  return { state: 'present', credential: credentialFrom(stdout.trim()) }
}

/**
 * A file that cannot be read holds no login, as Claude Code counts it: a
 * missing or locked file, and one caught mid-write (Claude Code renames a new
 * one into place, rewriting it in place only where that fails).
 */
async function readCredentialsFile($: Host, slot: string): Promise<Stored> {
  const path = credentialsFile(slot, await $.env.get('HOME'))
  const text = path === undefined ? undefined : await $.fs.read(path).catch(() => undefined)
  return text === undefined ? { state: 'absent' } : { state: 'present', credential: credentialFrom(text) }
}

type UsageAnswer = { kind: 'ok'; body: unknown } | { kind: 'rejected' } | { kind: 'failed'; status: number; retryAfter?: number }

const oauthHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'anthropic-beta': 'oauth-2025-04-20',
  'Content-Type': 'application/json',
})

/** The usage of the login a token belongs to, as `/usage` reads it. */
async function fetchUsage($: Host, accessToken: string): Promise<UsageAnswer> {
  const res = await $.http.fetch(USAGE_URL, { headers: oauthHeaders(accessToken) })
  if (res.status === 401 || res.status === 403) return { kind: 'rejected' }
  if (!res.ok) {
    const retryAfter = retryAfterFrom(res.headers ?? {}, await $.clock.now())
    return { kind: 'failed', status: res.status, ...(retryAfter === undefined ? {} : { retryAfter }) }
  }
  try {
    return { kind: 'ok', body: JSON.parse(res.text) }
  } catch {
    // A 2xx that is not JSON counts as a failed call; the next check asks again.
    return { kind: 'failed', status: res.status }
  }
}

/** Who a token signs in, as Claude Code asks at a sign-in: email, organization and plan; undefined when the call fails. */
async function fetchIdentity($: Host, accessToken: string): Promise<{ who?: Identity; status: number }> {
  const res = await $.http.fetch(PROFILE_URL, { headers: oauthHeaders(accessToken) })
  if (!res.ok) return { status: res.status }
  try {
    return { who: identityFromProfile(JSON.parse(res.text)), status: res.status }
  } catch {
    // A body that is not JSON says nothing of who; the next check asks again.
    return { status: res.status }
  }
}

/** Who a slot is signed in as: email, organization and plan. */
async function signedInAs($: Host, slot: string): Promise<Identity | undefined> {
  const { exitCode, stdout } = await $.process.run(['claude', 'auth', 'status', '--json'], {
    env: slotEnv(slot),
    timeoutMs: 20_000,
  })
  return exitCode === 0 ? identityFromStatus(stdout) : undefined
}

/** Points this session's requests, and every child it starts after, at a slot's login. */
async function useSlot($: Host, slot: string): Promise<void> {
  const set = slot === '' ? await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', undefined) : await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', slot)
  // The engine's hold resolves with its reason; a hook's refusal rejects. Callers meet both as a throw.
  if (set.deny !== undefined) throw new SwitchHeld(set.deny)
}

/**
 * Claude Code's security policy refuses switching in this session: says so
 * once, as a toast and a notification, and the pane says so while it lasts.
 * False when it was said already.
 */
async function blocked($: Host): Promise<boolean> {
  const view = await getView($)
  if (view.isSwitchBlocked) return false
  await setView($, v => ({ ...v, isSwitchBlocked: true }))
  const text = blockedText(isOnNormalLogin(view))
  $.ui.toast(text, { timeoutMs: 15_000 })
  await $.ui.notify(text, { title: TITLE })
  return true
}

/**
 * Sets the slot already in use, which changes nothing: the policy that refuses
 * a switch refuses this too, so a session that cannot switch says so at its start.
 */
async function checkSwitching($: Host, slot: string): Promise<void> {
  try {
    await useSlot($, slot)
  } catch (error) {
    if (isPolicyRefusal(error)) await blocked($)
    else await debug($, `switch check failed: ${String(error)}`)
  }
}

// ---------------------------------------------------------------- checks and switching

async function announceLockout($: Host, account: Account, why: string): Promise<void> {
  const text = `Claude account ${label(account)} needs a sign-in (${why}). Click ⚠${account.id} under the prompt.`
  $.ui.toast(text, { timeoutMs: 8000 })
  await $.ui.notify(text, { title: TITLE })
}

/** The reasons a Fable stop left the session where it was that the terminal has been told: each once a session, however many stops follow. */
const toldStays = new Set<StayReason>()

/** A Fable stop that did not move says why, and the way out, through the terminal's own notice, for a session left running; the band and toast are easy to miss. */
async function announceStay($: Host): Promise<void> {
  const stay = fableStay(await getView($), await $.clock.now(), isConnectingChrome, untaken)
  if (stay === undefined || toldStays.has(stay.reason)) return
  toldStays.add(stay.reason)
  await $.ui.notify(stay.text, { title: TITLE })
}

/**
 * Who a login's sign-in belongs to: as answered for its token before, else
 * asked while the token is live. A /login in a session on a login signs in
 * there, and a new sign-in brings a new token, so it is asked about again.
 */
async function holderOf($: Host, account: Account, credential: Credential, isLive: boolean): Promise<Holder | undefined> {
  const token = await fingerprint(credential.refreshToken ?? credential.accessToken)
  // The store's, not the view's: a sign-in another session named since this view's last merge is not taken for a new one.
  const known = holderFrom(await $.store.get(`holder:${account.id}`))
  if (known?.token === token) return known
  if (!isLive) return undefined
  const { who, status } = await fetchIdentity($, credential.accessToken)
  // Another session may have named this sign-in while the profile call ran: then it is not a new one.
  const named = holderFrom(await $.store.get(`holder:${account.id}`))
  if (named?.token === token) return named
  if (who?.email === undefined) {
    // No usage is read for a sign-in nobody has named: the pane says why, until a check names it.
    const what = status >= 200 && status < 300 ? 'the profile answer named no email' : `the profile call answered HTTP ${status}`
    await saveCheckError($, account.id, `${what}, so its usage is not read until it names the sign-in`)
    return undefined
  }
  const holder = { token, who: { ...who, email: who.email, ...(credential.plan === undefined ? {} : { plan: credential.plan }) } }
  await saveHolder($, account.id, holder)
  // The schedule, its back-off and its minute gate were the old token's: the new one is read at once. What another
  // account's usage said is its own, not this one's (its plan above all): it goes with it. The same account under a
  // new token (a refresh, or the same person signing in again) keeps its reading.
  const isOtherAccount = known !== undefined && (known.who.email !== who.email || known.who.orgId !== who.orgId)
  if (isOtherAccount) await dropSignInUsage($, account.id)
  else if (known !== undefined) await $.store.delete(`usage-due:${account.id}`)
  return holder
}

/**
 * The account as `who`'s sign-in names it. The plan's name and the tier are the sign-in's own: what `who` names
 * replaces them, and what it leaves out clears them, so a new sign-in never wears the last one's plan.
 */
function withSignIn(account: Account, who: Identity): Account {
  const { planName: _planName, tier: _tier, ...rest } = account
  return { ...rest, ...who }
}

/** Drops what the last sign-in's usage left on a login (its reading, its no-five-hour, its schedule), for every session. */
async function dropSignInUsage($: Host, id: string): Promise<void> {
  for (const key of [`usage:${id}`, `no-five-hour:${id}`, `usage-due:${id}`]) await $.store.delete(key)
  await setView($, v => {
    const { [id]: _reading, ...readings } = v.readings
    const { [id]: _noFive, ...noFiveHour } = v.noFiveHour ?? {}
    return { ...v, readings, noFiveHour }
  })
}

/**
 * A login's sign-in belongs to `who`. Another login on the list: this one
 * holds that one's sign-in, answered so it asks for its own again. Else the
 * login is who signed in, its name and plan kept current, and told when that
 * is another account than before: a /login in a session on it did that.
 */
async function followSignIn($: Host, account: Account, who: Identity): Promise<Account | undefined> {
  const accounts = await loadAccounts($)
  const own = accounts.find(a => a.id === account.id)
  if (own === undefined) return undefined
  const isSame = own.email === undefined || isLoginOf(own, who)
  const twin = isSame ? undefined : accounts.find(a => a.id !== own.id && isLoginOf(a, who))
  if (twin !== undefined) return twin
  const followed = withSignIn(own, who)
  const fields = ['email', 'orgId', 'orgName', 'plan', 'planName', 'tier'] as const
  if (fields.some(f => followed[f] !== own[f])) {
    await saveAccounts($, accounts.map(a => (a.id === own.id ? followed : a)))
  }
  if (!isSame) {
    const name = `${followed.email}${followed.orgName ? ` · ${followed.orgName}` : ''}`
    tell(
      $,
      own.slot === ''
        ? `Claude Code's login, account ${own.id}, is ${name} now: new sessions start on it.`
        : `Claude account ${own.id} is ${name} now: a /login in a session on account ${own.id} signs in there, not Claude Code's login.`,
    )
  }
  return undefined
}

/** This session's name on a usage claim, when the engine names no session. */
const SELF = `module-${Math.random().toString(36).slice(2, 10)}`

/**
 * How a check may read a login's usage. `claimed`: the schedule says it is due and this session claimed it.
 * `force`: a stop, a /login or a sign-in asks, so it reads unless a back-off stands, another session's read is under
 * way, or the last good read is under a minute old. `since`: a settling switch, read once unless a good read came
 * after the switch began. `none`: the sign-in only, no usage call.
 */
type UsageGate = 'claimed' | 'force' | 'none' | { since: number }

/** Claims, for this session, the read of each login whose schedule says it is due; answers those whose claim stands. */
async function claimDue($: Host, ids: readonly string[]): Promise<Set<string>> {
  const sessionId = (await getView($)).sessionId ?? SELF
  // The engine reads `$` only as `$.noun.event(...)` at the call site: the store goes over as two calls.
  const store = { get: (key: string) => $.store.get(key), set: (key: string, value: unknown) => $.store.set(key, value) }
  const hasOwnReading = async (id: string) => (await storedReading($, id)) !== undefined
  return claimDueReads(store, ids, sessionId, await $.clock.now(), () => $.clock.sleep(USAGE_CLAIM_WAIT_MS), hasOwnReading)
}

/** The schedule a read leaves when its gate lets it start: this session's claim, from now; undefined when it may not. */
function startRead(gate: Exclude<UsageGate, 'none'>, due: UsageDue | undefined, sessionId: string, now: number): UsageDue | undefined {
  if (gate === 'claimed') return renewClaim(due, sessionId, now)
  const isAllowed = gate === 'force' ? mayForceUsage(due, sessionId, now) : mayReadSince(due, sessionId, now, gate.since)
  return isAllowed ? claimUsage(due, sessionId, now) : undefined
}

/**
 * The one way to the usage endpoint: reads a login's usage when its gate lets it, and stores, for every session,
 * when it is next read. The claim is written as the read starts, so it lasts from the read. Undefined when the gate
 * says no.
 */
async function requestUsage($: Host, account: Account, accessToken: string, gate: UsageGate): Promise<UsageAnswer | undefined> {
  if (gate === 'none') return undefined
  const key = `usage-due:${account.id}`
  const stored = await storedReading($, account.id)
  const due = gatingDue(usageDueFrom(await $.store.get(key)), stored !== undefined)
  const now = await $.clock.now()
  const claim = startRead(gate, due, (await getView($)).sessionId ?? SELF, now)
  if (claim === undefined) return undefined
  await $.store.set(key, claim)
  // A response some session stored since the last good read: the login is in use.
  const hasResponded = stored?.by === account.id && stored.at > (due?.at ?? now - USAGE_IDLE_MS)
  let usage: UsageAnswer
  try {
    usage = await fetchUsage($, accessToken)
  } catch (error) {
    // A call that throws is a failed read: it backs off as one, for every session.
    await $.store.set(key, afterUsage(due, { kind: 'failed' }, await $.clock.now()))
    throw error
  }
  const at = await $.clock.now()
  // A body that holds no usage the mod reads stores no reading: it is no good read.
  const ok = usage.kind === 'ok' ? { kind: readingFromUsage(usage.body, at) === undefined ? ('empty' as const) : ('ok' as const), hasResponded } : undefined
  const outcome = ok ?? (usage.kind === 'rejected' ? usage : { kind: 'failed' as const, retryAfter: usage.retryAfter })
  await $.store.set(key, afterUsage(due, outcome, at))
  return usage
}

/** Why a failed usage call failed, as the pane says it: its status, and the wait its Retry-After asked for. */
const failedWhy = (usage: { status: number; retryAfter?: number }): string =>
  `the usage call answered HTTP ${usage.status}${usage.retryAfter === undefined ? '' : ` (retry after ${Math.round(usage.retryAfter / 1000)} s)`}`

/**
 * Re-reads one login's stored sign-in: who it belongs to and, while its token
 * is live and its gate lets it, its usage. One that is another login's on the
 * list leaves this login needing its own, its usage that other's.
 */
async function checkAccount($: Host, account: Account, gate: UsageGate): Promise<void> {
  const now = await $.clock.now()
  if (signingIn === account.id) return
  const stored = await readStored($, account.slot)
  if (stored.state === 'unreadable') {
    tell($, `Could not read Claude account ${account.id} from the keychain (exit ${stored.code}); is it locked?`)
    return
  }
  const credential = stored.state === 'present' ? stored.credential : undefined
  let health = healthOf(credential, now)
  if (health.kind === 'ok' && credential !== undefined) {
    const isLive = credential.expiresAt > now + 60_000
    const holder = await holderOf($, account, credential, isLive)
    // The tier is the sign-in's own, read at every check: a holder named before it was kept lacks it.
    const who = holder === undefined ? undefined : { ...holder.who, ...(credential.tier === undefined ? {} : { tier: credential.tier }) }
    const twin = who === undefined ? undefined : await followSignIn($, account, who)
    if (twin !== undefined) health = { kind: 'login-needed', why: `signed in as account ${twin.id} now` }
    // A token no profile call has named may be another login's: its usage is read and stored once it is named.
    else if (isLive && holder !== undefined) {
      const usage = await requestUsage($, account, credential.accessToken, gate)
      if (usage?.kind === 'rejected') health = { kind: 'login-needed', why: 'sign-in rejected' }
      if (usage?.kind === 'failed') await saveCheckError($, account.id, failedWhy(usage))
      if (usage?.kind === 'ok') {
        await saveCheckError($, account.id, undefined)
        const read = readingFromUsage(usage.body, now)
        if (read !== undefined) {
          const { noFiveHour, ...reading } = read
          // A body whose 5-hour window it cannot read leaves what the last one said.
          if (reading.fiveHour !== undefined || noFiveHour === true) await saveNoFiveHour($, account.id, noFiveHour === true)
          // A body with no Fable row keeps the stored one's: the stored read, never the view, which carries the marks.
          await saveReading($, account.id, { ...keepFable(reading, await ownedReading($, account.id), now), by: account.id }, 'body')
        }
      }
    }
  }
  const before = await saveHealth($, account.id, health)
  if (health.kind === 'login-needed' && before?.kind !== 'login-needed') {
    await announceLockout($, account, health.why)
  }
}

/**
 * Reads the usage of each login the schedule says is due and this session claims, with its sign-in. `isEvery`: the
 * sign-in of every other login is checked too (boot and the 10-minute check); else (the minute's tick) only the
 * claimed logins are, so a due read waits a minute at most, whatever the 10-minute check's phase.
 */
async function checkAll($: Host, isEvery = true): Promise<void> {
  const { accounts } = await getView($)
  let ours = new Set<string>()
  try {
    ours = await claimDue($, accounts.map(a => a.id))
  } catch (error) {
    // The sign-in checks still run, login by login: a store that fails a claim reads no usage this time.
    await debug($, `claiming usage reads failed: ${String(error)}`)
  }
  for (const account of accounts.filter(a => isEvery || ours.has(a.id))) {
    try {
      await checkAccount($, account, ours.has(account.id) ? 'claimed' : 'none')
    } catch (error) {
      await debug($, `checking account ${account.id} failed: ${String(error)}`)
      // The error's own text can carry anything a call returned: only its kind leaves the debug log.
      const kind = error instanceof Error ? error.name : 'an error'
      await saveCheckError($, account.id, `the check failed (${kind}); the debug log has the rest`).catch(() => undefined)
    }
  }
  // The rows carry what this check read, for a session that ends before the next merge: maybeRotate's launch pick
  // merges first, which writes them from the store as it stands, where every save went first and another session's
  // reads since this check began are too.
  await maybeRotate($)
}

/** The longest failure the pane and the store keep, in characters. */
const CHECK_ERROR_MAX = 200

/** Records, for every session, that a login's usage check failed and why; undefined clears it once a check succeeds. */
async function saveCheckError($: Host, id: string, why: string | undefined): Promise<void> {
  if (why === undefined) {
    // Another session's failure counts too: the store, not this session's view, says whether one stands.
    if ((await getView($)).checkErrors?.[id] === undefined && (await $.store.get(`check-error:${id}`)) === undefined) return
    await $.store.delete(`check-error:${id}`)
    await setView($, v => {
      const { [id]: _cleared, ...checkErrors } = v.checkErrors ?? {}
      return { ...v, checkErrors }
    })
    return
  }
  await debug($, `account ${id}: ${why}`)
  const failure: CheckError = { why: why.slice(0, CHECK_ERROR_MAX), at: await $.clock.now() }
  await $.store.set(`check-error:${id}`, failure)
  await setView($, v => ({ ...v, checkErrors: { ...v.checkErrors, [id]: failure } }))
}

/** Why the login in use is left, counted the way the footer shows it: room left, or what is used. */
function whyLeave(view: View, now: number, need?: Need): string {
  if (view.health[view.activeId]?.kind === 'login-needed') return `account ${view.activeId} needs a sign-in`
  const r = view.readings[view.activeId]
  const five = windowPct(r?.fiveHour, now) ?? 0
  const [window, used] =
    need === 'fable' && isFableSpent(r, now)
      ? ['Fable week', windowPct(r?.fable, now) ?? 0]
      : five >= LEAVE_FIVE_HOUR
        ? ['5-hour window', five]
        : ['week', windowPct(r?.sevenDay, now) ?? 0]
  return view.footer.fill === 'left'
    ? `account ${view.activeId} has ${Math.round(100 - used)}% of its ${window} left`
    : `account ${view.activeId} has used ${Math.round(used)}% of its ${window}`
}

/**
 * Once the active login is spent or locked out, moves to the one the pane's
 * Rotation setting picks; never while it is off, Claude Code's policy refuses
 * it, or Connect holds the session where it is. After a turn that died on the
 * Fable week (`need`), it leaves for that too, and only for a login with Fable
 * room: the ticks and responses pass none, so a session that never hit the
 * Fable week stays on a login whose Fable week is spent.
 */
async function maybeRotate($: Host, need?: Need, carry?: CarryOn): Promise<boolean> {
  // Every check, response and tick comes through here: the login new sessions start on follows the same readings.
  await saveLaunchPick($).catch(error => debug($, `launch pick failed: ${String(error)}`))
  const now = await $.clock.now()
  const view = await getView($)
  // A tick or a response is no stop: it leaves a held Fable recovery where it is going, to a login with Fable room.
  if (need === undefined && carry === undefined && held?.carry !== undefined) return false
  // A settling switch holds every tick and response; a stop (it carries on) may move the session on from it.
  const isSettling = view.pending !== undefined && carry === undefined
  if (isConnectingChrome || view.rotateTo === 'off' || view.isSwitchBlocked || isSettling || !shouldLeave(view, now, need)) return false
  // With none to move to, the band above the prompt says when the next login frees up.
  const target = pickTarget({ ...view, accounts: view.accounts.filter(a => !untaken.has(a.id)) }, now, need)
  return target === undefined ? false : switchTo($, target, whyLeave(view, now, need), false, carry, true)
}

/** The login in use, when its token refreshes too soon for the refresh guard to let the session leave it for `target`. */
async function refreshingSoon($: Host, view: View, target: Account, now: number): Promise<Account | undefined> {
  const active = view.accounts.find(a => a.id === view.activeId)
  if (active === undefined || active.id === target.id) return undefined
  const stored = await readStored($, active.slot)
  const credential = stored.state === 'present' ? stored.credential : undefined
  // A token that has already run out is refreshed first of all, at the session's next request: the switch waits for it too.
  // A sign-in whose refresh token has run out refreshes nothing, and nor does one already rejected with its token run out:
  // nothing holds the switch off either.
  const isExpired = credential !== undefined && credential.expiresAt <= now
  const isRejected = isExpired && view.health[active.id]?.kind === 'login-needed'
  const canRefresh = credential !== undefined && healthOf(credential, now).kind === 'ok' && !isRejected
  const isSoon = canRefresh && credential.expiresAt - now < REFRESH_GUARD_MS
  return isSoon ? active : undefined
}

/**
 * Tries the held switch again. One the rotation asked for is asked of it again:
 * turned off or refused by Claude Code's policy since, the switch is dropped; while
 * Connect holds the session, it waits for the next minute. One the person pressed for goes.
 */
async function retryHeld($: Host): Promise<void> {
  const h = held
  if (h === undefined) return
  if (h.isRotation) {
    const view = await getView($)
    if (view.rotateTo === 'off' || view.isSwitchBlocked) {
      h.timer.cancel()
      if (held === h) held = undefined
      return
    }
    if (isConnectingChrome) return
  }
  await switchTo($, h.target, h.why, false, h.carry, h.isRotation)
}

/**
 * Asks Claude to carry on once the switch just made has landed, if the session
 * is still on its account then: no other change of account came since, every
 * one (a Use now, a Rotate now, a switch pointed back) counting in `moves`.
 */
function carryOnAfterSettle($: Host, owed: CarryOn): void {
  const mark = moves
  $.clock.after(SETTLE_MS, () => {
    if (moves === mark) void carryOn($, owed.need).catch(error => debug($, `carry-on failed: ${String(error)}`))
  })
}

/**
 * Points this session at `target`; false while the refresh guard holds it back, or Claude Code's policy refuses it. Quiet: no toast.
 * `carry`: the carry-on the switch owes, sent once it lands. Held back, a Fable stop's carry-on waits for the switch; a plain stop's does not.
 */
async function switchTo($: Host, target: Account, why: string, isQuiet = false, carry?: CarryOn, isRotation = false): Promise<boolean> {
  const active = await refreshingSoon($, await getView($), target, await $.clock.now())
  if (active !== undefined) {
    // Where the held switch goes, what it carries on with and who asked for it are one intent, replaced together:
    // a later stop or press brings its own (a plain stop's, a press's, carries on with nothing); the retry brings the held one's.
    const owes = carry?.need === 'fable' ? carry : undefined
    if (held === undefined) {
      tell($, `Switching to Claude account ${target.id} in a few minutes, once account ${active.id}'s token has refreshed.`)
      const retry = () => void retryHeld($).catch(error => debug($, `held switch retry failed: ${String(error)}`))
      held = { target, why, timer: $.clock.every(60_000, retry), carry: owes, isRotation }
    } else held = { ...held, target, why, carry: owes, isRotation }
    return false
  }
  // A switch carries on with what it was asked to: the retry passes the held switch's own carry-on, a press none.
  const owed = carry
  held?.timer.cancel()
  held = undefined
  await keepChrome($)
  try {
    await useSlot($, target.slot)
  } catch (error) {
    if (!isPolicyRefusal(error)) throw error
    // A press of Use now or Rotate now gets an answer, even once the notice has shown.
    if (!(await blocked($))) tell($, blockedText(isOnNormalLogin(await getView($))))
    return false
  }
  // A switch that replaces an unproven one ends it unproven. A stop's own move (it carries on) keeps what the stop
  // marked: the mark is why it moves. Any other drops it.
  const replaced = (await getView($)).pending
  if (carry !== undefined) provisionalStop = undefined
  else if (replaced !== undefined) await undoProvisionalStop($, replaced)
  const now = await $.clock.now()
  movedAt = now
  moves += 1
  await setView($, v => ({
    ...v,
    activeId: target.id,
    pending: { id: target.id, from: v.activeId, since: now },
    removing: undefined,
  }))
  if (!isQuiet) $.ui.toast(`Switched to Claude account ${label(target)}: ${why}.`, { timeoutMs: 6000 })
  if (owed !== undefined) carryOnAfterSettle($, owed)
  return true
}

/**
 * After a switch: which login answered the latest response? The new one
 * (confirmed), or too soon to say. Only a response still answered by the old
 * login minutes later is reported: an idle session has no new response to tell.
 * Then the session is pointed back at the old login, and the footer and pane
 * mark it in use again, as it is the one spending. A response is judged against
 * readings no older than the switch: each login it compares is read once after
 * the switch began (the target at the first response, the source at give-up),
 * so a switch costs two usage calls at most, and an idle session's none.
 */
async function settlePending($: Host, isResponse: boolean): Promise<void> {
  const { pending, accounts } = await getView($)
  if (pending === undefined) return
  const now = await $.clock.now()
  if (now - pending.since < SETTLE_MS) return
  const reading = readingFromLimits((await $.session.usage()).rateLimits, now)
  const target = accounts.find(a => a.id === pending.id)
  if (isResponse && target !== undefined) await checkAccount($, target, { since: pending.since })
  // A response proves its login by its week's reset, which each account has at a time of its own; its percents prove
  // nothing, as two logins can stand within a few points of each other.
  const isTarget = (v: View) => whoseWeek(reading, v.readings).includes(pending.id)
  const isSource = (v: View) => whoseWeek(reading, v.readings).includes(pending.from)
  // A response whose week the login left shares tells nothing: confirmed on it, the old login's next responses
  // would be stored as the new one's.
  if (isTarget(await getView($)) && !isSource(await getView($))) {
    await proveSwitch($, pending.id)
  } else if (isResponse && now - pending.since > CONFIRM_GIVE_UP_MS) {
    const from = accounts.find(a => a.id === pending.from)
    if (from !== undefined) await checkAccount($, from, { since: pending.since })
    const after = await getView($)
    // Minutes on, a switch has landed if it ever will: only a response that is the old login's alone points back.
    if (isTarget(after) && isSource(after)) {
      await proveSwitch($, pending.id)
      return
    }
    if (from === undefined || !isSource(after)) {
      // No response proved either login: a stop marked on the one moved to is a guess, and every session reads marks.
      await undoProvisionalStop($, pending)
      await setView($, v => ({ ...v, pending: undefined }))
      tell($, `The switch to Claude account ${pending.id} has not shown in responses.`)
      return
    }
    untaken.add(pending.id)
    await undoProvisionalStop($, pending)
    try {
      await useSlot($, from.slot)
      movedAt = now
      moves += 1
    } catch (error) {
      await debug($, `switch back failed: ${String(error)}`)
    }
    await setView($, v => ({ ...v, activeId: from.id, pending: undefined }))
    tell(
      $,
      `The switch to Claude account ${pending.id} did not take: responses still use account ${label(from)}, so it shows in use again. ` +
        `The rotation leaves account ${pending.id} be in this session; Use now tries it again.`,
    )
  }
}

/** A response's own usage: the active login's, unless a switch is still settling. */
async function onMeasure($: Host, limits: readonly SessionRateLimit[]): Promise<void> {
  const measuredAt = await $.clock.now()
  lastMeasured = { at: measuredAt, reading: readingFromLimits(limits, measuredAt) }
  const view = await getView($)
  if (view.pending !== undefined) {
    await settlePending($, true)
    return
  }
  // Until boot has read which login this session uses, the view's login is a default, not this session's: a
  // response measured then is no login's to store (it once put account 3's week under account 1).
  if (!isBooted) return
  const reading = readingFromLimits(limits, await $.clock.now())
  if (reading === undefined) return
  // Stored only as the login in use's own week: a response whose week is another login's went out on that login's
  // sign-in, and one whose week two logins share proves neither.
  const owners = whoseWeek(reading, view.readings)
  if (owners.length !== 1 || owners[0] !== view.activeId) {
    await debug($, `a response with ${owners.length === 0 ? 'no known week' : `the week of account ${owners.join(', ')}`} is not stored as account ${view.activeId}'s`)
    await maybeRotate($)
    return
  }
  // A response that reports a 5-hour window shows the account has one, whatever the last usage check said: recorded once,
  // in a form the 5h limit does not filter.
  if (reading.fiveHour !== undefined && view.noFiveHour?.[view.activeId] !== false) await saveNoFiveHour($, view.activeId, false)
  // A response never lists the Fable week: the one the last check stored stays (the view's carries the marks).
  const fable = (await ownedReading($, view.activeId))?.fable
  await saveReading($, view.activeId, { ...reading, ...(fable ? { fable } : {}), by: view.activeId }, 'response')
  await maybeRotate($)
}

/**
 * Asks Claude to carry on after a switch. After a switch for the Fable week the
 * line kept in the store goes as the person's own words; every other switch,
 * and a Fable one with no line kept, sends the mod's own line under its name.
 */
async function carryOn($: Host, need?: Need): Promise<void> {
  const kept = need === 'fable' ? (await getView($)).fableContinueText : undefined
  await $.prompt.submit(kept === undefined ? { text: CONTINUE } : { text: kept, asUser: true })
}

/**
 * A turn that died on a usage limit or a rejected sign-in: switch, then carry
 * on. When the limit was the Fable week, it moves only to a login with Fable
 * room, and leaves the 5-hour window alone: the window is not what ran out, and
 * a mark on it, stored for every session, would move them all off the login.
 */
async function onStopFailure($: Host, stop: { error: string; last_assistant_message?: string }): Promise<void> {
  const { error } = stop
  if (error !== 'rate_limit' && error !== 'authentication_failed') return
  const view = await getView($)
  const active = view.accounts.find(a => a.id === view.activeId)
  if (active === undefined) return
  let need: Need | undefined
  if (error === 'authentication_failed') {
    const before = await saveHealth($, active.id, { kind: 'login-needed', why: 'sign-in rejected' })
    if (before?.kind !== 'login-needed') await announceLockout($, active, 'sign-in rejected')
  } else {
    // Claude Code reads the new login only once the switch lands: a turn that dies before then went out on the
    // login being left, which the switch already leaves. Nothing is marked on the login moved to; the turn carries on there.
    // A Connect visit and a Fable stop keep their own handling below.
    const isSettling = view.pending !== undefined && (await $.clock.now()) - view.pending.since < SETTLE_MS
    if (isSettling && !isConnectingChrome && !isFableStop(stop.last_assistant_message)) {
      // One carry-on per switch, however many turns die before it lands.
      if (carriedFor !== view.pending?.since) carryOnAfterSettle($, {})
      carriedFor = view.pending?.since
      return
    }
    // While a switch is unproven, a response since it began names the stop's login by its week, alone, or none at all
    // (a mark is every session's). With no response since, the switch has landed by now: the stop is the login moved
    // to, provisionally, and a settle that finds the switch did not take drops what the stop marked there.
    const since = view.pending?.since
    const hasResponseSince = since !== undefined && lastMeasured !== undefined && lastMeasured.at > since
    const owner = since === undefined || !hasResponseSince ? active : provenStopper(view, lastMeasured?.reading)
    const isProvisional = since !== undefined && !hasResponseSince
    let before: Record<string, unknown> = {}
    let wasFableStopped = false
    let readAt = 0
    const snapshot = async () => {
      before = await stopKeys($, active.id)
      wasFableStopped = (await getView($)).isFableStopped === true
      readAt = await $.clock.now()
    }
    if (owner === undefined) await debug($, `a stop while the switch to account ${view.pending?.id} is unproven marks no account`)
    else need = await markStop($, owner, stop.last_assistant_message, isProvisional ? snapshot : undefined)
    if (isProvisional && owner !== undefined) provisionalStop = await recordStop($, active.id, since, before, wasFableStopped, readAt)
    // A stop a response has proven sets this session's Fable stop of its own: no provisional one may take it back.
    else if (need === 'fable' && provisionalStop !== undefined) provisionalStop = { ...provisionalStop, setFableStop: false }
  }
  // A switch still settling stays settling: only a new switch, or a response that proves one, ends it. The stop may
  // move the session meanwhile (maybeRotate lets a stop through a settling switch), and that switch settles anew.
  // The switch sends the carry-on once it lands, held back for a refresh or not.
  if (!(await maybeRotate($, need, { need }))) {
    if (isConnectingChrome) isCutByVisit = true
    if (need === 'fable') await announceStay($)
  }
}

/**
 * Gives back what a stop wrote on the login moved to before any response proved the switch `pending` (any switch,
 * when none is given), once the switch ends with no proof it took: the stop may have gone out on the login left.
 * A key goes back only while it still holds what the stop wrote (another session's write since stands), and its
 * `no-five-hour` only while no usage read came after the stop's own; this session's Fable stop, only where the stop
 * set it and no proven stop has since.
 */
async function undoProvisionalStop($: Host, pending?: { id: string; since: number }): Promise<void> {
  const p = provisionalStop
  provisionalStop = undefined
  if (p === undefined || (pending !== undefined && (p.id !== pending.id || p.since !== pending.since))) return
  const read = await storedReading($, p.id)
  const isReadSince = read?.src === 'body' && read.at > p.readAt
  const gone: string[] = []
  for (const [key, { before, written }] of Object.entries(p.writes)) {
    if (key === `no-five-hour:${p.id}` && isReadSince) continue
    if (!sameValue(await $.store.get(key), written)) continue
    if (before === undefined) {
      await $.store.delete(key)
      gone.push(key)
    } else await $.store.set(key, before)
  }
  if (p.setFableStop) await setView($, v => ({ ...v, isFableStopped: false }))
  // The merge reads each key back; one now gone leaves nothing to read, so the view drops it here.
  const drop = <T,>(entries: Record<string, T> | undefined, key: string): Record<string, T> | undefined => {
    if (entries === undefined || !gone.includes(key)) return entries
    const { [p.id]: _gone, ...rest } = entries
    return rest
  }
  await setView($, v => ({
    ...v,
    marks: drop(v.marks, `mark:${p.id}`),
    weekMarks: drop(v.weekMarks, `week-mark:${p.id}`),
    fableMarks: drop(v.fableMarks, `fable-mark:${p.id}`),
    readings: drop(v.readings, `usage:${p.id}`) ?? v.readings,
    noFiveHour: drop(v.noFiveHour, `no-five-hour:${p.id}`),
  }))
  await mergeStore($)
}

/** The login a stop during an unproven switch belongs to: the one whose week the last response carries, alone. */
function provenStopper(view: View, last: Reading | undefined): Account | undefined {
  const owners = whoseWeek(last, view.readings)
  return owners.length === 1 ? view.accounts.find(a => a.id === owners[0]) : undefined
}

/** Marks what a usage-limit stop on `active` spent, after reading its usage when the gate lets it; answers the need it names. */
async function markStop($: Host, active: Account, said: string | undefined, afterRead?: () => Promise<void>): Promise<Need | undefined> {
  let need: Need | undefined
  {
    await checkAccount($, active, 'force')
    // What stands once the stop's own read is in: the stop's writes are judged against it.
    await afterRead?.()
    const now = await $.clock.now()
    const after = await getView($)
    const r = after.readings[active.id]
    // A mark goes on the read as stored, so a 5-hour window the limit hides stays in it.
    const read = (await ownedReading($, active.id)) ?? r
    // Claude's own words tell the Fable week from any other limit; the usage read decides only where there are none.
    const isFable = said === undefined || said === '' ? isFableSpent(r, now) : isFableStop(said)
    if (isFable) {
      need = 'fable'
      await setView($, v => ({ ...v, isFableStopped: true }))
      // The limit was hit before the usage call shows it: count the Fable week as full, under the mark's own key.
      if (!isFableSpent(r, now)) {
        const spent = fableMark(read?.fable, now)
        await saveFableMark($, active.id, { pct: spent.pct, resetsAt: spent.resetsAt ?? new Date(now + WEEK_MS).toISOString(), at: now })
      }
    } else if (!shouldLeave(after, now) && isSessionStop(said)) {
      // Claude's words name the 5-hour window: the account has one, whatever its last usage check said.
      await saveNoFiveHour($, active.id, false)
      const spent = spentMark(read?.fiveHour, now, FIVE_HOUR_MS)
      await saveMark($, active.id, { pct: spent.pct, resetsAt: spent.resetsAt ?? new Date(now + FIVE_HOUR_MS).toISOString(), at: now })
    } else if (!shouldLeave(after, now) && (isWeeklyStop(said) || reportsNoFiveHour(r))) {
      // The week ran out before the usage call shows it, by Claude's words or as the only window the account has:
      // count the week as full until its reset, never a 5-hour window.
      const spent = spentMark(read?.sevenDay, now, WEEK_MS)
      await saveWeekMark($, active.id, { pct: spent.pct, resetsAt: spent.resetsAt ?? new Date(now + WEEK_MS).toISOString(), at: now })
    } else if (!shouldLeave(after, now)) {
      // The limit was hit before the usage call shows it: count the 5-hour window as full, five hours at most where no reset is known.
      const spent = spentMark(read?.fiveHour, now, FIVE_HOUR_MS)
      await saveMark($, active.id, { pct: spent.pct, resetsAt: spent.resetsAt ?? new Date(now + FIVE_HOUR_MS).toISOString(), at: now })
    }
  }
  return need
}

// ---------------------------------------------------------------- Claude in Chrome
// The Chrome extension answers only connections made as the claude.ai account
// it is signed in to. Claude in Chrome connects at its first call, as the login
// the session's requests use then, and keeps that until it reconnects. So
// Connect moves the session to the extension's account and connects there: as
// the session opens, while it can still move, and when a browser call finds no
// browser. The connection stays as the rotation moves the session on.

type ChromeAnswer = 'paired' | 'unpaired' | 'failed' | 'absent'

/** Claude was held back from the browser, or found none: once Claude in Chrome connects, it is told to carry on. */
let isChromeAwaited = false
/** Connect found no browser as the extension's account: until one answers, a browser call that finds none asks the person instead. */
let hasChromeMissed = false
/** The mod's own call to Claude in Chrome is under way: Connect does not hold it back. */
let isAskingChrome = false
/** A turn hit a usage limit while Connect held the session on the extension's account: it carries on once the session is back. */
let isCutByVisit = false

/**
 * Asks Claude in Chrome which browsers answer, connecting it if this session
 * has not yet: 'failed' when it could not tell (no connection, or no answer in
 * time), 'absent' in a session without Claude in Chrome.
 */
async function askChrome($: Host): Promise<ChromeAnswer> {
  let answer: McpToolResult | undefined
  isAskingChrome = true
  try {
    const late = $.clock.sleep(CHROME_WAIT_MS).then(() => undefined)
    answer = await Promise.race([$.mcp.call(CHROME_SERVER, 'list_connected_browsers', {}), late])
  } catch (error) {
    // No Claude in Chrome tools in this session, or a hook refused the call.
    await debug($, `Claude in Chrome not reached: ${String(error)}`)
    return 'absent'
  } finally {
    isAskingChrome = false
  }
  if (answer === undefined || answer.isError) return 'failed'
  const browsers = browsersFrom(answer.content.map(block => block.text ?? '').join(''))
  return browsers === undefined ? 'failed' : browsers > 0 ? 'paired' : 'unpaired'
}

/** With no account named for the Chrome extension yet, the one a browser answered as is it, for every session. */
async function learnChrome($: Host, account: Account): Promise<void> {
  if ((await $.store.get('chrome-account')) !== undefined) return
  await setChromeAccount($, account.id)
  tell($, `Claude in Chrome connects as Claude account ${label(account)}: your Chrome extension is signed in to it.`)
}

/**
 * What an answer tells, Claude in Chrome having connected as `as`: whether the
 * session has it, how its connection stands, whether the Chrome box lists the
 * account, and, a browser answering, the extension's account. A guess at
 * Claude Code's login that finds none is kept, so it is not tried again.
 */
async function noteChrome($: Host, as: Account, answer: ChromeAnswer): Promise<void> {
  if (answer === 'absent' || answer === 'failed') {
    await setView($, v => ({ ...v, hasChrome: answer === 'failed' }))
    return
  }
  const isPaired = answer === 'paired'
  await setView($, v => ({
    ...v,
    hasChrome: true,
    chrome: { as: as.id, isPaired, ...(!isPaired && v.chrome?.hasFailed ? { hasFailed: true } : {}) },
  }))
  await noteChromeAccount($, as.id, isPaired)
  if (isPaired) await learnChrome($, as)
  else if ((await $.store.get('chrome-account')) === undefined && as.slot === '') await $.store.set('chrome-miss', as.id)
}

/**
 * Before the session moves off the login it is on: where that is the account
 * the Chrome extension is signed in to (or, none named yet, Claude Code's
 * login, where it most often is), connects Claude in Chrome there first, once a
 * session. The connection keeps that account as the session moves on.
 */
async function keepChrome($: Host): Promise<void> {
  const view = await getView($)
  if (view.chrome !== undefined || view.hasChrome === false || isConnectingChrome) return
  // Until a switch lands, the connection could be made as either login.
  if (movedAt !== undefined && (await $.clock.now()) - movedAt < SETTLE_MS) return
  const active = view.accounts.find(a => a.id === view.activeId)
  if (active === undefined) return
  const isGuess = view.chromeAccountId === undefined && active.slot === '' && (await $.store.get('chrome-miss')) !== active.id
  if (view.chromeAccountId !== active.id && !isGuess) return
  await noteChrome($, active, await askChrome($))
}

/**
 * Whether the session connects Claude in Chrome as it opens: an account is
 * named for the extension, signed in. Whatever usage it has left: connecting
 * uses its sign-in, not its usage. Later, a session Claude Code stops from
 * switching couldn't go there.
 */
function shouldConnectAtOpen(view: View): boolean {
  const target = view.accounts.find(a => a.id === view.chromeAccountId)
  if (target === undefined || !canConnectChrome(view)) return false
  const health = view.health[target.id]?.kind
  return target.id === view.activeId || (health !== 'login-needed' && health !== 'logging-in')
}

/**
 * Connect: visits the account the Chrome extension is signed in to, or one
 * tried for it, as Claude Code connects Claude in Chrome with the sign-in the
 * session uses: moves the session there, has Claude in Chrome connect once the
 * move lands (again, where it connected before), asks which browsers answer,
 * and moves back. The connection stays. Then Claude carries on: held back from
 * the browser, or cut by a usage limit on the way. Quiet as the session opens:
 * the pane says how it went. Answers what the browsers did, where it asked them.
 */
function connectChrome($: Host, isQuiet = false, tryId?: string): Promise<ChromeAnswer | undefined> {
  if (isConnectingChrome) return Promise.resolve(undefined)
  isConnectingChrome = true
  return (async () => {
    let done: { target: Account; answer: ChromeAnswer; isVisit: boolean } | undefined
    try {
      done = await connectingChrome($, isQuiet, tryId)
    } finally {
      isConnectingChrome = false
      await setView($, v => ({ ...v, chromeConnecting: undefined }))
    }
    const isMoved = (await maybeRotate($)) || done?.isVisit === true
    const isConnected = done?.answer === 'paired' && isChromeAwaited
    const text = isConnected && done !== undefined ? `Claude in Chrome is connected as Claude account ${label(done.target)}. Continue where you left off.` : isCutByVisit ? CONTINUE : undefined
    if (isConnected) isChromeAwaited = false
    isCutByVisit = false
    if (text !== undefined) {
      // Once the move back lands: until then the turn's requests may go out as the extension's account.
      if (isMoved) $.clock.after(SETTLE_MS, () => void $.prompt.submit({ text }))
      else void $.prompt.submit({ text })
    }
    return done?.answer
  })()
}

/**
 * Use for Chrome, on an account a browser answered as, or Try to connect, on
 * another: Claude in Chrome connects as the account, which once a browser
 * answers there is the extension's, in this session now and in every session
 * from now on. Where none answers, the Chrome box lists it no more, and Claude
 * in Chrome connects again as the account picked before.
 */
async function tryChromeAccount($: Host, id: string): Promise<void> {
  const answer = await connectChrome($, false, id)
  const picked = (await getView($)).chromeAccountId
  if (answer === 'paired') await setView($, v => ({ ...v, isChromeOthersShown: false }))
  else if ((answer === 'unpaired' || answer === 'failed') && picked !== undefined && picked !== id) await connectChrome($)
}

async function connectingChrome(
  $: Host,
  isQuiet: boolean,
  tryId: string | undefined,
): Promise<{ target: Account; answer: ChromeAnswer; isVisit: boolean } | undefined> {
  const view = await getView($)
  const target = view.accounts.find(a => a.id === (tryId ?? view.chromeAccountId))
  const from = view.accounts.find(a => a.id === view.activeId)
  if (target === undefined || from === undefined || !canConnectChrome({ ...view, chromeAccountId: target.id })) return undefined
  // Tried for the extension: the account picked before stays its own until a browser answers as this one.
  const isTrial = target.id !== view.chromeAccountId
  const active = await refreshingSoon($, view, target, await $.clock.now())
  if (active !== undefined) {
    if (!isQuiet) tell($, `Chrome can connect as account ${target.id} once account ${active.id}'s token has refreshed: try again in a few minutes.`)
    return undefined
  }
  await setView($, v => ({ ...v, chromeConnecting: target.id }))
  const isVisit = from.id !== target.id
  if (isVisit && !(await switchTo($, target, 'Claude in Chrome connects as it', true))) return undefined
  const wait = movedAt === undefined ? 0 : movedAt + SETTLE_MS - (await $.clock.now())
  if (wait > 0) await $.clock.sleep(wait)
  // A connection made before, as whichever login the session was on then, is made again as this one.
  const before = await getView($)
  if (before.chrome !== undefined || before.hasChrome === true) {
    try {
      await $.command.run({ command: 'mcp', args: `reconnect ${CHROME_SERVER}` })
    } catch (error) {
      await debug($, `/mcp reconnect ${CHROME_SERVER} failed: ${String(error)}`)
    }
  }
  const answer = await askChrome($)
  if (isTrial && answer === 'paired') await setChromeAccount($, target.id)
  await noteChrome($, target, answer)
  // Whether a browser answers as the extension's account: a trial that found none didn't ask there.
  if (!isTrial || answer === 'paired') hasChromeMissed = answer === 'unpaired'
  if (answer === 'paired') {
    // A browser answering as the account shows the switch took: the rotation need not wait for a response to say so.
    await proveSwitch($, target.id)
  }
  if (isVisit) await leaveVisit($, from)
  if (!isQuiet && answer === 'paired') tell($, `Claude in Chrome is connected as Claude account ${label(target)}.`)
  if (!isQuiet && answer === 'unpaired') {
    const back = isTrial ? view.accounts.find(a => a.id === view.chromeAccountId) : undefined
    tell(
      $,
      `No Chrome extension answers as Claude account ${label(target)}. Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome${isTrial ? ' and try again' : ''}.` +
        (back === undefined ? '' : ` Claude in Chrome goes back to account ${label(back)}.`),
    )
  }
  return { target, answer, isVisit }
}

/**
 * After Connect's visit: back to the login the session was on, while it can
 * serve, or with the rotation off; else on to the one the rotation picks. The
 * extension's account's usage is not the session's to spend.
 */
async function leaveVisit($: Host, from: Account): Promise<void> {
  const now = await $.clock.now()
  const view = await getView($)
  const health = view.health[from.id]?.kind
  const canServe = health !== 'login-needed' && health !== 'logging-in' && !shouldLeave({ ...view, activeId: from.id }, now)
  if (view.rotateTo === 'off' || canServe) {
    await switchTo($, from, 'back from connecting Claude in Chrome', true)
    return
  }
  const target = pickTarget({ ...view, accounts: view.accounts.filter(a => !untaken.has(a.id)) }, now)
  if (target !== undefined) await switchTo($, target, whyLeave({ ...view, activeId: from.id }, now), false, undefined, true)
}

/**
 * After a call to one of Claude in Chrome's tools. One answered marks the
 * connection paired and, as the session's first, names the extension's
 * account where none is. One that found no browser marks it so, for the band,
 * and returns what Claude reads in place of Claude Code's advice to /login:
 * that the mod connects it now, or what to ask the person.
 */
async function onBrowserCall($: Host, isUnanswered: boolean): Promise<string | undefined> {
  const view = await getView($)
  const isSure = movedAt === undefined || (await $.clock.now()) - movedAt >= SETTLE_MS
  const as = view.chrome?.as ?? (isSure ? view.activeId : undefined)
  const chrome = { ...(as === undefined ? {} : { as }), isPaired: !isUnanswered, ...(isUnanswered ? { hasFailed: true } : {}) }
  const after = await setView($, v => ({ ...v, hasChrome: true, chrome }))
  if (!isUnanswered) {
    hasChromeMissed = false
    if (as !== undefined) await noteChromeAccount($, as, true)
    const active = view.accounts.find(a => a.id === view.activeId)
    if (view.chrome === undefined && isSure && active !== undefined) await learnChrome($, active)
    return undefined
  }
  if (after.chromeAccountId === undefined) {
    isChromeAwaited = true
    return chromeNote(after, 'unset')
  }
  // Where Connect can't run: connected as the extension's account already, so Chrome may be closed, or the session can't move there.
  if (!canConnectChrome(after)) return chromeNote(after, after.chrome?.as === after.chromeAccountId ? 'no-browser' : 'blocked')
  isChromeAwaited = true
  if (hasChromeMissed) return chromeNote(after, 'no-browser')
  // Once this hook is done: the turn waits on it, and Connect's /mcp reconnect waits on the turn.
  $.clock.after(0, () => void connectChrome($).catch(error => debug($, `Chrome connect failed: ${String(error)}`)))
  return chromeNote(after, 'connecting')
}

// ---------------------------------------------------------------- sign-in

/** Signs one login in through the browser; its slot gets the new credential. */
async function signIn($: Host, account: Account): Promise<void> {
  const since = await $.clock.now()
  await saveHealth($, account.id, { kind: 'logging-in', since })
  const argv = ['claude', 'auth', 'login', '--claudeai', ...(account.email ? ['--email', account.email] : [])]
  // The child opens the browser itself. The link it prints is the paste-a-code
  // flow, which a background child cannot finish, so stdout goes unread.
  const child = $.process.spawn({ argv, env: slotEnv(account.slot) })
  running = child
  signingIn = account.id
  let errors = ''
  try {
    for await (const { stream, text } of child) {
      if (stream === 'stderr') errors += text
    }
  } catch (error) {
    errors += String(error)
  } finally {
    running = undefined
    signingIn = undefined
  }
  const code = await child.result.then(r => r.code, () => null)
  await saveHealth($, account.id, { kind: 'login-needed', why: 'sign-in not finished' })
  if (code !== 0) {
    tell($, `Sign-in for Claude account ${account.id} did not finish${errors.trim() ? `: ${errors.trim().slice(0, 160)}` : '.'}`)
    return
  }
  await adoptSignIn($, account)
}

/** After a browser sign-in: who signed in, and is it a login already on the list? */
async function adoptSignIn($: Host, account: Account): Promise<void> {
  const who = await signedInAs($, account.slot)
  const accounts = await loadAccounts($)
  const twin = who === undefined ? undefined : accounts.find(a => a.id !== account.id && sameLogin(a, who))
  if (twin !== undefined) {
    await saveHealth($, account.id, { kind: 'login-needed', why: `that was account ${label(twin)} again` })
    tell(
      $,
      `Claude account ${account.id} signed in as account ${label(twin)}. Sign out of claude.ai in your browser (or pick another organization), then sign in again.`,
    )
    return
  }
  const updated = accounts.map(a => (a.id === account.id && who !== undefined ? withSignIn(a, who) : a))
  await saveAccounts($, updated)
  await saveHealth($, account.id, { kind: 'ok' })
  const fresh = updated.find(a => a.id === account.id) ?? account
  await checkAccount($, fresh, 'force')
  await maybeRotate($)
}

function queueSignIn(work: () => Promise<void>): Promise<void> {
  signInQueue = signInQueue.then(work, work)
  return signInQueue
}

/** Signs in, one after another, every login that needs it. */
const signInAll = ($: Host) =>
  queueSignIn(async () => {
    const view = await getView($)
    for (const account of view.accounts.filter(a => view.health[a.id]?.kind === 'login-needed')) {
      await signIn($, account)
    }
  })

const signInOne = ($: Host, id: string) =>
  queueSignIn(async () => {
    const account = (await getView($)).accounts.find(a => a.id === id)
    if (account !== undefined) await signIn($, account)
  })

/** Adds a login in a new slot under ~/.claude/accounts and signs it in. */
async function addAccount($: Host): Promise<void> {
  const accounts = await loadAccounts($)
  const id = freeId(accounts)
  const slot = `${(await $.env.get('HOME')) ?? ''}/.claude/accounts/${id}`
  await $.fs.write(`${slot}/README`, `Claude account ${id}, kept by the account-rotator mod.\n`)
  await saveAccounts($, [...accounts, { id, slot }])
  await saveHealth($, id, { kind: 'login-needed', why: 'not signed in yet' })
  await signInOne($, id)
}

/**
 * An `account add`: lists a folder the CLI signed in, under the folder's number while no other slot holds it. Who signed
 * in is read here, then the list again, as the read takes seconds and another session can list either meanwhile. A
 * twin goes by what is known of a row: a wrong refusal has a way back, a wrong acceptance makes a row nobody removes.
 * The row wears nothing an old holder of its id left: a session not moved by an `rm` can write there after it. The
 * health stands before the row: a session that merges between them would otherwise find it not signed in. The answer
 * is the row the store holds after the write, as the store has no compare-and-set. The minute's check reads its usage.
 */
async function adoptSlot($: Host, slot: string): Promise<{ ok: boolean; message: string; accountId?: string; pickId?: string }> {
  const number = slotNumber(slot, (await $.env.get('HOME')) ?? '')
  if (number === undefined) return { ok: false, message: `${slot} is no numbered folder under ~/.claude/accounts, so nothing is added` }
  const already = async (a: Account) => ({ ok: true, message: `already account ${a.id}`, accountId: a.id, pickId: (await pickAnswer($)).pickId })
  const listed = (await loadAccounts($)).find(a => a.slot === slot)
  if (listed !== undefined) return already(listed)
  const who = await signedInAs($, slot)
  if (who === undefined) return { ok: false, message: `could not read who ${slot} is signed in as, so nothing is added` }
  const accounts = await loadAccounts($)
  const meanwhile = accounts.find(a => a.slot === slot)
  if (meanwhile !== undefined) return already(meanwhile)
  const twin = accounts.find(a => isLoginOf(a, who))
  if (twin !== undefined) {
    return {
      ok: false,
      message: `that sign-in is account ${label(twin)} already${twin.orgId === undefined ? ', as far as is known: its organization is not read yet, so ask again once a check has read it' : ''}, so nothing is added. Sign out of claude.ai in your browser (or pick another organization), then run account add again. ${slot} stays signed in with no account on it: sign it out with CLAUDE_SECURESTORAGE_CONFIG_DIR=${slot} CLAUDE_CONFIG_DIR=${slot} claude auth logout`,
    }
  }
  const account = withSignIn({ id: accounts.some(a => a.id === number) ? freeId(accounts) : number, slot }, who)
  await dropAccountKeys($, account.id)
  await saveHealth($, account.id, { kind: 'ok' })
  await saveAccounts($, [...accounts, account])
  await saveLaunchPick($)
  const stood = (await loadAccounts($)).find(a => a.slot === slot)
  if (stood === undefined || !isLoginOf(stood, who)) return { ok: false, message: `another session's write took the place of the row for ${slot}, so it is not listed as this sign-in` }
  const { text, pickId } = await pickAnswer($)
  return { ok: true, message: `account ${label(stood)} is added; ${text}`, accountId: stood.id, pickId }
}

/** Every store key of one account's own, each dropped when an account goes and before a row takes its id. */
async function dropAccountKeys($: Host, id: string): Promise<void> {
  for (const key of ['reading', 'usage', 'mark', 'no-five-hour', 'week-mark', 'fable-mark', 'check-error', 'health', 'holder', 'usage-due']) {
    await $.store.delete(`${key}:${id}`)
  }
}

/**
 * The second press of Remove, or an `account rm`: signs the slot out, then drops it from the list. It reads the list
 * from the store, as another session may have removed the account already. A logout that fails keeps the account: one
 * dropped from the list with its login still signed in is out of everyone's sight. Other sessions on it are not moved.
 * `seen`: what the CLI read of the account. A request waits, and an id can hold another login by the time it is applied.
 */
async function removeAccount($: Host, id: string, seen?: { slot: string; email?: string; orgId?: string }): Promise<{ ok: boolean; message: string; pickId?: string }> {
  const accounts = await loadAccounts($)
  const account = accounts.find(a => a.id === id)
  if (account === undefined) return { ok: true, message: `account ${id} is already gone` }
  if (account.slot === '') return { ok: false, message: `account ${id} is Claude Code's own login, which the mod does not remove` }
  if (isConnectingChrome) return { ok: false, message: CONNECTING_TEXT }
  if (seen !== undefined && !holdsLogin(seen, account)) {
    return { ok: false, message: `account ${id} holds another login than this command read, so nothing is removed: run account list, then rm again if it is the one you mean` }
  }
  const sharing = accounts.find(a => a.id !== id && a.slot === account.slot)
  if (sharing !== undefined) return { ok: false, message: `account ${id} shares its sign-in with account ${sharing.id}, so signing it out would sign out both: nothing is removed` }
  const view = await getView($)
  if (view.activeId === id) {
    const other = view.accounts.find(a => a.id !== id && view.health[a.id]?.kind === 'ok')
    if (other === undefined || !(await switchTo($, other, `account ${id} is being removed`))) {
      return { ok: false, message: `Claude account ${id} is in use and no other account can take over yet; not removed.` }
    }
  }
  const { exitCode, stderr } = await $.process.run(['claude', 'auth', 'logout'], { env: slotEnv(account.slot), timeoutMs: 20_000 })
  if (exitCode !== 0) {
    const [why] = stderr.trim().split('\n')
    return { ok: false, message: `Claude account ${id} could not be signed out, so it stays listed: ${why || `exit ${String(exitCode)}`}` }
  }
  await saveAccounts($, (await loadAccounts($)).filter(a => a.id !== id))
  if ((await $.store.get('chrome-account')) === id) await setChromeAccount($, undefined)
  await noteChromeAccount($, id, false)
  await dropAccountKeys($, id)
  await setView($, v => {
    const readings = { ...v.readings }
    const marks = { ...v.marks }
    const health = { ...v.health }
    delete readings[id]
    delete marks[id]
    delete health[id]
    const { [id]: _none, ...noFiveHour } = v.noFiveHour ?? {}
    const { [id]: _week, ...weekMarks } = v.weekMarks ?? {}
    const { [id]: _fable, ...fableMarks } = v.fableMarks ?? {}
    const { [id]: _error, ...checkErrors } = v.checkErrors ?? {}
    return { ...v, readings, marks, noFiveHour, weekMarks, fableMarks, checkErrors, health, removing: undefined }
  })
  // A launcher must never start a session on the account just removed.
  await saveLaunchPick($)
  const { text, pickId } = await pickAnswer($)
  return { ok: true, message: `account ${id} is removed; ${text}`, pickId }
}

// ---------------------------------------------------------------- wiring

/** The footer's one press: opens the pane, or closes it while it shows; what it shows changes only once that took. */
async function togglePane($: Host): Promise<void> {
  if (isPaneShown) {
    await $.ui.close({ id: PANE })
    isPaneShown = false
  } else {
    await $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS })
    isPaneShown = true
  }
}

/** Whether `/accounts` is this mod's: registered by it, with no other command of that name. */
let isAccountsOurs = false

/**
 * Registers `/accounts` unless a command of the person's, an MCP server's or another plugin's has the name: theirs
 * stays theirs, said once in the debug log. A refused registration leaves the name to its owner the same way.
 */
async function registerAccounts($: Host): Promise<void> {
  const listed = await $.command.list().catch(() => [])
  const other = listed.find(c => c.name === ACCOUNTS_COMMAND && !(c.source === 'plugin' && c.plugin?.startsWith('account-rotator') === true))
  if (other !== undefined) {
    isAccountsOurs = false
    await debug($, `/${ACCOUNTS_COMMAND} is not registered: a ${other.source} command has the name`)
    return
  }
  try {
    await $.command.register({ name: ACCOUNTS_COMMAND, description: `Open or close the ${TITLE} panel`, immediate: true })
    isAccountsOurs = true
  } catch (error) {
    isAccountsOurs = false
    await debug($, `/${ACCOUNTS_COMMAND} not registered: ${String(error)}`)
  }
}

/** After a /login, which signs in the login this session is on: who it is now, and a move off it when that is another login's account. */
async function checkActive($: Host): Promise<void> {
  const view = await getView($)
  const active = view.accounts.find(a => a.id === view.activeId)
  if (active !== undefined) await checkAccount($, active, 'force')
  await maybeRotate($)
}

/** Rotate now: moves to the login the pane's Rotation setting picks, as the rotation would once this one runs low; with it off, the most room. */
async function rotate($: Host): Promise<void> {
  const view = await getView($)
  const target = pickTarget(view, await $.clock.now())
  if (target === undefined) tell($, 'No other Claude account can take over right now.')
  else await switchTo($, target, 'you pressed Rotate now')
}

/** Every press starts its work in the background: a sign-in outlives the press. */
function actions($: Host): Actions {
  const background = (work: Promise<unknown>) => {
    work.catch(error => tell($, `Something went wrong: ${String(error)}`))
  }
  return {
    togglePane: () => background(togglePane($)),
    rotate: () => background(rotate($)),
    signInAll: () => background(signInAll($)),
    signInOne: id => background(signInOne($, id)),
    cancelSignIn: () => background(Promise.resolve(running?.return({ code: null, signal: 'SIGTERM' }))),
    add: () => background(addAccount($)),
    use: id =>
      background(
        getView($).then(view => {
          const account = view.accounts.find(a => a.id === id)
          return account === undefined ? false : switchTo($, account, 'you picked it')
        }),
      ),
    askRemove: id => background(setView($, v => ({ ...v, removing: id }))),
    remove: id =>
      background(
        removeAccount($, id).then(removed => {
          if (!removed.ok) tell($, removed.message)
        }),
      ),
    setFooter: change => background(setFooter($, change)),
    setRotateTo: rotateTo => background(setRotateTo($, rotateTo)),
    setFiveHourLimit: limit => background(setFiveHourLimit($, limit)),
    setWeekLeave: weekLeave => background(setWeekLeave($, weekLeave)),
    setLaunchOn: launchOn => background(setLaunchOn($, launchOn)),
    tryChromeAccount: id => background(tryChromeAccount($, id)),
    toggleChromeOthers: () => background(setView($, v => ({ ...v, isChromeOthersShown: !v.isChromeOthersShown }))),
    connectChrome: () => background(connectChrome($)),
    setDemo: on => background(setView($, v => ({ ...v, demo: on }))),
  }
}

/** First run makes the normal login number 1; then: which login this session uses, and Claude in Chrome connected as the extension's account. */
async function boot($: Host, isInteractive: boolean): Promise<void> {
  // Terminal.app is the terminal that names itself so and draws block characters from its font.
  const hasFontBlocks = (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal'
  await setView($, v => ({ ...v, hasFontBlocks }))
  let accounts = await loadAccounts($)
  if (accounts.length === 0) {
    accounts = [{ id: '1', slot: '' }]
    await saveAccounts($, accounts)
  }
  const slot = (await $.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR')) ?? ''
  let active = accounts.find(a => a.slot === slot)
  if (active === undefined) {
    // Started on a slot nobody registered (set by hand, or by another tool): adopt it.
    active = { id: freeId(accounts), slot }
    accounts = [...accounts, active]
    await saveAccounts($, accounts)
  }
  const activeId = active.id
  const sessionId = await $.session.id().catch(() => undefined)
  bootedAt = await $.clock.now()
  await mergeStore($)
  await setView($, v => ({ ...v, activeId, ...(sessionId === undefined ? {} : { sessionId }) }))
  isBooted = true
  await checkSwitching($, slot)
  // First, while the session can still move: the rotation waits for it.
  if (isInteractive && shouldConnectAtOpen(await getView($))) {
    void connectChrome($, true).catch(error => debug($, `Chrome connect failed: ${String(error)}`))
  }
  // A live sign-in names its login as it checks; one whose token has run out, from what `claude auth login` left in its folder.
  await checkAll($)
  for (const account of (await loadAccounts($)).filter(a => a.email === undefined || a.orgId === undefined)) {
    const who = await signedInAs($, account.slot)
    if (who === undefined) continue
    const latest = await loadAccounts($)
    await saveAccounts($, latest.map(a => (a.id === account.id ? { ...a, ...who } : a)))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A command typed at the prompt is the person's: it opens the pane as the footer's press does, with no mouse.
    // Awaited before next(e), so a session whose first prompt is /accounts finds it (the engine awaits the first start).
    await registerAccounts($)
    await setSessionMark($)
    const started = await next(e)
    void boot($, e.isInteractive).catch(error => debug($, `start failed: ${String(error)}`))
    void $.ui.panes().then(panes => {
      isPaneShown = panes.some(p => p.id === PANE && p.isShown)
    })
    $.clock.every(60_000, () => {
      void mergeStore($)
        .then(() => applyRequests($).catch(error => debug($, `requests failed: ${String(error)}`)))
        .then(() => settlePending($, false))
        .then(() => checkAll($, false))
        .catch(error => debug($, `sync failed: ${String(error)}`))
    })
    $.clock.every(10 * 60_000, () => {
      void checkAll($).catch(error => debug($, `check failed: ${String(error)}`))
    })
    return started
  })

  // Only while /accounts is this mod's; else the run goes on to the command that owns the name. It shows a pane, no text.
  on('command.run', { command: ACCOUNTS_COMMAND }, async ($, e, next) => {
    if (!isAccountsOurs) return next(e)
    await togglePane($).catch(error => tell($, `The ${TITLE} panel did not ${isPaneShown ? 'close' : 'open'}: ${String(error)}`))
    return {}
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      void onMeasure($, e.rateLimits).catch(error => debug($, `measure failed: ${String(error)}`))
    }
    return next(e)
  })

  // A stop marked on a switch no response has proven is a guess: it goes when the process does, within the end's
  // budget. A /clear or a resume ends the conversation, not the process: the switch, and its proof, go on.
  on('session.end', async ($, e, next) => {
    if (PROCESS_ENDS.has(e.reason)) await undoProvisionalStop($).catch(error => debug($, `undo at session end failed: ${String(error)}`))
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    void onStopFailure($, e).catch(error => debug($, `stop failure handling failed: ${String(error)}`))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Typed at the prompt, /login answers once its sign-in is done; run mid-turn, at once, and the checks find it later.
  on('command.run', { command: 'login' }, async ($, e, next) => {
    const ran = await next(e)
    void checkActive($).catch(error => debug($, `check after /login failed: ${String(error)}`))
    return ran
  }).catch(($, e, next) => next(e))

  // `account use` waits for its answer inside this call, so only a watch during the call can answer it in time. Every
  // other way of running the CLI (`!`, a wrapper's name, a background Bash) has the minute's tick.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.tool !== 'Bash' || !e.command.includes(CLI_NAME)) return next(e)
    const watch = { isRunning: true }
    // A reload aborts the watch's sleep. The call runs on, and the minute of the reloaded module backs it up.
    void watchRequests($, watch).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      watch.isRunning = false
    }
  })

  // While Connect is under way a browser call would connect as the login being left: Claude waits, and is told when to carry on.
  on('tool.check', { tool: CHROME_TOOL }, async ($, e, next) => {
    if (!isConnectingChrome || isAskingChrome) return next(e)
    if (e.tool_use_id !== undefined) isChromeAwaited = true
    return { decision: 'deny' as const, reason: chromeNote(await getView($), 'held') }
  }).catch(($, e, next) => next(e))

  // Claude Code's words for a browser call that found no browser send the person to /login, which here signs in the wrong account.
  on('tool.call', { tool: CHROME_TOOL }, async ($, e, next) => {
    const done = await next(e)
    if (done.deny !== undefined) return done
    const note = await onBrowserCall($, done.isError === true && isNoBrowser(done.text ?? '')).catch(async error => {
      await debug($, `browser call handling failed: ${String(error)}`)
      return undefined
    })
    return note === undefined ? done : { ...done, context: [...(done.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  // However the pane closes, it shows no more once the close took: a hook below that refuses answers `{ deny }`, not a throw.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE && !('deny' in closed && closed.deny !== undefined)) isPaneShown = false
    return closed
  })


  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const view = await getView($)
    if (view.accounts.length === 0) return next(e)
    return Footer($.ui.resolve(e), view, e.props.modes, await $.clock.now(), actions($))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const view = await getView($)
    return Band($.ui.resolve(e), view, await $.clock.now(), actions($)) ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view = await getView($)
    return Pane($.ui.resolve(e), view, await $.clock.now(), actions($), e.props.bodyColumns)
  })
}
