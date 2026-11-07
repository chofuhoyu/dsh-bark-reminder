/**
 * Reminder runtime: turns Host events that require the user into Bark pushes.
 *
 * Approvals and structured questions are observed on their answerer waterfalls
 * (prepended, and always delegated through `next()`), so the reminder never
 * changes what the user sees or decides. A finished session is derived from
 * `agent/status`: the push is delayed, then re-checked against a goal that will
 * continue on its own, queued input, and an open turn, so a goal round or an
 * already queued message cannot produce a false "finished" reminder.
 */

import { basename } from 'node:path'
import { hostname } from 'node:os'
import { DEVICE_KEY_REF, truncate } from './config.js'
import { renderNotification, sampleVars } from './messages.js'
import { sendBark } from './bark.js'

const HOST_NAME = hostname()

/** Opening of the audit reason auto-review writes when it asks the user to override a denial. */
const REVIEW_REASON_PREFIX = 'Auto review denied tool "'

/** Opening of the audit reason a sandbox escalation writes. */
const ESCALATION_REASON_PREFIX = 'escalate sandbox to '

/** Deliveries retained for the settings page. */
const RECENT_LIMIT = 12

/** Log a rate-limit warning at most this often. */
const RATE_WARN_INTERVAL_MS = 60_000

/**
 * Format a timestamp for the `{time}` placeholder.
 * @param {Date} date - instant to show.
 * @returns {string} local `YYYY-MM-DD HH:mm`.
 */
function formatTime(date) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Read the session id an event's agent carries.
 * @param {unknown} agent - event agent.
 * @returns {string | undefined} the id when present.
 */
