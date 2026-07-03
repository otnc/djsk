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

/**
 * Prints the final summary: what was scaffolded, and any Next Step (TODO) items.
 *
 * Plain lines rather than `consola.box` — a box's border width is fixed to its longest line,
 * so it visually breaks (wrapped/misaligned borders) once that exceeds the terminal width.
 * Plain text just soft-wraps like any other terminal output.
 */
export function printSummary(answers: Answers, writtenFiles: string[], pm: PackageManager): void {
  const todos = buildTodos(answers)
  const runner = pm === 'npm' ? 'npm run' : pm
  // `pnpm deploy` is pnpm's own built-in command (workspace deployment), so it shadows a
  // package.json script named "deploy" — `pnpm run deploy` is required to actually run ours.
  const scriptRunner = pm === 'npm' ? 'npm run' : `${pm} run`

  consola.success(
    `Scaffolded ${writtenFiles.length} file${writtenFiles.length === 1 ? '' : 's'} in ${answers.directory}`,
  )
  consola.log('')
  consola.log(`  cd ${answers.directory}`)
  consola.log(`  ${answers.format === 'ts' ? `${runner} dev` : `${runner} start`}`)

  if (answers.kind === 'bot' && answers.commandMode !== 'text') {
    consola.log(`  ${scriptRunner} deploy   # registers the slash command`)
  }

  if (todos.length > 0) {
    consola.log('')
    consola.info('Next Steps (TODO):')
    for (const todo of todos) consola.log(`  - ${todo}`)
  }
}
