import type { Context } from '../context'
import { installPrototypeGuards } from '../prototype-guard'
import { guardOutbound } from '../security'
import { inspectResult } from '../util/format'
import { loadLibraryModule } from '../util/meta'
import type { Command } from './registry'

// The AsyncFunction constructor is not exposed globally; derive it once.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>

const ENABLE = new Set(['on', 'true', 't', 'yes', 'y', '1', 'enable'])
const DISABLE = new Set(['off', 'false', 'f', 'no', 'n', '0', 'disable'])

/**
 * Compiles user code into an async function.
 *
 * First tries to treat the whole input as a single expression (auto-returning its
 * value, e.g. `1 + 1`); if that isn't valid syntax, falls back to a statement body
 * where the user is expected to `return` explicitly.
 */
function compile(code: string, argNames: string[]): (...values: unknown[]) => Promise<unknown> {
  try {
    return new AsyncFunction(...argNames, `return (${code}\n);`)
  } catch {
    return new AsyncFunction(...argNames, code)
  }
}

// biome-ignore lint/suspicious/noExplicitAny: structural Message check across libraries.
function isMessage(value: any): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'author' in value &&
    typeof value.react === 'function' &&
    ('url' in value || 'id' in value)
  )
}

async function sendResult(ctx: Context, result: unknown): Promise<void> {
  if (result === undefined) return
  if (isMessage(result)) {
    // biome-ignore lint/suspicious/noExplicitAny: verified Message-like above.
    const message = result as any
    await ctx.send(`<Message ${message.url ?? message.id}>`)
    return
  }
  await ctx.sendResult(inspectResult(result), 'output.js')
}

const jsCommand: Command = {
  name: 'js',
  aliases: ['javascript', 'eval'],
  summary: 'Evaluates JavaScript. Single expressions auto-return; use `return` for statements.',
  async handler(ctx) {
    const code = ctx.codeblock.content
    if (!code.trim()) {
      await ctx.send('No code to evaluate.')
      return
    }

    const jsk = ctx.jsk

    // In security mode, hand the scope guarded objects so user code that sends/replies/edits
    // (message, channel, DMs, interactions reachable through them) is scrubbed too.
    const guard = (value: unknown): unknown =>
      jsk.config.security && value && typeof value === 'object'
        ? guardOutbound(value, (text) => jsk.scrub(text))
        : value

    const scope: Record<string, unknown> = {
      client: ctx.client,
      bot: ctx.client,
      ctx,
      message: guard(ctx.message),
      msg: guard(ctx.message),
      author: guard(ctx.author),
      channel: guard(ctx.channel),
      guild: ctx.guild,
      // biome-ignore lint/suspicious/noExplicitAny: client.user shape is stable.
      me: guard((ctx.client as any).user),
      _: jsk.lastResult,
      vars: jsk.replVars,
    }
    const argNames = Object.keys(scope)
    const argValues = Object.values(scope)

    // In security mode, also guard the library's outbound methods for the duration of the eval
    // so arbitrary Discord calls (any channel/webhook/interaction, raw REST wrappers) are scrubbed.
    let restoreGuards: (() => void) | null = null
    if (jsk.config.security) {
      const module = await loadLibraryModule()
      if (module) restoreGuards = installPrototypeGuards(module, (text) => jsk.scrub(text))
    }

    const task = jsk.submitTask('jsk js')
    try {
      const fn = compile(code, argNames)
      const result = await fn(...argValues)

      if (jsk.retain) jsk.lastResult = result

      await ctx.react('✅')
      await sendResult(ctx, result)
    } finally {
      restoreGuards?.()
      jsk.removeTask(task)
    }
  },
}

const retainCommand: Command = {
  name: 'retain',
  summary: 'Toggles REPL variable retention (the `vars` object and `_`). No arg shows status.',
  async handler(ctx) {
    const jsk = ctx.jsk
    const toggle = ctx.args[0]?.toLowerCase()

    if (toggle === undefined) {
      await ctx.send(`Variable retention is set to ${jsk.retain ? 'ON' : 'OFF'}.`)
      return
    }

    if (ENABLE.has(toggle)) {
      if (jsk.retain) {
        await ctx.send('Variable retention is already set to ON.')
        return
      }
      jsk.retain = true
      jsk.replVars = {}
      jsk.lastResult = null
      await ctx.send('Variable retention is ON. Assign to `vars` to persist across REPL sessions.')
      return
    }

    if (DISABLE.has(toggle)) {
      if (!jsk.retain) {
        await ctx.send('Variable retention is already set to OFF.')
        return
      }
      jsk.retain = false
      await ctx.send('Variable retention is OFF. Future REPL sessions will not retain their scope.')
      return
    }

    await ctx.send('Provide `on` or `off` (or nothing to see the current status).')
  },
}

export const jsCommands: Command[] = [jsCommand, retainCommand]
