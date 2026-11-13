/**
 * Configuration surface of the Bark reminder plugin: defaults, coercion of
 * hand-written patch values, and strict validation of page submissions.
 *
 * The plugin deliberately exports no Loader `Config` schema: the bundle is
 * installed as a linked local package, and a runtime schema import would then
 * have to resolve a DSH package from outside the installation tree. The
 * settings page saves the same shape through `configEditor`, so this module is
 * the single validator for both the file layer and the HTTP layer.
 */

/** Credential reference holding the Bark device key; also honoured as an environment variable. */
export const DEVICE_KEY_REF = 'BARK_DEVICE_KEY'

/**
 * Default notification icon, served from this repository's raw address.
 * Bark downloads the URL on the device and hands the bytes to iOS, which does
 * not decode SVG, so this points at the PNG twin of `icon.svg`.
 */
export const DEFAULT_ICON_URL = 'https://raw.githubusercontent.com/chofuhoyu/dsh-bark-reminder/main/icon.png'

/** Bark interruption levels, from quietest to most prominent. */
export const LEVELS = ['passive', 'active', 'timeSensitive', 'critical']

/** Languages the push copy itself is written in (independent of the page locale). */
export const MESSAGE_LOCALES = ['zh', 'en']

/** Event families the plugin can announce. */
export const TRIGGER_KINDS = ['approval', 'review', 'escalation', 'question', 'idle', 'error']

/** The longest template the page may store, in characters. */
export const MAX_TEMPLATE_LENGTH = 4000

/** Bounds shared by the numeric settings. */
export const LIMITS = Object.freeze({
  idleDelayMs: { min: 0, max: 10 * 60_000 },
  dedupeWindowMs: { min: 0, max: 10 * 60_000 },
  maxPerMinute: { min: 1, max: 120 },
})

/** Default field values; also the copy the page's "restore" action writes. */
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  server: 'https://api.day.app',
  messageLocale: 'zh',
  triggers: Object.freeze({
    approval: true,
    review: true,
    escalation: true,
    question: true,
    idle: true,
    error: true,
  }),
  notifySubagents: false,
  idleDelayMs: 60_000,
  // The title identifies the product and the session; the body carries only the
  // generated detail. iOS already shows the delivery time, so the default omits
  // it.
  titleTemplate: '[DSH] {sessionTitle}',
  bodyTemplate: '{detail}',
  level: 'active',
  sound: '',
  group: 'DSH',
  // An empty value keeps Bark's native icon; the default replaces it with the
  // repository's PNG artwork.
  icon: DEFAULT_ICON_URL,
  urlTemplate: '',
  call: false,
  isArchive: true,
  dedupeWindowMs: 3000,
  maxPerMinute: 12,
  /**
   * Fallback device key for profiles that compose no credential store. It is
   * never returned by the settings routes; only its presence is exposed.
   */
  deviceKey: '',
})

/**
 * Resolve a Bark base URL, tolerating a trailing slash and a reverse-proxy path.
 * @param {unknown} value - candidate server address.
 * @returns {{ url: string } | { error: string }} the normalized address or a reason.
 */
export function normalizeServer(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { error: 'a Bark server URL is required' }
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return { error: 'not a valid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'only http and https URLs are supported' }
  }
  if (url.search !== '' || url.hash !== '') {
    return { error: 'the server URL cannot carry a query or fragment' }
  }
  const path = url.pathname.replace(/\/+$/, '')
  return { url: `${url.origin}${path}` }
}

/**
 * Validate one page submission or a patch-layer config object.
 *
 * `strict` turns every rejected field into an error the page can show; the
 * lenient mode used at activation only warns and keeps the default, so a
 * hand-edited patch never prevents the plugin from loading.
 *
 * @param {unknown} raw - candidate configuration.
 * @param {{ strict?: boolean }} [options] - strict when serving a page submission.
 * @returns {{ config: typeof DEFAULT_CONFIG, errors: { field: string, message: string }[], warnings: string[] }} resolved state.
 */
