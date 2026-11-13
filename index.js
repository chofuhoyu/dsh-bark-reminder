/**
 * Bark reminders for DeepSeek Harness: push a notification to the user's iPhone
 * when the Harness requires a human decision or a turn ends.
 *
 * Host half only; the settings page lives in `client.js`.
 */

import { resolveConfig } from './host/config.js'
import { createRoutes } from './host/http.js'
import { BarkReminderRuntime } from './host/runtime.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'bark-reminder'

/**
 * Install the reminder runtime and its settings routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 * @param {object} rawConfig - row configuration from the profile patch.
 */
export function apply(ctx, rawConfig = {}) {
  const { config, warnings } = resolveConfig(rawConfig)
  for (const warning of warnings) ctx.logger.warn(`bark-reminder: ${warning}`)

  const runtime = new BarkReminderRuntime(ctx, config)
  runtime.install()
  ctx.effect(() => () => runtime.dispose(), 'bark-reminder: runtime')

  // The settings routes exist only where a browser carrier does; a headless
  // profile keeps the reminder runtime without them.
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const connection = scope.get('connection')
      if (connection === undefined) return
      const disposers = []
      for (const route of createRoutes(ctx, runtime)) {
        try {
          disposers.push(connection.fetch.register(route))
        } catch (error) {
          ctx.logger.warn(`bark-reminder: could not register ${route.path}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return () => {
        for (const dispose of disposers) {
          Promise.resolve(dispose()).catch(() => {})
        }
      }
    }, 'bark-reminder: routes')
  })
}
