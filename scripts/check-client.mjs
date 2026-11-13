/**
 * Static checks for the hand-written client bundle, which has no type checker
 * or build step of its own:
 *
 * - the bundle parses and its factory registers a Cordis plugin through the
 *   module loader;
 * - every `t('literal')` used by the page exists in both dictionaries;
 * - the page's variable list matches the Host's template variables;
 * - every variable has a label, a description, and an example in both
 *   dictionaries, and the examples match the Host's own sample render.
 *
 * Run with `node scripts/check-client.mjs`.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../client.js', import.meta.url))
const MESSAGES_PATH = fileURLToPath(new URL('../host/messages.js', import.meta.url))

/** Minimal React surface the bundle touches before its components render. */
const reactStub = {
  createElement() {},
  useCallback: value => value,
  useEffect() {},
  useLayoutEffect() {},
  useRef: () => ({ current: null }),
  useState: value => [value, () => {}],
}

let plugin
const registered = []
const dictionaries = {}
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      plugin = registration.factory(requested => (requested === 'react' ? reactStub : undefined))
    },
  },
}

await import(new URL('../client.js', import.meta.url))
if (plugin === undefined) throw new Error('client bundle did not register a factory')

const ctx = {
  effect(callback) {
    const dispose = callback()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  slots: {
    inject(_name, callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    },
  },
  locale: {
    bind: () => key => key,
    register(namespace, dicts) {
      dictionaries[namespace] = dicts
      return () => {}
    },
  },
}

plugin.apply(ctx)

const namespace = Object.keys(dictionaries)[0]
if (namespace === undefined) throw new Error('client registered no locale dictionaries')
const dicts = dictionaries[namespace]
const languages = Object.keys(dicts)
if (languages.length < 2) throw new Error(`expected at least two languages, got ${languages.join(', ')}`)

const source = await readFile(CLIENT_PATH, 'utf8')
const literalKeys = new Set()
for (const match of source.matchAll(/\bt\('([^']+)'\)/g)) literalKeys.add(match[1])

const problems = []
for (const key of literalKeys) {
  for (const language of languages) {
    if (!(key in dicts[language])) problems.push(`${language}:${key} is missing`)
  }
}

const { TEMPLATE_VARIABLES, renderNotification, sampleVars } = await import(MESSAGES_PATH)
const listMatch = source.match(/const VARIABLES = \[([\s\S]*?)\]/)
const pageVariables = listMatch === null
  ? []
  : [...listMatch[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map(match => match[1])
if (pageVariables.join(',') !== TEMPLATE_VARIABLES.join(',')) {
  problems.push(`page variables do not match the Host: ${pageVariables.join(', ')}`)
}
for (const name of TEMPLATE_VARIABLES) {
  for (const language of languages) {
    for (const suffix of ['', 'Desc', 'Example']) {
      const key = `var.${name}${suffix}`
      const value = dicts[language][key]
      if (typeof value !== 'string' || value === '') problems.push(`${language}:${key} is missing`)
    }
  }
}

// The hover cards must keep showing the same values the Host renders for its
// own preview, so copy changes on either side show up here.
for (const language of languages) {
  if (language !== 'zh' && language !== 'en') continue
  const vars = sampleVars(language, '2026-11-13 13:54', 'MacBook-Pro')
  const review = renderNotification('review', vars, {
    titleTemplate: '',
    bodyTemplate: '',
    messageLocale: language,
  })
  const expected = {
    kindLabel: review.kindLabel,
    detail: review.detail,
    sessionTitle: vars.sessionTitle,
    project: vars.project,
    cwd: vars.cwd,
    tool: vars.tool,
    reason: vars.reason,
    question: vars.question,
    mode: vars.mode,
    error: vars.error,
    time: vars.time,
    host: vars.host,
    turn: String(vars.turn),
    goal: vars.goal,
  }
  for (const name of TEMPLATE_VARIABLES) {
    const key = `var.${name}Example`
    if (String(dicts[language][key]) !== String(expected[name])) {
      problems.push(`${language}:${key} does not match the Host sample`)
    }
  }
}

if (problems.length > 0) {
  console.error(`client check failed:\n${problems.join('\n')}`)
  process.exitCode = 1
}

if (registered.length !== 2) throw new Error(`expected the settings page and icon registrations, got ${registered.length}`)
console.log(`client ok: ${languages.join('/')}, ${literalKeys.size} literal keys, ${TEMPLATE_VARIABLES.length} variables, ${registered.length} registrations`)
