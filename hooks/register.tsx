import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  HookStream,
  McpToolResult,
  ProcessSpawnChunk,
  ProcessSpawnResult,
  Register,
  SessionRateLimit,
} from 'claude-code'

import type { Account, CheckError, FiveHourLimit, FooterStyle, Health, Holder, LaunchOn, LaunchPick, Mark, ProvisionalStop, Reading, ReadingSource, RotateTo, RotatorRequest, UsageDue, View } from '../types'
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
  accountsRoot,
  canConnectChrome,
  chromeNote,
  CONTINUE_TEXT_MAX,
  continueTextFrom,
  credentialFrom,
  credentialsFile,
  endsFableMark,
  fableMark,
  fableStay,
  fingerprint,
  footerStyleFrom,
  freeId,
  firstFreeAt,
  limitNotice,
  healthOf,
  SIGN_IN_REJECTED,
  NOT_SIGNED_IN,
  identityFromProfile,
  identityFromStatus,
  isFableSpent,
  signInFromStatus,
  isFableStop,
  isWeeklyStop,
  withWeekMark,
  withFableMark,
  laterMark,
  reportsNoFiveHour,
  isLoginOf,
  isNoBrowser,
  isPolicyRefusal,
  keepFable,
  isSpent,
  isUnread,
  keychainItem,
  keychainUser,
  claudeAccount,
  label,
  labelOf,
  pickTarget,
  rotateToFrom,
  readingFromLimits,
  readingFromUsage,
  holdsLogin,
  slotNumber,
  shouldLeave,
  WRITER_VERSION,
  whoseWeek,
  whoseReset,
  stopResetAt,
  slotEnv,
  stuckText,
  TOKEN_LIVE_MARGIN_MS,
  isBackedOff,
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
  REQUEST_MAX_BYTES,
  isRequestNonce,
  REQUEST_POLL_MS,
  REQUEST_TTL_MS,
  SwitchHeld,
  requestFrom,
  requestsDir,
  launcherCopyDir,
  escapeAfterFill,
  escapeArgv,
  escapeHeldBack,
  ownContinueAfterLook,
  ownContinueResetAt,
  ownContinueHeldBack,
  screenArgv,
  screenLinesFrom,
  NUDGE_TEXT,
  isBoxFree,
  nudgeHeld,
  pickAfterStop,
  raisesLimitModal,
  renudgeDue,
  wordingClass,
  mayWrite,
  switchFields,
} from './model'
import type { AfterFill, Credential, EscapeLook, Identity, Need, OwnContinueLook, SignInRead, StayReason, StopWindow, SwitchWriter } from './model'
import { Band, Footer, PANE_COLUMNS, Pane } from './view'
import type { Actions } from './view'

type Host = EngineInterface

const PANE = 'claude-accounts'
const TITLE = 'Claude accounts'
/** The slash command that opens and closes the pane. */
const ACCOUNTS_COMMAND = 'accounts'
/** Claude Code caches a keychain read for 30 s, so a switch lands within this. */
const SETTLE_MS = 35_000
/** The owed look's reasons for a gate it read before its fill and finds closed after it: each is written once an episode. */
const GATES_AFTER_FILL: readonly string[] = ['a prompt began entering during the fill', 'the switch moved during the fill', 'a switch was held during the fill']
/** A switch no response has shown after this long is reported as not taken. */
const CONFIRM_GIVE_UP_MS = 4 * 60_000
/** How long a check waits on `claude auth status`: a check reads every login in turn, so a hung one holds each this long. */
const STATUS_TIMEOUT_MS = 5_000
/** How long a usage or profile read waits for its answer: a stop's own read holds the stop path's lock, and with it every later stop and the owed resume. */
const READ_TIMEOUT_MS = 10_000
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
/** The carry-on after a stop with no login left, where the login in use freed up itself: nothing switched. */
const CONTINUE_RESET = "This Claude account's usage limit has reset. Continue where you left off."
/** How long past the time owed a carry-on with no switch waits: Claude Code can carry on a 5-hour stop by itself after its reset (puma-9arph.35 d5), and one carry-on goes, not two. */
const CARRY_ON_GRACE_MS = 3 * 60_000

const viewAtom = atom({ plugin: 'account-rotator', key: 'view' } as const, EMPTY_VIEW)

/**
 * Whether this session's pane shows. A press opens or closes it in its own
 * turn, with no read before: the engine counts an open as the person's only
 * there, and places it at any width; one made after an await waits undrawn
 * below 144 columns. Kept in step with closes by the person and with reloads.
 */
let isPaneShown = false

/**
 * What this session set that only its view shows, kept where /clear, /resume and /branch do not reach: they reset the
 * view, and rebindSession copies these back. Each is set where its value is born; undefined until then. The records
 * of a switch in flight and the Chrome link are copied by setView instead, from every write of a bound view.
 */
let kept: { slot?: string; mark?: string; hasFontBlocks?: boolean; isSwitchBlocked?: boolean; isFableStopped?: boolean; isStuckTold?: boolean } & InFlight & ChromeLink = {}
/** When this session's boot read the store: an older version's reading written after it says that version still runs. */
let bootedAt: number | undefined
/** An older version writes its reading at every check, every 10 minutes at most: one this old has stopped. */
const OLDER_WRITER_MS = 30 * 60_000
/** The last response this session measured, and when: it names the login a stop during an unproven switch belongs to. */
let lastMeasured: { at: number; reading: Reading | undefined } | undefined
/**
 * Whether the main loop is failed, as Orca shows an agent red: its last StopFailure (any error) came after its last turn
 * start. A tick or a response moves a session only while it is failed; a sub-agent's stop or turn changes nothing here.
 * It starts false: a session holds until its main loop fails, a lost sign-in included (the next request fails).
 */
let isUncleared = false
/**
 * How many failed main-loop stops this session has had: each StopFailure of the main loop adds one, and a stop snapshots
 * the count it examined. Work a stop awaits before it acts is void once the count moved: a newer failure is another
 * stop's to handle, even where the session is red again (the boolean alone cannot tell the two failures apart).
 */
let failureEpoch = 0
/** Whether the main loop is red now: failed, and no main turn started since. */
const isRed = (): boolean => isUncleared
/** Whether the failure a stop examined (`epoch`) is still the latest, and still uncleared. */
const isSameFailure = (epoch: number): boolean => failureEpoch === epoch && isUncleared
/** The login whose hold (a tick or a response left it be, its stored usage saying leave) the stop-log already told: one line a hold. */
let heldTold: string | undefined
/**
 * The session ends whose process ends with them, by the engine's SessionEndReason: /exit and its keys, a logout, a
 * `-p` run done or a signal. A reason not named here keeps the stop's marks.
 */
const PROCESS_ENDS: ReadonlySet<string> = new Set(['prompt_input_exit', 'logout', 'other'])

/**
 * The one way a switch to `id` ends proven, by a response's week or a browser answering as the account: it settles,
 * and a stop marked on it provisionally is kept, so no later end of anything reverts it.
 */
async function proveSwitch($: Host, id: string, since: number): Promise<void> {
  // The login's record of failed landings goes only where this proof's write applied: a switch that replaced the pending
  // one meanwhile makes it stale, and the login has not landed.
  const isProven = await writeSwitch($, { pending: since }, v => ({
    ...v,
    provisionalStop: v.provisionalStop?.id === id ? undefined : v.provisionalStop,
    pending: v.pending?.id === id ? undefined : v.pending,
  }))
  if (isProven) {
    untaken.delete(id)
    nonLandings.delete(id)
    // A response proved a switch: what the episode kept of earlier unproven moves is no longer a proof of any non-landing.
    if (episode !== undefined) episode.superseded = undefined
  }
}

/** The keys a stop writes for a login, every session's: its marks, its reading, its `no-five-hour`. */
const STOP_KEYS = (id: string) => [`mark:${id}`, `week-mark:${id}`, `fable-mark:${id}`, `usage:${id}`, `no-five-hour:${id}`]

async function stopKeys($: Host, id: string, keys = STOP_KEYS(id)): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {}
  for (const key of keys) values[key] = await $.store.get(key)
  return values
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The record of a provisional stop on `id` just marked, from what stood before it (`before`, after its own read).
 * A second stop on the same unproven switch adds what it wrote and keeps what stood before the first.
 */