function sessionIdOf(agent) {
  const id = agent?.session?.id ?? agent?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Turn an unknown thrown value into one line of text.
 * @param {unknown} error - thrown value.
 * @returns {string} message text.
 */
function errorMessage(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** Reminder runtime owned by one plugin activation. */
export class BarkReminderRuntime {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
   * @param {object} config - resolved configuration.
   */
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    this.disposed = false
    this.pending = new Map()
    this.idleTimers = new Map()
    this.timers = new Set()
    this.lastIdleTurn = new Map()
    this.dedupe = new Map()
    this.rate = []
    this.recent = []
    this.counters = { sent: 0, failed: 0, skipped: 0 }
    this.last = null
    this.lastRateWarningAt = 0
    this.disposers = []
  }

  /** Subscribe to the events the reminder is built from. */
  install() {
    this.disposers.push(this.ctx.on('approval/request', this.onApproval, true))
    this.disposers.push(this.ctx.on('user-questions/request', this.onQuestion, true))
    this.disposers.push(this.ctx.on('agent/status', this.onStatus))
    this.disposers.push(this.ctx.on('agent/error', this.onError))
    this.disposers.push(this.ctx.on('agent/disposed', this.onDisposed))
    const enabled = Object.entries(this.config.triggers)
      .filter(([, on]) => on)
      .map(([kind]) => kind)
      .join(', ')
    this.ctx.logger.info(`bark-reminder: active (${this.config.enabled ? 'enabled' : 'disabled'}; triggers: ${enabled || 'none'})`)
  }

  /** Drop timers, listeners, and per-session memory. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    this.idleTimers.clear()
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    for (const dispose of this.disposers) {
      try {
        dispose()
      } catch (error) {
        this.ctx.logger.warn(`bark-reminder: listener disposal failed: ${errorMessage(error)}`)
      }
    }
    this.disposers = []
    this.pending.clear()
    this.lastIdleTurn.clear()
    this.dedupe.clear()
  }

  /** Replace the effective configuration without restarting the runtime. */
  applyConfig(config) {
    // The fallback device key belongs to the stored row, not to a page form.
    this.config = { ...config, deviceKey: this.config.deviceKey ?? '' }
  }

  /** Runtime counters and recent deliveries for the settings page. */
  statusSnapshot() {
    return {
      enabled: this.config.enabled,
      counters: { ...this.counters },
      last: this.last,
      recent: this.recent.map(entry => ({ ...entry })),
    }
  }

  /**
   * Report whether a device key is stored, and where it came from.
   * @returns {Promise<{ configured: boolean, source: string | null, writable: boolean }>} credential presence.
   */
  async keyStatus() {
    const credentials = this.ctx.get('credentials')
    let credentialInfo
    if (credentials !== undefined) {
      try {
        credentialInfo = await credentials.describe(DEVICE_KEY_REF)
        if (credentialInfo.configured === true) {
          // An environment value is visible to the store but not owned by it.
          const fromEnvironment = credentialInfo.source === 'env'
          return {
            configured: true,
            source: credentialInfo.source ?? 'credential',
            writable: fromEnvironment ? false : credentialInfo.writable === true,
            store: 'credentials',
          }
        }
      } catch (error) {
        this.ctx.logger.warn(`bark-reminder: could not describe ${DEVICE_KEY_REF}: ${errorMessage(error)}`)
      }
    }
    const env = process.env[DEVICE_KEY_REF]
    if (typeof env === 'string' && env.trim() !== '') {
      return { configured: true, source: 'env', writable: false, store: 'environment' }
    }
    if (this.config.deviceKey !== '') {
      return { configured: true, source: 'config', writable: true, store: 'config' }
    }
    return {
      configured: false,
      source: null,
      writable: credentialInfo === undefined || credentialInfo.writable !== false,
      store: credentials === undefined ? 'config' : 'credentials',
    }
  }

  /**
   * Store a device key, preferring the credential store so the secret stays out
   * of configuration. A profile without that service keeps the key in the plugin
   * row instead, which the page reports as such.
   * @param {string} value - Bark device key.
   * @returns {{ store: 'credentials' | 'config', reason?: string }} where the value was stored.
   */
  async setDeviceKey(value) {
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        await credentials.set(DEVICE_KEY_REF, value)
        return { store: 'credentials' }
      } catch (error) {
        // A profile whose credential provider refuses writes still needs a
        // working reminder; the page reports the downgrade instead of hiding it.
        const reason = errorMessage(error)
        this.ctx.logger.warn(`bark-reminder: could not write ${DEVICE_KEY_REF} to the credential store: ${reason}`)
        this.config = { ...this.config, deviceKey: value }
        return { store: 'config', reason }
      }
    }
    this.config = { ...this.config, deviceKey: value }
    return { store: 'config' }
  }

  /**
   * Remove the stored device key from the credential store and the config fallback.
   * @returns {{ store: 'credentials' | 'config', reason?: string }} which store was used.
   */
  async clearDeviceKey() {
    const credentials = this.ctx.get('credentials')
    let store = 'credentials'
    let reason
    if (credentials !== undefined) {
      try {
        await credentials.unset(DEVICE_KEY_REF)
      } catch (error) {
        reason = errorMessage(error)
        this.ctx.logger.warn(`bark-reminder: could not clear ${DEVICE_KEY_REF} from the credential store: ${reason}`)
        store = 'config'
      }
    } else {
      store = 'config'
    }
    if (this.config.deviceKey !== '') store = 'config'
    this.config = { ...this.config, deviceKey: '' }
    return reason === undefined ? { store } : { store, reason }
  }

  /**
   * Render the stored templates with sample values, without sending anything.
   * @param {{ titleTemplate: string, bodyTemplate: string, messageLocale: 'zh' | 'en' }} draft - templates being edited.
   * @returns {{ title: string, body: string, variables: Record<string, unknown> }} preview text.
   */
  preview(draft) {
    const config = { ...this.config, ...draft }
    const locale = config.messageLocale === 'en' ? 'en' : 'zh'
    const variables = sampleVars(locale, formatTime(new Date()), HOST_NAME)
    const rendered = renderNotification('review', variables, config)
    return { title: rendered.title, body: rendered.body, variables }
  }

  /**
   * Send one notification with the current settings, regardless of the
   * `enabled` switch and the per-kind toggles: a test proves the transport.
   * @returns {Promise<{ ok: boolean, error?: string }>} delivery outcome.
   */
  async sendTest() {
    const key = await this.resolveDeviceKey()
    if (key === undefined) return { ok: false, error: 'no-device-key' }
    const variables = sampleVars(this.config.messageLocale === 'en' ? 'en' : 'zh', formatTime(new Date()), HOST_NAME)
    const text = renderNotification('test', variables, this.config)
    return this.deliver('test', text, variables, key)
  }

  // -- events -------------------------------------------------------------

  /** Observe one approval without claiming it; always delegate the decision. */
  onApproval = (request, next) => {
    const sessionId = sessionIdOf(request.agent)
    if (sessionId === undefined) return next()
    this.pendingOf(sessionId).approvals += 1
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      this.settlePending(sessionId, 'approvals')
    }
    try {
      this.announceApproval(request, sessionId)
    } catch (error) {
      this.ctx.logger.warn(`bark-reminder: approval reminder failed: ${errorMessage(error)}`)
    }
    let result
    try {
      result = next()
    } catch (error) {
      settle()
      throw error
    }
    result.then(settle, settle)
    return result
  }

  /** Observe one structured question without claiming it. */
  onQuestion = (request, next) => {
    const sessionId = sessionIdOf(request.agent)
    if (sessionId === undefined) return next()
    this.pendingOf(sessionId).questions += 1
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      this.settlePending(sessionId, 'questions')
    }
    try {
      this.announceQuestion(request, sessionId)
    } catch (error) {
      this.ctx.logger.warn(`bark-reminder: question reminder failed: ${errorMessage(error)}`)
    }
    let result
    try {
      result = next()
    } catch (error) {
      settle()
      throw error
    }
    result.then(settle, settle)
    return result
  }

  /** Start or cancel the finished-session timer with the agent's running state. */
  onStatus = ({ agent, status }) => {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return
    if (status !== 'idle') {
      this.clearIdleTimer(sessionId)
      return
    }
    this.scheduleIdle(agent, sessionId)
  }

  /** Announce a failed run once per event position. */
  onError = ({ agent, turn, step, error }) => {
    if (!this.config.enabled || !this.config.triggers.error) return
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined || !this.eligible(agent.session)) return
    // The same failure also reaches `idle`; do not send both reminders.
    this.lastIdleTurn.set(sessionId, turn)
    this.dispatch('error', {
      ...this.sessionVars(agent.session),
      turn,
      error: truncate(errorMessage(error), 300),
    }, `error:${sessionId}:${turn}:${step}`)
  }

  /** Forget per-session state that only the live agent could still need. */
  onDisposed = ({ agent }) => {
    const sessionId = sessionIdOf(agent)
    if (sessionId === undefined) return
    this.clearIdleTimer(sessionId)
    this.pending.delete(sessionId)
    this.lastIdleTurn.delete(sessionId)
  }

  // -- notification sources ----------------------------------------------

  /**
   * Classify and announce an approval request.
   * @param {object} request - approval request event.
   * @param {string} sessionId - requesting session.
   */
  announceApproval(request, sessionId) {
    const tool = typeof request.toolName === 'string' ? request.toolName : 'tool'
    const classified = classifyApproval(request, this.config.messageLocale)
    if (!this.config.enabled || !this.config.triggers[classified.kind]) return
    if (!this.eligible(request.agent?.session)) return
    const callId = request.callId === undefined ? tool : String(request.callId)
    this.dispatch(classified.kind, {
      ...this.sessionVars(request.agent?.session),
      tool,
      reason: classified.reason,
      mode: classified.mode ?? '',
    }, `approval:${sessionId}:${callId}`)
  }

  /**
   * Announce a structured question.
   * @param {object} request - user-questions request event.
   * @param {string} sessionId - asking session.
   */
  announceQuestion(request, sessionId) {
    if (!this.config.enabled || !this.config.triggers.question) return
    if (!this.eligible(request.agent?.session)) return
    const questions = Array.isArray(request.questions) ? request.questions : []
    const first = questions[0] ?? {}
    const question = truncate(typeof first.question === 'string' ? first.question : '', 300)
    const requestDetail = truncate(typeof first.detail === 'string' ? first.detail : '', 200)
    const callId = request.wait?.callId
    const key = callId === undefined
      ? `question:${sessionId}:${questions.map(item => item?.id ?? '').join(',')}`
      : `question:${sessionId}:${String(callId)}`
    this.dispatch('question', {
      ...this.sessionVars(request.agent?.session),
      question,
      questionCount: questions.length,
      requestDetail,
    }, key)
  }

  /** Arm the delayed finished-session check for an idle agent. */
  scheduleIdle(agent, sessionId) {
    if (!this.config.enabled || !this.config.triggers.idle) return
    if (this.idleTimers.has(sessionId)) return
    if (!this.eligible(agent.session)) return
    const delay = this.config.idleDelayMs
    const timer = setTimeout(() => {
      this.idleTimers.delete(sessionId)
      try {
        this.checkIdle(sessionId)
      } catch (error) {
        this.ctx.logger.warn(`bark-reminder: finished-session check failed: ${errorMessage(error)}`)
      }
    }, delay)
    timer.unref?.()
    this.idleTimers.set(sessionId, timer)
  }

  /** Decide whether the idle session is really waiting for the user, then notify. */
  checkIdle(sessionId) {
    if (this.disposed) return
    const agents = this.ctx.get('agents')
    const agent = agents?.get?.(sessionId)
    if (agent === undefined || agent.status !== 'idle') return
    const pending = this.pending.get(sessionId)
    if (pending !== undefined && pending.approvals + pending.questions > 0) return
    const goal = this.goalOf(agent)
    // An armed active goal queues its next round by itself; that is not an end.
    if (goal !== undefined && goal.phase === 'active' && goal.activation === 'armed') return
    let boundary
    try {
      boundary = agents.turnBoundaryOf?.(agent.session)
    } catch {
      boundary = undefined
    }
    if (boundary !== undefined && boundary !== null && boundary.openTurnStartSeq !== null) return
    const inbox = agent.inbox
    if ((inbox?.nextTurn?.length ?? 0) > 0 || (inbox?.nextStep?.length ?? 0) > 0) return
    const turn = boundary?.lastTurn ?? 0
    if (turn === 0 || this.lastIdleTurn.get(sessionId) === turn) return
    this.lastIdleTurn.set(sessionId, turn)
    this.dispatch('idle', {
      ...this.sessionVars(agent.session),
      turn,
      goal: goal?.objective ?? '',
      goalPhase: goal?.phase ?? '',
      goalReason: goal?.blockedReason?.message ?? '',
    }, `idle:${sessionId}:${turn}`)
  }

  // -- delivery -----------------------------------------------------------

  /**
   * Render and deliver one reminder unless the settings filter it out.
   * @param {string} kind - event family.
   * @param {Record<string, unknown>} vars - placeholder values.
   * @param {string} dedupeKey - identity of this occurrence.
   */
  async dispatch(kind, vars, dedupeKey) {
    // Nothing in a reminder may surface as an unhandled rejection: the caller
    // is an event listener or a timer, not a request that can report it.
    try {
      if (this.disposed || !this.config.enabled || !this.config.triggers[kind]) return
      const now = Date.now()
      this.pruneState(now)
      if (this.dedupe.has(dedupeKey)) {
        this.counters.skipped += 1
        return
      }
      this.dedupe.set(dedupeKey, now)
      if (!this.allowRate(now)) {
        this.counters.skipped += 1
        if (now - this.lastRateWarningAt > RATE_WARN_INTERVAL_MS) {
          this.lastRateWarningAt = now
          this.ctx.logger.warn(`bark-reminder: more than ${this.config.maxPerMinute} reminders in a minute; dropping the rest`)
        }
        return
      }
      const key = await this.resolveDeviceKey()
      if (key === undefined) {
        this.counters.skipped += 1
        this.record({ at: now, kind, title: '', ok: false, error: 'no-device-key', sessionTitle: String(vars.sessionTitle ?? '') })
        return
      }
      const text = renderNotification(kind, vars, this.config)
      await this.deliver(kind, text, vars, key)
    } catch (error) {
      this.counters.failed += 1
      this.ctx.logger.warn(`bark-reminder: could not deliver a ${kind} reminder: ${errorMessage(error)}`)
    }
  }

  /**
   * Send rendered text and record the outcome.
   * @param {string} kind - event family.
   * @param {{ title: string, body: string }} text - rendered push text.
   * @param {Record<string, unknown>} vars - placeholder values (for the recent list).
   * @param {string} key - device key.
   * @returns {Promise<{ ok: boolean, error?: string }>} delivery outcome.
   */
  async deliver(kind, text, vars, key) {
    const url = this.renderTapUrl(vars)
    const result = await sendBark({
      server: this.config.server,
      deviceKey: key,
      text,
      options: {
        sound: this.config.sound,
        level: this.config.level,
        group: this.config.group,
        icon: this.config.icon,
        url,
        call: this.config.call,
        isArchive: this.config.isArchive,
      },
    })
    const at = Date.now()
    if (result.ok) {
      this.counters.sent += 1
      this.record({ at, kind, title: text.title, ok: true, sessionTitle: String(vars.sessionTitle ?? '') })
      this.ctx.logger.debug?.(`bark-reminder: sent ${kind} reminder`)
      return { ok: true }
    }
    this.counters.failed += 1
    this.record({ at, kind, title: text.title, ok: false, error: result.error, sessionTitle: String(vars.sessionTitle ?? '') })
    this.ctx.logger.warn(`bark-reminder: ${kind} reminder failed: ${result.error}`)
    return { ok: false, error: result.error }
  }

  /** Resolve the effective device key, preferring the credential store. */
  async resolveDeviceKey() {
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(DEVICE_KEY_REF)
        if (typeof hit?.value === 'string' && hit.value !== '') return hit.value
      } catch (error) {
        this.ctx.logger.warn(`bark-reminder: could not resolve ${DEVICE_KEY_REF}: ${errorMessage(error)}`)
      }
    }
    const env = process.env[DEVICE_KEY_REF]
    if (typeof env === 'string' && env.trim() !== '') return env.trim()
    return this.config.deviceKey !== '' ? this.config.deviceKey : undefined
  }

  /** Render the optional tap target, dropping a template that produced nothing. */
  renderTapUrl(vars) {
    const template = this.config.urlTemplate
    if (typeof template !== 'string' || template.trim() === '') return undefined
    const rendered = template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name) => {
      const value = vars[name]
      return value === undefined || value === null || value === '' ? whole : String(value)
    }).trim()
    if (rendered === '' || rendered.includes('{')) return undefined
    return rendered
  }

  // -- helpers ------------------------------------------------------------

  /**
   * Whether a session belongs in the reminder stream.
   * @param {object | undefined} session - event session.
   * @returns {boolean} true when its reminders are enabled.
   */
  eligible(session) {
    if (this.config.notifySubagents || session === undefined) return true
    const header = session.header
    if (header?.origin === 'subagent') return false
    return (header?.delegationDepth ?? 0) === 0
  }

  /** Session-derived placeholder values. */
  sessionVars(session) {
    const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : ''
    let title = ''
    try {
      title = this.ctx.get('sessionTitle')?.get?.(session)?.title ?? ''
    } catch {
      title = ''
    }
    return {
      sessionId: typeof session?.id === 'string' ? session.id : '',
      sessionTitle: title || (cwd === '' ? 'DSH' : basename(cwd)),
      project: cwd === '' ? '' : basename(cwd),
      cwd,
      time: formatTime(new Date()),
      host: HOST_NAME,
    }
  }

  /** The live goal of an agent, when the goal service is composed. */
  goalOf(agent) {
    try {
      return this.ctx.get('goals')?.get?.(agent)
    } catch {
      return undefined
    }
  }

  /** Per-session pending counts. */
  pendingOf(sessionId) {
    let entry = this.pending.get(sessionId)
    if (entry === undefined) {
      entry = { approvals: 0, questions: 0 }
      this.pending.set(sessionId, entry)
    }
    return entry
  }

  /** Decrement one pending counter without going negative. */
  settlePending(sessionId, field) {
    const entry = this.pending.get(sessionId)
    if (entry === undefined) return
    entry[field] = Math.max(0, entry[field] - 1)
    if (entry.approvals === 0 && entry.questions === 0) this.pending.delete(sessionId)
  }

  /** Cancel one session's finished-session timer. */
  clearIdleTimer(sessionId) {
    const timer = this.idleTimers.get(sessionId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.idleTimers.delete(sessionId)
  }

  /** Sliding one-minute rate limit for delivered reminders. */
  allowRate(now) {
    this.rate = this.rate.filter(stamp => now - stamp < 60_000)
    if (this.rate.length >= this.config.maxPerMinute) return false
    this.rate.push(now)
    return true
  }

  /** Drop dedupe entries that can no longer suppress anything. */
  pruneState(now) {
    const window = Math.max(this.config.dedupeWindowMs, 1000)
    for (const [key, stamp] of this.dedupe) {
      if (now - stamp > window) this.dedupe.delete(key)
    }
  }

  /** Keep one delivery record for the page. */
  record(entry) {
    this.last = entry
    this.recent.unshift(entry)
    if (this.recent.length > RECENT_LIMIT) this.recent.length = RECENT_LIMIT
  }
}

