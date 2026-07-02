import type {
  Client as ClientV13,
  Interaction as InteractionV13,
  Message as MessageV13,
} from 'discord.js-v13'
import type {
  Client as ClientV14,
  Interaction as InteractionV14,
  Message as MessageV14,
} from 'discord.js-v14'

// djsk is duck-typed at runtime — none of the AnyClient/AnyMessage/AnyInteraction unions below
// are enforced — but discord.js v13 and v14 have meaningfully different shapes, so a
// single-version type would silently show the wrong one for half of djsk's consumers.
// `discord.js-v13`/`discord.js-v14` are `discord.js@13`/`discord.js@14` installed under
// devDependency-only aliases (`npm:discord.js@...`), purely so both majors' types can be
// imported side by side without a version conflict. `pnpm build:types` (dts-bundle-generator,
// not tsup's own dts step — see tsup.config.ts) fully inlines both into the published .d.ts;
// neither alias name may appear in the output, since consumers won't have either installed
// under those names.
//
// The selfbot forks (discord.js-selfbot-v13, discord.js-selfbot-youtsuho-v13) don't publish
// their own types and are v13-shaped, so they fall under the v13 side of these unions too.

/** A discord.js (or compatible fork) Client. See the module-level comment for why this is a union. */
export type AnyClient = ClientV13 | ClientV14

/** A discord.js (or compatible fork) Message. See the module-level comment for why this is a union. */
export type AnyMessage = MessageV13 | MessageV14

/**
 * A discord.js (or compatible fork) Interaction (chat input command or modal submit).
 * See the module-level comment for why this is a union.
 */
export type AnyInteraction = InteractionV13 | InteractionV14

/** Text decoding used when reading shell output. */
export type Encoding = 'UTF-8' | 'Shift_JIS' | (string & {})

/**
 * Overrides which shell/terminal `jsk sh` spawns, instead of djsk's auto-detected default
 * (PowerShell, falling back to `cmd`, on Windows; `$SHELL`, falling back to `/bin/bash`,
 * everywhere else). Useful for PowerShell Core (`pwsh`), a specific shell (`zsh`, `fish`, ...),
 * a non-default install path, WSL, or a sandboxed/containerized shell.
 */
export interface ShellOverride {
  /** The command to spawn (e.g. `'pwsh'`, `'zsh'`, or a full path). */
  command: string
  /** Arguments passed before the code to run — the code itself is appended as the final argument. */
  args?: string[]
  /** Prompt shown before the command in the rendered output. Default: `'$'`. */
  ps1?: string
  /** Codeblock language used for the rendered output's syntax highlighting. Default: `'ansi'`. */
  highlight?: string
}

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
   * Name of the slash command djsk registers/handles for interaction-based use (see
   * {@link getSlashCommandData} and {@link Jishaku.onInteractionCreate}). Default: `jsk`.
   */
  slashCommandName?: string
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
  /** Overrides which shell `jsk sh` spawns. Default: djsk's platform auto-detection. */
  shell?: ShellOverride
}

/** Fully-resolved configuration with defaults applied. */
export interface ResolvedConfig {
  prefix: string
  owners: string[] | null
  encoding: Encoding
  consoleLog: boolean
  slashCommandName: string
  shellTimeout: number
  exitOnShutdown: boolean
  security: boolean
  secretPatterns: RegExp[]
  secretValues: string[]
  shell: ShellOverride | null
}
