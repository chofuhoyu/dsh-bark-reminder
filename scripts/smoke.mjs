/**
 * Dependency-free smoke test for the Host half.
 *
 * Boots the runtime against fake Cordis services, drives the events the
 * reminders are built from, and asserts the Bark request bodies, the
 * finished-session suppression rules, and the settings routes.
 *
 * Run with `node scripts/smoke.mjs`.
 */

import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, DEFAULT_ICON_URL, publicConfig, resolveConfig } from '../host/config.js'
import { renderNotification } from '../host/messages.js'
import { classifyApproval, BarkReminderRuntime } from '../host/runtime.js'
import { createRoutes } from '../host/http.js'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One fake live agent backed by one fake session. */
function makeAgent({ cwd = '/tmp/dsh-bark-reminder-fixture', status = 'idle' } = {}) {
  const session = { id: 'session-1', header: { cwd } }
  return {
    id: 'session-1',
    session,
    status,
    inbox: { nextTurn: [], nextStep: [] },
  }
}

/** Build a Context stand-in with only the members the runtime reads. */
function makeContext(agent, overrides = {}) {
  const listeners = new Map()
  const services = {
    credentials: {
      resolve: async () => ({ value: 'device-key', source: 'file' }),
      describe: async () => ({ configured: true, source: 'file', writable: true }),
      set: async () => {},
      unset: async () => {},
    },
    agents: {
      get: id => (id === agent.id ? agent : undefined),
      turnBoundaryOf: () => ({ openTurnStartSeq: null, lastTurn: 3 }),
    },
    goals: { get: () => undefined },
    sessionTitle: { get: () => ({ title: 'Fixture session' }) },
    ...overrides.services,
  }
  const ctx = {
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    fiber: { entry: { options: {} } },
    on(event, handler) {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    },
    get(name) {
      if (name in services) return services[name]
      return overrides.singleton?.[name]
    },
    effect(callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  return { ctx, listeners }
}

/** Capture outbound pushes instead of reaching the network. */
const requests = []
globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), body: JSON.parse(init.body) })
  return new Response(JSON.stringify({ code: 200, message: 'success' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// -- configuration ---------------------------------------------------------

const defaults = resolveConfig(undefined)
assert.equal(defaults.errors.length, 0)
assert.equal(defaults.config.server, 'https://api.day.app')
assert.equal(defaults.config.triggers.idle, true)
assert.equal(defaults.config.level, 'active')
assert.equal(defaults.config.titleTemplate, '[DSH] {sessionTitle}')
assert.equal(defaults.config.bodyTemplate, '{detail}')
assert.equal(defaults.config.icon, DEFAULT_ICON_URL)
assert.equal(DEFAULT_ICON_URL, 'https://raw.githubusercontent.com/chofuhoyu/dsh-bark-reminder/main/icon.png')

// A profile saved before the default existed stores an empty icon; it must
// resolve to the project artwork rather than Bark's native icon.
const emptyIcon = resolveConfig({ icon: '' }, { strict: true })
assert.equal(emptyIcon.errors.length, 0)
assert.equal(emptyIcon.config.icon, DEFAULT_ICON_URL)

const customIcon = resolveConfig({ icon: ' https://example.com/icon.png ' }, { strict: true })
assert.equal(customIcon.errors.length, 0)
assert.equal(customIcon.config.icon, 'https://example.com/icon.png')

const explicitLevel = resolveConfig({ level: 'timeSensitive' }, { strict: true })
assert.equal(explicitLevel.errors.length, 0)
assert.equal(explicitLevel.config.level, 'timeSensitive')

const hardened = resolveConfig({ server: 'https://bark.example.com/', idleDelayMs: 5, maxPerMinute: 999 }, { strict: true })
assert.equal(hardened.config.server, 'https://bark.example.com')
assert.equal(hardened.errors.length, 1)
assert.equal(hardened.errors[0].field, 'maxPerMinute')

const fallback = resolveConfig({ level: 'loud' })
assert.equal(fallback.config.level, DEFAULT_CONFIG.level)
assert.equal(fallback.warnings.length, 1)

// -- push text -------------------------------------------------------------

const reviewText = renderNotification('review', { tool: 'bash', reason: 'Deletes staging rows', sessionTitle: 'Fixture', time: '2026-01-01 10:00', host: 'mac' }, DEFAULT_CONFIG)
assert.equal(reviewText.title, '[DSH] Fixture')
assert.match(reviewText.body, /^自动审查未放行 bash/)
assert.match(reviewText.body, /Deletes staging rows/)
// The session title belongs to the title only; the body carries the generated
// detail without a kind-label prefix, footer, or blank-line separator.
assert.doesNotMatch(reviewText.body, /Fixture/)
assert.doesNotMatch(reviewText.body, /自动审查拦下了一项操作/)
assert.doesNotMatch(reviewText.body, /\n\s*\n/)
// iOS stamps the delivery time itself; the default template must not repeat it.
assert.doesNotMatch(reviewText.body, /2026-01-01 10:00/)
assert.doesNotMatch(reviewText.title, /·/)
assert.doesNotMatch(reviewText.body, /·/)
assert.doesNotMatch(DEFAULT_CONFIG.bodyTemplate, /\{time\}/)

const english = renderNotification('review', { tool: 'bash', reason: 'Drops rows', sessionTitle: 'Fixture' }, { ...DEFAULT_CONFIG, messageLocale: 'en' })
assert.equal(english.title, '[DSH] Fixture')
assert.match(english.body, /^Auto review did not approve bash/)
assert.doesNotMatch(english.body, /Auto review declined a step/)
assert.match(english.body, /Drops rows/)

const idle = renderNotification('idle', { goalPhase: 'blocked', goalReason: 'needs a key' }, DEFAULT_CONFIG)
assert.match(idle.body, /目标受阻：needs a key/)

// -- approval classification ----------------------------------------------

const review = classifyApproval({ reason: 'Auto review denied tool "bash": Deletes production rows' }, 'zh')
assert.equal(review.kind, 'review')
assert.equal(review.reason, 'Deletes production rows')

const escalation = classifyApproval({ reason: 'escalate sandbox to danger-full-access: needs the network' }, 'zh')
assert.equal(escalation.kind, 'escalation')
assert.equal(escalation.mode, 'danger-full-access')
assert.equal(escalation.reason, 'needs the network')

const plain = classifyApproval({ toolName: 'edit', displayReason: { en: 'Allow this edit?', zh: '允许这次编辑吗？' } }, 'zh')
assert.equal(plain.kind, 'approval')
assert.equal(plain.reason, '允许这次编辑吗？')

// -- approval reminder -----------------------------------------------------

{
  requests.length = 0
  const agent = makeAgent()
  const { ctx, listeners } = makeContext(agent)
  const runtime = new BarkReminderRuntime(ctx, resolveConfig(undefined).config)
  runtime.install()
  const outcome = await listeners.get('approval/request')({
    agent,
    toolName: 'bash',
    callId: 'call-1',
    reason: 'Auto review denied tool "bash": Deletes production rows',
  }, async () => 'allowed-once')
  assert.equal(outcome, 'allowed-once')
  await wait(30)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://api.day.app/push')
  assert.equal(requests[0].body.device_key, 'device-key')
  assert.equal(requests[0].body.title, '[DSH] Fixture session')
  assert.match(requests[0].body.body, /^自动审查未放行 bash/)
  assert.match(requests[0].body.body, /Deletes production rows/)
  assert.equal(requests[0].body.level, 'active')
  assert.equal(requests[0].body.group, 'DSH')
  assert.equal(requests[0].body.icon, DEFAULT_ICON_URL)

  // The very same approval asked again inside the window is de-duplicated.
  await listeners.get('approval/request')({
    agent,
    toolName: 'bash',
    callId: 'call-1',
    reason: 'Auto review denied tool "bash": Deletes production rows',
  }, async () => 'rejected')
  await wait(20)
  assert.equal(requests.length, 1)

  // A disabled family produces no push.
  runtime.dispose()
  requests.length = 0
  const { ctx: quietCtx, listeners: quietListeners } = makeContext(agent)
  const quiet = new BarkReminderRuntime(quietCtx, resolveConfig({ triggers: { review: false } }).config)
  quiet.install()
  await quietListeners.get('approval/request')({
    agent,
    toolName: 'bash',
    callId: 'call-2',
    reason: 'Auto review denied tool "bash": nope',
  }, async () => 'rejected')
  await wait(20)
  assert.equal(requests.length, 0)
  quiet.dispose()
}

// -- structured question ---------------------------------------------------

{
  requests.length = 0
  const agent = makeAgent()
  const { ctx, listeners } = makeContext(agent)
  const runtime = new BarkReminderRuntime(ctx, resolveConfig({}).config)
  runtime.install()
  await listeners.get('user-questions/request')({
    agent,
    questions: [{ id: 'q1', question: 'Which database should the migration use?', detail: 'Fixture detail' }],
    wait: { callId: 'call-q' },
  }, async () => ({ answers: [{ id: 'q1', selected: ['SQLite'] }] }))
  await wait(30)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.title, '[DSH] Fixture session')
  assert.match(requests[0].body.body, /^DSH 需要你的回答：/)
  assert.match(requests[0].body.body, /Which database should the migration use\?/)
  assert.match(requests[0].body.body, /Fixture detail/)
  runtime.dispose()
}

// -- failed run ------------------------------------------------------------

{
  requests.length = 0
  const agent = makeAgent()
  const { ctx, listeners } = makeContext(agent)
  const config = resolveConfig({ idleDelayMs: 0 }).config
  const runtime = new BarkReminderRuntime(ctx, config)
  runtime.install()
  listeners.get('agent/error')({ agent, turn: 3, step: 2, error: new Error('model request failed') })
  await wait(30)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.title, '[DSH] Fixture session')
  assert.match(requests[0].body.body, /^DSH 因错误停止：/)
  assert.match(requests[0].body.body, /model request failed/)
  // The same turn's idle must not become a second reminder.
  listeners.get('agent/status')({ agent, status: 'idle' })
  await wait(30)
  assert.equal(requests.length, 1)
  runtime.dispose()
}

// -- finished session ------------------------------------------------------


{
  requests.length = 0
  const agent = makeAgent()
  let goal
  const { ctx, listeners } = makeContext(agent)
  ctx.get = (name) => {
    if (name === 'goals') return { get: () => goal }
    if (name === 'agents') return { get: id => (id === agent.id ? agent : undefined), turnBoundaryOf: () => ({ openTurnStartSeq: null, lastTurn: 4 }) }
    if (name === 'credentials') return { resolve: async () => ({ value: 'device-key' }), describe: async () => ({ configured: true }) }
    if (name === 'sessionTitle') return { get: () => ({ title: 'Fixture session' }) }
    return undefined
  }
  const config = resolveConfig({ idleDelayMs: 0 }).config
  const runtime = new BarkReminderRuntime(ctx, config)
  runtime.install()

  // An armed goal continues by itself, so this idle is not an end.
  goal = { phase: 'active', activation: 'armed', objective: 'Ship it' }
  listeners.get('agent/status')({ agent, status: 'idle' })
  await wait(30)
  assert.equal(requests.length, 0)

  // Without a goal the idle turn is announced exactly once.
  goal = undefined
  listeners.get('agent/status')({ agent, status: 'idle' })
  await wait(30)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].body.title, '[DSH] Fixture session')
  assert.match(requests[0].body.body, /^DSH 正在等待你的下一步。/)
  listeners.get('agent/status')({ agent, status: 'idle' })
  await wait(30)
  assert.equal(requests.length, 1)

  // Running cancels a pending finished-session check.
  agent.status = 'running'
  listeners.get('agent/status')({ agent, status: 'idle' })
  listeners.get('agent/status')({ agent, status: 'running' })
  await wait(30)
  assert.equal(requests.length, 1)
  runtime.dispose()
}

