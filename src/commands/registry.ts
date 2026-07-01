import type { Context } from '../context'
import { filesystemCommands } from './filesystem'
import { jsCommands } from './js'
import { managementCommands } from './management'
import { rootCommands } from './root'
import { shellCommands } from './shell'

/** A djsk subcommand under the `jsk` root. */
export interface Command {
  /** Primary invocation name, e.g. `sh`. */
  name: string
  /** Alternative names, e.g. `['shell', 'bash']`. */
  aliases?: string[]
  /** One-line description shown by `jsk help`. */
  summary: string
  /** Command implementation. */
  handler: (ctx: Context) => Promise<void> | void
}

/** All registered commands, in help-display order. */
export const COMMANDS: Command[] = [
  ...rootCommands,
  ...jsCommands,
  ...shellCommands,
  ...managementCommands,
  ...filesystemCommands,
]

const LOOKUP = new Map<string, Command>()
for (const command of COMMANDS) {
  LOOKUP.set(command.name.toLowerCase(), command)
  for (const alias of command.aliases ?? []) {
    LOOKUP.set(alias.toLowerCase(), command)
  }
}

/** Resolves a command by name or alias (case-insensitive). */
export function resolveCommand(name: string): Command | undefined {
  return LOOKUP.get(name.toLowerCase())
}
