import type { Answers } from './types'

const DOTENV_VERSION = '^17.4.2'
const TSX_VERSION = '^4.22.4'
const TYPESCRIPT_VERSION = '^6.0.3'
const TYPES_NODE_VERSION = '^22.0.0'

/** The entry file's path relative to the project root, for the chosen format. */
export function entryFilePath(format: Answers['format']): string {
  return format === 'ts' ? 'src/index.ts' : 'index.mjs'
}

/** The deploy-commands script's path relative to the project root, for the chosen format. */
export function deployCommandsFilePath(format: Answers['format']): string {
  return format === 'ts' ? 'src/deploy-commands.ts' : 'deploy-commands.mjs'
}

/** Builds the scaffolded project's `package.json` content. */
export function buildPackageJson(answers: Answers, djskVersion: string): Record<string, unknown> {
  const dependencies: Record<string, string> = {
    djsk: `^${djskVersion}`,
    dotenv: DOTENV_VERSION,
  }

  if (answers.kind === 'bot') {
    dependencies['discord.js'] = answers.discordJsRange
  } else {
    dependencies[answers.library] = 'latest'
  }

  const isTs = answers.format === 'ts'
  const runner = isTs ? 'tsx' : 'node'
  const scripts: Record<string, string> = isTs
    ? { dev: 'tsx watch src/index.ts', start: 'tsx src/index.ts' }
    : { start: `node ${entryFilePath(answers.format)}` }

  if (answers.kind === 'bot' && answers.commandMode !== 'text') {
    scripts.deploy = `${runner} ${deployCommandsFilePath(answers.format)}`
  }

  const pkg: Record<string, unknown> = {
    name: answers.projectName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts,
    dependencies,
  }

  if (isTs) {
    pkg.devDependencies = {
      tsx: TSX_VERSION,
      typescript: TYPESCRIPT_VERSION,
      '@types/node': TYPES_NODE_VERSION,
    }
  }

  return pkg
}

/** Builds the scaffolded project's `.env` content. */
export function buildEnv(answers: Answers): string {
  const lines: string[] =
    answers.kind === 'selfbot'
      ? [`SELFBOT_TOKEN=${answers.token ?? ''}`]
      : [
          `DISCORD_TOKEN=${answers.token ?? ''}`,
          ...(answers.clientId ? [`CLIENT_ID=${answers.clientId}`] : []),
        ]

  return `${lines.join('\n')}\n`
}

/** Builds the scaffolded project's `.gitignore` content. */
export function buildGitignore(): string {
  return ['node_modules/', '.env', 'dist/', ''].join('\n')
}

/** Builds the scaffolded project's `tsconfig.json` content (TS format only). */
export function buildTsconfig(): Record<string, unknown> {
  return {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      noEmit: true,
    },
    include: ['src'],
  }
}

/** Renders the `Jishaku` constructor's config object body (indented, without the braces). */
function jishakuConfigBody(answers: Answers): string {
  const lines: string[] = []

  if (answers.owners.length > 0) {
    lines.push(`  owners: [${answers.owners.map((id) => `'${id}'`).join(', ')}],`)
  } else {
    lines.push(
      "  // owners: ['YOUR_DISCORD_USER_ID'], // omitted — djsk auto-detects the application owner/team",
    )
  }

  if (answers.security) lines.push('  security: true,')

  return lines.join('\n')
}

/**
 * Builds the bot entry file's content. Plain ESM with no TypeScript-specific syntax, so the
 * exact same content is valid as either `index.mjs` or `src/index.ts` — only the target
 * filename (and therefore the extension) differs, decided by the caller.
 */
export function buildBotEntry(answers: Extract<Answers, { kind: 'bot' }>): string {
  const wantsText = answers.commandMode === 'text' || answers.commandMode === 'slash+text'
  const wantsSlash = answers.commandMode === 'slash' || answers.commandMode === 'slash+text'

  const intents =
    answers.discordVersion === 'v14'
      ? wantsText
        ? '[GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]'
        : '[GatewayIntentBits.Guilds]'
      : wantsText
        ? '[Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.MESSAGE_CONTENT]'
        : '[Intents.FLAGS.GUILDS]'

  const importLine =
    answers.discordVersion === 'v14'
      ? "import { Client, GatewayIntentBits } from 'discord.js'"
      : "import { Client, Intents } from 'discord.js'"

  const wiring = [
    wantsText ? "client.on('messageCreate', (message) => jsk.onMessageCreated(message))" : null,
    wantsSlash
      ? "client.on('interactionCreate', (interaction) => jsk.onInteractionCreate(interaction))"
      : null,
  ].filter((line): line is string => line !== null)

  return `import 'dotenv/config'
${importLine}
import { Jishaku } from 'djsk'

const client = new Client({
  intents: ${intents},
})

const jsk = new Jishaku(client, {
${jishakuConfigBody(answers)}
})

client.once('ready', (readyClient) => {
  console.log(\`Ready! Logged in as \${readyClient.user.tag}\`)
})

${wiring.join('\n')}

client.login(process.env.DISCORD_TOKEN)
`
}

/**
 * Builds the selfbot entry file's content. Same "no TS-specific syntax" property as
 * {@link buildBotEntry} — one string works as both `index.mjs` and `src/index.ts`.
 */
export function buildSelfbotEntry(answers: Extract<Answers, { kind: 'selfbot' }>): string {
  return `import 'dotenv/config'
import { Client } from '${answers.library}'
import { Jishaku } from 'djsk'

const client = new Client()

const jsk = new Jishaku(client, {
${jishakuConfigBody(answers)}
})

client.on('ready', () => {
  console.log(\`Ready! Logged in as \${client.user?.tag}\`)
})

client.on('messageCreate', (message) => jsk.onMessageCreated(message))

client.login(process.env.SELFBOT_TOKEN)
`
}

/**
 * Builds the standalone slash command registration script (bot + slash-inclusive modes only).
 * Uses raw `fetch`, not discord.js, so it can register commands without logging in a full client.
 */
export function buildDeployCommands(): string {
  return `import 'dotenv/config'
import { getSlashCommandData } from 'djsk'

const { DISCORD_TOKEN, CLIENT_ID } = process.env

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and CLIENT_ID in .env before running this script.')
  process.exit(1)
}

const response = await fetch(\`https://discord.com/api/v10/applications/\${CLIENT_ID}/commands\`, {
  method: 'PUT',
  headers: {
    Authorization: \`Bot \${DISCORD_TOKEN}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify([getSlashCommandData()]),
})

if (!response.ok) {
  console.error(\`Failed to register commands: \${response.status} \${await response.text()}\`)
  process.exit(1)
}

console.log('Slash commands registered.')
`
}
