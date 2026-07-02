import { consola } from 'consola'
import type { PackageManager } from './package-manager'
import type { Answers } from './types'

/** Builds the "Next Step (TODO)" list from whatever was skipped during setup. */
function buildTodos(answers: Answers): string[] {
  const todos: string[] = []

  if (!answers.token) {
    const envVar = answers.kind === 'selfbot' ? 'SELFBOT_TOKEN' : 'DISCORD_TOKEN'
    todos.push(`Set ${envVar} in .env before running the bot.`)
  }

  if (answers.owners.length === 0) {
    todos.push(
      'No owner IDs set — djsk will auto-detect the application owner/team (or the selfbot ' +
        'user) at runtime. Set `owners` in the config to restrict access explicitly.',
    )
  }

  if (answers.kind === 'bot' && answers.commandMode !== 'text' && !answers.clientId) {
    todos.push(
      answers.token
        ? "Couldn't fetch the application ID automatically — set CLIENT_ID in .env yourself " +
            '(from the Discord Developer Portal) before running the deploy script.'
        : 'Set CLIENT_ID in .env (from the Discord Developer Portal) before running the deploy script.',
    )
  }

  return todos
}

/** Prints the final summary box: what was scaffolded, and any Next Step (TODO) items. */
export function printSummary(answers: Answers, writtenFiles: string[], pm: PackageManager): void {
  const todos = buildTodos(answers)
  const runner = pm === 'npm' ? 'npm run' : pm
  // `pnpm deploy` is pnpm's own built-in command (workspace deployment), so it shadows a
  // package.json script named "deploy" — `pnpm run deploy` is required to actually run ours.
  const scriptRunner = pm === 'npm' ? 'npm run' : `${pm} run`

  const lines: string[] = [
    `Scaffolded ${writtenFiles.length} file${writtenFiles.length === 1 ? '' : 's'} in ${answers.directory}`,
    '',
    `cd ${answers.directory}`,
    answers.format === 'ts' ? `${runner} dev` : `${runner} start`,
  ]

  if (answers.kind === 'bot' && answers.commandMode !== 'text') {
    lines.push(`${scriptRunner} deploy   # registers the slash command`)
  }

  if (todos.length > 0) {
    lines.push('', 'Next Steps (TODO):')
    for (const todo of todos) lines.push(`  - ${todo}`)
  }

  consola.box(lines.join('\n'))
}
