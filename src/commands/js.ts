import { runVmEval } from './eval-shared'
import type { Command } from './registry'

const ENABLE = new Set(['on', 'true', 't', 'yes', 'y', '1', 'enable'])
const DISABLE = new Set(['off', 'false', 'f', 'no', 'n', '0', 'disable'])

const jsCommand: Command = {
  name: 'js',
  aliases: ['javascript', 'eval'],
  summary: 'Evaluates JavaScript. Use `return` to produce a result.',
  async handler(ctx) {
    await runVmEval(ctx, ctx.codeblock.content, {}, 'jsk js')
  },
}

const retainCommand: Command = {
  name: 'retain',
  summary: 'Toggles REPL variable retention (the `vars` object and `_`).',
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
