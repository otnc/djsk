import type { Client, Message } from 'discord.js'

/**
 * A discord.js (or compatible fork) Client.
 *
 * djsk is duck-typed at runtime, so any of discord.js v13/v14,
 * discord.js-selfbot-v13 or discord.js-selfbot-youtsuho-v13 clients are accepted.
 * The discord.js types are used purely for editor ergonomics.
 */
export type AnyClient = Client

/** A discord.js (or compatible fork) Message. */
export type AnyMessage = Message

/** Text decoding used when reading shell output. */
export type Encoding = 'UTF-8' | 'Shift_JIS' | (string & {})

/** User-facing configuration passed to {@link Jishaku}. */
export interface JishakuConfig {
  /** Command prefix. The root command is `${prefix}jsk`. Default: `.` */
  prefix?: string
  /**
   * IDs of users allowed to use djsk.
   * When omitted, djsk resolves the application owner/team (or the selfbot user itself).
   */
  owners?: string[]
  /** Encoding used to decode shell output. Default: `UTF-8`. `Shift_JIS` is supported natively. */
  encoding?: Encoding
  /** Whether djsk prints init/update notices and errors to the console. Default: `true`. */
  consoleLog?: boolean
  /**
   * Security mode. When `true`, djsk best-effort redacts secrets — the Discord token,
   * secret-like `process.env` values, `.env` assignments and common credential formats —
   * from everything it sends, replies with, edits, or logs (including `jsk js` results,
   * `jsk cat`/`jsk curl` output and shell output). Default: `false`.
   */
  security?: boolean
  /**
   * Extra credential regexes to redact in security mode (e.g. provider-specific API key
   * formats such as AWS/GitHub). The built-in patterns only cover Discord tokens & webhooks,
   * bearer tokens and PEM private keys, so add the formats your bot handles here.
   */
  secretPatterns?: RegExp[]
  /** Extra exact strings to always redact in security mode. */
  secretValues?: string[]
  /** Timeout (ms) after which a silent `jsk sh` process is killed. Default: `120000`. */
  shellTimeout?: number
  /** Whether `jsk shutdown` calls `process.exit(0)` after destroying the client. Default: `false`. */
  exitOnShutdown?: boolean
}

/** Fully-resolved configuration with defaults applied. */
export interface ResolvedConfig {
  prefix: string
  owners: string[] | null
  encoding: Encoding
  consoleLog: boolean
  shellTimeout: number
  exitOnShutdown: boolean
  security: boolean
  secretPatterns: RegExp[]
  secretValues: string[]
}