/**
 * Classify one approval request into the reminder families.
 * @param {object} request - approval request event.
 * @param {'zh' | 'en'} locale - push copy language.
 * @returns {{ kind: 'review' | 'escalation' | 'approval', reason: string, mode?: string }} classification and human reason.
 */
export function classifyApproval(request, locale) {
  const raw = typeof request.reason === 'string' ? request.reason : ''
  const display = request.displayReason !== null && typeof request.displayReason === 'object'
    ? request.displayReason[locale] ?? request.displayReason.en
    : undefined

  if (raw.startsWith(REVIEW_REASON_PREFIX)) {
    const rest = raw.slice(REVIEW_REASON_PREFIX.length)
    const separator = rest.indexOf('":')
    const toolEnd = separator >= 0 ? separator : rest.indexOf('"')
    const tool = toolEnd >= 0 ? rest.slice(0, toolEnd) : ''
    const reviewer = separator >= 0 ? rest.slice(separator + 2).trim() : ''
    const fallback = tool === '' ? '' : `Auto review denied ${tool}`
    return { kind: 'review', reason: truncate(reviewer || display || fallback, 600) }
  }

  if (raw.startsWith(ESCALATION_REASON_PREFIX)) {
    const rest = raw.slice(ESCALATION_REASON_PREFIX.length)
    const separator = rest.indexOf(':')
    const mode = (separator >= 0 ? rest.slice(0, separator) : rest).trim()
    const justification = separator >= 0 ? rest.slice(separator + 1).trim() : ''
    return { kind: 'escalation', mode, reason: truncate(justification || display || '', 600) }
  }

  return { kind: 'approval', reason: truncate(display || raw || (typeof request.toolName === 'string' ? request.toolName : ''), 600) }
}
