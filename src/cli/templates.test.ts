import { describe, expect, it } from 'vitest'
import {
  buildBotEntry,
  buildDeployCommands,
  buildEnv,
  buildGitignore,
  buildPackageJson,
  buildSelfbotEntry,
  buildTsconfig,
  deployCommandsFilePath,
  entryFilePath,
} from './templates'
import type { BotAnswers, SelfbotAnswers } from './types'

function makeBotAnswers(overrides: Partial<BotAnswers> = {}): BotAnswers {
  return {
    kind: 'bot',
    directory: './my-bot',
    projectName: 'my-bot',
    format: 'js',
    token: null,
    security: false,
    owners: [],
    discordVersion: 'v14',
    discordJsRange: '^14.0.0',
    commandMode: 'slash+text',
    clientId: null,
    ...overrides,
  }
}

function makeSelfbotAnswers(overrides: Partial<SelfbotAnswers> = {}): SelfbotAnswers {
  return {
    kind: 'selfbot',
    directory: './my-selfbot',
    projectName: 'my-selfbot',
    format: 'js',
    token: null,
    security: false,
    owners: [],
    library: 'discord.js-selfbot-v13',
    ...overrides,
  }
}

describe('entryFilePath / deployCommandsFilePath', () => {
  it('uses .mjs for JS and src/*.ts for TS', () => {
    expect(entryFilePath('js')).toBe('index.mjs')
    expect(entryFilePath('ts')).toBe('src/index.ts')
    expect(deployCommandsFilePath('js')).toBe('deploy-commands.mjs')
    expect(deployCommandsFilePath('ts')).toBe('src/deploy-commands.ts')
  })
})

