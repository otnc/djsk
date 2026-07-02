import { consola } from 'consola'
import type { BotDiscordVersion, CommandMode, FileFormat, SelfbotLibrary } from './types'

/** Prompts for the target directory, unless `positional` (from `djsk create <dir>`) was given. */
export async function promptDirectory(positional: string | undefined): Promise<string> {
  if (positional) return positional
  return consola.prompt('Project directory:', {
    type: 'text',
    default: './',
    placeholder: './',
    cancel: 'reject',
  })
}

/** Asks for confirmation before scaffolding into a non-empty directory. Default: abort. */
export async function promptOverwriteConfirm(directory: string): Promise<boolean> {
  return consola.prompt(`"${directory}" is not empty. Continue anyway?`, {
    type: 'confirm',
    initial: false,
    cancel: 'reject',
  })
}

export async function promptBotOrSelfbot(): Promise<'bot' | 'selfbot'> {
  const value = await consola.prompt('Are you setting up a bot or a selfbot (user account)?', {
    type: 'select',
    options: [
      { label: 'Bot', value: 'bot' },
      { label: 'Selfbot', value: 'selfbot' },
    ],
    cancel: 'reject',
  })
  return value as 'bot' | 'selfbot'
}

export async function promptFileFormat(): Promise<FileFormat> {
  const value = await consola.prompt('JavaScript or TypeScript?', {
    type: 'select',
    options: [
      { label: 'JavaScript', value: 'js' },
      { label: 'TypeScript', value: 'ts' },
    ],
    cancel: 'reject',
  })
  return value as FileFormat
}

/** Returns `null` if the token prompt is submitted empty (skipped). */
export async function promptToken(kind: 'bot' | 'selfbot'): Promise<string | null> {
  const label = kind === 'bot' ? 'Discord bot token' : 'Selfbot user token'
  const token = await consola.prompt(`${label} (leave empty to skip):`, {
    type: 'text',
    default: '',
    cancel: 'reject',
  })
  return token.trim() || null
}

export async function promptSecurity(): Promise<boolean> {
  return consola.prompt('Enable security mode (redact secrets from output)?', {
    type: 'confirm',
    initial: false,
    cancel: 'reject',
  })
}

/** Returns `.` (djsk's default) if the prefix prompt is submitted empty. */
export async function promptPrefix(): Promise<string> {
  const raw = await consola.prompt(
    'Command prefix for text commands (the root command is `<prefix>jsk`):',
    {
      type: 'text',
      default: '.',
      placeholder: '.',
      cancel: 'reject',
    },
  )
  return raw.trim().length > 0 ? raw.trim() : '.'
}

/** Returns an empty array if the owner id prompt is submitted empty (skipped). */
export async function promptOwners(): Promise<string[]> {
  const raw = await consola.prompt('Owner user ID(s), space-separated (leave empty to skip):', {
    type: 'text',
    default: '',
    cancel: 'reject',
  })
  return raw.trim().length > 0 ? raw.trim().split(/\s+/) : []
}

export async function promptDiscordVersion(): Promise<BotDiscordVersion> {
  const value = await consola.prompt('discord.js version:', {
    type: 'select',
    initial: 'v14',
    options: [
      { label: 'v14', value: 'v14' },
      { label: 'v13', value: 'v13' },
    ],
    cancel: 'reject',
  })
  return value as BotDiscordVersion
}

export async function promptCommandMode(): Promise<CommandMode> {
  const value = await consola.prompt('Which commands should the bot support?', {
    type: 'select',
    options: [
      { label: 'Slash command + text command', value: 'slash+text' },
      { label: 'Slash command only', value: 'slash' },
      { label: 'Text command only', value: 'text' },
    ],
    cancel: 'reject',
  })
  return value as CommandMode
}

export async function promptSelfbotLibrary(): Promise<SelfbotLibrary> {
  const value = await consola.prompt('Selfbot library:', {
    type: 'select',
    initial: 'discord.js-selfbot-v13',
    options: [
      { label: 'discord.js-selfbot-v13', value: 'discord.js-selfbot-v13' },
      { label: 'discord.js-selfbot-youtsuho-v13', value: 'discord.js-selfbot-youtsuho-v13' },
    ],
    cancel: 'reject',
  })
  return value as SelfbotLibrary
}
