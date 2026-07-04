import type { Client, Interaction, Message } from 'discord.js'

// djsk is duck-typed at runtime and works with discord.js v13/v14 and the selfbot forks
// (discord.js-selfbot-v13, discord.js-selfbot-youtsuho-v13) alike — none of these types are
// actually enforced. They exist purely for editor ergonomics, and only matter as *fallbacks*:
// `Jishaku` and its `onMessageCreated`/`onInteractionCreate` handlers are generic over the
// concrete client/message/interaction type you pass in (see jishaku.ts), so in practice your
// editor infers and shows the exact shape of whatever you actually installed — these are only
// used when that can't be inferred.
//
// These must stay a plain external reference to the real `discord.js` package rather than a
// bundled/inlined type (as a previous version of this file did, importing `discord.js-v13`/
// `discord.js-v14` aliases and fully inlining both into the published .d.ts): discord.js's
// classes carry private fields, which TypeScript treats as nominally typed — identical only
// when they originate from the exact same declaration. An inlined copy of `Client` is a
// *different* declaration from the real `Client` a consumer's own `discord.js` install
// resolves to, so passing their client into anything typed with the inlined version always
// fails to type-check, even on a matching version. A plain external import resolves against
// whatever `discord.js` is hoisted in the consumer's own node_modules, so it's always the
// exact same declaration — no mismatch possible.

/** A discord.js (or compatible fork) Client. See the module-level comment for why this matters. */
export type AnyClient = Client

/** A discord.js (or compatible fork) Message. See the module-level comment for why this matters. */
export type AnyMessage = Message

/**
 * A discord.js (or compatible fork) Interaction (chat input command or modal submit).
 * See the module-level comment for why this matters.
 */
export type AnyInteraction = Interaction

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
  /**
   * Hard cap (ms) on any single *synchronous* stretch of a `jsk js` eval — protects against a
   * runaway loop (`while (true) {}`) freezing the whole bot process, which `jsk cancel` can't
   * help with since nothing (including processing that command) runs while the eval is stuck
   * in synchronous code. Doesn't limit the eval's total time when it's `await`ing things
   * (network calls, timers, ...) — that's unbounded, and separately stoppable via `jsk cancel`.
   * Default: `10000`.
   */
  evalTimeout?: number
  /** Overrides which shell `jsk sh` spawns. Default: djsk's platform auto-detection. */
  shell?: ShellOverride
  /**
   * Base directory `jsk cjs`'s `require` and `jsk mjs`'s `import` resolve modules from —
   * point this at your bot's project root if djsk is ever invoked with a different `cwd`.
   * `jsk mjs` also writes its transient per-eval module file under here (in a `.djsk-tmp`
   * subdirectory, cleaned up immediately after each eval). Default: `process.cwd()`.
   */
  evalModuleDir?: string
  /**
   * When `true`, djsk installs process-wide `uncaughtException`/`unhandledRejection`
   * listeners for the life of the process, so an error that escapes the awaited chain a `jsk
   * js`/`jsk cjs`/`jsk mjs`/`jsk sh` eval runs in — a fire-and-forget promise the eval'd code
   * left unawaited, an event listener it registered that throws later, ... — gets logged
   * instead of taking the whole bot down. Node's default for both events is to terminate the
   * process; djsk's own per-command try/catch (see {@link Jishaku.run}) only ever covers
   * errors thrown or rejected within that command's own awaited chain, not ones like these.
   *
   * This is a process-wide safety net, not scoped to djsk's own commands — it also swallows
   * crashes from unrelated parts of your bot that would otherwise have exited the process. If
   * you already install your own top-level `uncaughtException`/`unhandledRejection` handlers
   * (e.g. for a process manager or crash reporter), set this to `false` so djsk doesn't shadow
   * them. Default: `true`.
   */
  catchProcessErrors?: boolean
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
  evalTimeout: number
  shell: ShellOverride | null
  evalModuleDir: string
  catchProcessErrors: boolean
}