export function resolveConfig(raw, { strict = false } = {}) {
  const errors = []
  const warnings = []
  const input = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  /** Record a rejected field and answer whether the caller must stop resolving it. */
  const reject = (field, message) => {
    if (strict) errors.push({ field, message })
    else warnings.push(`${field}: ${message} (falling back to the default)`)
    return strict
  }

  const bool = (field, value, fallback) => {
    if (value === undefined) return fallback
    if (typeof value !== 'boolean') {
      reject(field, 'must be true or false')
      return fallback
    }
    return value
  }

  const text = (field, value, fallback, maxLength) => {
    if (value === undefined) return fallback
    if (typeof value !== 'string') {
      reject(field, 'must be a string')
      return fallback
    }
    if (value.length > maxLength) {
      reject(field, `must be at most ${maxLength} characters`)
      return fallback
    }
    return value
  }

  const integer = (field, value, fallback, { min, max }) => {
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      reject(field, 'must be an integer')
      return fallback
    }
    if (value < min || value > max) {
      reject(field, `must be between ${min} and ${max}`)
      return fallback
    }
    return value
  }

  const config = {}
  config.enabled = bool('enabled', input.enabled, DEFAULT_CONFIG.enabled)

  if (input.server === undefined) config.server = DEFAULT_CONFIG.server
  else {
    const server = normalizeServer(input.server)
    if ('url' in server) config.server = server.url
    else {
      reject('server', server.error)
      config.server = DEFAULT_CONFIG.server
    }
  }

  if (input.messageLocale === undefined) config.messageLocale = DEFAULT_CONFIG.messageLocale
  else if (MESSAGE_LOCALES.includes(input.messageLocale)) config.messageLocale = input.messageLocale
  else {
    reject('messageLocale', 'must be zh or en')
    config.messageLocale = DEFAULT_CONFIG.messageLocale
  }

  if (input.triggers === undefined) config.triggers = { ...DEFAULT_CONFIG.triggers }
  else if (input.triggers === null || typeof input.triggers !== 'object' || Array.isArray(input.triggers)) {
    reject('triggers', 'must be an object')
    config.triggers = { ...DEFAULT_CONFIG.triggers }
  } else {
    config.triggers = {}
    for (const kind of TRIGGER_KINDS) {
      config.triggers[kind] = bool(`triggers.${kind}`, input.triggers[kind], DEFAULT_CONFIG.triggers[kind])
    }
  }

  config.notifySubagents = bool('notifySubagents', input.notifySubagents, DEFAULT_CONFIG.notifySubagents)
  config.idleDelayMs = integer('idleDelayMs', input.idleDelayMs, DEFAULT_CONFIG.idleDelayMs, LIMITS.idleDelayMs)
  config.titleTemplate = text('titleTemplate', input.titleTemplate, DEFAULT_CONFIG.titleTemplate, MAX_TEMPLATE_LENGTH)
  config.bodyTemplate = text('bodyTemplate', input.bodyTemplate, DEFAULT_CONFIG.bodyTemplate, MAX_TEMPLATE_LENGTH)

  if (input.level === undefined) config.level = DEFAULT_CONFIG.level
  else if (LEVELS.includes(input.level)) config.level = input.level
  else {
    reject('level', `must be one of ${LEVELS.join(' / ')}`)
    config.level = DEFAULT_CONFIG.level
  }

  config.sound = text('sound', input.sound, DEFAULT_CONFIG.sound, 120)
  config.group = text('group', input.group, DEFAULT_CONFIG.group, 120)

  if (input.icon === undefined) config.icon = DEFAULT_CONFIG.icon
  else if (typeof input.icon !== 'string') {
    reject('icon', 'must be a string')
    config.icon = DEFAULT_CONFIG.icon
  } else if (input.icon.trim() === '') config.icon = ''
  else {
    try {
      const icon = new URL(input.icon.trim())
      config.icon = icon.protocol === 'http:' || icon.protocol === 'https:' ? icon.toString() : ''
      if (config.icon === '') reject('icon', 'only http and https image URLs are supported')
    } catch {
      reject('icon', 'not a valid URL')
      config.icon = DEFAULT_CONFIG.icon
    }
  }

  config.urlTemplate = text('urlTemplate', input.urlTemplate, DEFAULT_CONFIG.urlTemplate, MAX_TEMPLATE_LENGTH)
  config.call = bool('call', input.call, DEFAULT_CONFIG.call)
  config.isArchive = bool('isArchive', input.isArchive, DEFAULT_CONFIG.isArchive)
  config.dedupeWindowMs = integer('dedupeWindowMs', input.dedupeWindowMs, DEFAULT_CONFIG.dedupeWindowMs, LIMITS.dedupeWindowMs)
  config.maxPerMinute = integer('maxPerMinute', input.maxPerMinute, DEFAULT_CONFIG.maxPerMinute, LIMITS.maxPerMinute)
  // Internal fallback secret: read from the patch, never accepted from the page.
  config.deviceKey = typeof input.deviceKey === 'string' && input.deviceKey.length <= 512
    ? input.deviceKey.trim()
    : ''

  return { config, errors, warnings }
}

/**
 * Strip internal secrets before a configuration document reaches the page.
 * @param {object} config - resolved configuration.
 * @returns {object} the public fields only.
 */
export function publicConfig(config) {
  const { deviceKey: _deviceKey, ...rest } = config
  return rest
}

/**
 * Bounds a template-derived field before it reaches Bark, so one pathological
 * session title cannot produce an unreadable notification.
 * @param {string} value - rendered text.
 * @param {number} limit - maximum characters to keep.
 * @returns {string} the shortened text.
 */
export function truncate(value, limit) {
  const trimmed = value.trim()
  if (trimmed.length <= limit) return trimmed
  return `${trimmed.slice(0, Math.max(0, limit - 1))}…`
}
