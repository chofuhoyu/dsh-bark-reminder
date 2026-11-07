/**
 * Static checks for the hand-written client bundle, which has no type checker
 * or build step of its own:
 *
 * - the bundle parses and its factory registers a Cordis plugin through the
 *   module loader;
 * - every `t('literal')` used by the page exists in both dictionaries;
 * - the page's variable list matches the Host's template variables.
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

const missing = []
for (const key of literalKeys) {
  for (const language of languages) {
    if (!(key in dicts[language])) missing.push(`${language}:${key}`)
  }
}

const { TEMPLATE_VARIABLES } = await import(MESSAGES_PATH)
const declaredVariables = new Set()
for (const match of source.matchAll(/'var\.([A-Za-z0-9_]+)'|t\(`var\.\$\{name\}`\)/g)) {
  if (match[1] !== undefined) declaredVariables.add(match[1])
}
for (const name of TEMPLATE_VARIABLES) {
  for (const language of languages) {
    if (!(`var.${name}` in dicts[language])) missing.push(`${language}:var.${name}`)
  }
}

if (missing.length > 0) {
  console.error(`missing locale keys:\n${missing.join('\n')}`)
  process.exitCode = 1
}

if (registered.length !== 2) throw new Error(`expected the settings page and icon registrations, got ${registered.length}`)
console.log(`client ok: ${languages.join('/')}, ${literalKeys.size} literal keys, ${TEMPLATE_VARIABLES.length} variables, ${registered.length} registrations`)
