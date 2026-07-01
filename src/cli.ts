import chalk from 'chalk'
import { Command } from 'commander'
import { consola } from 'consola'
import { fetchApplicationId } from './cli/discord-api'
import { detectPackageManager } from './cli/package-manager'
import {
  promptBotOrSelfbot,
  promptCommandMode,
  promptDirectory,
  promptDiscordVersion,
  promptFileFormat,
  promptOverwriteConfirm,
  promptOwners,
  promptSecurity,
  promptSelfbotLibrary,
  promptToken,
} from './cli/prompts'
import { derivePackageName, isNonEmptyDirectory, scaffold } from './cli/scaffold'
import { printSummary } from './cli/summary'
import type { Answers } from './cli/types'
import { DJSK_VERSION } from './util/meta'

async function collectAnswers(directoryArg: string | undefined): Promise<Answers> {
  const directory = await promptDirectory(directoryArg)

  if (await isNonEmptyDirectory(directory)) {
    const proceed = await promptOverwriteConfirm(directory)
    if (!proceed) {
      consola.info('Aborted.')
      process.exit(0)
    }
  }

  const kind = await promptBotOrSelfbot()
  const format = await promptFileFormat()
  const token = await promptToken(kind)
  const security = await promptSecurity()
  const owners = await promptOwners()
  const projectName = derivePackageName(directory)

  if (kind === 'bot') {
    const discordVersion = await promptDiscordVersion()
    const commandMode = await promptCommandMode()
    const clientId = commandMode !== 'text' && token ? await fetchApplicationId(token) : null

    return {
      kind: 'bot',
      directory,
      projectName,
      format,
      token,
      security,
      owners,
      discordVersion,
      commandMode,
      clientId,
    }
  }

  const library = await promptSelfbotLibrary()

  return {
    kind: 'selfbot',
    directory,
    projectName,
    format,
    token,
    security,
    owners,
    library,
  }
}

async function createAction(directoryArg: string | undefined): Promise<void> {
  consola.log(chalk.bold.cyan('\ndjsk create — scaffold a jishaku project\n'))

  const answers = await collectAnswers(directoryArg)
  const writtenFiles = await scaffold(answers, DJSK_VERSION)
  printSummary(answers, writtenFiles, detectPackageManager())
}

const program = new Command()

program.name('djsk').description('djsk CLI').version(DJSK_VERSION)

program
  .command('create')
  .description('Scaffold a new djsk (bot or selfbot) project')
  .argument('[directory]', 'target directory (prompted for if omitted)')
  .action(async (directory: string | undefined) => {
    try {
      await createAction(directory)
    } catch (error) {
      consola.error(error instanceof Error ? error.message : error)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
