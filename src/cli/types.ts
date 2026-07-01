/** Output language for the scaffolded project. */
export type FileFormat = 'js' | 'ts'

/** Which discord.js major the scaffolded bot project uses. */
export type BotDiscordVersion = 'v13' | 'v14'

/** Which command surface(s) the scaffolded bot wires up. */
export type CommandMode = 'slash+text' | 'slash' | 'text'

/** Which selfbot fork the scaffolded selfbot project uses. */
export type SelfbotLibrary = 'discord.js-selfbot-v13' | 'discord.js-selfbot-youtsuho-v13'

interface CommonAnswers {
  /** Absolute path to the target project directory. */
  directory: string
  /** Project (and package.json) name, derived from the directory unless given explicitly. */
  projectName: string
  format: FileFormat
  /** `null` when the token prompt was skipped. */
  token: string | null
  security: boolean
  /** Empty when the owner id prompt was skipped. */
  owners: string[]
}

export interface BotAnswers extends CommonAnswers {
  kind: 'bot'
  discordVersion: BotDiscordVersion
  commandMode: CommandMode
  /** Fetched application id, or `null` when skipped/unavailable/not applicable (text-only mode). */
  clientId: string | null
}

export interface SelfbotAnswers extends CommonAnswers {
  kind: 'selfbot'
  library: SelfbotLibrary
}

export type Answers = BotAnswers | SelfbotAnswers
