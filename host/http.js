/**
 * Authenticated page routes for the Bark reminder settings page.
 *
 * Everything runs below `/api`, so Connection admits only the owner peer; the
 * page itself is served from the same origin and needs no token handling. A
 * save answers before persistence starts: writing through `configEditor`
 * restarts the plugin fiber, and the restart would otherwise cut the response
 * the page is waiting for.
 */

import { DEFAULT_CONFIG, DEVICE_KEY_REF, MAX_TEMPLATE_LENGTH, publicConfig, resolveConfig } from './config.js'
import { TEMPLATE_VARIABLES } from './messages.js'

/** Shared route prefix; the page resolves the same relative path. */
export const ROUTE_PREFIX = '/api/bark-reminder'

/** Largest accepted JSON request body. */
const MAX_BODY_BYTES = 64 * 1024

/** Delay between the save response and the persistence write. */
const PERSIST_DELAY_MS = 40

/** Longest device key accepted. */
const MAX_DEVICE_KEY_LENGTH = 512

/**
 * Build one JSON response.
 * @param {unknown} body - serializable payload.
 * @param {number} [status] - HTTP status.
 * @returns {Response} the response.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Read a bounded JSON request body.
 * @param {Request} request - incoming request.
 * @returns {Promise<{ ok: true, value: any } | { ok: false, response: Response }>} parsed value or the refusal.
 */
async function readJson(request) {
  const essence = (request.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase()
  if (essence !== 'application/json') {
    return { ok: false, response: json({ code: 'unsupported-media-type', message: 'content-type must be application/json' }, 415) }
  }
  let text
  try {
    text = await request.text()
  } catch {
    return { ok: false, response: json({ code: 'bad-request', message: 'request body is unreadable' }, 400) }
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return { ok: false, response: json({ code: 'payload-too-large', message: `request body exceeds ${MAX_BODY_BYTES} bytes` }, 413) }
  }
  try {
    return { ok: true, value: text === '' ? {} : JSON.parse(text) }
  } catch {
    return { ok: false, response: json({ code: 'bad-request', message: 'request body must be valid JSON' }, 400) }
  }
}

/**
 * Wrap a handler so an unexpected failure still answers the page.
 * @param {() => Promise<Response>} handler - route body.
 * @returns {Promise<Response>} the handler's response or a 500.
 */
async function guard(handler) {
  try {
    return await handler()
  } catch (error) {
    return json({ code: 'internal-error', message: error instanceof Error ? error.message : String(error) }, 500)
  }
}

/**
 * Persist the full configuration through the profile config editor after the
 * response has been produced.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} config - complete next configuration.
 */
function schedulePersist(ctx, config) {
  const entry = ctx.fiber?.entry
  const editor = ctx.get('configEditor')
  if (entry === undefined || editor === undefined) {
    ctx.logger.warn('bark-reminder: no config editor in this profile; settings apply until restart only')
    return
  }
  const timer = setTimeout(() => {
    editor.edit(entry, current => ({ ...current, ...config })).catch((error) => {
      ctx.logger.warn(`bark-reminder: could not save settings: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, PERSIST_DELAY_MS)
  timer.unref?.()
}

/**
 * Build the route table for one runtime.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {import('./runtime.js').BarkReminderRuntime} runtime - active runtime.
 * @returns {Array<object>} Connection fetch routes.
 */
export function createRoutes(ctx, runtime) {
  /** Read the settings document the page edits. */
  const readConfig = async () => json({
    ok: true,
    version: 1,
    config: publicConfig(runtime.config),
    defaults: publicConfig(DEFAULT_CONFIG),
    variables: TEMPLATE_VARIABLES,
    deviceKeyRef: DEVICE_KEY_REF,
    key: await runtime.keyStatus(),
    status: runtime.statusSnapshot(),
  })

  /** Validate and apply a page submission. */
  const saveConfig = async (request) => {
    const body = await readJson(request)
    if (!body.ok) return body.response
    const incoming = { ...(body.value?.config ?? {}) }
    // The fallback device key is written only through the dedicated key route.
    Reflect.deleteProperty(incoming, 'deviceKey')
    const { config, errors } = resolveConfig(incoming, { strict: true })
    if (errors.length > 0) return json({ code: 'invalid-config', errors }, 422)
    runtime.applyConfig(config)
    schedulePersist(ctx, config)
    return json({ ok: true, config })
  }

  /** Store or remove the device key. */
  const saveKey = async (request) => {
    const body = await readJson(request)
    if (!body.ok) return body.response
    const value = body.value ?? {}
    if (value.clear === true) {
      const cleared = await runtime.clearDeviceKey()
      if (cleared.store === 'config') schedulePersist(ctx, runtime.config)
      return json({
        ok: true,
        store: cleared.store,
        ...cleared.reason === undefined ? {} : { fallbackReason: cleared.reason },
        key: await runtime.keyStatus(),
      })
    }
    const key = typeof value.key === 'string' ? value.key.trim() : ''
    if (key === '' || key.length > MAX_DEVICE_KEY_LENGTH || /\s/.test(key)) {
      return json({ code: 'invalid-key', message: 'device key must be one non-empty token without whitespace' }, 422)
    }
    const stored = await runtime.setDeviceKey(key)
    if (stored.store === 'config' || stored.clearedFallback === true) schedulePersist(ctx, runtime.config)
    return json({
      ok: true,
      store: stored.store,
      ...stored.reason === undefined ? {} : { fallbackReason: stored.reason },
      key: await runtime.keyStatus(),
    })
  }

  /** Send one test notification with the effective settings. */
  const sendTest = async () => {
    const result = await runtime.sendTest()
    if (result.ok) return json({ ok: true })
    const code = result.error === 'no-device-key' ? 'no-device-key' : 'delivery-failed'
    return json({ code, message: result.error ?? 'delivery failed' }, 400)
  }

  /** Render the templates being edited without sending anything. */
  const preview = async (request) => {
    const body = await readJson(request)
    if (!body.ok) return body.response
    const value = body.value ?? {}
    const draft = {}
    if (typeof value.titleTemplate === 'string' && value.titleTemplate.length <= MAX_TEMPLATE_LENGTH) {
      draft.titleTemplate = value.titleTemplate
    }
    if (typeof value.bodyTemplate === 'string' && value.bodyTemplate.length <= MAX_TEMPLATE_LENGTH) {
      draft.bodyTemplate = value.bodyTemplate
    }
    if (value.messageLocale === 'zh' || value.messageLocale === 'en') draft.messageLocale = value.messageLocale
    return json({ ok: true, ...runtime.preview(draft) })
  }

  return [
    {
      path: `${ROUTE_PREFIX}/config`,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => guard(() => request.method === 'GET' ? readConfig() : saveConfig(request)),
    },
    {
      path: `${ROUTE_PREFIX}/key`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => guard(() => saveKey(request)),
    },
    {
      path: `${ROUTE_PREFIX}/test`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: () => guard(() => sendTest()),
    },
    {
      path: `${ROUTE_PREFIX}/preview`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: request => guard(() => preview(request)),
    },
  ]
}
