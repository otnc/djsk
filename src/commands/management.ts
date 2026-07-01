import { performance } from 'node:perf_hooks'
import type { AnyMessage } from '../types'
import type { Command } from './registry'

function meanStddev(values: number[]): { mean: number; stddev: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return { mean, stddev: Math.sqrt(variance) }
}

const pingCommand: Command = {
  name: 'ping',
  aliases: ['rtt'],
  summary: 'Measures websocket latency and message round-trip time.',
  async handler(ctx) {
    // biome-ignore lint/suspicious/noExplicitAny: ws.ping is stable across libraries.
    const wsPing = Math.round((ctx.client as any).ws?.ping ?? -1)

    const start = performance.now()
    const message: AnyMessage = await ctx.send('Calculating round-trip time...')
    const readings = [performance.now() - start]

    for (let i = 0; i < 4; i++) {
      const before = performance.now()
      await ctx.edit(message, `Calculating round-trip time... (${i + 1}/4)`)
      readings.push(performance.now() - before)
    }

    const { mean, stddev } = meanStddev(readings)
    const wsText = wsPing >= 0 ? `${wsPing}ms` : 'unavailable'

    await ctx.edit(
      message,
      `🏓\nWebsocket latency: ${wsText}\nRound-trip: ${mean.toFixed(2)} ± ${stddev.toFixed(2)}ms`,
    )
  },
}

const shutdownCommand: Command = {
  name: 'shutdown',
  aliases: ['logout'],
  summary: 'Logs the bot out and destroys the client.',
  async handler(ctx) {
    await ctx.send('Logging out now…')
    try {
      // destroy() is void in v13 and a Promise in v14; await handles both.
      // biome-ignore lint/suspicious/noExplicitAny: destroy exists on all supported clients.
      await (ctx.client as any).destroy()
    } catch {
      // ignore
    }
    if (ctx.jsk.config.exitOnShutdown) process.exit(0)
  },
}

export const managementCommands: Command[] = [pingCommand, shutdownCommand]