// -- device key fallback ---------------------------------------------------

{
  const agent = makeAgent()
  const { ctx } = makeContext(agent, { services: { credentials: undefined } })
  const runtime = new BarkReminderRuntime(ctx, resolveConfig({}).config)
  const stored = await runtime.setDeviceKey('fallback-device-key')
  assert.deepEqual(stored, { store: 'config' })
  assert.equal(await runtime.resolveDeviceKey(), 'fallback-device-key')
  const status = await runtime.keyStatus()
  assert.equal(status.configured, true)
  assert.equal(status.source, 'config')
  assert.equal('deviceKey' in publicConfig(runtime.config), false)
  const cleared = await runtime.clearDeviceKey()
  assert.equal(cleared.store, 'config')
  assert.equal(await runtime.resolveDeviceKey(), undefined)
  runtime.dispose()
}

// A successful credential write clears the plaintext fallback copy.
{
  const agent = makeAgent()
  let written
  const credentials = {
    set: async (_ref, value) => { written = value },
    unset: async () => {},
    resolve: async () => ({ value: written, source: 'file' }),
    describe: async () => ({ configured: true, source: 'file', writable: true }),
  }
  const { ctx } = makeContext(agent, { services: { credentials } })
  const runtime = new BarkReminderRuntime(ctx, resolveConfig({}).config)
  runtime.config = { ...runtime.config, deviceKey: 'old-fallback-copy' }
  const stored = await runtime.setDeviceKey('credential-key')
  assert.equal(written, 'credential-key')
  assert.deepEqual(stored, { store: 'credentials', clearedFallback: true })
  assert.equal(runtime.config.deviceKey, '')
  runtime.dispose()
}

