/**
 * Bark transport: one JSON push to `POST <server>/push`.
 *
 * The server only carries a device key, so a request needs no signing; every
 * failure is returned rather than thrown, because a notification must never
 * disturb the turn that triggered it.
 */

/** How long one push may take before the reminder is reported as failed. */
const REQUEST_TIMEOUT_MS = 12_000

/** Largest response body read for an error explanation. */
const MAX_RESPONSE_BYTES = 4096

/**
 * Assemble the Bark JSON payload from rendered text and notification options.
 * @param {string} deviceKey - target device key.
 * @param {{ title: string, body: string }} text - rendered push text.
 * @param {object} options - effective notification options.
 * @param {string} [options.sound] - Bark ringtone name.
 * @param {string} [options.level] - interruption level.
 * @param {string} [options.group] - notification group.
 * @param {string} [options.icon] - icon URL.
 * @param {string} [options.url] - URL to open on tap.
 * @param {boolean} [options.call] - repeat the ringtone for 30 seconds.
 * @param {boolean} [options.isArchive] - save to the Bark history.
 * @returns {Record<string, unknown>} the request body.
 */
function pushPayload(deviceKey, { title, body }, options) {
  const payload = { device_key: deviceKey, title, body }
  if (options.sound) payload.sound = options.sound
  if (options.level) payload.level = options.level
  if (options.group) payload.group = options.group
  if (options.icon) payload.icon = options.icon
  if (options.url) payload.url = options.url
  if (options.call) payload.call = '1'
  payload.isArchive = options.isArchive === false ? '0' : '1'
  return payload
}

/**
 * Send one notification.
 * @param {object} request - delivery request.
 * @param {string} request.server - normalized Bark base URL.
 * @param {string} request.deviceKey - target device key.
 * @param {{ title: string, body: string }} request.text - rendered push text.
 * @param {object} request.options - notification options (see {@link pushPayload}).
 * @param {AbortSignal} [request.signal] - caller lifetime.
 * @returns {Promise<{ ok: true, status: number } | { ok: false, status: number, error: string }>} delivery outcome.
 */
export async function sendBark({ server, deviceKey, text, options, signal }) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let response
  try {
    response = await fetch(`${server}/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
      body: JSON.stringify(pushPayload(deviceKey, text, options)),
      signal: combined,
    })
  } catch (error) {
    return { ok: false, status: 0, error: describeFetchFailure(error) }
  }

  const raw = await response.text().catch(() => '')
  let parsed
  try {
    parsed = raw === '' ? undefined : JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  const message = parsed !== null && typeof parsed === 'object' && typeof parsed.message === 'string'
    ? parsed.message
    : raw.slice(0, MAX_RESPONSE_BYTES)

  if (!response.ok) {
    return { ok: false, status: response.status, error: `HTTP ${response.status}${message ? `: ${message}` : ''}` }
  }
  const code = parsed !== null && typeof parsed === 'object' ? parsed.code : undefined
  if (code !== undefined && String(code) !== '200') {
    return { ok: false, status: response.status, error: `Bark returned ${String(code)}${message ? `: ${message}` : ''}` }
  }
  return { ok: true, status: response.status }
}

/**
 * Explain a transport failure without leaking the device key into logs.
 * @param {unknown} error - thrown fetch value.
 * @returns {string} one diagnostic line.
 */
function describeFetchFailure(error) {
  if (error instanceof Error && error.name === 'TimeoutError') return `request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
  if (error instanceof Error && error.name === 'AbortError') return 'request was cancelled'
  const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
  return `${error instanceof Error ? error.message : String(error)}${cause}`
}