describe('buildPackageJson', () => {
  it('includes djsk and the resolved discord.js range for a bot', () => {
    const pkg = buildPackageJson(makeBotAnswers({ discordJsRange: '^14.26.4' }), '0.1.0')
    expect(pkg.name).toBe('my-bot')
    // biome-ignore lint/suspicious/noExplicitAny: test-only structural access
    expect((pkg as any).dependencies['discord.js']).toBe('^14.26.4')
    // biome-ignore lint/suspicious/noExplicitAny: test-only structural access
    expect((pkg as any).dependencies.djsk).toBe('^0.1.0')
  })

  it('passes through whatever discord.js range was resolved (v13 bot)', () => {
    const pkg = buildPackageJson(
      makeBotAnswers({ discordVersion: 'v13', discordJsRange: '^13.17.1' }),
      '0.1.0',
    )
    // biome-ignore lint/suspicious/noExplicitAny: test-only structural access
    expect((pkg as any).dependencies['discord.js']).toBe('^13.17.1')
  })

  it('includes the chosen selfbot library instead of discord.js', () => {
    const pkg = buildPackageJson(
      makeSelfbotAnswers({ library: 'discord.js-selfbot-youtsuho-v13' }),
      '0.1.0',
    )
    // biome-ignore lint/suspicious/noExplicitAny: test-only structural access
    const deps = (pkg as any).dependencies
    expect(deps['discord.js-selfbot-youtsuho-v13']).toBe('latest')
    expect(deps['discord.js']).toBeUndefined()
  })

  it('adds TS devDependencies and tsx-based scripts only in TS mode', () => {
    const jsPkg = buildPackageJson(makeBotAnswers({ format: 'js' }), '0.1.0') as {
      scripts: Record<string, string>
      devDependencies?: unknown
    }
    expect(jsPkg.devDependencies).toBeUndefined()
    expect(jsPkg.scripts.start).toBe('node index.mjs')

    const tsPkg = buildPackageJson(makeBotAnswers({ format: 'ts' }), '0.1.0') as {
      scripts: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(tsPkg.devDependencies).toBeDefined()
    expect(tsPkg.scripts.dev).toBe('tsx watch src/index.ts')
    expect(tsPkg.scripts.start).toBe('tsx src/index.ts')
  })

  it('adds a deploy script only when the bot mode includes slash, using the right runner', () => {
    const textOnly = buildPackageJson(makeBotAnswers({ commandMode: 'text' }), '0.1.0') as {
      scripts: Record<string, string>
    }
    expect(textOnly.scripts.deploy).toBeUndefined()

    const slashJs = buildPackageJson(
      makeBotAnswers({ commandMode: 'slash', format: 'js' }),
      '0.1.0',
    ) as { scripts: Record<string, string> }
    expect(slashJs.scripts.deploy).toBe('node deploy-commands.mjs')

    const slashTs = buildPackageJson(
      makeBotAnswers({ commandMode: 'slash+text', format: 'ts' }),
      '0.1.0',
    ) as { scripts: Record<string, string> }
    expect(slashTs.scripts.deploy).toBe('tsx src/deploy-commands.ts')

    const selfbot = buildPackageJson(makeSelfbotAnswers(), '0.1.0') as {
      scripts: Record<string, string>
    }
    expect(selfbot.scripts.deploy).toBeUndefined()
  })
})

describe('buildEnv', () => {
  it('uses DISCORD_TOKEN and includes CLIENT_ID for a bot with both set', () => {
    const env = buildEnv(makeBotAnswers({ token: 'tok', clientId: '123' }))
    expect(env).toBe('DISCORD_TOKEN=tok\nCLIENT_ID=123\n')
  })

  it('omits CLIENT_ID when absent, and leaves the token blank when skipped', () => {
    const env = buildEnv(makeBotAnswers({ token: null, clientId: null }))
    expect(env).toBe('DISCORD_TOKEN=\n')
  })

  it('uses SELFBOT_TOKEN for selfbot answers', () => {
    const env = buildEnv(makeSelfbotAnswers({ token: 'utok' }))
    expect(env).toBe('SELFBOT_TOKEN=utok\n')
  })
})

describe('buildGitignore', () => {
  it('ignores node_modules, .env and dist', () => {
    const content = buildGitignore()
    expect(content).toContain('node_modules/')
    expect(content).toContain('.env')
    expect(content).toContain('dist/')
  })
})

describe('buildTsconfig', () => {
  it('targets ES2022 with strict mode and noEmit', () => {
    const tsconfig = buildTsconfig() as { compilerOptions: Record<string, unknown> }
    expect(tsconfig.compilerOptions.target).toBe('ES2022')
    expect(tsconfig.compilerOptions.strict).toBe(true)
    expect(tsconfig.compilerOptions.noEmit).toBe(true)
  })
})

describe('buildBotEntry', () => {
  it('wires both messageCreate and interactionCreate for slash+text', () => {
    const entry = buildBotEntry(makeBotAnswers({ commandMode: 'slash+text' }))
    expect(entry).toContain('onMessageCreated')
    expect(entry).toContain('onInteractionCreate')
  })

  it('wires only interactionCreate and uses minimal intents for slash-only', () => {
    const entry = buildBotEntry(makeBotAnswers({ commandMode: 'slash', discordVersion: 'v14' }))
    expect(entry).not.toContain('onMessageCreated')
    expect(entry).toContain('onInteractionCreate')
    expect(entry).toContain('[GatewayIntentBits.Guilds]')
  })

  it('wires only messageCreate for text-only', () => {
    const entry = buildBotEntry(makeBotAnswers({ commandMode: 'text' }))
    expect(entry).toContain('onMessageCreated')
    expect(entry).not.toContain('onInteractionCreate')
  })

  it('uses GatewayIntentBits for v14 and Intents.FLAGS for v13', () => {
    const v14 = buildBotEntry(makeBotAnswers({ discordVersion: 'v14', commandMode: 'text' }))
    expect(v14).toContain('GatewayIntentBits')

    const v13 = buildBotEntry(makeBotAnswers({ discordVersion: 'v13', commandMode: 'text' }))
    expect(v13).toContain('Intents.FLAGS')
  })

  it('includes explicit owners when provided, and a placeholder comment otherwise', () => {
    const withOwners = buildBotEntry(makeBotAnswers({ owners: ['111', '222'] }))
    expect(withOwners).toContain("owners: ['111', '222']")

    const withoutOwners = buildBotEntry(makeBotAnswers({ owners: [] }))
    expect(withoutOwners).not.toMatch(/^\s*owners: \[/m)
    expect(withoutOwners).toContain('djsk auto-detects')
  })

  it('includes security: true only when security mode is enabled', () => {
    expect(buildBotEntry(makeBotAnswers({ security: true }))).toContain('security: true,')
    expect(buildBotEntry(makeBotAnswers({ security: false }))).not.toContain('security: true,')
  })
})

describe('buildSelfbotEntry', () => {
  it('imports from the chosen selfbot library and logs in with SELFBOT_TOKEN', () => {
    const entry = buildSelfbotEntry(
      makeSelfbotAnswers({ library: 'discord.js-selfbot-youtsuho-v13' }),
    )
    expect(entry).toContain("from 'discord.js-selfbot-youtsuho-v13'")
    expect(entry).toContain('process.env.SELFBOT_TOKEN')
    expect(entry).toContain('onMessageCreated')
  })
})

describe('buildDeployCommands', () => {
  it('PUTs to the applications/{id}/commands endpoint using CLIENT_ID and DISCORD_TOKEN', () => {
    const content = buildDeployCommands()
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting the generated template literal's literal text.
    expect(content).toContain('applications/${CLIENT_ID}/commands')
    expect(content).toContain("method: 'PUT'")
    expect(content).toContain('getSlashCommandData')
  })
})