// -- settings routes -------------------------------------------------------


{
  requests.length = 0
  const agent = makeAgent()
  const saved = []
  const { ctx } = makeContext(agent, {
    singleton: {
      configEditor: {
        edit: async (entry, change) => { saved.push(change({}, {})) },
      },
    },
  })
  const runtime = new BarkReminderRuntime(ctx, resolveConfig({}).config)
  const routes = createRoutes(ctx, runtime)
  const configRoute = routes.find(route => route.path.endsWith('/config'))
  const keyRoute = routes.find(route => route.path.endsWith('/key'))
  const previewRoute = routes.find(route => route.path.endsWith('/preview'))

  const read = await configRoute.fetch(new Request('http://localhost/api/bark-reminder/config'))
  assert.equal(read.status, 200)
  const document = await read.json()
  assert.equal(document.ok, true)
  assert.equal(document.config.enabled, true)
  assert.equal(document.key.configured, true)
  assert.equal(document.deviceKeyRef, 'BARK_DEVICE_KEY')

  const invalid = await configRoute.fetch(new Request('http://localhost/api/bark-reminder/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config: { ...document.config, server: 'ftp://example.com' } }),
  }))
  assert.equal(invalid.status, 422)
  assert.equal((await invalid.json()).code, 'invalid-config')

  const accepted = await configRoute.fetch(new Request('http://localhost/api/bark-reminder/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config: { ...document.config, group: 'Saved' } }),
  }))
  assert.equal(accepted.status, 200)
  await wait(120)
  assert.equal(saved.length, 1)
  assert.equal(saved[0].group, 'Saved')
  assert.equal(runtime.config.group, 'Saved')

  const preview = await previewRoute.fetch(new Request('http://localhost/api/bark-reminder/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ titleTemplate: 'T · {kindLabel}', bodyTemplate: '{detail}', messageLocale: 'en' }),
  }))
  assert.equal(preview.status, 200)
  const previewDocument = await preview.json()
  assert.match(previewDocument.title, /T · Auto review declined a step/)

  const cleared = await keyRoute.fetch(new Request('http://localhost/api/bark-reminder/key', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear: true }),
  }))
  assert.equal(cleared.status, 200)
}

console.log('host smoke ok')