async function recordStop($: Host, id: string, since: number, before: Record<string, unknown>, wasFableStopped: boolean, readAt: number, keys = STOP_KEYS(id)): Promise<ProvisionalStop> {
  const { provisionalStop: stood } = await getView($)
  const kept = stood?.since === since && stood.id === id ? stood : { id, since, readAt, writes: {}, setFableStop: false }
  const after = await stopKeys($, id, keys)
  const writes = { ...kept.writes }
  for (const key of keys) {
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
/**
 * The carry-on a switch owes: what the turn that stopped died on, which picks the line sent; and, for a stop's own move,
 * the failure epoch the stop examined: the move goes only while that failure is still the latest and uncleared
 * (`isSameFailure`), whatever the stop awaited on the way. A press carries none.
 */
type CarryOn = { need?: Need; epoch?: number }
/** When the switch began whose landing a carry-on already follows: the switch's own, or one for a turn that died before it landed. */
let carriedFor: number | undefined
/** The last carry-on sent: when the switch it follows began, and when it went. The turn it starts may answer as the login left. */
let carriedOn: { since: number | undefined; at: number } | undefined
/** When the switch began whose one Fable stop on its carry-on the login moved to's usage read cleared. */
let clearedFor: number | undefined
/**
 * The one carry-on owed after a usage-limit stop found no login to move to, as the view's `carryDue` holds it: set once,
 * by the first such stop, with no await between its read and its write, so a second stop adds no notice and no retry.
 */
let due: { at?: number; from?: string; owedAt?: number; turns?: number } | undefined
/** How many switches ended the carry-on owed (endDue): one landing while carryOnWhenFree writes is not undone by it. */
let dueEndings = 0
/** The turns open now, the main loop's and every agent's or teammate's, by id: a key sent while one runs would answer its dialog. */
const openTurns = new Set<string>()
/** The main loop's turns started this session, and how many had started at the last usage-limit stop: equal while its modal can stand. */
let mainTurns = 0
let limitStopAfter: number | undefined
/** How many switches this session has made: a carry-on goes out only if no switch came after the one it follows. */
let moves = 0
/** Logins a switch to did not take this session: the rotation leaves them be; Use now still tries. */
const untaken = new Set<string>()
/** How many times a stop named another login's reset right after a move to this one: at two the rotation leaves it be (untaken). */
const nonLandings = new Map<string, number>()
/** When this session last moved to another login: until SETTLE_MS after, its requests may still go out as the one before. */
let movedAt: number | undefined

/**
 * A usage-limit stop of the main loop, from its StopFailure until the work answers on a login: the logins its stops
 * died on (tried), its Escapes against `budget` (two a login, plus two, set at its first stop), and when the resume
 * entered. Module state, so /clear, /resume and /branch keep it; a reload drops it.
 */
type Episode = {
  need?: Need
  stops: number
  tried: string[]
  /**
   * The provisional records this episode's own moves superseded: a stop's carried move clears the view's record, but its
   * mark stays on the login moved to until a proof ends it. A later stop whose words show that login's switch never
   * landed gives them back (`undoSuperseded`); a response that proves a switch drops them. Kept in memory only: a reload
   * loses the list, and a mark it held then ends with its own reset, as any stop's does.
   */
  superseded?: readonly ProvisionalStop[]
  /** Wordless stops by login while a switch to it was unproven: a login counts as tried at its second (isSecondUnprovenStop). */
  unprovenStops?: Readonly<Record<string, number>>
  budget?: number
  escapes: number
  lastEscapeAt?: number
  enteredAt?: number
  lastWaitCount?: number
  /**
   * What stood when the turn that entered began (`carryOn`, the refusal count while a carry-on was in flight), and whether
   * that turn was the carry-on's own (its text the one submitted): another turn that ends aborted or failed gives back
   * that same carry-on, so the look acts again.
   */
  before?: { carryOn?: number; isLimitStopLast: boolean; isCarryOnTurn: boolean }
  /** When the refresh nudge went (puma-9arph.57): once an episode. */
  nudgedAt?: number
  /** The held switch it went for (holdKey): a drop after it drops that one alone. */
  nudgedFor?: string
  /**
   * The last nudge's facts (puma-9arph.65): when it went, and the expiry and digest (`fingerprint`, as the holder
   * records take it; undefined where it failed) of the stored token it went on. The digest is never logged.
   */
  nudge?: { at: number; expiresAt: number; token: string | undefined }
  /** The one more nudge, sent once the token the first went on had run out unrefreshed, went. */
  isRenudged?: boolean
  /** A carry-on held back while the nudge sat queued (a landing meanwhile): owed once the nudge's turn ends. */
  isCarryOnHeldBack?: true
  /** `personPrompts` at the last limit stop: a person's prompt since cancelled its countdown, so its resume arms nothing. */
  personPrompts?: number
  told: Set<Told>
}
/** A stop's held switch by where it goes and what it carries on with; a press's, which carries on with nothing, has none. */
const holdKey = (h: View['held']): string | undefined => (h?.carry === undefined ? undefined : `${h.target.id} ${JSON.stringify(h.carry)}`)
type Told = 'pane' | 'nothing' | 'stuck' | 'fill' | 'failed' | 'nudge' | 'sign-in wait' | 'draft' | 'draft told' | `after fill: ${string}`
let episode: Episode | undefined
/** The refresh nudge's own turn while it runs: it is no entry of the resume (council B2). */
let nudgeTurnId: string | undefined
/** A carry-on submitted and not yet entered: no second is submitted, and the look may free it. */
let isCarryOnInFlight = false
/** The latest carry-on submission: an older one's late refusal clears nothing of a newer one. */
let carryOnSubmits = 0
/** The carry-on sendCarryOn turned away while one was queued, and the submission it waits on: the newest one stands. */
let turnedAway: { prompt: { text: string; asUser?: true }; submit: number } | undefined
/** The text of the carry-on last submitted: a main turn whose text holds it is the carry-on's own. */
let carryOnText: string | undefined
/** Counts carry-ons refused or dropped: a give-back revives a carry-on only while this has not moved since its turn began. */
let carryOnRefusals = 0
/** Counts carry-on submissions answered, any way: one fewer than carryOnSubmits while a submit waits on its answer. */
let carryOnAnswers = 0
/** Counts the refresh nudge's own submits: no carry-on of the work, so no evidence for a Connect visit's line. */
let nudgeSubmits = 0
/** The latest carry-on of the work answered clean, by its submission: a dropped one is no evidence for a Connect visit's line. */
let workAnsweredClean = 0
/** Carry-ons armed and not yet due: the look says nothing is queued only while none is. */
let armedCarryOns = 0
/**
 * A person's own prompts at an idle prompt, counted as each enters (puma-9arph.80): each cancels Claude Code's countdown
 * (reading R3x). No other prompt is counted: a background agent's task notification does not cancel it (stand-in run a3).
 */
let personPrompts = 0
/** Prompts of any origin submitted and not yet entered: while one is, no own-continue key goes (Codex round 1 KEY-QUEUED). */
let promptsEntering = 0
/** The window the last stop's markStop judged spent, by login: the own-continue arm takes that window's reset. */
let stopWindow: { id: string; window: StopWindow } | undefined
/**
 * The own-continue Escape owed after a usage-limit stop's carry-on answered (puma-9arph.71): Claude Code's own countdown
 * still stands and would continue a second time (reading R6c). Module state, as the episode ends with that answer; a
 * reload drops it.
 */
let ownContinue: { resetAt?: number; isSent: boolean; told: Set<string> } | undefined
/** How often the owed-resume look runs, between turns as well. */
const OWED_LOOK_MS = 15_000
/** A measure this long after the resume entered proves it answered: a turn that dies on a limit dies within seconds. */
const ENTRY_PROOF_MS = 30_000
/** The one lock of the stop path and the look: the stop path waits for it, the look skips a tick that finds it held. */
let lockTail: Promise<void> = Promise.resolve()
let isLocked = false

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const before = lockTail
  let release = () => {}
  lockTail = new Promise<void>(resolve => {
    release = resolve
  })
  await before
  isLocked = true
  try {
    return await fn()
  } finally {
    isLocked = false
    release()
  }
}
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
/** The records of a switch in flight: what settles it, undoes its stop and retries it, held by the view alone. */
type InFlight = Pick<View, 'pending' | 'provisionalStop' | 'held'>
const inFlight = (v: View): InFlight => ({ pending: v.pending, provisionalStop: v.provisionalStop, held: v.held })
/** How Claude in Chrome stands in this session: whether it has it, as which login it connected, and a Connect under way. */
type ChromeLink = Pick<View, 'hasChrome' | 'chrome' | 'chromeConnecting'>
const chromeLink = (v: View): ChromeLink => ({ hasChrome: v.hasChrome, chrome: v.chrome, chromeConnecting: v.chromeConnecting })
const viewWrite = async ($: Host, fn: (v: View) => View): Promise<View> => {
  const written = await update($, viewAtom, v => fn(current(v)))
  // A cleared record is copied too, so a finished switch comes back as finished. A view not bound is the reset's
  // default, before rebindSession: copied, it would wipe the switch the reset took.
  if (written.isBound === true) kept = { ...kept, ...inFlight(written), ...chromeLink(written) }
  return written
}
/** Writes every field of the view but those that name the switch: those change only through writeSwitch. */
const setView = async ($: Host, fn: (v: View) => View): Promise<View> => {
  let isStray = false
  const written = await viewWrite($, v => {
    const next = fn(v)
    isStray = JSON.stringify(switchFields(next)) !== JSON.stringify(switchFields(v))
    return isStray ? { ...next, ...switchFields(v) } : next
  })
  if (isStray) void debug($, STRAY_SWITCH_WRITE)
  return written
}
/** What the debug log says of a switch field written outside writeSwitch; the flow tests fail on it. */
const STRAY_SWITCH_WRITE = 'switch field written outside writeSwitch: kept as it was'
/**
 * The one way to change the fields that name the switch: `fn` applies only where mayWrite lets `by` write the view as
 * the update reads it. True when it applied.
 */
async function writeSwitch($: Host, by: SwitchWriter, fn: (v: View) => View): Promise<boolean> {
  let isApplied = false
  await viewWrite($, v => {
    isApplied = mayWrite(v, by)
    return isApplied ? fn(v) : v
  })
  return isApplied
}
/** Something the person should know that nothing on screen says: a toast, on screen for a while. */
const tell = ($: Host, text: string) => $.ui.toast(text, { timeoutMs: 8000 })
const debug = ($: Host, text: string) => $.ui.log(`account-rotator: ${text}`, { to: 'debug' })
/**
 * The terminal's own notice, sent and not waited for: one the terminal never answers holds nothing, and one it refuses
 * ends nothing. Its rejection is caught, and so is a throw at the call.
 */
function notify($: Host, text: string): void {
  try {
    void $.ui.notify(text, { title: TITLE }).catch(error => debug($, `notice failed: ${String(error)}`))
  } catch (error) {
    // A throw at the call: the test kit's notice only rejects, so no test reaches this catch.
    void debug($, `notice failed: ${String(error)}`)
  }
}

function isAccount(value: unknown): value is Account {
  if (typeof value !== 'object' || value === null) return false
  const { id, slot } = value as Record<string, unknown>
  return typeof id === 'string' && typeof slot === 'string'
}

/** An account as read from the store: only a string is an email, so one stored as null or a number is no email. */
function withEmailOnlyIfString(account: Account): Account {
  if (account.email === undefined || typeof account.email === 'string') return account
  const { email: _notAnEmail, ...rest } = account
  return rest
}

async function loadAccounts($: Host): Promise<Account[]> {
  const stored = await $.store.get('accounts')
  return Array.isArray(stored) ? stored.filter(isAccount).map(withEmailOnlyIfString) : []
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
 * Ends a login's Fable mark for every session; the next save of its reading draws it without the mark. Only the mark
 * judged ended goes: a stop another session marked since stands. The store has no conditional write, so this narrows
 * the gap between the read and the delete to one store call.
 */
async function dropFableMark($: Host, id: string, judged: Mark): Promise<void> {
  if (!sameValue(markFrom(await $.store.get(`fable-mark:${id}`)), judged)) return
  await $.store.delete(`fable-mark:${id}`)
  await setView($, v => {
    const { [id]: _ended, ...fableMarks } = v.fableMarks ?? {}
    return { ...v, fableMarks }
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
  const nextAt: Record<string, number> = {}
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
    const due = usageDueFrom(await $.store.get(`usage-due:${a.id}`))
    if (due?.at !== undefined) readAt[a.id] = due.at
    // While a read is claimed `next` is the claim's expiry (claimUsage), not when the failed read is tried again.
    if (due !== undefined && due.claim === undefined) nextAt[a.id] = due.next
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
    return { ...v, accounts, readings: nextReadings, marks: nextMarks, noFiveHour: nextNoFiveHour, weekMarks: nextWeekMarks, fableMarks: nextFableMarks, checkErrors, readAt, nextAt, health: nextHealth, footer, rotateTo, fiveHourLimit, weekLeave, launchOn, fableContinueText, chromeAccountId, chromeAccountIds, hasOlderWriter }
  })
  await saveRows($, now)
  // A refused store-id fails no caller of the merge: the next merge tries again.
  await saveStoreId($).catch(error => debug($, `store-id failed: ${String(error)}`))
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
/** The files in the requests folder already logged as skipped, and whether the last look at it failed: each said once. */
const skippedRequests = new Set<string>()
let isRequestListFailing = false

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
    kept = { ...kept, mark }
    await setView($, v => ({ ...v, sessionMark: mark }))
  } catch (error) {
    await debug($, `session mark refused: ${String(error)}`)
  }
}

/** What the stop-log keeps per session, and how long a session's log outlives its last entry. */
const STOP_LOG_KEEP = 50
const STOP_LOG_MAX_AGE_MS = 7 * 24 * 3600_000
type StopLogEntry = { at: number; what: string }

const stopLogFrom = (value: unknown): StopLogEntry[] =>
  (Array.isArray(value) ? value : []).filter((e): e is StopLogEntry => typeof e?.at === 'number' && typeof e?.what === 'string')

/**
 * Says what a stop did, under `stop-log:<session mark>`: one key a session, so sessions never overwrite each other's lines.
 * An entry names logins by their id, and holds no token, no email and no prompt text beyond 'entered' and 'drop'.
 * Never fails its caller. The writes go one at a time, in call order, so a caller need not await one: two at once
 * would each read the old list and one entry would be lost.
 */
let stopLogChain: Promise<void> = Promise.resolve()
function logStop($: Host, what: string): Promise<void> {
  stopLogChain = stopLogChain.then(async () => {
    try {
      const mark = (await getView($)).sessionMark ?? kept.mark
      if (mark === undefined) return
      const key = `stop-log:${mark}`
      const entries = stopLogFrom(await $.store.get(key))
      await $.store.set(key, [...entries, { at: await $.clock.now(), what }].slice(-STOP_LOG_KEEP))
    } catch (error) {
      await debug($, `stop-log failed: ${String(error)}`)
    }
  })
  // Its own catch: whatever the debug line does, the next entry still writes. The test kit's debug line never rejects,
  // refused by a throw or a deny, so no test reaches this catch.
  stopLogChain = stopLogChain.catch(() => undefined)
  return stopLogChain
}

/**
 * Deletes the stop-logs of sessions whose last entry is over a week old, with those that hold none, and each session's
 * carry-on ended mark (markCarryEnded) that ended over a week ago or holds no time.
 */
async function pruneStopLogs($: Host): Promise<void> {
  const now = await $.clock.now()
  const keys = await $.store.keys()
  for (const key of keys.filter(k => k.startsWith('stop-log:'))) {
    const last = stopLogFrom(await $.store.get(key)).at(-1)
    if (last === undefined || now - last.at > STOP_LOG_MAX_AGE_MS) await $.store.delete(key)
  }
  for (const key of keys.filter(k => k.startsWith(CARRY_ENDED))) {
    const endedAt = (await $.store.get(key) as { endedAt?: unknown } | undefined)?.endedAt
    if (typeof endedAt !== 'number' || now - endedAt > STOP_LOG_MAX_AGE_MS) await $.store.delete(key)
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
  // A view the reset left names login 1 in use and no mark: bound first, so a request acts on this session's login.
  if (!(await isBound($))) return
  const { sessionMark } = await getView($)
  const dir = requestsDir(await $.env.get('CLAUDE_CONFIG_DIR'), (await $.env.get('HOME')) ?? '')
  const entries = await $.fs.list(dir).then(found => {
    isRequestListFailing = false
    return found
  }, async (error: unknown) => {
    if (!isRequestListFailing) await debug($, `cannot read the requests folder ${dir}: ${String(error)}`)
    isRequestListFailing = true
    return []
  })
  const names = new Set(entries.map(e => e.name))
  const now = await $.clock.now()
  const requests: RotatorRequest[] = []
  // The CLI writes a request whole, by a rename from `.json.tmp`, which this listing skips: a request file of a nonce
  // it writes that is too large to read, or whose text does not parse, is a broken request, answered so its CLI does
  // not wait out --wait.
  const broken: [nonce: string, message: string][] = []
  for (const { name, kind, size } of entries) {
    const nonce = name.endsWith('.json') && !name.endsWith('.result.json') ? name.slice(0, -'.json'.length) : undefined
    if (nonce === undefined || names.has(`${nonce}.result.json`) || takenRequests.has(nonce)) continue
    if (kind !== 'file' || size > REQUEST_MAX_BYTES) {
      if (!skippedRequests.has(name)) await debug($, `skipped ${name} in the requests folder: ${kind}, ${size} bytes`)
      skippedRequests.add(name)
      if (kind === 'file' && isRequestNonce(nonce)) broken.push([nonce, `the request file is over ${REQUEST_MAX_BYTES} bytes, more than a session reads: run the command again`])
      continue
    }
    // A file no read can reach, or one that is no request of this store, reads as none.
    const text = await $.fs.read(`${dir}/${name}`).catch(() => undefined)
    const value = parsed(typeof text === 'string' ? text : undefined)
    // No version of the CLI writes a request that is not a JSON object.
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value)
    if (typeof text === 'string' && !isObject && isRequestNonce(nonce)) broken.push([nonce, 'the request file is not a JSON object a session can read: run the command again'])
    const request = requestFrom(value, now)
    if (request === undefined || request.nonce !== nonce || request.store !== storeId) continue
    if (request.kind !== 'use' || request.session === sessionMark) requests.push(request)
  }
  for (const [nonce, message] of broken) {
    takenRequests.add(nonce)
    await $.fs.write(`${dir}/${nonce}.result.json`, JSON.stringify({ nonce, ok: false, message, at: now }))
      .catch(error => debug($, `request ${nonce} failed: ${String(error)}`))
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
 * `continue-text` sets or clears the line a Fable switch sends.
 */
async function applyRequest($: Host, request: RotatorRequest): Promise<{ ok: boolean; message: string; pickId?: string; activeId?: string; accountId?: string }> {
  if (request.kind === 'rm') return removeAccount($, request.id, request)
  if (request.kind === 'add') return adoptSlot($, request.slot)
  if (request.kind === 'continue-text') return setContinueText($, request.text)
  const target = (await getView($)).accounts.find(a => a.id === request.id)
  if (target === undefined) return { ok: false, message: `${labelOf([], request.id)} is not listed in this store` }
  if (request.kind === 'use') return useAccount($, target)
  await setLaunchOn($, `account:${request.id}`)
  const { text, pickId } = await pickAnswer($)
  return { ok: true, message: text, pickId }
}

/**
 * The line a session sends after a Fable switch, as the person's own words: `text`, as `continueTextFrom` takes it, or
 * null to clear it, so the mod's own line goes instead. Every session reads the key at its next merge.
 */
async function setContinueText($: Host, text: unknown): Promise<{ ok: boolean; message: string }> {
  if (text === null) {
    await $.store.delete('fable-continue-text')
    await setView($, v => ({ ...v, fableContinueText: undefined }))
    return { ok: true, message: "cleared: after a Fable switch a session sends the mod's own line" }
  }
  const line = continueTextFrom(text)
  if (line === undefined) return { ok: false, message: `the line after a Fable switch is text of 1 to ${CONTINUE_TEXT_MAX} characters once trimmed` }
  await $.store.set('fable-continue-text', line)
  await setView($, v => ({ ...v, fableContinueText: line }))
  return { ok: true, message: `after a Fable switch a session sends: ${line}` }
}

/** Where new sessions start now, in a request's words. */
async function pickAnswer($: Host): Promise<{ text: string; pickId?: string }> {
  const pick = (await $.store.get('launch-slot')) as LaunchPick | undefined
  if (pick === undefined) return { text: "no account has room, so new sessions start on Claude Code's login" }
  return { text: `new sessions start on ${labelOf((await getView($)).accounts, pick.id)} (${pick.why})`, pickId: pick.id }
}

/** Why a request waits out Connect: its visit moves the session and back, unsaid. */
const CONNECTING_TEXT = 'Claude in Chrome is connecting, which moves this session and back: try again in a minute'

/**
 * Moves this session as the panel's Use now does, under the same rule: only a login signed in. The result reads back
 * where it stands. Connect's visit would move the session back unsaid, so a use waits it out, as a press does; and the
 * account in use needs no switch, only the end of one held for later.
 */
async function useAccount($: Host, target: Account): Promise<{ ok: boolean; message: string; activeId: string }> {
  const view = await getView($)
  const name = label(target, view.accounts)
  if (isConnectingChrome) return { ok: false, message: CONNECTING_TEXT, activeId: view.activeId }
  if (view.activeId === target.id) {
    // While a switch runs, ending the hold is refused (mayWrite), and that switch may still move the session.
    if (!(await writeSwitch($, { idle: true }, v => ({ ...v, held: undefined })))) {
      return { ok: false, message: `this session uses ${name}, and a switch is running that may move it: run it again in a minute`, activeId: target.id }
    }
    return { ok: true, message: `this session already uses ${name}`, activeId: target.id }
  }
  const health = view.health[target.id]
  if (health?.kind !== 'ok') return { ok: false, message: `${name} cannot take over: ${health?.kind === 'login-needed' ? health.why : 'it is not signed in yet'}`, activeId: view.activeId }
  const hasMoved = await switchTo($, target, 'a command asked for it')
  if (hasMoved) return { ok: true, message: `this session now uses ${name}`, activeId: target.id }
  // switchTo holds a switch for a token about to refresh, and otherwise declines only on a policy refusal.
  if ((await getView($)).held !== undefined) return { ok: true, message: `this session moves to ${name} in a few minutes, once ${labelOf(view.accounts, view.activeId)}'s token has refreshed`, activeId: view.activeId }
  return { ok: false, message: blockedText(view), activeId: view.activeId }
}

/** Use now. A switch held for a token about to refresh says so on the pressed row while it waits (view.tsx). */
async function pressUse($: Host, id: string): Promise<void> {
  // As for `account use`: Connect's visit would move the session back unsaid.
  if (isConnectingChrome) return tell($, CONNECTING_TEXT)
  const target = (await getView($)).accounts.find(a => a.id === id)
  if (target !== undefined) await switchTo($, target, 'you picked it')
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
    // applyRequests binds a view not bound, once boot has read the slot, before it takes a request.
    if (await isWatching()) await applyRequests($, true).catch(error => debug($, `requests failed: ${String(error)}`))
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

/**
 * A slot's stored login, from the keychain on macOS or its file elsewhere (Linux); the secret stays in this module.
 * Throws CredentialReadTimedOut once READ_TIMEOUT_MS passes with no answer.
 */
async function readStored($: Host, slot: string): Promise<Stored> {
  const read = (async () => ((await $.fs.exists(MACOS_MARKER)) ? readKeychain($, slot) : readCredentialsFile($, slot)))()
  return answerWithin($, 'CredentialReadTimedOut', read)
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

const LATE: unique symbol = Symbol('late')

/** A read's answer, or a throw named `name` once READ_TIMEOUT_MS passes with none: a late answer is never read. */
async function answerWithin<T>($: Host, name: string, read: Promise<T>): Promise<T> {
  const answer = await Promise.race([read, $.clock.sleep(READ_TIMEOUT_MS).then((): typeof LATE => LATE)])
  if (answer === LATE) throw Object.assign(new Error(`no answer in ${READ_TIMEOUT_MS} ms`), { name })
  return answer
}

/** The usage of the login a token belongs to, as `/usage` reads it. */
async function fetchUsage($: Host, accessToken: string): Promise<UsageAnswer> {
  const res = await answerWithin($, 'UsageReadTimedOut', $.http.fetch(USAGE_URL, { headers: oauthHeaders(accessToken) }))
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

/**
 * Who a token signs in, as Claude Code asks at a sign-in: email, organization and plan; `who` undefined when the profile
 * answers with no account it can read. Throws when the call gets no answer (a dropped connection, a refused tunnel): the
 * caller's catch decides, as a throw here is no answer about who.
 */
async function fetchIdentity($: Host, accessToken: string): Promise<{ who?: Identity; status: number }> {
  const res = await answerWithin($, 'ProfileReadTimedOut', $.http.fetch(PROFILE_URL, { headers: oauthHeaders(accessToken) }))
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
  const { exitCode, stdout } = await runAuthStatus($, slot, ['--json'], 20_000)
  return exitCode === 0 ? identityFromStatus(stdout) : undefined
}

/** `claude auth status` under a slot's login, the one place the mod runs it. */
function runAuthStatus($: Host, slot: string, flags: readonly string[], timeoutMs: number): ReturnType<Host['process']['run']> {
  return $.process.run(['claude', 'auth', 'status', ...flags], { env: slotEnv(slot), timeoutMs })
}

/**
 * Whether Claude Code counts a login in a slot, though its keychain may hold a record. Only its exit code and
 * authMethod are read, and its output (it names the account) goes nowhere. A run refused or timed out says nothing.
 */
async function signInRead($: Host, slot: string): Promise<SignInRead> {
  try {
    const { exitCode, stdout } = await runAuthStatus($, slot, [], STATUS_TIMEOUT_MS)
    return signInFromStatus(exitCode, stdout)
  } catch {
    return 'unknown'
  }
}

/** Points this session's requests, and every child it starts after, at a slot's login. */
async function useSlot($: Host, slot: string): Promise<void> {
  const set = slot === '' ? await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', undefined) : await $.env.set('CLAUDE_SECURESTORAGE_CONFIG_DIR', slot)
  // The engine's hold resolves with its reason; a hook's refusal rejects. Callers meet both as a throw.
  if (set.deny !== undefined) throw new SwitchHeld(set.deny)
  kept = { ...kept, slot }
}

/**
 * Claude Code's security policy refuses switching in this session: says so
 * once, as a toast and a notification, and the pane says so while it lasts.
 * False when it was said already.
 */
async function blocked($: Host): Promise<boolean> {
  // Kept first: after a reload the view says it already, and /clear would lose it.
  kept = { ...kept, isSwitchBlocked: true }
  const view = await getView($)
  if (view.isSwitchBlocked) return false
  await setView($, v => ({ ...v, isSwitchBlocked: true }))
  const text = blockedText(view)
  $.ui.toast(text, { timeoutMs: 15_000 })
  notify($, text)
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
  const text = `${claudeAccount(account, (await getView($)).accounts)} needs a sign-in (${why}). Click ⚠${account.id} under the prompt.`
  $.ui.toast(text, { timeoutMs: 8000 })
  notify($, text)
}

/** The reasons a Fable stop left the session where it was that the terminal has been told: each once a session, however many stops follow. */
const toldStays = new Set<StayReason>()

/** A Fable stop that did not move says why, and the way out, through the terminal's own notice, for a session left running; the band and toast are easy to miss. */
async function announceStay($: Host): Promise<void> {
  const stay = fableStay(await getView($), await $.clock.now(), isConnectingChrome, untaken)
  if (stay === undefined || toldStays.has(stay.reason)) return
  toldStays.add(stay.reason)
  notify($, stay.text)
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
  // What another account's usage said is its own, not this one's (its plan above all): it goes with it. The same
  // account under a new token (a refresh, or the same person signing in again) keeps its reading, and is read at once
  // unless a back-off stands, which keeps its time: a refresh each time would otherwise end it, read after read.
  const isOtherAccount = known !== undefined && (known.who.email !== who.email || known.who.orgId !== who.orgId)
  if (isOtherAccount) await dropSignInUsage($, account.id)
  else if (known !== undefined) {
    const key = `usage-due:${account.id}`
    if (!isBackedOff(usageDueFrom(await $.store.get(key)), await $.clock.now())) await $.store.delete(key)
  }
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
    const name = label(followed, accounts.map(a => (a.id === own.id ? followed : a)))
    tell(
      $,
      own.slot === ''
        ? `Claude Code's login is ${name} now: new sessions start on it.`
        : `The Claude account that was ${label(own, accounts)} is ${name} now: a /login in a session on it signs in there, not Claude Code's login.`,
    )
  }
  return undefined
}

/** This session's name on a usage claim, when the engine names no session. */
const SELF = `module-${Math.random().toString(36).slice(2, 10)}`

/**
 * How a check may read a login's usage. `claimed`: the schedule says it is due and this session claimed it.
 * `force`: a stop, a /login or a sign-in asks, so it reads unless a back-off stands, another session's read is under
 * way, or the last good read is under a minute old. `since`: read unless a back-off stands, another session's read is
 * under way, or a good read came after `since`: a settling switch passes when it began, the carry-on stop passes now.
 * `none`: the sign-in only, no usage call.
 */
type UsageGate = 'claimed' | 'force' | 'none' | { since: number }

/** Claims, for this session, the read of each login whose schedule says it is due; answers those whose claim stands, and when it claimed them. */
async function claimDue($: Host, ids: readonly string[]): Promise<{ ours: Set<string>; at: number }> {
  const sessionId = (await getView($)).sessionId ?? SELF
  // The engine reads `$` only as `$.noun.event(...)` at the call site: the store goes over as two calls.
  const store = { get: (key: string) => $.store.get(key), set: (key: string, value: unknown) => $.store.set(key, value) }
  const hasOwnReading = async (id: string) => (await storedReading($, id)) !== undefined
  const at = await $.clock.now()
  return { ours: await claimDueReads(store, ids, sessionId, at, () => $.clock.sleep(USAGE_CLAIM_WAIT_MS), hasOwnReading), at }
}

/** The schedule a read leaves when its gate lets it start: this session's claim, from now; undefined when it may not. */
function startRead(gate: Exclude<UsageGate, 'none'>, due: UsageDue | undefined, sessionId: string, now: number): UsageDue | undefined {
  if (gate === 'claimed') return renewClaim(due, sessionId, now)
  const isAllowed = gate === 'force' ? mayForceUsage(due, sessionId, now) : mayReadSince(due, sessionId, now, gate.since)
  return isAllowed ? claimUsage(due, sessionId, now) : undefined
}

/** A usage call that threw: requestUsage has stored its back-off and its failure, so the check stores no other. */
class UsageCallThrew extends Error {
  name = 'UsageCallThrew'
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
    // Only the scheduled check (checkAll, the 'claimed' gate) stores a failure for a throw: a forced or since read
    // that throws stored none, and one stored now would leave a login with no reading unread, out of the pick.
    if (gate !== 'claimed') throw error
    // The row says so in the usage call's own words: that back-off is the next try of what failed, which the check's
    // generic failure would not say. Only the error's kind is stored, as the check's own failure stores.
    const kind = error instanceof Error ? error.name : 'an error'
    await saveCheckError($, account.id, `the usage call threw (${kind})`, true).catch(() => undefined)
    throw new UsageCallThrew(String(error))
  }
  const at = await $.clock.now()
  // A body that holds no usage the mod reads stores no reading: it is no good read.
  const ok = usage.kind === 'ok' ? { kind: readingFromUsage(usage.body, at) === undefined ? ('empty' as const) : ('ok' as const), hasResponded } : undefined
  const outcome = ok ?? (usage.kind === 'rejected' ? usage : { kind: 'failed' as const, retryAfter: usage.retryAfter })
  await $.store.set(key, afterUsage(due, outcome, at))
  return usage
}

/**
 * A claimed read the check did not make (a token not live, a sign-in not named, a throw) gives its claim back, so no
 * claim stands unanswered: the login is next due as an idle one, with no back-off and its last good read's time kept.
 * Only the claim made at `claimedAt`: a read this session started since (a stop, a /login) renewed it, moving its next.
 */
async function releaseClaim($: Host, id: string, claimedAt: number): Promise<void> {
  const key = `usage-due:${id}`
  const sessionId = (await getView($)).sessionId ?? SELF
  // The clock is read first, so nothing but the write itself comes between the store's read and its write.
  const now = await $.clock.now()
  const due = usageDueFrom(await $.store.get(key))
  const made = claimUsage(due, sessionId, claimedAt)
  if (due?.claim !== made.claim || due.next !== made.next) return
  await $.store.set(key, afterUsage(due, { kind: 'empty', hasResponded: false }, now))
}

/** Why a failed usage call failed, as the pane says it: its status, and the wait its Retry-After asked for. */
const failedWhy = (usage: { status: number; retryAfter?: number }): string =>
  `the usage call answered HTTP ${usage.status}${usage.retryAfter === undefined ? '' : ` (retry after ${Math.round(usage.retryAfter / 1000)} s)`}`

/**
 * Re-reads one login's stored sign-in: who it belongs to and, while its token
 * is live and its gate lets it, its usage. One that is another login's on the
 * list leaves this login needing its own, its usage that other's. Answers whether it stored a body that listed the
 * Fable week: a check its gate skipped answers false.
 */
async function checkAccount($: Host, account: Account, gate: UsageGate): Promise<boolean> {
  const now = await $.clock.now()
  let hasFreshFable = false
  if (signingIn === account.id) return hasFreshFable
  const stored = await readStored($, account.slot)
  if (stored.state === 'unreadable') {
    tell($, `Could not read ${claudeAccount(account, (await getView($)).accounts)} from the keychain (exit ${stored.code}); is it locked?`)
    return hasFreshFable
  }
  const credential = stored.state === 'present' ? stored.credential : undefined
  let health = healthOf(credential, now)
  // A record Claude Code does not count as a login is no sign-in, whatever its own expiry says; read at every check, so a
  // new sign-in ends it at the next.
  const statusRead = health.kind === 'ok' ? await signInRead($, account.slot) : 'unknown'
  if (statusRead === 'out') health = { kind: 'login-needed', why: NOT_SIGNED_IN }
  // A rejected sign-in stands until a usage read works or a profile call names a sign-in no check had named: a check
  // that reads nothing (its token run out, or another session's turn to read) never gives it back to the picks.
  const known = holderFrom(await $.store.get(`holder:${account.id}`))
  let isSignInProven = false
  if (health.kind === 'ok' && credential !== undefined) {
    const isLive = credential.expiresAt > now + TOKEN_LIVE_MARGIN_MS
    const holder = await holderOf($, account, credential, isLive)
    isSignInProven = holder !== undefined && holder.token !== known?.token
    // The tier is the sign-in's own, read at every check: a holder named before it was kept lacks it.
    const who = holder === undefined ? undefined : { ...holder.who, ...(credential.tier === undefined ? {} : { tier: credential.tier }) }
    const twin = who === undefined ? undefined : await followSignIn($, account, who)
    if (twin !== undefined) health = { kind: 'login-needed', why: `signed in as ${label(twin, (await getView($)).accounts)} now` }
    // A token no profile call has named may be another login's: its usage is read and stored once it is named.
    else if (isLive && holder !== undefined) {
      const usage = await requestUsage($, account, credential.accessToken, gate)
      if (usage?.kind === 'rejected') health = { kind: 'login-needed', why: SIGN_IN_REJECTED }
      if (usage?.kind === 'failed') await saveCheckError($, account.id, failedWhy(usage), true)
      if (usage?.kind === 'ok') {
        isSignInProven = true
        await saveCheckError($, account.id, undefined)
        const read = readingFromUsage(usage.body, now)
        if (read !== undefined) {
          const { noFiveHour, ...reading } = read
          // A body whose 5-hour window it cannot read leaves what the last one said.
          if (reading.fiveHour !== undefined || noFiveHour === true) await saveNoFiveHour($, account.id, noFiveHour === true)
          // A Fable mark that this body's own week, read long enough after the stop, contradicts ends before the reading is drawn.
          const fableMarked = markFrom(await $.store.get(`fable-mark:${account.id}`))
          if (fableMarked !== undefined && endsFableMark(reading.fable, now, fableMarked)) await dropFableMark($, account.id, fableMarked)
          // A body with no Fable row keeps the stored one's: the stored read, never the view, which carries the marks.
          await saveReading($, account.id, { ...keepFable(reading, await ownedReading($, account.id), now), by: account.id }, 'body')
          hasFreshFable = reading.fable !== undefined
        }
      }
    }
    // A token run out is not read until a session refreshes it: its row says idle, from its health.
  }
  // Read after the check's own calls, so a rejection another session stored meanwhile counts. It is left as stored, `at`
  // and all: undoProvisionalStop gives it back only while it holds what the stop wrote.
  // A stored mark ends only on its proof: a rejection on a new sign-in or a usage read that works (a signed-out read
  // keeps its text), 'not signed in' on those or a read that says logged in. A read that says nothing ends neither.
  const stood = (await $.store.get(`health:${account.id}`)) as Health | undefined
  const stoodWhy = stood?.kind === 'login-needed' ? stood.why : undefined
  // The stop's own mark (it carries `at`) also stands where this check's usage read was rejected too: the check writes
  // nothing, so the `at` that lets a held switch go at the token's expiry stays.
  const isStopMark = stood?.kind === 'login-needed' && typeof stood.at === 'number'
  const isRejectedAgain = isStopMark && health.kind === 'login-needed' && health.why === SIGN_IN_REJECTED
  const isRejectionKept = stoodWhy === SIGN_IN_REJECTED && !isSignInProven && (health.kind === 'ok' || statusRead === 'out' || isRejectedAgain)
  const isSignOutKept = stoodWhy === NOT_SIGNED_IN && !isSignInProven && health.kind === 'ok' && statusRead === 'unknown'
  if (isRejectionKept || isSignOutKept) return hasFreshFable
  const before = await saveHealth($, account.id, health)
  if (health.kind === 'login-needed' && before?.kind !== 'login-needed') {
    await announceLockout($, account, health.why)
  }
  return hasFreshFable
}

/**
 * Reads the usage of each login the schedule says is due and this session claims, with its sign-in. `isEvery`: the
 * sign-in of every other login is checked too (boot and the 10-minute check); else (the minute's tick) only the
 * claimed logins are, so a due read waits a minute at most, whatever the 10-minute check's phase.
 */
async function checkAll($: Host, isEvery = true): Promise<void> {
  const { accounts } = await getView($)
  let ours = new Set<string>()
  let claimedAt = NaN
  try {
    ;({ ours, at: claimedAt } = await claimDue($, accounts.map(a => a.id)))
  } catch (error) {
    // The sign-in checks still run, login by login: a store that fails a claim reads no usage this time.
    await debug($, `claiming usage reads failed: ${String(error)}`)
  }
  for (const account of accounts.filter(a => isEvery || ours.has(a.id))) {
    try {
      await checkAccount($, account, ours.has(account.id) ? 'claimed' : 'none')
    } catch (error) {
      await debug($, `checking account ${account.id} failed: ${String(error)}`)
      // The error's own text can carry anything a call returned: only its kind leaves the debug log. A usage call that
      // threw has stored its own failure, which names its back-off.
      const kind = error instanceof Error ? error.name : 'an error'
      if (!(error instanceof UsageCallThrew)) await saveCheckError($, account.id, `the check failed (${kind}); the debug log has the rest`).catch(() => undefined)
    }
    if (ours.has(account.id)) await releaseClaim($, account.id, claimedAt).catch(error => debug($, `releasing account ${account.id}'s usage claim failed: ${String(error)}`))
  }
  // The rows carry what this check read, for a session that ends before the next merge: maybeRotate's launch pick
  // merges first, which writes them from the store as it stands, where every save went first and another session's
  // reads since this check began are too.
  await maybeRotate($)
}

/** The longest failure the pane and the store keep, in characters. */
const CHECK_ERROR_MAX = 200

/**
 * Records, for every session, that a login's usage check failed and why; undefined clears it once a check succeeds.
 * `isUsageRead`: the usage read itself failed, so the sign-in was named and the rotation may still try the login.
 */
async function saveCheckError($: Host, id: string, why: string | undefined, isUsageRead = false): Promise<void> {
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
  const failure: CheckError = { why: why.slice(0, CHECK_ERROR_MAX), at: await $.clock.now(), ...(isUsageRead ? { isUsageRead: true as const } : {}) }
  await $.store.set(`check-error:${id}`, failure)
  await setView($, v => ({ ...v, checkErrors: { ...v.checkErrors, [id]: failure } }))
}

/** Why the login in use is left, counted the way the footer shows it: room left, or what is used. */
function whyLeave(view: View, now: number, need?: Need): string {
  const name = labelOf(view.accounts, view.activeId)
  if (view.health[view.activeId]?.kind === 'login-needed') return `${name} needs a sign-in`
  const r = view.readings[view.activeId]
  const five = windowPct(r?.fiveHour, now) ?? 0
  const [window, used] =
    need === 'fable' && isFableSpent(r, now)
      ? ['Fable week', windowPct(r?.fable, now) ?? 0]
      : five >= LEAVE_FIVE_HOUR
        ? ['5-hour window', five]
        : ['week', windowPct(r?.sevenDay, now) ?? 0]
  return view.footer.fill === 'left'
    ? `${name} has ${Math.round(100 - used)}% of its ${window} left`
    : `${name} has used ${Math.round(used)}% of its ${window}`
}

/**
 * Once the active login is spent or locked out, moves to the one the pane's
 * Rotation setting picks; never while it is off, Claude Code's policy refuses
 * it, or Connect holds the session where it is. Refused, it says once how to
 * get a session that can move: a background session nobody watches gets the
 * notification. Not from a turn that dies on the limit: Claude Code's security
 * default, seated in such a session, passes its StopFailure hook over. After a
 * turn that died on the Fable week (`need`), it leaves for that too, and only
 * for a login with Fable room: the ticks and responses pass none, so a session
 * that never hit the Fable week stays on a login whose Fable week is spent.
 * A tick or a response moves a session only while its main loop is failed (isRed): otherwise only a usage-limit stop does.
 */
async function maybeRotate($: Host, need?: Need, carry?: CarryOn): Promise<boolean> {
  // A view at its defaults names login 1 in use, whichever login this session runs on.
  if (!(await isBound($))) return false
  // Every check, response and tick comes through here: the login new sessions start on follows the same readings.
  await saveLaunchPick($).catch(error => debug($, `launch pick failed: ${String(error)}`))
  const now = await $.clock.now()
  const view = await getView($)
  // A stop that stays says why in the stop-log; a tick or a response is no stop.
  const stays = async (why: string): Promise<false> => {
    if (carry !== undefined) void logStop($, `stayed: ${why}`)
    return false
  }
  if (view.isSwitchBlocked) {
    // Said once a session: `kept` carries it through /clear, /resume and /branch, as it does isSwitchBlocked.
    const stuck = view.isStuckTold ? undefined : stuckText(view, now)
    if (stuck !== undefined) {
      await setView($, v => ({ ...v, isStuckTold: true }))
      kept = { ...kept, isStuckTold: true }
      $.ui.toast(stuck, { timeoutMs: 15_000 })
      notify($, stuck)
    }
    return stays('switching blocked')
  }
  // A tick or a response is no stop: it leaves a held Fable recovery where it is going, to a login with Fable room.
  if (need === undefined && carry === undefined && view.held?.carry !== undefined) return false
  // Nor does it move a session whose stop is still being recovered: that move would be in no stop's tried list.
  if (carry === undefined && episode !== undefined) return false
  // A settling switch holds every tick and response; a stop (it carries on) may move the session on from it.
  const isSettling = view.pending !== undefined && carry === undefined
  if (isConnectingChrome) return stays('Claude in Chrome is connecting')
  if (view.rotateTo === 'off') return stays('rotation off')
  if (isSettling) return stays('a switch is settling')
  // A stop's own move: the stop is the reason to leave, and every login not yet tried in its episode is a candidate.
  const tried = episode?.tried
  if (carry !== undefined && tried !== undefined) {
    const raw: Record<string, Reading | undefined> = {}
    for (const a of view.accounts) raw[a.id] = await ownedReading($, a.id)
    const pick = pickAfterStop(view, raw, now, need, tried, untaken)
    if (pick === undefined) {
      // A plain usage-limit stop (not the Fable week, not a rejected sign-in) with every login tried owes one carry-on once a login frees up.
      if (need === undefined && view.health[view.activeId]?.kind !== 'login-needed') {
        awaitFreeLogin($, view, now)
        // The stop's episode owes nothing now (no resume enters): the carry-on owed goes by the tick, whose own move
        // an episode standing would hold off.
        episode = undefined
        isCarryOnInFlight = false
      }
      return stays(`no untried login (tried ${tried.join(', ')})`)
    }
    const age = pick.readAgeMs === undefined ? '' : `, read ${Math.round(pick.readAgeMs / 60_000)} min ago`
    void logStop($, `picked ${pick.account.id}: ${pick.tier}${age}; tried ${tried.join(', ')}`)
    return switchTo($, pick.account, whyLeave(view, now, need), false, carry, true)
  }
  if (!shouldLeave(view, now, need)) {
    heldTold = undefined
    return stays('the login in use need not be left')
  }
  // A tick or a response moves a session only while it is failed (red in Orca): otherwise it stays where it runs,
  // whatever the stored numbers say (a login reset by hand keeps its old 100 until the next read), a sign-in mark
  // included: a lost sign-in fails the next request, which turns the session red.
  if (carry === undefined && !isRed()) {
    if (heldTold !== view.activeId) {
      heldTold = view.activeId
      void logStop($, `held on login ${view.activeId}: the session is answering, its stored usage says leave`)
    }
    return false
  }
  heldTold = undefined
  // With none to move to, the band above the prompt says when the next login frees up.
  const target = pickTarget({ ...view, accounts: view.accounts.filter(a => !untaken.has(a.id)) }, now, need)
  if (target === undefined) {
    // A plain usage-limit stop (not the Fable week, not a rejected sign-in) owes one carry-on once a login frees up.
    if (carry !== undefined && need === undefined && view.health[view.activeId]?.kind !== 'login-needed') awaitFreeLogin($, view, now)
    return stays('no login to move to')
  }
  const isMoved = await switchTo($, target, whyLeave(view, now, need), false, carry, true)
  // A tick or a response may move to a login whose usage read failed and that has no reading; no carry-on follows it.
  if (isMoved && carry === undefined && isUnread(view, target)) {
    void logStop($, `moved to ${target.id} by the tick or a response, its usage read failed, no carry-on`)
  }
  return isMoved
}

/**
 * Owes one carry-on once the first login frees up, and says so once: a toast, a notification and a stop-log line, the
 * line being what a reader of the store (a fleet watchdog) finds. A second stop before then finds `due` set and adds
 * nothing. `due` is read and set with no await between, as carriedFor is.
 */
function awaitFreeLogin($: Host, view: View, now: number): void {
  if (due !== undefined) return
  const at = firstFreeAt(view, now, untaken)
  const owed = at === undefined ? { from: view.activeId, owedAt: now } : { at, from: view.activeId, owedAt: now }
  // The main turns so far, held in this module only: a reload drops it, and the carry-on then goes after the grace.
  due = { ...owed, turns: mainTurns }
  const debt = due
  void logStop($, `no login left: one carry-on ${at === undefined ? 'once a login frees up' : `at ${new Date(at).toISOString()}`}`)
  const text = `${limitNotice(view, now, untaken)} This session carries on by itself once one frees up.`
  void (async () => {
    await writeCarryDue($, debt)
    $.ui.toast(text, { timeoutMs: 15_000 })
    notify($, text)
  })().catch(error => debug($, `carry-on owed not written to the view: ${String(error)}`))
}

/**
 * Sends the carry-on awaitFreeLogin owes, once, at the first tick that finds the login in use not spent: its own window
 * reset, or the tick's own rotation, which runs just before this, moved to a login that freed up. It never switches
 * itself: a second move in the same tick would end the first one's carry-on. Where that switch is still settling, it
 * carries on once the switch lands, armed once. On the login the stop found spent (no switch) it waits CARRY_ON_GRACE_MS
 * past the time owed, and sends nothing where a main turn ran since the stop, as Claude Code may carry on by itself.
 */
async function carryOnWhenFree($: Host): Promise<void> {
  if (due === undefined) return
  const view = await getView($)
  const now = await $.clock.now()
  // A debt this module holds that the view lacks, its write refused (awaitFreeLogin's, or the held branch's below), is
  // written again, so a reload after this tick still owes it. A view still holding an older debt, ended and marked in the
  // store, lacks this one too: the newer debt stands in its place, as this module owes one carry-on at a time.
  if (due !== undefined && (view.carryDue === undefined || view.carryDue.owedAt !== due.owedAt)) {
    await writeCarryDue($, due).catch(error => debug($, `carry-on owed not written again: ${String(error)}`))
  }
  // Connect holds the session on the extension's login: the carry-on stays owed and goes at the first tick after.
  if (isConnectingChrome) return
  if (shouldLeave(view, now)) return
  const isSameLogin = view.activeId === due?.from
  if (isSameLogin && due?.at !== undefined && now < due.at + CARRY_ON_GRACE_MS) return
  // Another tick may have taken it during the reads: the check and the clear go with no await between.
  if (due === undefined) return
  const owed = due
  const endings = dueEndings
  const isCleared = await clearCarryDue($)
  // A turn, a switch or a Connect visit can come during that write: the decision is made from what stands after it.
  const after = await getView($).catch(async error => {
    // Nothing was decided: what was owed stays owed, so the next tick writes it into the view again, unless a switch
    // ended it during the clear, which marks it where the view still holds it, as below. A newer debt a stop set
    // meanwhile stands instead, as in the held branch: this module owes one carry-on at a time.
    if (dueEndings !== endings && !isCleared) await markCarryEnded($, owed)
    else if (due === undefined && dueEndings === endings) due = owed
    throw error
  })
  if (after.activeId !== view.activeId || shouldLeave(after, now) || isConnectingChrome) {
    // A switch that ended what is owed moved it: nothing stays owed, and a view that still holds it is marked.
    if (dueEndings !== endings) return isCleared ? undefined : markCarryEnded($, owed)
    // The login moved meanwhile: the carry-on stays owed, decided again at the next tick.
    if (due === undefined) due = owed
    const held = due
    void logStop($, 'carry-on held: the login moved')
    await writeCarryDue($, held)
    return
  }
  // Every exit from here ends what is owed. Where the view still holds it, the store marks it, so a reload's boot owes
  // it no more; marked before the carry-on goes, so one whose submit throws went all the same.
  if (!isCleared) await markCarryEnded($, owed)
  const hasTurnRun = isSameLogin && owed.turns !== undefined && mainTurns > owed.turns
  void logStop($, hasTurnRun ? 'a turn ran since the stop: no carry-on' : `a login is free: carry-on on ${view.activeId}`)
  if (hasTurnRun) return
  const since = after.pending?.since
  if (since === undefined || now - since >= SETTLE_MS) {
    // Still on the login the stop found spent: nothing switched, so the line says its limit reset. A submit that
    // rejects sends nothing and is not tried again: what was owed is ended and marked above. A Connect visit that begins
    // after the check above, during markCarryEnded's write or carryOn's own reads, meets the carry-on as any running turn.
    await carryOn($, undefined, view.activeId === owed.from ? CONTINUE_RESET : undefined)
    return
  }
  // A stop that rode this switch and armed its carry-on during the clearing write above: no second one.
  if (carriedFor === since) return
  carryOnAfterSettle($, {})
  carriedFor = since
}

/**
 * Writes the carry-on owed into the view, only while this module still owes that same debt: one a switch, a press or a
 * tick ended or took meanwhile is never written back. The record leaves out the main turns, which only this module keeps.
 */
async function writeCarryDue($: Host, debt: NonNullable<typeof due>): Promise<void> {
  const { at, from, owedAt } = debt
  const record = at === undefined ? { from, owedAt } : { at, from, owedAt }
  await setView($, v => (due === debt ? { ...v, carryDue: record } : v))
}

/**
 * Clears the carry-on owed, in this module at once and then in the view. Answers whether the view write went: one
 * refused leaves the view holding it, which its caller marks ended (markCarryEnded) once it ends it.
 */
async function clearCarryDue($: Host): Promise<boolean> {
  due = undefined
  try {
    await setView($, v => ({ ...v, carryDue: undefined }))
    return true
  } catch (error) {
    await debug($, `carry-on owed not cleared: ${String(error)}`)
    return false
  }
}

/** What the store keeps per session: when the carry-on owed was owed that this module ended though its view kept it. */
const CARRY_ENDED = 'carry-ended:'

/**
 * Marks the carry-on owed as ended under `carry-ended:<session mark>`, so a reload's boot does not owe it again while the
 * view still holds it. One with no `owedAt` (an older version of the mod owed it) is never marked: nothing names it.
 * Never fails its caller: a refused write, or no session mark, leaves a reload owing it once more.
 */
async function markCarryEnded($: Host, owed: { owedAt?: number }): Promise<void> {
  if (owed.owedAt === undefined) return
  try {
    const mark = (await getView($)).sessionMark ?? kept.mark
    if (mark === undefined) return
    // When it ended, which the start's sweep ages the mark from: a debt can be owed for a week before it ends.
    await $.store.set(`${CARRY_ENDED}${mark}`, { owedAt: owed.owedAt, endedAt: await $.clock.now() })
  } catch (error) {
    await debug($, `carry-on end not marked: ${String(error)}`)
  }
}

/** When the carry-on owed was owed that `mark`'s session ended though its view kept it; undefined where none is marked. */
async function markedOwedAt($: Host, mark: string | undefined): Promise<number | undefined> {
  if (mark === undefined) return undefined
  const marked = await $.store.get(`${CARRY_ENDED}${mark}`).catch(() => undefined)
  const owedAt = (marked as { owedAt?: unknown } | undefined)?.owedAt
  return typeof owedAt === 'number' ? owedAt : undefined
}

/** The login in use, when its token refreshes too soon for the refresh guard to let the session leave it for `target`. */
async function refreshingSoon($: Host, view: View, target: Account, now: number): Promise<Account | undefined> {
  const active = view.accounts.find(a => a.id === view.activeId)
  if (active === undefined || active.id === target.id) return undefined
  let stored: Stored
  try {
    stored = await readStored($, active.slot)
  } catch (error) {
    // A read with no answer tells no expiry, so it holds: a switch through the guard can save the old login's token
    // under the new slot. The minute's retry reads again. A refused read throws, as before (RULING 7121).
    if (errorName(error) !== 'CredentialReadTimedOut') throw error
    return active
  }
  const credential = stored.state === 'present' ? stored.credential : undefined
  // A token that has already run out is refreshed first of all, at the session's next request: the switch waits for it too.
  // A sign-in whose refresh token has run out refreshes nothing, and nor does one already rejected with its token run out:
  // nothing holds the switch off either. Only a stop's rejection proves that (its mark carries `at`); a check's
  // login-needed proves no refresh dead, so the hold stands until the token refreshes.
  const isExpired = credential !== undefined && credential.expiresAt <= now
  const health = view.health[active.id]
  const isRejected = isExpired && health?.kind === 'login-needed' && health.why === SIGN_IN_REJECTED && typeof health.at === 'number'
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
  const view = await getView($)
  const h = view.held
  if (h === undefined) return
  if (h.isRotation) {
    if (view.rotateTo === 'off' || view.isSwitchBlocked) {
      await writeSwitch($, { idle: true }, v => ({ ...v, held: undefined }))
      return
    }
    if (isConnectingChrome) return
    // A rotation that carries nothing (a tick's or a response's) goes only while the session is red: a main turn since
    // has cleared it, so the hold ends and the next tick decides again.
    if (h.carry === undefined && !isRed()) {
      await writeSwitch($, { idle: true }, v => ({ ...v, held: undefined }))
      return
    }
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
  armedCarryOns += 1
  $.clock.after(SETTLE_MS, () => {
    armedCarryOns -= 1
    // A Connect visit holds the session: it carries the turn on once it ends, as for a stop it cut, though its move counts
    // as another switch since. A Fable carry-on held so goes as the mod's own line.
    if (isConnectingChrome) {
      isCutByVisit = true
      void logStop($, 'carry-on held: Claude in Chrome is connecting')
    } else if (moves === mark) void carryOn($, owed.need).catch(error => debug($, `carry-on failed: ${String(error)}`))
    else void logStop($, 'carry-on skipped: another switch since')
  })
  // Not awaited: a caller sets carriedFor in the same tick, so a second stop cannot arm a second carry-on meanwhile.
  void logStop($, 'carry-on armed')
}

/**
 * How long a switch waits on the one running before it takes the switch over. It is longer than the 10 s of the keychain
 * read and the CHROME_WAIT_MS of Claude in Chrome, the limits a switch's own steps carry; the engine's env set and the
 * store have none, so a switch that never ends must not hold every later press for ever.
 */
const SWITCH_WAIT_MS = 30_000
/** The run of the switch or point-back this module started and still owns, awaited by a switch that waits on it. */
let switchRun: Promise<boolean> | undefined
/** The token of that run, while it runs: a /clear's reset drops the view's owner, and rebindSession puts this one back. */
let live: number | undefined
let lastToken = 0

/**
 * Drops the held switch `key` names (holdKey), at once and only while no switch runs; any other hold (a press's, a later
 * stop's) stands. 'dropped' only where this write cleared that hold. Not fixed: a minute retry that read the hold before
 * this write holds it again after it, and the hold then lands through the refresh guard once the token refreshes.
 */
async function dropHeld($: Host, key: string | undefined): Promise<'dropped' | 'not the hold the nudge went for' | 'a switch is running'> {
  let wasHeld = false
  const isApplied = await writeSwitch($, { idle: true }, v => {
    wasHeld = key !== undefined && holdKey(v.held) === key
    return wasHeld ? { ...v, held: undefined } : v
  })
  if (!isApplied) return 'a switch is running'
  return wasHeld ? 'dropped' : 'not the hold the nudge went for'
}

/**
 * Runs `run` as the switch that owns the session, by `token`, already claimed in the view. Once it ends, held,
 * refused, given up or done, it owns nothing: no claim it made stands, and the slot follows the view again.
 */
async function runOwned($: Host, token: number, run: () => Promise<boolean>): Promise<boolean> {
  const p = run()
  switchRun = p
  live = token
  try {
    return await p
  } finally {
    if (switchRun === p) switchRun = undefined
    if (live === token) live = undefined
    await writeSwitch($, { owner: token }, v => ({ ...v, owner: undefined })).catch(error => debug($, `switch release failed: ${errorName(error)}`))
    await reconcile($).catch(error => debug($, `slot repair failed: ${errorName(error)}`))
  }
}

/**
 * While no switch runs: writes the slot of the login the view names where the slot in use is another, as after a switch
 * taken over whose slot write landed late. Where that write fails, the view names the login whose slot is in use.
 */
async function reconcile($: Host): Promise<void> {
  const view = await getView($)
  if (view.owner !== undefined || kept.slot === undefined) return
  const want = view.accounts.find(a => a.id === view.activeId)?.slot
  if (want === undefined || want === kept.slot) return
  try {
    await useSlot($, want)
  } catch (error) {
    await debug($, `slot repair failed: ${errorName(error)}`)
    const inUse = view.accounts.find(a => a.slot === kept.slot)
    if (inUse !== undefined) await writeSwitch($, { idle: true }, v => ({ ...v, activeId: inUse.id, pending: undefined }))
  }
}

/**
 * Points this session at `target`; false while the refresh guard holds it back, or Claude Code's policy refuses it. Quiet: no toast.
 * `carry`: the carry-on the switch owes, sent once it lands. Held back, any stop's carry-on waits for the switch.
 * With a switch running: a rotation that carries nothing starts none, as the next tick decides again; a stop's rotation
 * rides the one running where it moves, its carry-on armed on it once; a press or a Claude in Chrome visit waits for it,
 * then claims the switch, and after SWITCH_WAIT_MS takes it over: the one taken over writes nothing more.
 */
async function switchTo($: Host, target: Account, why: string, isQuiet = false, carry?: CarryOn, isRotation = false): Promise<boolean> {
  for (;;) {
    const seen = (await getView($)).owner?.token
    if (seen === undefined) {
      const token = ++lastToken
      if (await writeSwitch($, { claim: undefined }, v => ({ ...v, owner: { token } }))) {
        return runOwned($, token, () => switchNow($, token, target, why, isQuiet, carry, isRotation))
      }
      continue
    }
    if (isRotation && carry === undefined) return false
    const before = switchRun
    const late = $.clock.sleep(SWITCH_WAIT_MS).then(() => 'late' as const)
    const result = await Promise.race([before === undefined ? late : before.catch(() => false), late])
    if (result === 'late') {
      // Only the waiter whose claim applies takes the switch over; another waits on the switch that waiter starts.
      const token = ++lastToken
      if (!(await writeSwitch($, { claim: seen }, v => ({ ...v, owner: { token } })))) continue
      await debug($, `took over the switch running after ${SWITCH_WAIT_MS / 1000} s`)
      return runOwned($, token, () => switchNow($, token, target, why, isQuiet, carry, isRotation))
    }
    if (isRotation && result) {
      const since = (await getView($)).pending?.since
      // The check and the write go with no await between, as in switchNow: the switch that ran may carry on itself.
      if (since !== undefined && carriedFor !== since && carry !== undefined) {
        carryOnAfterSettle($, carry)
        carriedFor = since
        // Only a rider that arms its own carry-on ends what is owed: one that arms none leaves it for carryOnWhenFree.
        endDue($, carry, isRotation, isQuiet)
      }
      return true
    }
    // A waiter claims again, so two released by one switch start one after the other, and one whose target the switch
    // that ran reached starts none.
    if ((await getView($)).activeId === target.id) {
      endDue($, carry, isRotation, isQuiet)
      return true
    }
  }
}

/**
 * Ends the carry-on owed once a login frees up (awaitFreeLogin) where a move landed for a switch that carries on, or one a
 * person asked for: switchNow's own, a stop's that rode the switch running, or a press whose login that switch reached.
 * The tick's own rotation (it carries nothing) and Connect's visit (quiet) leave it owed: carryOnWhenFree sends it after them.
 */
function endDue($: Host, carry: CarryOn | undefined, isRotation: boolean, isQuiet: boolean): void {
  if (carry === undefined && (isRotation || isQuiet)) return
  // Counted even while carryOnWhenFree's clearing write runs, with `due` already cleared, so that write keeps it ended.
  dueEndings += 1
  if (due === undefined) return
  const owed = due
  void clearCarryDue($).then(isCleared => (isCleared ? undefined : markCarryEnded($, owed)))
}

/** The switch that owns the session by `token`: every write that names the switch applies only while it still owns it. */
async function switchNow($: Host, token: number, target: Account, why: string, isQuiet: boolean, carry: CarryOn | undefined, isRotation: boolean): Promise<boolean> {
  const mine: SwitchWriter = { owner: token }
  // Taken over while it waited at an await: it writes nothing more, a stop's switch saying so in the stop-log.
  const givenUp = (): false => {
    if (carry !== undefined) void logStop($, 'stop switch given up on: landed late, no carry-on')
    return false
  }
  // A stop's own move holds the failure its stop examined, and goes only while that is still the latest and uncleared: a
  // main turn that began, or a newer failure, since, makes it the old stop's move on another's behalf. Abandoned: no
  // hold, no slot write, no carry-on. Checked last before each: every move but a press passes it, and a press carries no epoch.
  const isStale = () => carry?.epoch !== undefined && !isSameFailure(carry.epoch)
  const dropStaleStop = (): false => {
    void logStop($, 'stop switch dropped: the failed turn it examined has changed since')
    return false
  }
  const active = await refreshingSoon($, await getView($), target, await $.clock.now())
  if (active !== undefined) {
    // Where the held switch goes, what it carries on with and who asked for it are one intent, replaced together:
    // a later stop or press brings its own (a press's carries on with nothing); the retry brings the held one's.
    // The held switch outlives the failure it was made for (the refresh nudge's own turn clears it), so it carries no
    // epoch: a stop that went stale holds nothing, and its hold would replace a later stop's.
    if (isStale()) return dropStaleStop()
    let wasHeld = false
    if (!(await writeSwitch($, mine, v => {
      wasHeld = v.held !== undefined
      return { ...v, held: { target, why, carry: carry === undefined ? undefined : { need: carry.need }, isRotation } }
    }))) return givenUp()
    if (!wasHeld) {
      if (carry !== undefined) void logStop($, `held for ${target.id}: the token in use refreshes soon`)
      const { accounts } = await getView($)
      tell($, `Switching to ${claudeAccount(target, accounts)} in a few minutes, once ${label(active, accounts)}'s token has refreshed.`)
    }
    return false
  }
  // A switch carries on with what it was asked to: the retry passes the held switch's own carry-on, a press none.
  const owed = carry
  if (!(await writeSwitch($, mine, v => ({ ...v, held: undefined })))) return givenUp()
  await keepChrome($)
  // The awaits since maybeRotate's check can span a main turn start, which clears the failure: a rotation that carries
  // nothing reads it again here, the last point before the slot write, and stays where the session now runs.
  if (isRotation && carry === undefined && !isRed()) return false
  if (isStale()) return dropStaleStop()
  try {
    await useSlot($, target.slot)
  } catch (error) {
    if (!isPolicyRefusal(error)) throw error
    // A press of Use now or Rotate now gets an answer, even once the notice has shown.
    if (!(await blocked($))) tell($, blockedText(await getView($)))
    if (carry !== undefined) void logStop($, 'stayed: switching blocked')
    return false
  }
  // A switch that replaces an unproven one ends it unproven. A stop's own move (it carries on) keeps what the stop
  // marked: the mark is why it moves. Any other drops it. Taken over during its slot write, it writes nothing, and
  // the release puts the slot back on the login the view names.
  if (carry !== undefined) {
    let replaced = undefined as ProvisionalStop | undefined
    if (!(await writeSwitch($, mine, v => {
      replaced = v.provisionalStop
      return { ...v, provisionalStop: undefined }
    }))) return givenUp()
    // The record leaves the view but its mark stands: the episode keeps it, for a later proof that its switch did not land.
    const ep = episode
    if (replaced !== undefined && ep !== undefined) ep.superseded = [...(ep.superseded ?? []), replaced]
  } else if (!(await undoProvisionalStop($, mine))) return givenUp()
  const now = await $.clock.now()
  // Published only after the slot write landed, and only while it still owns the switch.
  if (!(await writeSwitch($, mine, v => ({
    ...v,
    activeId: target.id,
    pending: { id: target.id, from: v.activeId, since: now },
    removing: undefined,
  })))) return givenUp()
  movedAt = now
  moves += 1
  endDue($, carry, isRotation, isQuiet)
  // The carry-on is armed and carriedFor set straight after pending's write, with no await between, so a second stop
  // cannot arm a second carry-on; the toast reads the view after them.
  if (carry !== undefined) void logStop($, `moved to ${target.id}`)
  if (owed !== undefined) {
    carryOnAfterSettle($, owed)
    carriedFor = now
  }
  if (!isQuiet) $.ui.toast(`Switched to ${claudeAccount(target, (await getView($)).accounts)}: ${why}.`, { timeoutMs: 6000 })
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
  // A switch made while this waited (a use, a stop) owns the session now: this one's proof or give-up is void.
  const isStill = async () => {
    const current = (await getView($)).pending
    return current?.id === pending.id && current.since === pending.since
  }
  if (!(await isStill())) return
  // A response proves its login by its week's reset, which each account has at a time of its own; its percents prove
  // nothing, as two logins can stand within a few points of each other.
  const isTarget = (v: View) => whoseWeek(reading, v.readings).includes(pending.id)
  const isSource = (v: View) => whoseWeek(reading, v.readings).includes(pending.from)
  // A response whose week the login left shares tells nothing: confirmed on it, the old login's next responses
  // would be stored as the new one's.
  if (isTarget(await getView($)) && !isSource(await getView($))) {
    await proveSwitch($, pending.id, pending.since)
  } else if (isResponse && now - pending.since > CONFIRM_GIVE_UP_MS) {
    const from = accounts.find(a => a.id === pending.from)
    if (from !== undefined) await checkAccount($, from, { since: pending.since })
    if (!(await isStill())) return
    const after = await getView($)
    // Another session may have removed the account moved to meanwhile: it is then named by its id, never "?".
    const movedTo = accounts.find(a => a.id === pending.id)
    const named = movedTo === undefined ? labelOf(accounts, pending.id) : claudeAccount(movedTo, accounts)
    // Minutes on, a switch has landed if it ever will: only a response that is the old login's alone points back.
    if (isTarget(after) && isSource(after)) {
      await proveSwitch($, pending.id, pending.since)
      return
    }
    // Each write below acts on this settling switch alone, while no switch runs: a press since owns the session.
    const examined: SwitchWriter = { pending: pending.since }
    if (from === undefined || !isSource(after)) {
      // No response proved either login: a stop marked on the one moved to is a guess, and every session reads marks.
      if (!(await undoProvisionalStop($, examined))) return
      if (!(await writeSwitch($, examined, v => ({ ...v, pending: undefined })))) return
      tell($, `The switch to ${named} has not shown in responses.`)
      return
    }
    // The point-back claims the switch in the one write that finds this switch still settling and none running, so a
    // press waits for it, and a press made before it claims stands.
    const token = ++lastToken
    if (!(await writeSwitch($, examined, v => ({ ...v, owner: { token } })))) return
    const isBack = await runOwned($, token, async () => {
      untaken.add(pending.id)
      if (!(await undoProvisionalStop($, { owner: token }))) return false
      try {
        await useSlot($, from.slot)
      } catch (error) {
        await debug($, `switch back failed: ${errorName(error)}`)
        return false
      }
      if (!(await writeSwitch($, { owner: token }, v => ({ ...v, activeId: from.id, pending: undefined })))) return false
      movedAt = now
      moves += 1
      return true
    })
    if (!isBack) return
    tell(
      $,
      `The switch to ${named} did not take: responses still use ${label(from, accounts)}, so it shows in use again. ` +
        `The rotation leaves ${labelOf(accounts, pending.id)} be in this session; Use now tries it again.`,
    )
  }
}

/** A response's own usage: the active login's, unless a switch is still settling. */
async function onMeasure($: Host, limits: readonly SessionRateLimit[]): Promise<void> {
  const measuredAt = await $.clock.now()
  lastMeasured = { at: measuredAt, reading: readingFromLimits(limits, measuredAt) }
  // A view not bound holds a default login, not this session's: a response measured then is no login's to store (it
  // once put account 3's week under account 1). Once boot has read the slot, isBound binds it first, and gives back
  // a switch in flight, which this response then settles before any reading is stored.
  if (!(await isBound($))) return
  const view = await getView($)
  if (view.pending !== undefined) {
    await settlePending($, true)
    return
  }
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
 * and a Fable one with no line kept, sends the mod's own line under its name:
 * `own` where the caller names it (a carry-on with no switch), else CONTINUE.
 */
async function carryOn($: Host, need?: Need, own?: string): Promise<void> {
  const view = await getView($)
  const kept = need === 'fable' ? view.fableContinueText : undefined
  carriedOn = { since: view.pending?.since, at: await $.clock.now() }
  await sendCarryOn($, kept === undefined ? { text: own ?? CONTINUE } : { text: kept, asUser: true })
}

/**
 * Submits a carry-on, one at a time, and logs its answer: it resolves once the prompt entered and its turn started, or
 * was queued behind a running one. After a usage-limit stop Claude Code shows a menu that holds a submitted prompt
 * queued, and no mod call closes it: the owed-resume look (lookOwed) frees it with an Escape.
 *
 * One turned away while another is queued waits on that one (puma-9arph.91): where the engine drops or refuses it while
 * it is still the latest and still queued, the one turned away goes once in its place. Once: a submit of its own that is
 * dropped too keeps nothing, so a further one needs a new turn-away. Nothing goes where the queued one went through or
 * anything since cleared the queue: a main turn began, the stop found no login left, the episode ended. A Connect visit
 * open then takes it, and sends its own line in its place, the mod's even for a Fable line kept as your words. Not fixed:
 * a drop after a visit's finally and before its move back settles sends at once (puma-9arph.93).
 */
async function sendCarryOn($: Host, prompt: { text: string; asUser?: true }): Promise<void> {
  if (isCarryOnInFlight) {
    if (carryOnText === NUDGE_TEXT && episode !== undefined) episode.isCarryOnHeldBack = true
    else turnedAway = { prompt, submit: carryOnSubmits }
    void logStop($, 'carry-on not sent again: one is queued')
    return
  }
  isCarryOnInFlight = true
  carryOnText = prompt.text
  const submit = (carryOnSubmits += 1)
  void logStop($, 'carry-on queued')
  // Read and started in one synchronous run with the refusal it answers, before any await: a turn may begin at the next.
  const sendTurnedAway = (isQueued: boolean) => {
    const away = turnedAway?.submit === submit ? turnedAway : undefined
    if (away === undefined) return
    turnedAway = undefined
    if (!isQueued) return
    if (isConnectingChrome) {
      isCutByVisit = true
      void logStop($, 'carry-on held: Claude in Chrome is connecting')
      return
    }
    void logStop($, 'carry-on sent in place of the one queued')
    void sendCarryOn($, away.prompt).catch(error => debug($, `carry-on failed: ${String(error)}`))
  }
  let answer: Awaited<ReturnType<Host['prompt']['submit']>>
  try {
    answer = await $.prompt.submit(prompt)
  } catch (error) {
    carryOnAnswers += 1
    const isLatest = submit === carryOnSubmits
    const isQueued = isLatest && isCarryOnInFlight
    if (isLatest) {
      isCarryOnInFlight = false
      carryOnRefusals += 1
    }
    sendTurnedAway(isQueued)
    if (isLatest && prompt.text === NUDGE_TEXT && episode !== undefined) carryOnAfterNudge($, episode, false)
    throw error
  }
  carryOnAnswers += 1
  if (answer.drop === undefined) {
    if (prompt.text !== NUDGE_TEXT) workAnsweredClean = Math.max(workAnsweredClean, submit)
    void logStop($, 'carry-on resolved')
    return
  }
  // The engine's own refusal (a Stop stands, a host's limit): said in debug, with its reason, and not tried again.
  const isLatest = submit === carryOnSubmits
  const isQueued = isLatest && isCarryOnInFlight
  if (isLatest) {
    isCarryOnInFlight = false
    carryOnRefusals += 1
  }
  sendTurnedAway(isQueued)
  await debug($, `carry-on dropped: ${answer.drop}`)
  void logStop($, 'carry-on drop')
  if (isLatest && prompt.text === NUDGE_TEXT && episode !== undefined) carryOnAfterNudge($, episode, false)
}

/**
 * Carries the person's turn on, once, after the refresh nudge's turn: owed where its answer dropped the hold on the login
 * in use (`isOwed`), or where a landing held its carry-on back behind the nudge. Only while nothing is queued or armed.
 */
function carryOnAfterNudge($: Host, ep: Episode, isOwed: boolean): void {
  if (episode !== ep || !(isOwed || ep.isCarryOnHeldBack === true) || isCarryOnInFlight || armedCarryOns > 0) return
  ep.isCarryOnHeldBack = undefined
  void carryOn($, ep.need).catch(error => debug($, `carry-on failed: ${String(error)}`))
}

/** Ends a stop's episode once its resume has answered: a later stop opens a new one, with its own tried list and budget. */
async function endEpisode($: Host, ep: Episode): Promise<void> {
  if (episode !== ep) return
  episode = undefined
  isCarryOnInFlight = false
  // The resume is proven, whichever turn entered it: Claude Code's own countdown still stands (reading R6c), so one
  // Escape is owed (puma-9arph.80 case B).
  await armOwnContinue($, ep.tried.at(-1), ep.personPrompts)
  const { activeId } = await getView($)
  void logStop($, `work resumed on login ${activeId}`)
}

/**
 * Ends an entry that did not answer (aborted, failed, or stopped by a limit). The carry-on's own turn used it up:
 * nothing is queued. Another turn (a waker's, or one an Escape landed on) leaves it queued as before it, so the look acts
 * again, and a new stop's carry-on is not sent again: one resume never enters twice.
 */
function endEntry($: Host, ep: Episode, how: string): void {
  ep.enteredAt = undefined
  const before = ep.before
  if (before === undefined) return
  if (before.isCarryOnTurn) {
    void logStop($, `resume ended ${how}: the carry-on's own turn, nothing queued`)
    return
  }
  // Only the carry-on that stood when this turn began, while no refusal since ended it; one submitted since holds the
  // flag up already.
  if (before.carryOn === carryOnRefusals) isCarryOnInFlight = true
  if (before.isLimitStopLast) limitStopAfter = mainTurns
  void logStop($, `resume ended ${how}: another turn, ${isCarryOnInFlight ? 'the carry-on still queued' : 'nothing queued'}`)
}

/** Writes a look's line once an episode, where the look would otherwise write it every tick. */
function tellOnce($: Host, ep: Episode, what: Told, line: string): void {
  if (ep.told.has(what)) return
  ep.told.add(what)
  void logStop($, line)
}

/** Tells the person a line once an episode, where the look would otherwise tell it every tick. */
function toastOnce($: Host, ep: Episode, what: Told, line: string): void {
  if (ep.told.has(what)) return
  ep.told.add(what)
  tell($, line)
}

/**
 * Every OWED_LOOK_MS while a stop's episode stands and its resume has not entered: notes the turns a queued carry-on
 * waits on, and sends one Escape to this session's Orca pane where escapeHeldBack finds nothing holding it back, so
 * Claude Code's limit menu lets the carry-on enter. A tick that finds the lock held does nothing; the lock is let go
 * as the key's child starts, so a hung `orca` holds nothing.
 */
async function lookOwed($: Host): Promise<void> {
  const ep = episode
  if (ep === undefined || ep.enteredAt !== undefined || isLocked) return
  const sent = await withLock(async () => {
    if (episode !== ep || ep.enteredAt !== undefined) return undefined
    const view = await getView($)
    const now = await $.clock.now()
    ep.budget ??= 2 * view.accounts.length + 2
    const turns = openTurns.size
    if (isCarryOnInFlight && turns !== ep.lastWaitCount) {
      ep.lastWaitCount = turns
      if (turns > 0) void logStop($, `owed resume waits: ${turns} turns open`)
    }
    const isSettling = movedAt !== undefined && now - movedAt < SETTLE_MS
    if (!isCarryOnInFlight && armedCarryOns === 0 && !isSettling && view.held === undefined) tellOnce($, ep, 'nothing', 'owed resume: no carry-on queued, no key')
    if (view.held?.carry !== undefined && (await nudgeIfDue($, ep, view, now))) return undefined
    const look: EscapeLook = {
      isCarryOnInFlight,
      isLimitStopLast: limitStopAfter === mainTurns,
      openTurns: turns,
      isPromptEntering: promptsEntering > 0,
      isSettling,
      isHeld: view.held !== undefined,
      isNudge: ep.nudgedAt !== undefined && isCarryOnInFlight && carryOnText === NUDGE_TEXT,
      escapes: ep.escapes,
      budget: ep.budget,
      sinceEscapeMs: ep.lastEscapeAt === undefined ? undefined : now - ep.lastEscapeAt,
      pane: await $.env.get('ORCA_TERMINAL_HANDLE'),
    }
    const why = escapeHeldBack(look)
    if (why === 'no Orca pane') tellOnce($, ep, 'pane', 'owed resume: no Orca pane, waits for an Esc')
    if (why === 'Escapes spent') tellOnce($, ep, 'stuck', `owed resume stuck: ${ep.budget} Escapes spent, not entered`)
    if (why !== undefined || look.pane === undefined) return undefined
    // Bounded, as the look holds the lock: a fill with no answer is no key. A rejected fill throws, as before.
    const box = await answerWithin($, 'PromptFillTimedOut', $.prompt.fill({ text: '', mode: 'append' })).catch(error => {
      if (errorName(error) !== 'PromptFillTimedOut') throw error
      return undefined
    })
    if (box === undefined) {
      tellOnce($, ep, 'after fill: no answer', 'owed resume: fill got no answer, no key')
      return undefined
    }
    // Every gate the look read before its fill is read again with no await before the key, the fill's answer being the
    // last awaited (puma-9arph.81, Codex round 1 F1): a prompt entering, a move (against the look's own `now`, so a move
    // during the look reads as settling), a hold (from `kept`, which every view write of this session updates), or a turn
    // begun during the fill gets no Escape.
    const after: AfterFill = {
      openTurns: openTurns.size,
      isLimitStopLast: limitStopAfter === mainTurns,
      isCarryOnInFlight,
      isSameEpisode: episode === ep,
      isPromptEntering: promptsEntering > 0,
      isSettling: movedAt !== undefined && now - movedAt < SETTLE_MS,
      isHeld: kept.held !== undefined,
    }
    const act = escapeAfterFill(look, box.refusal, after, now)
    if ('why' in act) {
      if (act.why === 'no dialog holds it') tellOnce($, ep, 'fill', `owed resume: fill answered ${box.refusal ?? 'no cause'}, no key`)
      else if (GATES_AFTER_FILL.includes(act.why)) tellOnce($, ep, `after fill: ${act.why}`, `owed resume: no key, ${act.why}`)
      return undefined
    }
    const child = $.process.spawn({ argv: escapeArgv(look.pane) })
    ep.escapes = act.escapes
    ep.lastEscapeAt = act.lastEscapeAt
    return { child, escape: act.escapes, budget: ep.budget }
  })
  if (sent === undefined) return
  const code = await exitOf($, sent.child)
  void logStop($, `owed resume: Escape ${sent.escape} of ${sent.budget} (exit ${code ?? 'none'})`)
}

/**
 * Owes the own-continue Escape once a limit stop's resume answered, by the stopped login's stored reset where one is
 * kept, else five hours on (RULING 6839 b), the shortest window a stop marks. Not where a person's prompt entered since
 * the stop (`since`, the count then): it cancelled the countdown.
 */
async function armOwnContinue($: Host, stoppedId: string | undefined, since: number | undefined): Promise<void> {
  // Read again after the view: a person's prompt during the read has ended the need for the key (round 1 F3).
  if (since === undefined || personPrompts !== since) return
  const view = await getView($)
  if (personPrompts !== since) return
  const judged = stoppedId !== undefined && stopWindow?.id === stoppedId ? stopWindow.window : undefined
  const resetAt = ownContinueResetAt(view, stoppedId, judged) ?? (await $.clock.now()) + FIVE_HOUR_MS
  ownContinue = { resetAt, isSent: false, told: new Set() }
  void logStop($, 'own continue: armed')
}

/** Ends the own-continue arm, saying why where it was still owed. */
function disarmOwnContinue($: Host, why: string): void {
  const arm = ownContinue
  ownContinue = undefined
  if (arm !== undefined && !arm.isSent) void logStop($, `own continue: disarmed, ${why}`)
}

/**
 * Every OWED_LOOK_MS while the own-continue Escape is owed (puma-9arph.71): weighs it by ownContinueHeldBack, asking the
 * box, then an empty fill, then the pane's rendered screen, and sends ONE Escape to this session's Orca pane only where
 * all of it answers an idle, empty prompt under the countdown's footer. The turns are read again with no await before
 * the key. Each reason it holds back for is written once an arm; no screen text is kept or written.
 */
async function lookOwnContinue($: Host): Promise<void> {
  const arm = ownContinue
  if (arm === undefined || arm.isSent || isLocked) return
  const sent = await withLock(async () => {
    if (ownContinue !== arm || arm.isSent) return undefined
    // A main turn that begins during the look leaves the arm, but this look's reads are stale: no key from it.
    const turnsAt = mainTurns
    const view = await getView($)
    const now = await $.clock.now()
    const tellWhy = (why: string): undefined => {
      if (why === "past the own continue's deadline") disarmOwnContinue($, why)
      else if (!arm.told.has(why)) {
        arm.told.add(why)
        void logStop($, `own continue: no key, ${why}`)
      }
      return undefined
    }
    let look: OwnContinueLook = {
      isArmed: true,
      isSent: arm.isSent,
      openTurns: openTurns.size,
      isPromptEntering: promptsEntering > 0,
      isCarryOnQueued: isCarryOnInFlight || armedCarryOns > 0,
      isSettling: movedAt !== undefined && now - movedAt < SETTLE_MS,
      isHeld: view.held !== undefined,
      isPanelShown: isPaneShown,
      now,
      resetAt: arm.resetAt,
      pane: await $.env.get('ORCA_TERMINAL_HANDLE'),
    }
    let why = ownContinueHeldBack(look)
    if (why !== undefined || !look.pane) return tellWhy(why ?? 'no Orca pane')
    const box = await answerWithin($, 'PromptReadTimedOut', $.prompt.read()).catch(() => undefined)
    look = { ...look, box: { text: box?.text } }
    why = ownContinueHeldBack(look)
    if (why !== undefined) return tellWhy(why)
    const fill = await answerWithin($, 'PromptFillTimedOut', $.prompt.fill({ text: '', mode: 'append' })).catch(() => undefined)
    look = { ...look, fill: fill === undefined ? { isFilled: false } : { isFilled: fill.isFilled, refusal: fill.refusal, text: fill.text } }
    why = ownContinueHeldBack(look)
    if (why !== undefined) return tellWhy(why)
    const read = await $.process.run(screenArgv(look.pane), { timeoutMs: 5_000 }).catch(() => undefined)
    look = { ...look, screen: { lines: read?.exitCode === 0 ? screenLinesFrom(read.stdout) : undefined } }
    // The box again after the screen, then every gate read with no await (Codex round 1 KEY-STALE-PANEL): a draft
    // typed, the panel opened, a carry-on queued, a move or a prompt begun during the look's awaits gets no key.
    const again = await answerWithin($, 'PromptReadTimedOut', $.prompt.read()).catch(() => undefined)
    look = {
      ...look,
      box: { text: again?.text },
      isPromptEntering: promptsEntering > 0,
      isCarryOnQueued: isCarryOnInFlight || armedCarryOns > 0,
      isSettling: movedAt !== undefined && now - movedAt < SETTLE_MS,
      isPanelShown: isPaneShown,
    }
    // Read again with no await before the key: an arm that ended, or a turn that began, during the look gets none.
    const act = ownContinueAfterLook(look, { isSameArm: ownContinue === arm, openTurns: openTurns.size, mainTurnsSince: mainTurns - turnsAt })
    if ('why' in act) return tellWhy(act.why)
    arm.isSent = true
    return { child: $.process.spawn({ argv: escapeArgv(look.pane) }) }
  })
  if (sent === undefined) return
  const code = await exitOf($, sent.child)
  void logStop($, `own continue: Escape (exit ${code ?? 'none'})`)
}

/**
 * The refresh nudge (puma-9arph.57), under the look's lock: while a stop's switch is held for the token in use, with
 * no turn running, Claude Code refreshes that token at no request. Once the token is due within NUDGE_LEAD_MS this
 * sends one carry-on of its own on the login in use: its request refreshes the token under that login's own slot,
 * and the stop it dies on lands the switch through the unchanged refresh guard. True when it sent one.
 * One more goes (puma-9arph.65) once that token has run out unrefreshed, on the same terms: a request on a token past
 * its expiry refreshes it first. Never a third. A draft in the box holds either, and the person is told once.
 */
async function nudgeIfDue($: Host, ep: Episode, view: View, now: number): Promise<boolean> {
  const active = view.accounts.find(a => a.id === view.activeId)
  if (active === undefined) return false
  const isQuiet = !isCarryOnInFlight && nudgeTurnId === undefined && openTurns.size === 0
  const isAgain = ep.nudge !== undefined
  if (ep.nudgedAt !== undefined) {
    if (isQuiet && limitStopAfter === mainTurns) {
      tellOnce($, ep, 'nudge', 'refresh nudge: token not refreshed, switch still held')
      if (ep.isRenudged === true) toastOnce($, ep, 'sign-in wait', "Switching accounts waits for this login's sign-in to refresh. Send any message to retry, or use /accounts.")
    }
    // The one more waits for the token's expiry, and for a quiet session as the first did.
    if (ep.isRenudged === true || ep.nudge === undefined || now < ep.nudge.expiresAt || !isQuiet) return false
  }
  const stored = await readStored($, active.slot).catch(() => undefined)
  const credential = stored?.state === 'present' ? stored.credential : undefined
  const boxText = (await answerWithin($, 'PromptReadTimedOut', $.prompt.read()).catch(() => undefined))?.text
  const why = nudgeHeld({
    hasHeldCarry: true,
    isNudged: false,
    isLimitStopLast: limitStopAfter === mainTurns,
    openTurns: openTurns.size,
    isCarryOnQueued: isCarryOnInFlight || armedCarryOns > 0,
    isBoxEmpty: true,
    isTokenOk: credential !== undefined && healthOf(credential, now).kind === 'ok',
    expiresInMs: credential === undefined ? undefined : credential.expiresAt - now,
  })
  if (why !== undefined || credential === undefined) return false
  // The stored token's digest, taken once before the view is read again: an expiry alone tells no token (review r65).
  const token = await fingerprint(credential.refreshToken ?? credential.accessToken).catch(() => undefined)
  const due = { isRenudged: ep.isRenudged === true, firstExpiresAt: ep.nudge?.expiresAt, expiresAt: credential.expiresAt, firstToken: ep.nudge?.token, token, now }
  if (isAgain && !renudgeDue(due)) return false
  // A box the read cannot show is no empty box (council B5); the mod's own lines left in it count as empty.
  if (!isBoxFree(boxText, [NUDGE_TEXT, CONTINUE, view.fableContinueText])) {
    if (boxText !== undefined) {
      tellOnce($, ep, 'draft', 'refresh nudge: a draft in the box, switch still held')
      toastOnce($, ep, 'draft told', 'Switching accounts waits for your draft: press Enter to send it, or clear the box.')
    }
    return false
  }
  // A press or a landing during the two reads may have replaced or cleared the held stop: the nudge is for it alone.
  const after = await getView($)
  const isSameHold = after.held?.carry !== undefined && after.held.target.id === view.held?.target.id && after.activeId === view.activeId
  if (!isSameHold || episode !== ep) return false
  ep.nudgedAt = now
  ep.nudgedFor = holdKey(after.held)
  ep.nudge = { at: now, expiresAt: credential.expiresAt, token }
  if (isAgain) ep.isRenudged = true
  ep.budget = (ep.budget ?? 0) + 2
  void logStop(
    $,
    isAgain
      ? `refresh nudge again: login ${active.id}'s token expired ${Math.round((now - credential.expiresAt) / 1000)} s ago, carry-on sent on it`
      : `refresh nudge: login ${active.id}'s token expires in ${Math.round((credential.expiresAt - now) / 1000)} s, carry-on sent on it`,
  )
  // sendCarryOn counts a submit before its first await, so this reads whether the nudge went or was turned away.
  const submitsBefore = carryOnSubmits
  void sendCarryOn($, { text: NUDGE_TEXT }).catch(error => debug($, `refresh nudge failed: ${String(error)}`))
  if (carryOnSubmits > submitsBefore) nudgeSubmits += 1
  return true
}

/** An Escape's exit code, null where it did not run. */
async function exitOf($: Host, child: HookStream<ProcessSpawnChunk, ProcessSpawnResult>): Promise<number | null> {
  try {
    // Its output goes unread: the exit code says whether the key went.
    for await (const chunk of child) void chunk
  } catch (error) {
    await debug($, `Escape failed: ${String(error)}`)
  }
  return child.result.then(r => r?.code ?? null, () => null)
}

/** The window a limit stop's wording names, for `whoseReset`. */
const STOP_WINDOWS: Readonly<Record<string, 'fable' | 'week' | 'session' | undefined>> = { fable: 'fable', weekly: 'week', session: 'session' }

/**
 * The one login whose window the stop's own words name by its reset time (`stopResetAt`, `whoseReset`); undefined where
 * the words name no limit or no reset, where no stored read has that reset, or where two logins share it and so prove
 * neither.
 */
async function stopNamed($: Host, view: View, said: string | undefined): Promise<Account | undefined> {
  const window = STOP_WINDOWS[wordingClass(said)]
  const at = stopResetAt(said, await $.clock.now())
  if (window === undefined || at === undefined) return undefined
  const owners = whoseReset(view, at, window)
  return owners.length === 1 ? view.accounts.find(a => a.id === owners[0]) : undefined
}

/**
 * Counts a stop that named no reset on login `id`, a switch to it unproven; whether it is the login's second or later in
 * the episode. Counted by login, not by switch, so a run of switches that each get one stop still ends once every login
 * has had two.
 */
function isSecondUnprovenStop(ep: Episode, id: string): boolean {
  const count = (ep.unprovenStops?.[id] ?? 0) + 1
  ep.unprovenStops = { ...ep.unprovenStops, [id]: count }
  return count >= 2
}

/**
 * Counts a move to `target` that a stop's words showed did not land. At the second in a session the rotation leaves the
 * login be (untaken, as a switch that did not take is), and the person is told once.
 */
async function countNonLanding($: Host, target: Account, owner: Account): Promise<void> {
  const count = (nonLandings.get(target.id) ?? 0) + 1
  nonLandings.set(target.id, count)
  if (count !== 2) return
  untaken.add(target.id)
  const { accounts } = await getView($)
  tell(
    $,
    `The move to ${claudeAccount(target, accounts)} did not land twice: requests still go out as ${label(owner, accounts)}. ` +
      `The rotation leaves ${labelOf(accounts, target.id)} be in this session; Use now tries it again.`,
  )
}

/**
 * Points the session's slot and view back at `owner`, the login a stop's words showed its requests go out on, ending a
 * switch that never landed as settlePending's give-up does. It acts only on what the stop examined: the login believed in
 * use, the switch pending and the failure (`seen`: its epoch, still the latest and still red). 'stale' where any
 * changed (a press's switch, a new main turn, a newer failure) before the write, and nothing is written; 'failed' where
 * another switch runs or the slot write fails, and the stop then goes on with the login believed.
 */
async function pointBackTo($: Host, owner: Account, seen: { activeId: string; since: number | undefined; epoch: number }): Promise<'done' | 'failed' | 'stale'> {
  if (!isSameFailure(seen.epoch)) return 'stale'
  const token = ++lastToken
  let isStale = false
  const isClaimed = await writeSwitch($, { claim: undefined }, v => {
    isStale = v.activeId !== seen.activeId || v.pending?.since !== seen.since
    return isStale ? v : { ...v, owner: { token } }
  })
  if (isStale) return 'stale'
  if (!isClaimed) return 'failed'
  let isLate = false
  const isDone = await runOwned($, token, async () => {
    if (!(await undoProvisionalStop($, { owner: token }))) return false
    // A main turn that began meanwhile cleared the failure: the stop is no longer the session's.
    if (!isSameFailure(seen.epoch)) {
      isLate = true
      return false
    }
    try {
      await useSlot($, owner.slot)
    } catch (error) {
      await debug($, `point-back to ${owner.id} failed: ${errorName(error)}`)
      return false
    }
    // The slot write awaited: a main turn that began meanwhile cleared the failure, or the switch examined changed. Then
    // nothing is published, and the release's reconcile puts the slot back on the login the view names. The check is
    // inside the write, the last point before the view changes.
    const isPublished = await writeSwitch($, { owner: token }, v => {
      isLate = !isSameFailure(seen.epoch) || v.activeId !== seen.activeId || v.pending?.since !== seen.since
      return isLate ? v : { ...v, activeId: owner.id, pending: undefined }
    })
    if (isLate || !isPublished) return false
    movedAt = await $.clock.now()
    moves += 1
    return true
  })
  return isLate ? 'stale' : isDone ? 'done' : 'failed'
}

/** The stops the stop path acts on: a usage limit and a rejected sign-in. */
const isSwitchingStop = (error: string): boolean => error === 'rate_limit' || error === 'authentication_failed'

/**
 * A turn that died on a usage limit or a rejected sign-in: switch, then carry
 * on. When the limit was the Fable week, it moves only to a login with Fable
 * room, and leaves the 5-hour window alone: the window is not what ran out, and
 * a mark on it, stored for every session, would move them all off the login.
 */
async function onStopFailure($: Host, stop: { error: string; last_assistant_message?: string }, epoch: number): Promise<void> {
  const { error } = stop
  if (!isSwitchingStop(error)) return
  let view = await getView($)
  const believed = view.accounts.find(a => a.id === view.activeId)
  if (believed === undefined) return
  // The login the stop is charged to: the one in use, until a stop's own words name another's reset.
  let active: Account = believed
  let need: Need | undefined
  // Claude Code reads the new login only once the switch lands: a turn that dies before then, on a limit or a rejected
  // sign-in, went out on the login being left, which the switch already leaves. Nothing is marked on the login moved
  // to; the turn carries on there, once a switch however many turns die before it lands; during a Connect visit, once
  // the visit ends. A rejected sign-in after a response with the moved-to login's week went out on that login: the
  // switch has landed.
  const isFable = isFableStop(stop.last_assistant_message)
  // Not awaited, as no stop-log line is: an await here would let a second stop act on a view read before this one's switch.
  void logStop($, `stop heard: ${error} (wording: ${wordingClass(stop.last_assistant_message)}), login ${active.id} in use`)
  // The login each usage-limit stop of the episode died on is never tried again in it.
  const ep = episode
  // Council B4: a nudge's request that fails another way (a refresh refused above all) drops the held switch, and marks
  // nothing: a rejection mark would let the guard go at the token's expiry with no refresh, a landing around it.
  // The one exception (puma-9arph.65): a nudge sent with its token already past its expiry, the stored token still the
  // same (the same digest and expiry: an expiry alone tells no token). A request on an expired token refreshes first,
  // so its rejection proves the refresh dead: the mark is written and the hold stands, and the guard lets the switch go
  // through its expiry release. A token that cannot be read or digested is not the same one: the drop below runs.
  if (ep?.nudgedAt !== undefined && error !== 'rate_limit' && view.held !== undefined) {
    if (error === 'authentication_failed' && ep.nudge !== undefined && ep.nudge.expiresAt <= ep.nudge.at) {
      const stored = await readStored($, active.slot).catch(() => undefined)
      const credential = stored?.state === 'present' ? stored.credential : undefined
      const isSameExpiry = credential !== undefined && credential.expiresAt === ep.nudge.expiresAt
      const token = isSameExpiry ? await fingerprint(credential.refreshToken ?? credential.accessToken).catch(() => undefined) : undefined
      if (isSameExpiry && token !== undefined && token === ep.nudge.token) {
        const before = await saveHealth($, active.id, { kind: 'login-needed', why: SIGN_IN_REJECTED, at: await $.clock.now() })
        if (before?.kind !== 'login-needed') await announceLockout($, active, SIGN_IN_REJECTED)
        void logStop($, 'stop rejected on the expired token after the refresh nudge: the held switch lands through the release')
        return
      }
    }
    // A drop a running switch refused, or that found the hold gone, ends nothing: the episode goes on as it stands.
    const dropped = await dropHeld($, ep.nudgedFor)
    if (dropped !== 'dropped') {
      void logStop($, `held switch not dropped: ${dropped}`)
      return
    }
    void logStop($, `held switch dropped: ${error} after the refresh nudge, login ${active.id} kept`)
    // Nothing is owed any more: the episode ends, so a later stop opens its own and moves (no work resumed here).
    if (episode === ep) {
      episode = undefined
      isCarryOnInFlight = false
    }
    return
  }
  let since = view.pending?.since
  let hasResponseSince = since !== undefined && lastMeasured !== undefined && lastMeasured.at > since
  // THE owner decision of a usage-limit stop, the only one: every path below acts on `owner` and `isUnproven`.
  const words = error === 'rate_limit' ? await stopNamed($, view, stop.last_assistant_message) : undefined
  const { owner, isProvisional } =
    error === 'rate_limit' ? ownerOfStop(view, active, words, hasResponseSince ? lastMeasured?.reading : undefined, hasResponseSince) : { owner: active, isProvisional: false }
  // The stop read the view, the failure and the pending switch before the awaits above; it acts on them only while they
  // stand. A stop dropped here, or by the point-back below, has changed no episode state, mark or count: those are
  // written only after the last check.
  let seen = { activeId: view.activeId, since, epoch }
  // What the stop charged the episode, to give back where the stop is dropped before it wrote a mark.
  let undoCharge: (() => void) | undefined
  const dropStale = () => {
    undoCharge?.()
    undoCharge = undefined
    void logStop($, 'stop dropped: the switch or the failed turn it examined has changed since')
  }
  const isCurrent = async () => {
    const now = await getView($)
    return isSameFailure(epoch) && now.activeId === seen.activeId && now.pending?.since === seen.since
  }
  const charge = () => {
    if (ep === undefined || error !== 'rate_limit') return
    const was = { stops: ep.stops, tried: [...ep.tried], budget: ep.budget, unproven: ep.unprovenStops, need: ep.need }
    undoCharge = () => {
      ep.stops = was.stops
      ep.tried = was.tried
      ep.budget = was.budget
      ep.unprovenStops = was.unproven
      ep.need = was.need
    }
    ep.stops += 1
    // Who the stop died on: its owner; where the owner is only provisional, the login moved to only at its second such
    // stop (the first may have gone out on the login left, and nothing says); nobody where a response since the switch
    // proves two logins alike.
    const died = isProvisional ? (isSecondUnprovenStop(ep, active.id) ? active.id : undefined) : owner?.id
    if (died !== undefined && !ep.tried.includes(died)) ep.tried.push(died)
    ep.budget ??= 2 * view.accounts.length + 2
  }
  if (!(await isCurrent())) return dropStale()
  // The owner is not the login the mod believes in use, whatever the switch's age and whether the words or a response
  // proved it: the move to the believed login never landed (the requests still go out on the owner). The believed login
  // is charged nothing; the session is pointed back at the owner, as a give-up of the switch does, and the stop goes on
  // as the owner's. A believed login that fails to land twice in a session is left be. The point-back acts only on the
  // switch and the failure this stop examined: where either has changed since, the stop is dropped.
  if (owner !== undefined && owner.id !== active.id) {
    const back = await pointBackTo($, owner, seen)
    if (back === 'stale') return dropStale()
    const proof = words === undefined ? `a response since the switch is login ${owner.id}'s` : `stop names login ${owner.id}'s reset`
    void logStop($, `${proof}, not login ${active.id}'s: the move to ${active.id} has not landed`)
    charge()
    await countNonLanding($, active, owner)
    if (back === 'done') {
      // The words show the move to the login believed never landed: so did any earlier move of this episode that a
      // stop marked its target for, unproven.
      await undoSuperseded($, ep)
      view = await getView($)
      active = owner
      since = view.pending?.since
      hasResponseSince = false
      // The session is on the owner now: what the rest of the stop examines is that, not the login it found.
      seen = { activeId: owner.id, since, epoch }
    }
  } else charge()
  const isProvenRejection = error === 'authentication_failed' && hasResponseSince && provenStopper(view, lastMeasured?.reading)?.id === active.id
  const isSettling = view.pending !== undefined && (await $.clock.now()) - view.pending.since < SETTLE_MS
  // The awaits above (the clock, the point-back's view read) can span a press or a main turn: the stop acts below only
  // on what it still finds, and a stop dropped here gives its episode charge back.
  if (!(await isCurrent())) return dropStale()
  if (isSettling && !isProvenRejection) {
    if (isConnectingChrome) isCutByVisit = true
    else if (carriedFor !== view.pending?.since) carryOnAfterSettle($, isFable ? { need: 'fable' } : {})
    carriedFor = view.pending?.since
    return
  }
  // A later stop of the episode, on a login no response has shown since the switch to it: that try died. Nothing is
  // marked (the stop may have gone out on the login left), and the next untried login is tried.
  if (ep !== undefined && ep.stops > 1 && error === 'rate_limit' && isProvisional) {
    void logStop($, `stop on owed resume: login ${active.id} ${ep.tried.includes(active.id) ? 'tried' : 'in use'}, no response since its switch, no mark`)
    if (!(await maybeRotate($, ep.need, { need: ep.need, epoch }))&& isConnectingChrome) isCutByVisit = true
    return
  }
  if (error === 'authentication_failed') {
    // On an unproven switch the rejection is provisional, as a usage-limit stop there is: its end gives the health back.
    // Its time makes the write this stop's own, so another session's rejection since never reads as it.
    const keys = [`health:${active.id}`]
    const stood = await stopKeys($, active.id, keys)
    const rejectedAt = await $.clock.now()
    // The last check before the write: the reads above awaited.
    if (!(await isCurrent())) return dropStale()
    undoCharge = undefined
    const before = await saveHealth($, active.id, { kind: 'login-needed', why: SIGN_IN_REJECTED, at: rejectedAt })
    if (before?.kind !== 'login-needed') await announceLockout($, active, SIGN_IN_REJECTED)
    if (since !== undefined && !hasResponseSince) {
      const record = await recordStop($, active.id, since, stood, view.isFableStopped === true, await $.clock.now(), keys)
      await setView($, v => ({ ...v, provisionalStop: record }))
    }
  } else {
    // The landing can lag the settle: the turn the carry-on starts as the settle ends can still go out on the login
    // left (measured on vox), and a turn over the Fable limit dies at once. So a Fable stop within SETTLE_MS of the
    // carry-on, before any response proves the switch, that the login moved to's own usage read contradicts (a body this
    // stop's check read lists the Fable week, with room) is not that login's: once a switch it marks nothing and carries
    // on again. The check reads whatever the last read's age, one made since the switch included, as a stored body is no
    // proof (it can carry an older Fable row). A check its gate skipped proves nothing: the stop then goes the way any other does.
    const isOnCarryOn = carriedOn !== undefined && carriedOn.since === since && (await $.clock.now()) - carriedOn.at < SETTLE_MS
    if (isProvisional && isFable && isOnCarryOn && clearedFor !== since) {
      const hasFreshFable = await stopRead($, active, { since: await $.clock.now() })
      if (hasFreshFable && !isFableSpent((await getView($)).readings[active.id], await $.clock.now())) {
        // The read awaited: a stop that went stale during it arms no carry-on.
        if (!(await isCurrent())) return dropStale()
        clearedFor = since
        if (isConnectingChrome) isCutByVisit = true
        else carryOnAfterSettle($, { need: 'fable' })
        return
      }
    }
    let before: Record<string, unknown> = {}
    let wasFableStopped = false
    let readAt = 0
    const snapshot = async () => {
      before = await stopKeys($, active.id)
      wasFableStopped = (await getView($)).isFableStopped === true
      readAt = await $.clock.now()
    }
    if (owner === undefined) await debug($, `a stop while the switch to account ${view.pending?.id} is unproven marks no account`)
    else {
      // markStop checks again after its forced read, before the first mark: a stale stop writes none.
      const marked = await markStop($, owner, stop.last_assistant_message, isProvisional ? snapshot : undefined, isCurrent)
      if (marked === 'stale') return dropStale()
      // Marks written: the charge stands with them.
      undoCharge = undefined
      need = marked
      if (ep !== undefined) ep.need = need
    }
    if (isProvisional && owner !== undefined) {
      const record = await recordStop($, active.id, since, before, wasFableStopped, readAt)
      await setView($, v => ({ ...v, provisionalStop: record }))
    }
    // A stop a response has proven sets this session's Fable stop of its own: no provisional one may take it back.
    else if (need === 'fable') await setView($, v => (v.provisionalStop === undefined ? v : { ...v, provisionalStop: { ...v.provisionalStop, setFableStop: false } }))
  }
  // A switch still settling stays settling: only a new switch, or a response that proves one, ends it. The stop may
  // move the session meanwhile (maybeRotate lets a stop through a settling switch), and that switch settles anew.
  // The switch sends the carry-on once it lands, held back for a refresh or not. The marks above awaited: a stop that
  // went stale meanwhile moves nothing (its marks stand, as the stop happened).
  if (!(await isCurrent())) return dropStale()
  if (!(await maybeRotate($, need, { need, epoch }))) {
    if (isConnectingChrome) isCutByVisit = true
    if (need === 'fable') await announceStay($)
  }
}

/**
 * Gives back what a stop wrote on the login moved to before any response proved its switch, once a switch ends with
 * no proof it took: the stop may have gone out on the login left. The record may name a switch a press already
 * replaced, during the stop's own usage read. A key goes back only while it still holds what the stop wrote (another session's write since stands), and its
 * `no-five-hour` only while no usage read came after the stop's own; this session's Fable stop, only where the stop
 * set it and no proven stop has since.
 */
async function undoProvisionalStop($: Host, by: SwitchWriter): Promise<boolean> {
  const { provisionalStop: p } = await getView($)
  if (p === undefined) return true
  // Only the writer that may write the switch undoes its record, so two undos never give one record back twice.
  let isSame = false
  if (!(await writeSwitch($, by, v => {
    isSame = v.provisionalStop?.since === p.since && v.provisionalStop.id === p.id
    return isSame ? { ...v, provisionalStop: undefined } : v
  }))) return false
  if (!isSame) return true
  return revertStop($, p)
}

/**
 * Gives back the keys one provisional record wrote, each only while it still holds what the stop wrote. The record is
 * out of the view already (undone, or superseded by the episode's own move).
 */
async function revertStop($: Host, p: ProvisionalStop): Promise<boolean> {
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
  if (p.setFableStop) {
    kept = { ...kept, isFableStopped: false }
    await setView($, v => ({ ...v, isFableStopped: false }))
  }
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
    health: drop(v.health, `health:${p.id}`) ?? v.health,
  }))
  await mergeStore($)
  return true
}

/**
 * Gives back every mark the episode's own moves left standing on a login moved to unproven, once a stop's words show a
 * switch did not land: the stop that marked it may have gone out on the login left. Each goes back on revertStop's
 * terms. The session's Fable stop stays as it is (setFableStop false): the move that superseded the record was for the
 * Fable week, and a later stop's own mark decides the rest.
 */
async function undoSuperseded($: Host, ep: Episode | undefined): Promise<void> {
  const records = ep?.superseded ?? []
  if (ep === undefined || records.length === 0) return
  ep.superseded = undefined
  for (const p of records) await revertStop($, { ...p, setFableStop: false })
}

/**
 * THE owner decision of a usage-limit stop: whose it is, and so what is marked and tried and whether the session is
 * pointed back (the owner is not the login believed in use). In this order:
 *   1. the login the stop's own words name by its reset (`words`), at any switch age;
 *   2. no switch pending: the login in use;
 *   3. a response since the switch (`hasResponseSince`): the login whose week it carries, alone, else nobody;
 *   4. an unproven switch with no response and no words: the login moved to, provisionally (`isProvisional`): its mark is
 *      given back where the switch ends unproven (undoProvisionalStop), and it counts as tried only at its second such stop.
 * Nobody owns a stop that two logins' response fits alike (3): nothing is marked and nothing is tried.
 */
function ownerOfStop(view: View, active: Account, words: Account | undefined, last: Reading | undefined, hasResponseSince: boolean): { owner: Account | undefined; isProvisional: boolean } {
  if (words !== undefined) return { owner: words, isProvisional: false }
  if (view.pending === undefined) return { owner: active, isProvisional: false }
  if (hasResponseSince) return { owner: provenStopper(view, last), isProvisional: false }
  return { owner: active, isProvisional: true }
}

/** The login a stop during an unproven switch belongs to: the one whose week the last response carries, alone. */
function provenStopper(view: View, last: Reading | undefined): Account | undefined {
  const owners = whoseWeek(last, view.readings)
  return owners.length === 1 ? view.accounts.find(a => a.id === owners[0]) : undefined
}

/** An error's name, the one part of it the stop-log keeps: its message can hold a URL or a path. */
const errorName = (error: unknown): string => (error instanceof Error && /^\w+$/.test(error.name) ? error.name : 'unknown')

/**
 * A stop's own read of a login. Any failure inside it never ends the stop's recovery: a call that gets no answer (the
 * profile call, a forced or since usage read) and a fault of the host's store or view during the read alike. It goes to
 * the stop-log and the debug log, and the stop goes on as with no fresh reading (answering false), so the session moves
 * and carries on with no person.
 */
async function stopRead($: Host, account: Account, gate: UsageGate): Promise<boolean> {
  try {
    return await checkAccount($, account, gate)
  } catch (error) {
    void logStop($, `stop read failed: ${errorName(error)}, login ${account.id}`)
    try {
      await debug($, `the stop's read of account ${account.id} failed: ${String(error)}`)
    } catch {
      // The stop-log line above says it already.
    }
    return false
  }
}

/** Marks what a usage-limit stop on `active` spent, after reading its usage when the gate lets it; answers the need it names. */
async function markStop($: Host, active: Account, said: string | undefined, afterRead?: () => Promise<void>, isStillCurrent?: () => Promise<boolean>): Promise<Need | undefined | 'stale'> {
  let need: Need | undefined
  {
    await stopRead($, active, 'force')
    // What stands once the stop's own read is in: the stop's writes are judged against it.
    await afterRead?.()
    // Everything the marks are judged on is read first, then the stop is checked, then it writes: no await stands between
    // the check and the first write, so nothing can make the stop stale after the check and before its mark.
    const now = await $.clock.now()
    const after = await getView($)
    const r = after.readings[active.id]
    // A mark goes on the read as stored, so a 5-hour window the limit hides stays in it; with none stored, the view's
    // gives the resets.
    const owned = await ownedReading($, active.id)
    const read = owned ?? r
    // Claude's own words tell the Fable week from any other limit; the usage read decides where there are none, or
    // where they name no limit this mod knows.
    const wording = wordingClass(said)
    const isFable = wording === 'none' || wording === 'unknown' ? isFableSpent(r, now) : wording === 'fable'
    // A main turn or a press since the stop began makes it stale, and it writes no mark, no arm.
    if (isStillCurrent !== undefined && !(await isStillCurrent())) return 'stale'
    // A stop that judges no window (its read already shows the account spent) leaves the arm to the newest mark.
    stopWindow = undefined
    if (isFable) {
      need = 'fable'
      stopWindow = { id: active.id, window: 'fable' }
      kept = { ...kept, isFableStopped: true }
      await setView($, v => ({ ...v, isFableStopped: true }))
      // The limit was hit before the usage call shows it: count the Fable week as full, under the mark's own key. Judged on
      // the read as stored, never the view's, which carries the mark: a stop on a login its mark holds renews the mark.
      if (!isFableSpent(owned, now)) {
        const spent = fableMark(read?.fable, now)
        await saveFableMark($, active.id, { pct: spent.pct, resetsAt: spent.resetsAt ?? new Date(now + WEEK_MS).toISOString(), at: now })
      }
    } else if (!shouldLeave(after, now) && isSessionStop(said)) {
      // Claude's words name the 5-hour window: the account has one, whatever its last usage check said.
      await saveNoFiveHour($, active.id, false)
      stopWindow = { id: active.id, window: 'five-hour' }
      const spent = spentMark(read?.fiveHour, now, FIVE_HOUR_MS)
      await saveMark($, active.id, { pct: spent.pct, resetsAt: spent.resetsAt ?? new Date(now + FIVE_HOUR_MS).toISOString(), at: now })
    } else if (!shouldLeave(after, now) && (isWeeklyStop(said) || reportsNoFiveHour(r))) {
      // The week ran out before the usage call shows it, by Claude's words or as the only window the account has:
      // count the week as full until its reset, never a 5-hour window.
      stopWindow = { id: active.id, window: 'week' }
      const spent = spentMark(read?.sevenDay, now, WEEK_MS)
      await saveWeekMark($, active.id, { pct: spent.pct, resetsAt: spent.resetsAt ?? new Date(now + WEEK_MS).toISOString(), at: now })
    } else if (!shouldLeave(after, now)) {
      // The limit was hit before the usage call shows it: count the 5-hour window as full, five hours at most where no reset is known.
      stopWindow = { id: active.id, window: 'five-hour' }
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
// These flags and isConnectingChrome are module variables: /clear, /resume and /branch reset the view, not them.

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
  tell($, `Claude in Chrome connects as ${claudeAccount(account, (await getView($)).accounts)}: your Chrome extension is signed in to it.`)
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
 * named for the extension, and the session is on it, or can visit it: signed
 * in, with room, and a browser answered there last time. Later, a session
 * Claude Code stops from switching couldn't go there. One the rotation would
 * leave (its 5-hour window at 90%, or its week down to the Week setting) is
 * left be: a prompt sent during the visit would go out as it, spending room the
 * rotation keeps, or hitting its limit. One no
 * browser answered as, while another did, is likely the extension's no more.
 * Either connects at the first browser call that finds no browser instead.
 */
function shouldConnectAtOpen(view: View, now: number): boolean {
  const target = view.accounts.find(a => a.id === view.chromeAccountId)
  if (target === undefined || !canConnectChrome(view)) return false
  if (target.id === view.activeId) return true
  const health = view.health[target.id]?.kind
  const answered = view.chromeAccountIds ?? []
  return (
    health !== 'login-needed' &&
    health !== 'logging-in' &&
    !isSpent(view.readings[target.id], now, view.weekLeave) &&
    (answered.length === 0 || answered.includes(target.id))
  )
}

/** How often a visit's line looks again while it waits on a carry-on owed (connectChrome): the tick's own beat. */
const OWED_LINE_LOOK_MS = 60_000

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
    // A visit that throws ends as one that answers: what it cut or held goes from the one send below, then the error.
    // Nothing on the way to that send may throw past it: the carry-on would be lost (puma-9arph.89).
    let failure: { error: unknown } | undefined
    const movesBefore = moves
    try {
      done = await connectingChrome($, isQuiet, tryId)
    } catch (error) {
      failure = { error }
    }
    isConnectingChrome = false
    try {
      await setView($, v => ({ ...v, chromeConnecting: undefined }))
    } catch (error) {
      failure ??= { error }
    }
    let isRotated = false
    try {
      isRotated = await maybeRotate($)
    } catch (error) {
      failure ??= { error }
    }
    const isMoved = isRotated || moves !== movesBefore
    const isConnected = done?.answer === 'paired' && isChromeAwaited
    // Where the view read fails, the line names no account: a line without it still carries the turn on.
    let connectedAs = ''
    if (isConnected && done !== undefined) {
      try {
        connectedAs = ` as ${claudeAccount(done.target, (await getView($)).accounts)}`
      } catch (error) {
        failure ??= { error }
      }
    }
    const text = isConnected ? `Claude in Chrome is connected${connectedAs}. Continue where you left off.` : isCutByVisit ? CONTINUE : undefined
    if (isConnected) isChromeAwaited = false
    isCutByVisit = false
    // A carry-on owed for a free login carries the turn this visit cut on (puma-9arph.90): the visit's own line is its
    // backup only. It waits while that one is owed or armed, and, once a main turn began and a carry-on other than the
    // refresh nudge was submitted since the visit's end, while any submit of the session waits on its answer. With none
    // submitted since, an older submit that never answers holds nothing (puma-9arph.95). It stands down only once such a
    // carry-on submitted since was answered clean, not dropped or refused, and every submit of the session is answered:
    // a main turn alone, the nudge, or a carry-on the engine dropped is no evidence (puma-9arph.100). An older submit
    // that never answers, after the one owed went, keeps it looking each minute for good.
    // A refusal or drop of the submit that was the latest when it answered lets it go. Else it goes, even where that
    // makes two. The connected line is never held. Not fixed: after a switch that carries nothing ends what is owed (a
    // press), the line can go inside that switch's settle (the class of puma-9arph.93).
    const owedAtEnd =
      !isConnected && due !== undefined
        ? { turns: mainTurns, submits: carryOnSubmits, nudges: nudgeSubmits, refusals: carryOnRefusals }
        : undefined
    let isWaitLogged = false
    if (text !== undefined) {
      const wait = () => {
        if (!isWaitLogged) void logStop($, 'carry-on waits on the one owed')
        isWaitLogged = true
        $.clock.after(OWED_LINE_LOOK_MS, send)
      }
      const send = (): void => {
        if (owedAtEnd !== undefined) {
          if (due !== undefined || armedCarryOns > 0) return wait()
          if (carryOnRefusals === owedAtEnd.refusals) {
            // A submit still waiting on its answer can yet be dropped, after its turn began: the line waits for it.
            const isWorkSent = carryOnSubmits - nudgeSubmits > owedAtEnd.submits - owedAtEnd.nudges
            if (mainTurns > owedAtEnd.turns && isWorkSent && carryOnAnswers !== carryOnSubmits) return wait()
            if (workAnsweredClean > owedAtEnd.submits && carryOnAnswers === carryOnSubmits) {
              void logStop($, 'carry-on not sent: the one owed went')
              return
            }
          }
        }
        // A visit begun since takes it, as for a stop it cuts: nothing goes while one is open. It comes after the
        // stand-down, so a visit that cut nothing does not send a line the carry-on owed already made needless.
        if (isConnectingChrome) {
          isCutByVisit = true
          void logStop($, 'carry-on held: Claude in Chrome is connecting')
          return
        }
        void sendCarryOn($, { text }).catch(error => debug($, `carry-on failed: ${String(error)}`))
      }
      // Once the move back lands: until then the turn's requests may go out as the extension's account.
      if (isMoved) $.clock.after(SETTLE_MS, send)
      else send()
    }
    if (failure !== undefined) throw failure.error
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
    if (!isQuiet) tell($, `Chrome can connect as ${label(target, view.accounts)} once ${label(active, view.accounts)}'s token has refreshed: try again in a few minutes.`)
    return undefined
  }
  await setView($, v => ({ ...v, chromeConnecting: target.id }))
  const isVisit = from.id !== target.id
  if (isVisit && !(await switchTo($, target, 'Claude in Chrome connects as it', true))) return undefined
  let answer: ChromeAnswer
  try {
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
    answer = await askChrome($)
    if (isTrial && answer === 'paired') await setChromeAccount($, target.id)
    await noteChrome($, target, answer)
    // Whether a browser answers as the extension's account: a trial that found none didn't ask there.
    if (!isTrial || answer === 'paired') hasChromeMissed = answer === 'unpaired'
    if (answer === 'paired') {
      // A browser answering as the account shows the switch took: the rotation need not wait for a response to say so.
      const settling = (await getView($)).pending
      if (settling?.id === target.id) await proveSwitch($, target.id, settling.since)
    }
  } catch (error) {
    // Back while the visit still holds the session: a stop meanwhile hands its carry-on to the visit, not to a timer
    // this move would skip. Where the move back fails, the carry-on still goes, on the login the session is on.
    if (isVisit) await leaveVisit($, from).catch(e => debug($, `move back after a failed visit failed: ${String(e)}`))
    throw error
  }
  if (isVisit) await leaveVisit($, from)
  if (!isQuiet && answer === 'paired') tell($, `Claude in Chrome is connected as ${claudeAccount(target, view.accounts)}.`)
  if (!isQuiet && answer === 'unpaired') {
    const back = isTrial ? view.accounts.find(a => a.id === view.chromeAccountId) : undefined
    tell(
      $,
      `No Chrome extension answers as ${claudeAccount(target, view.accounts)}. Open Chrome and check its Claude extension is signed in with that email; if it is, restart Chrome${isTrial ? ' and try again' : ''}.` +
        (back === undefined ? '' : ` Claude in Chrome goes back to ${label(back, view.accounts)}.`),
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
async function onBrowserCall($: Host, isUnanswered: boolean, isEmpty = false): Promise<string | undefined> {
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
  // No browser listed, and no error: unpaired, but only a person's Connect moves the window.
  if (isEmpty) return undefined
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
  // Keep `r?.code ?? null`, though ProcessSpawnResult says `r` is never undefined:
  // after Cancel's return(), Claude Code fulfills the result with undefined, and
  // the test kit cannot fake that, so no test fails if this goes back to `r.code`.
  // That throws here, skips the save below, and leaves the login stuck at
  // 'logging-in' behind a "Something went wrong" toast. `git log -S 'r?.code'`
  // has the commit whose PR holds the repro.
  const code = await child.result.then(r => r?.code ?? null, () => null)
  await saveHealth($, account.id, { kind: 'login-needed', why: 'sign-in not finished' })
  if (code !== 0) {
    tell($, `Sign-in for ${claudeAccount(account, (await getView($)).accounts)} did not finish${errors.trim() ? `: ${errors.trim().slice(0, 160)}` : '.'}`)
    return
  }
  await adoptSignIn($, account)
}

/** After a browser sign-in: who signed in, and is it a login already on the list? */
async function adoptSignIn($: Host, account: Account): Promise<void> {
  const who = await signedInAs($, account.slot)
  const accounts = await loadAccounts($)
  const twin = who === undefined ? undefined : accounts.find(a => a.id !== account.id && isLoginOf(a, who))
  if (twin !== undefined) {
    await saveHealth($, account.id, { kind: 'login-needed', why: `that was ${label(twin, accounts)} again` })
    tell(
      $,
      `${claudeAccount(account, accounts)} signed in as ${label(twin, accounts)}. Sign out of claude.ai in your browser (or pick another organization), then sign in again.`,
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

/**
 * Makes the next free folder, by bin/account-rotator make_folder's rule: the first number from 2 with no account, no slot
 * and no folder. A sign-in run in a folder that exists would replace what it holds, and rm leaves its folder, so no id
 * comes back. The claim is a plain `mkdir`, which refuses a folder that exists: `$.fs` has no way to make one alone.
 */
async function claimNextSlot($: Host, accounts: readonly Account[]): Promise<Account> {
  const root = accountsRoot((await $.env.get('HOME')) ?? '')
  await $.process.run(['mkdir', '-p', root], { timeoutMs: FOLDER_TIMEOUT_MS })
  for (let n = 2; ; n += 1) {
    const id = String(n)
    const slot = `${root}/${id}`
    if (accounts.some(a => a.id === id || a.slot === slot)) continue
    const { exitCode, stderr } = await $.process.run(['mkdir', slot], { timeoutMs: FOLDER_TIMEOUT_MS })
    if (exitCode === 0) return { id, slot }
    // Taken by then is the next number's business; anything else no later number gets past.
    if (!(await $.fs.exists(slot))) throw new Error(`cannot make ${slot}: ${stderr.trim() || `exit ${String(exitCode)}`}`)
  }
}

const FOLDER_TIMEOUT_MS = 5_000

/** Adds a login in a new slot under ~/.claude/accounts and signs it in. */
async function addAccount($: Host): Promise<void> {
  const accounts = await loadAccounts($)
  const account = await claimNextSlot($, accounts)
  const { id, slot } = account
  await $.fs.write(`${slot}/README`, `Claude account folder ${id}, kept by the account-rotator mod.\n`)
  await dropAccountKeys($, id)
  await saveHealth($, id, { kind: 'login-needed', why: 'not signed in yet' })
  await saveAccounts($, [...accounts, account])
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
  const already = async (a: Account) => ({ ok: true, message: `already ${label(a, await loadAccounts($))}`, accountId: a.id, pickId: (await pickAnswer($)).pickId })
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
      message: `that sign-in is ${label(twin, accounts)} already${twin.orgId === undefined ? ', as far as is known: its organization is not read yet, so ask again once a check has read it' : ''}, so nothing is added. Sign out of claude.ai in your browser (or pick another organization), then run account add again. ${slot} stays signed in with no account on it: sign it out with CLAUDE_SECURESTORAGE_CONFIG_DIR=${slot} CLAUDE_CONFIG_DIR=${slot} claude auth logout`,
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
  return { ok: true, message: `${label(stood, await loadAccounts($))} is added; ${text}`, accountId: stood.id, pickId }
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
  if (account === undefined) return { ok: true, message: `the account with id ${id} is already gone` }
  const name = label(account, accounts)
  if (account.slot === '') return { ok: false, message: `${name} is Claude Code's own login, which the mod does not remove` }
  if (isConnectingChrome) return { ok: false, message: CONNECTING_TEXT }
  if (seen !== undefined && !holdsLogin(seen, account)) {
    return { ok: false, message: `${name} holds another login than this command read, so nothing is removed: run account list, then rm again if it is the one you mean` }
  }
  const sharing = accounts.find(a => a.id !== id && a.slot === account.slot)
  if (sharing !== undefined) return { ok: false, message: `${name} shares its sign-in with ${label(sharing, accounts)}, so signing it out would sign out both: nothing is removed` }
  const view = await getView($)
  if (view.activeId === id) {
    const other = view.accounts.find(a => a.id !== id && view.health[a.id]?.kind === 'ok')
    if (other === undefined || !(await switchTo($, other, `${name} is being removed`))) {
      return { ok: false, message: `${claudeAccount(account, accounts)} is in use and no other account can take over yet; not removed.` }
    }
  }
  const { exitCode, stderr } = await $.process.run(['claude', 'auth', 'logout'], { env: slotEnv(account.slot), timeoutMs: 20_000 })
  if (exitCode !== 0) {
    const [why] = stderr.trim().split('\n')
    return { ok: false, message: `${claudeAccount(account, accounts)} could not be signed out, so it stays listed: ${why || `exit ${String(exitCode)}`}` }
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
  return { ok: true, message: `${name} is removed; ${text}`, pickId }
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
    use: id => background(pressUse($, id)),
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

/**
 * The view's account in use, from the slot this session runs on, and its session id, after the store's merge, with
 * `isBound`. `boot` runs it at the start, and rebindSession again after /clear, /resume and /branch, which reset $.state
 * while session.start does not fire again.
 */
async function bindSession($: Host, slot: string): Promise<void> {
  let accounts = await loadAccounts($)
  if (accounts.length === 0) {
    accounts = [{ id: '1', slot: '' }]
    await saveAccounts($, accounts)
  }
  let active = accounts.find(a => a.slot === slot)
  if (active === undefined) {
    // Started on a slot nobody registered (set by hand, or by another tool): adopt it.
    active = { id: freeId(accounts), slot }
    await dropAccountKeys($, active.id)
    accounts = [...accounts, active]
    await saveAccounts($, accounts)
  }
  const activeId = active.id
  const sessionId = await $.session.id().catch(() => undefined)
  await mergeStore($)
  const bound = (v: View): View => ({ ...v, isBound: true, ...(sessionId === undefined ? {} : { sessionId }) })
  // The login of the slot in use, written by the switch running in this module, or while none runs.
  if (!(await writeSwitch($, live === undefined ? { idle: true } : { owner: live }, v => ({ ...bound(v), activeId })))) await setView($, bound)
}

/**
 * After /clear, /resume or /branch: what `kept` holds, then the account and id again, from the slot this session last
 * set. No variable is read: one this session set may not read back as set, and one it was refused is a parent's.
 * Before boot has read the slot there is nothing to bind: boot binds it. The Chrome link goes back only where the
 * reset left it unset, a write since being newer; the Connect line only while a Connect is under way.
 */
async function rebindSession($: Host): Promise<void> {
  const { slot, mark, hasFontBlocks, isSwitchBlocked, isFableStopped, isStuckTold, pending, provisionalStop, held, hasChrome, chrome: link, chromeConnecting } = kept
  // The switch's own records come back only into the reset's view, which names no switch running; with this module's
  // switch still running, its owner comes back with them, so the switch's later writes still apply.
  await writeSwitch($, { claim: undefined }, v => ({
    ...v,
    ...(pending === undefined ? {} : { pending }),
    ...(held === undefined ? {} : { held }),
    ...(live === undefined ? {} : { owner: { token: live } }),
  }))
  await setView($, v => ({
    ...v,
    ...(provisionalStop === undefined ? {} : { provisionalStop }),
    ...(hasFontBlocks === undefined ? {} : { hasFontBlocks }),
    ...(isSwitchBlocked === undefined ? {} : { isSwitchBlocked }),
    ...(isFableStopped === undefined ? {} : { isFableStopped }),
    ...(isStuckTold === undefined ? {} : { isStuckTold }),
    ...(due === undefined ? {} : { carryDue: due }),
    ...(mark === undefined ? {} : { sessionMark: mark }),
    ...(hasChrome === undefined || v.hasChrome !== undefined ? {} : { hasChrome }),
    ...(link === undefined || v.chrome !== undefined ? {} : { chrome: link }),
    ...(chromeConnecting === undefined || v.chromeConnecting !== undefined || !isConnectingChrome ? {} : { chromeConnecting }),
  }))
  if (slot !== undefined) await bindSession($, slot)
}

/**
 * Whether the view holds this session's account. The reset of /clear, /resume and /branch clears `isBound` before the
 * classic.SessionStart hook runs; once boot has read the slot, a view not bound is bound here, so the next check makes
 * good a bind that failed, at boot or after a reset.
 */
async function isBound($: Host): Promise<boolean> {
  if ((await getView($)).isBound === true) return true
  if (kept.slot === undefined) return false
  await rebindSession($).catch(error => debug($, `rebind failed: ${String(error)}`))
  return (await getView($)).isBound === true
}

const LAUNCHER_COPY = 'claude'
const LAUNCHER_FILE = 'bin/account-rotator-claude'
const LAUNCHER_COMMAND_TIMEOUT_MS = 10_000

/**
 * puma-9arph.26: keeps the launcher copy a person installed (README, "Picks where new sessions start") equal to this
 * mod's own `bin/account-rotator-claude`. Only an existing regular file whose bytes differ is replaced, never a link
 * and never a copy made where none stands: `$.fs.write` makes a temporary file beside it under one stable name, so a
 * leftover (a refused rm) is overwritten by the next boot; chmod and mv (a rename in one folder) put it in place
 * whole. The temporary file is read back (not empty, equal to the mod's file) and asked `test -x` before the move, so a
 * write or chmod that went wrong is never moved over the copy. A second session writing the same name between the
 * check and the move is not covered. Any failure leaves the old copy as it stood, and is one debug line.
 */
async function refreshLauncherCopy($: Host): Promise<void> {
  const dir = launcherCopyDir(await $.env.get('CLAUDE_CONFIG_DIR'), (await $.env.get('HOME')) ?? '')
  const copy = `${dir}/${LAUNCHER_COPY}`
  const entries = await $.fs.list(dir).catch(() => [])
  if (!entries.some(entry => entry.name === LAUNCHER_COPY && entry.kind === 'file')) return
  const own = await $.fs.read(`${$.plugin.root}/${LAUNCHER_FILE}`)
  if ((await $.fs.read(copy)) === own) return
  const temporary = `${copy}.new`
  const run = async (argv: string[]) => {
    const { exitCode } = await $.process.run(argv, { timeoutMs: LAUNCHER_COMMAND_TIMEOUT_MS })
    if (exitCode !== 0) throw new Error(`${argv[0]} did not finish`)
  }
  try {
    await $.fs.write(temporary, own)
    await run(['chmod', '755', temporary])
    const written = await $.fs.read(temporary)
    if (written === '' || written !== own) throw new Error('temporary file does not hold the mod\'s launcher')
    await run(['test', '-x', temporary])
    await run(['mv', '-f', temporary, copy])
  } catch (error) {
    await $.process.run(['rm', '-f', temporary], { timeoutMs: LAUNCHER_COMMAND_TIMEOUT_MS }).catch(() => undefined)
    throw error
  }
  debug($, `launcher copy ${copy} replaced by ${LAUNCHER_FILE} of the mod`)
}

/** First run makes the normal login number 1; then: which login this session uses, and Claude in Chrome connected as the extension's account. */
async function boot($: Host, isInteractive: boolean): Promise<void> {
  // A view still bound outlived a reload of this code, which emptied `kept`: its Fable stop mark and its stuck notice
  // said go back into `kept`, so a later /clear, /resume or /branch restores them.
  const survived = await getView($)
  if (survived.isBound === true && survived.isFableStopped !== undefined) kept = { ...kept, isFableStopped: survived.isFableStopped }
  if (survived.isBound === true && survived.isStuckTold !== undefined) kept = { ...kept, isStuckTold: survived.isStuckTold }
  // So does a carry-on owed once a login frees up: the tick, armed again by the reload, sends it. The reload zeroed the
  // count of main turns, so the grace counts from here: a turn after the reload shows Claude Code carried on by itself.
  // One this session ended though the view kept it, which the store marks by when it was owed, is cleared again instead.
  const survivedDue = survived.carryDue
  if (survived.isBound === true && survivedDue !== undefined && due === undefined) {
    const marked = survivedDue.owedAt === undefined ? undefined : await markedOwedAt($, survived.sessionMark)
    const isEnded = marked !== undefined && marked === survivedDue.owedAt
    // A stop during that read owes its own: it stands, and nothing is cleared or restored over it. The view is cleared
    // only while it still holds the debt examined, so a stop's own debt written meanwhile stands there too.
    const examined = survivedDue.owedAt
    if (due === undefined && isEnded) {
      await setView($, v => (v.carryDue?.owedAt === examined ? { ...v, carryDue: undefined } : v)).catch(error =>
        debug($, `carry-on owed not cleared: ${String(error)}`),
      )
    } else if (due === undefined) due = { ...survivedDue, turns: mainTurns }
  }
  // Terminal.app is the terminal that names itself so and draws block characters from its font.
  const hasFontBlocks = (await $.env.get('TERM_PROGRAM')) === 'Apple_Terminal'
  kept = { ...kept, hasFontBlocks }
  await setView($, v => ({ ...v, hasFontBlocks }))
  bootedAt = await $.clock.now()
  const slot = (await $.env.get('CLAUDE_SECURESTORAGE_CONFIG_DIR')) ?? ''
  kept = { ...kept, slot }
  await bindSession($, slot)
  await refreshLauncherCopy($).catch(error => debug($, `launcher copy not refreshed: ${errorName(error)}`))
  await pruneStopLogs($).catch(error => debug($, `stop-log prune failed: ${String(error)}`))
  await checkSwitching($, slot)
  // A check that lands after a switch moved the session wrote the slot it started on back: set the slot right at once.
  await reconcile($).catch(error => debug($, `slot repair failed: ${errorName(error)}`))
  // First, while the session can still move: the rotation waits for it.
  if (isInteractive && shouldConnectAtOpen(await getView($), await $.clock.now())) {
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
      // Armed again by a reload, which keeps the view and cancels every wait. Its own catch: a failing merge skips no retry.
      void retryHeld($).catch(error => debug($, `held switch retry failed: ${String(error)}`))
      // A slot write that landed after the view moved on, or a repair that failed, is set right here.
      void reconcile($).catch(error => debug($, `slot repair failed: ${errorName(error)}`))
      void carryOnWhenFree($).catch(error => debug($, `carry-on once a login is free failed: ${String(error)}`))
      void mergeStore($)
        .then(() => applyRequests($).catch(error => debug($, `requests failed: ${String(error)}`)))
        .then(() => settlePending($, false))
        .then(() => checkAll($, false))
        .catch(error => debug($, `sync failed: ${String(error)}`))
    })
    $.clock.every(10 * 60_000, () => {
      void checkAll($).catch(error => debug($, `check failed: ${String(error)}`))
    })
    // Timers run between turns: a resume owed after a stop is acted on with no turn and no person.
    $.clock.every(OWED_LOOK_MS, () => {
      void lookOwed($).catch(error => {
        // A look that fails leaves the resume owed: the stop-log says so, once an episode.
        if (episode !== undefined) tellOnce($, episode, 'failed', `owed resume look failed: ${errorName(error)}`)
        return debug($, `owed resume look failed: ${String(error)}`)
      })
      void lookOwnContinue($).catch(error => debug($, `own continue look failed: ${String(error)}`))
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
    // A measure well after the resume entered: the work goes on, on the login in use.
    const ep = episode
    if (ep?.enteredAt !== undefined && (await $.clock.now()) - ep.enteredAt >= ENTRY_PROOF_MS) await endEpisode($, ep)
    return next(e)
  })

  // A stop marked on a switch no response has proven is a guess: it goes when the process does, within the end's
  // budget. A /clear or a resume ends the conversation, not the process: the switch, and its proof, go on, as `kept`
  // carries the switch's records across the reset.
  on('session.end', async ($, e, next) => {
    if (PROCESS_ENDS.has(e.reason)) await undoProvisionalStop($, live === undefined ? { idle: true } : { owner: live }).catch(error => debug($, `undo at session end failed: ${String(error)}`))
    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    // The main loop's failed stop, whatever the error, turns the session red. Set here, before any await and outside
    // the stop's queued work, so the next tick finds it; a sub-agent's stop never does.
    if (e.agent_id === undefined) {
      failureEpoch += 1
      isUncleared = true
    }
    const epoch = failureEpoch
    // A subagent's stop switches nothing: the main loop's own stop, which follows it, does the work.
    if (e.agent_id !== undefined) {
      void logStop($, `stop heard from agent ${e.agent_type ?? 'unknown'}: ${e.error}, no switch`)
      return next(e)
    }
    // A new stop of the main loop raises its own countdown: the Escape owed for the last one ends.
    disarmOwnContinue($, 'a new stop')
    // A stop that switches, on the turn that entered, comes before that turn's end: the entry ends here, so the stop's
    // carry-on finds the first one queued and one resume never enters twice.
    if (episode?.enteredAt !== undefined && isSwitchingStop(e.error)) endEntry($, episode, e.error)
    // A switching stop on the nudge's own turn is the stop path's: its own landing carries the person's turn on.
    if (nudgeTurnId !== undefined && isSwitchingStop(e.error) && episode !== undefined) episode.isCarryOnHeldBack = undefined
    // Only a stop that raises the limit modal arms the Escape and opens an episode; onStopFailure's wider list says
    // which stops switch at all. Both are set here, before any await, so no branch of the stop runs without them.
    if (raisesLimitModal(e.error)) {
      limitStopAfter = mainTurns
      episode ??= { stops: 0, tried: [], escapes: 0, told: new Set() }
      // This stop's countdown is cancelled only by a person's prompt from here on.
      episode.personPrompts = personPrompts
    }
    void withLock(() => onStopFailure($, e, epoch)).catch(error => {
      // A fault of the host itself (its store, its view) outside the stop's own read: the recovery ends here, and the
      // stop-log says so.
      void logStop($, `stop handling failed: ${errorName(error)}`)
      return debug($, `stop failure handling failed: ${String(error)}`)
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  // A person's own words (their Enter here, or the Remote Control bridge) cancel Claude Code's countdown (reading R3x)
  // and end the arm as they are submitted, queued behind a turn or not: the engine stamps where a prompt came from here
  // (`origin`), which turn.start does not carry. Every other origin leaves the arm, whose gates still hold the key, and
  // any prompt still entering holds it (Codex round 1 KEY-QUEUED).
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      personPrompts += 1
      disarmOwnContinue($, "a person's prompt")
    }
    promptsEntering += 1
    try {
      return await next(e)
    } finally {
      promptsEntering -= 1
    }
  }).catch(($, e, next) => next(e))

  // The turns open now, any loop's, and how many the main loop began: what a queued carry-on's Escape waits on.
  on('turn.start', async ($, e, next) => {
    openTurns.add(e.turnId)
    if (e.agentId === undefined) {
      // A new main turn clears the failure, as Orca's next prompt clears the red.
      isUncleared = false
      // A main turn leaves the own-continue arm: only a person's prompt (prompt.submit below) cancels the countdown.
      const ep = episode
      // The refresh nudge's own turn is no entry (council B2): the resume stays owed and the held switch stands.
      if (ep?.nudgedAt !== undefined && isCarryOnInFlight && carryOnText === NUDGE_TEXT && e.text.includes(NUDGE_TEXT)) {
        mainTurns += 1
        isCarryOnInFlight = false
        nudgeTurnId = e.turnId
        void logStop($, `refresh nudge entered on login ${(await getView($)).activeId}`)
        return next(e)
      }
      if (ep !== undefined && ep.enteredAt === undefined) {
        // Claude Code hands turn.start a plugin's prompt inside its own frame ("The <plugin> plugin sent a message: ..."),
        // unless it went asUser: the carry-on's own turn is the one whose text holds the carry-on's.
        const isCarryOnTurn = isCarryOnInFlight && carryOnText !== undefined && e.text.includes(carryOnText)
        ep.before = { carryOn: isCarryOnInFlight ? carryOnRefusals : undefined, isLimitStopLast: limitStopAfter === mainTurns, isCarryOnTurn }
        void debug($, `resume entry: ${isCarryOnTurn ? "the carry-on's own turn" : 'another turn'}`)
      }
      mainTurns += 1
      isCarryOnInFlight = false
      if (ep !== undefined && ep.enteredAt === undefined) {
        ep.enteredAt = await $.clock.now()
        void logStop($, 'resume entered')
      }
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const wasOpen = openTurns.delete(e.turnId)
    const ep = episode
    if (e.turnId === nudgeTurnId) {
      nudgeTurnId = undefined
      // The login in use answered the nudge: the work goes on there, and the switch held to leave it goes.
      if (ep !== undefined && e.reason === 'answer') {
        const dropped = await dropHeld($, ep.nudgedFor)
        const { activeId, held } = await getView($)
        // A hold already gone (the switch landed while the nudge sat queued) is no refused drop: the line says so.
        const gone = `held switch already gone at the refresh nudge's answer, on login ${activeId}`
        void logStop($, dropped === 'dropped' ? `held switch dropped: the refresh nudge answered on login ${activeId}` : held === undefined ? gone : `held switch not dropped: ${dropped}`)
        // Only the nudge was answered: the person's own turn carries on, and its entry and answer end the episode.
        carryOnAfterNudge($, ep, dropped === 'dropped')
      } else if (ep !== undefined) carryOnAfterNudge($, ep, false)
      return next(e)
    }
    if (ep !== undefined) {
      if (!wasOpen) void logStop($, `turn end with no start heard: agent ${e.agentId ?? 'main'}, reason ${e.reason}`)
      else if (ep.enteredAt === undefined && openTurns.size === 0) void logStop($, 'owed resume: turns closed')
      if (e.agentId === undefined && ep.enteredAt !== undefined) {
        // An answer proves the resume; an interrupted or failed one leaves it owed, and the look acts again.
        if (e.reason === 'answer') await endEpisode($, ep)
        else if (e.reason === 'aborted' || e.reason === 'error') endEntry($, ep, e.reason)
      }
    }
    return next(e)
  })

  // The start and a compaction keep $.state; these three reset it, and session.start does not fire after them.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    // Awaited: the event completes with the view bound again.
    await rebindSession($).catch(error => debug($, `rebind after ${e.source} failed: ${String(error)}`))
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
    const text = done.text ?? ''
    // list_connected_browsers answers an empty list, not an error, where no browser answers.
    const isEmpty = done.isError !== true && e.tool.endsWith('__list_connected_browsers') && browsersFrom(text) === 0
    const note = await onBrowserCall($, (done.isError === true && isNoBrowser(text)) || isEmpty, isEmpty).catch(async error => {
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
