# djsk

[![npm version](https://img.shields.io/npm/v/djsk.svg)](https://www.npmjs.com/package/djsk) [![npm downloads](https://img.shields.io/npm/dm/djsk.svg)](https://www.npmjs.com/package/djsk) [![CI](https://github.com/otnc/djsk/actions/workflows/ci.yml/badge.svg)](https://github.com/otnc/djsk/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/djsk.svg)](./LICENSE)
[![discord.js](https://img.shields.io/badge/discord.js-v13%20%7C%20v14-5865F2?logo=discorddotjs&logoColor=white)](https://www.npmjs.com/package/discord.js) [![discord.js-selfbot-v13](https://img.shields.io/badge/discord.js--selfbot--v13-supported-5865F2)](https://www.npmjs.com/package/discord.js-selfbot-v13) [![discord.js-selfbot-youtsuho-v13](https://img.shields.io/badge/discord.js--selfbot--youtsuho--v13-supported-5865F2)](https://www.npmjs.com/package/discord.js-selfbot-youtsuho-v13)

Jishaku for Discord.js — a debugging and diagnostics toolkit for your bot.

The original jishaku (Discord.py) is [here](https://github.com/Gorialis/jishaku).

## Supported Versions

- [Discord.js](https://www.npmjs.com/package/discord.js)
  - v14
  - v13
    - Recommend: `v13-lts` (`13.17.1`)
- [discord.js-selfbot-v13](https://www.npmjs.com/package/discord.js-selfbot-v13)
  - All
    - Recommend: `latest`
- [discord.js-selfbot-youtsuho-v13](https://www.npmjs.com/package/discord.js-selfbot-youtsuho-v13)
  - All
    - Recommend: `latest`

> [!Note]
>   
> v12 or older are not supported.  
> Planned to support newer versions, but may not be supported in the current version.

## Features

- **`jsk js`** — Evaluate JavaScript in the running process (async, with token redaction).
- **`jsk cjs`** — Same as `jsk js`, plus a working `require()` resolved against your bot project.
- **`jsk mjs`** — Evaluate JavaScript as a real ES module — `import`/top-level `await` work.
- **`jsk sh`** — Run system shell commands with live-streamed output (PowerShell/cmd/`$SHELL`).
- **`jsk cat` / `jsk curl`** — Read local files (with line spans) or remote text resources.
- **Diagnostics** — `jsk` status summary, `jsk ping` round-trip timing, `jsk tasks` / `jsk cancel`.
- **Slash commands** — `/jsk <subcommand>` (bot use, not selfbots); the same handlers as the text commands, with `js`/`sh` prompting a code-input modal instead of a plain string option.
- **Pagination** — output over Discord's 2000-character limit is split into pages you browse with ⬅️/➡️ reactions, instead of being truncated or dumped to a file.
- **Cross-library** — one API for discord.js v13/v14 and the selfbot forks; no builder-class lock-in.
- **Zero runtime dependencies** — discord.js is a peer dependency; Shift_JIS and HTTP use Node built-ins.
- **`djsk create`** — an interactive CLI that scaffolds a ready-to-run bot or selfbot project.
- **Update notices** — when `consoleLog` is on, djsk checks once at startup (non-blocking, never throws) whether a newer version is published and logs a one-line notice if so.

## Installation

```sh
npm install djsk
# discord.js (or a supported fork) is a peer dependency:
npm install discord.js
```

## CLI / Project Scaffolding

Starting a new project? `npx djsk create` (or `pnpm dlx djsk create`) scaffolds one interactively:

```sh
npx djsk create my-bot
# or, to be prompted for the directory:
npx djsk create
```

It asks whether you're setting up a **bot** or a **selfbot**, JavaScript or TypeScript, a Discord token (optional), whether to enable [security mode](#security-mode), owner ID(s) (optional), and the command prefix (default `.`) — then, for bots, the discord.js version and command mode (slash + text / slash only / text only), fetching the application ID for `.env` when slash commands are included; for selfbots, which fork to use (`discord.js-selfbot-v13` or `discord.js-selfbot-youtsuho-v13`). It writes `package.json`, `.env`, `.gitignore`, the entry file, a `tsconfig.json` (TypeScript projects), and a standalone `deploy-commands` script (slash-inclusive bot projects), then installs dependencies with whichever package manager invoked it (npm/pnpm/yarn/bun). Anything you skipped (token, owner IDs, the application ID) is listed as a **Next Steps** checklist at the end.

## Examples

Full examples are in [examples/](./examples): [bot](./examples/bot.mjs), [selfbot](./examples/selfbot.mjs),
[slash commands](./examples/slash.mjs), and [security mode](./examples/security.mjs) (`security: true` vs `false`).

```js
import { Client, GatewayIntentBits } from 'discord.js'
import { Jishaku } from 'djsk'

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Required to read command content.
    GatewayIntentBits.GuildMessageReactions, // Required for ⬅️/➡️ pagination on long output.
  ],
})

const jsk = new Jishaku(client, {
  prefix: '.', // Root command becomes `.jsk`. Default: '.'
  // owners: ['957885295251034112'], // Optional; defaults to the application owner/team.
  encoding: 'UTF-8', // Use 'Shift_JIS' for Japanese Windows shell output.
})

client.on('messageCreate', (message) => jsk.onMessageCreated(message))
client.login(process.env.DISCORD_TOKEN)
```

> [!Caution]
>   
> You may use djsk on a user account (selfbot) via a fork. Automating a user account is prohibited by the [Discord ToS](https://discord.com/terms) and can lead to account termination.  
> Use at your own risk — the authors take no responsibility for banned accounts.

## Configuration

| Option           | Type       | Default    | Description                                                                 |
| ---------------- | ---------- | ---------- | --------------------------------------------------------------------------- |
| `prefix`         | `string`   | `'.'`      | Command prefix. The root command is `${prefix}jsk`.                         |
| `owners`         | `string[]` | *(auto)*   | Allowed user IDs. Omitted → application owner/team (or the selfbot user).   |
| `encoding`       | `string`   | `'UTF-8'`  | Shell output decoding. `Shift_JIS` is supported natively.                   |
| `consoleLog`     | `boolean`  | `true`     | Print init notices and command errors to the console.                       |
| `slashCommandName` | `string` | `'jsk'`    | Name of the `/jsk` slash command (see below).                               |
| `security`       | `boolean`  | `false`    | Redact secrets from all output/logs (see below).                            |
| `secretPatterns` | `RegExp[]` | `[]`       | Extra credential regexes to redact in security mode.                        |
| `secretValues`   | `string[]` | `[]`       | Extra exact strings to redact in security mode.                             |
| `shellTimeout`   | `number`   | `120000`   | Kill a `jsk sh` process after this many ms of inactivity.                   |
| `exitOnShutdown` | `boolean`  | `false`    | Call `process.exit(0)` after `jsk shutdown` destroys the client.            |
| `evalTimeout`    | `number`   | `10000`    | Cap on a single *synchronous* stretch of a `jsk js`/`jsk cjs` eval (see below). |
| `shell`          | `ShellOverride` | *(auto)* | Override which shell `jsk sh` spawns (see below).                      |
| `evalModuleDir`  | `string`   | `process.cwd()` | Base directory `jsk cjs`'s `require` and `jsk mjs`'s `import` resolve modules from (see below). |
| `catchProcessErrors` | `boolean` | `true`  | Keep the process alive on an `uncaughtException`/`unhandledRejection` that escapes an eval (see below). |

### Process-wide error safety net

`jsk js` / `jsk cjs` / `jsk mjs` / `jsk sh` already catch and report anything an eval throws or rejects with *within its own awaited chain* — that's just `jsk`'s normal ‼️ error reporting. But eval'd code can also fail *outside* that chain: a `fetch(...)` left unawaited that rejects after the command already returned, an event listener the eval registered (`client.on(...)`) that throws later, and so on. Node's default for both `uncaughtException` and `unhandledRejection` is to terminate the process, which would take the whole bot down over a mistake in a one-off debug snippet.

With `catchProcessErrors` (on by default), djsk installs its own `uncaughtException`/`unhandledRejection` listeners for the life of the process, logging instead of crashing. This is process-wide, not scoped to djsk's own commands — set it to `false` if you already install your own top-level handlers (a process manager, crash reporter, ...) and don't want djsk's to shadow them.

### Security mode

The Discord token is **always** redacted from djsk's own output. Setting `security: true` additionally best-effort redacts, from everything djsk sends, replies with, edits, or logs — including `jsk js`/`jsk cjs`/`jsk mjs` results, `jsk cat` / `jsk curl` output (message and file attachments), and shell output:

- secret-like `process.env` values (keys matching `TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `API`, …);
- `.env`-style assignments (`SECRET_KEY=...`), even when not loaded into the environment;
- built-in credential formats — Discord tokens & webhook URLs, bearer tokens, PEM private keys.

Provider-specific keys (AWS, GitHub, Slack, …) are intentionally **not** built in, to keep false positives low. Add the formats your bot handles via `secretPatterns` / `secretValues`:

```js
new Jishaku(client, {
  security: true,
  secretPatterns: [/\bAKIA[0-9A-Z]{16}\b/g, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  secretValues: ['a-specific-key-you-want-gone'],
})
```

**`jsk js`/`jsk cjs`/`jsk mjs` user code.** Because eval'd code can call Discord directly (e.g. `message.reply(...)`, `channel.send(...)`, `interaction.editReply(...)`) — bypassing djsk's own output path — security mode protects this in three layers, active only while an eval is running:

1. The eval scope's `message`, `msg`, `channel`, `author` and `me` are Proxy-guarded, so their response methods (and `channel`/DMs reached through them) scrub before sending.
2. For anything reached another way (`client.channels.cache.get(id).send(...)`, a webhook, an interaction, a fetched user, ...), djsk temporarily patches `send`/`reply`/`edit`/`editReply`/ `followUp`/`update` on the installed library's own exported classes for the duration of that single eval, then restores the originals — regardless of how the object was obtained. Gateway/IPC/shard-control methods that happen to share a name (e.g. `Shard.send`, any `*Manager.edit`) are excluded so they aren't corrupted.
3. On discord.js v14 (not v13 or the selfbot forks — they route requests through an older builder with no equivalent choke point), `client.rest.get/post/put/patch/delete(...)` all funnel through one method internally, so djsk patches just that one to scrub `body.content` too — narrowing, though not fully closing, layer 2's gap for raw REST calls.

Because layers 2 and 3 patch shared prototypes, any other message the bot happens to send *while that eval is running* is scrubbed too; the patches are removed as soon as the eval finishes. Only a hand-built raw `fetch()` call using the token directly — skipping the library entirely — is still not covered; there is no method to intercept there.

> [!Warning]
>   
> This is a heuristic safety net, not a guarantee. It favours over-redaction, so legitimate output may occasionally be redacted too. Treat it as defense-in-depth, not a substitute for not printing secrets in the first place.

### Custom shell

`jsk sh` auto-detects a shell to run — PowerShell (falling back to `cmd`) on Windows, `$SHELL` (falling back to `/bin/bash`) everywhere else — which covers Windows/macOS/Linux without any configuration. Override it via `shell` to use something else instead (PowerShell Core, a specific shell, a non-default install path, ...):

```js
new Jishaku(client, {
  shell: {
    command: 'pwsh',
    args: ['-NoProfile', '-NonInteractive', '-Command'], // the code to run is appended as the final argument
    ps1: 'PS >',       // shown before the command in the rendered output. Default: '$'
    highlight: 'powershell', // codeblock language for syntax highlighting. Default: 'ansi'
  },
})
```

## Slash commands

Bot accounts (not selfbots — Discord doesn't allow user accounts to have application commands) can also drive djsk through `/jsk <subcommand>`, using the exact same command handlers as the text commands:

```js
import { getSlashCommandData, Jishaku } from 'djsk'

const jsk = new Jishaku(client, { slashCommandName: 'jsk' }) // must match what you register below

client.once('ready', async (readyClient) => {
  // Register once (e.g. behind a one-off script or a flag), not on every boot.
  await readyClient.application.commands.set([getSlashCommandData(jsk.config.slashCommandName)])
})

client.on('interactionCreate', (interaction) => jsk.onInteractionCreate(interaction))
```

`getSlashCommandData()` returns a plain command payload (no `SlashCommandBuilder`), so you can also register it yourself via any REST call or deploy script instead of `commands.set(...)`.

`js` and `sh` take no string option — invoking them immediately opens a code-input modal (Discord's slash command input box isn't well suited to writing/pasting multi-line code), and the command runs once you submit it. Every other subcommand (`cat`, `curl`, `ping`, `shutdown`, `tasks`, `cancel`, `retain`, `status`, `help`) takes normal options.

## Commands

All commands are used as `${prefix}jsk <command>` (e.g. `.jsk js return 1 + 1`) or `/jsk <command>`.

Non-owners get no reaction at all when using text commands (djsk doesn't even reveal it's listening), and an ephemeral "You are not allowed to use this command." reply when using the slash command.

| Command                    | Description                                                          |
| -------------------------- | ------------------------------------------------------------------- |
| `jsk`                      | Status summary (versions, memory, cache counts, latency).           |
| `jsk help`                 | Lists all commands.                                                 |
| `jsk js <code>` (`eval`)   | Evaluates JavaScript. Use `return` to produce a result.              |
| `jsk cjs <code>` (`commonjs`) | Like `jsk js`, plus a working `require()`.                        |
| `jsk mjs <code>` (`esm`)   | Evaluates as a real ES module (`import` works). Use `export default` for a result. |
| `jsk retain [on\|off]`     | Toggles REPL variable retention (the `vars` object and `_`).        |
| `jsk sh <command>` (`shell`) | Runs a system shell command, streaming output.                    |
| `jsk cat <path[#L1-3]>`    | Reads a file, optionally a line span.                              |
| `jsk curl <url>`           | Downloads and displays a text resource.                            |
| `jsk ping` (`rtt`)         | Measures websocket latency and message round-trip time.            |
| `jsk shutdown` (`logout`)  | Logs the bot out and destroys the client.                          |
| `jsk tasks`                | Lists running djsk tasks.                                          |
| `jsk cancel <index>`       | Cancels a task (`~` for all, `-1` for the most recent).            |

### `jsk js` / `jsk cjs` / `jsk mjs` scope

The following variables are injected into the evaluation scope of all three:

`client` / `bot`, `ctx`, `message` / `msg`, `interaction`, `author`, `channel`, `guild`, `me`, `_` (last result), `vars` (a persistent object when retention is on), `signal` (an `AbortSignal`, see below), and `dynamicImport` (see below). `jsk cjs` additionally gets `require`.

`message`/`msg` are `null` and `interaction` is set when invoked via slash command (through the code-input modal) instead of a text command, and vice versa.

`jsk js` and `jsk cjs` run eval'd code via `vm.Script#runInThisContext()` rather than a plain function, in the *current* realm — Node's ambient globals and live object references (client, message, ...) work exactly as if it were a plain function, but bare `import(...)` doesn't (it needs `--experimental-vm-modules`, which not every djsk consumer's process runs with). Use the injected `dynamicImport(specifier)` instead — it's a normal function defined outside the vm boundary, so it isn't affected by that restriction: `const os = await dynamicImport('node:os')`. `jsk cjs` additionally gets a real `require()`, resolved against `evalModuleDir` (default `process.cwd()`) — so `require('discord.js')`, `require('./some-local-file')`, etc. resolve against *your bot project*, not djsk's own.

**`jsk mjs` is different.** Static `import` syntax can't appear inside a wrapped function body at all (an ECMAScript rule, not a `vm.Script` limitation), so `jsk mjs` instead runs your code as the top level of a real, freshly-loaded ES module — real `import`, real top-level `await`. Two consequences:

- There's no `return` — a module's top level has no return value. Use `export default <value>` to produce a result instead (e.g. `export default 1 + 1;`).
- It writes a transient `.mjs` file under `<evalModuleDir>/.djsk-tmp` for the duration of the eval (deleted immediately after; a `.gitignore` is dropped in that folder so it never pollutes your repo). This is required for real npm package imports to resolve — dynamically `import()`-ing a `data:` URL works for `node:` builtins but can't resolve real packages (no filesystem location for Node to walk up node_modules from), so a real file is the only way to make `import 'some-package'` actually work.
- It does **not** get `evalTimeout`'s synchronous-runaway protection (see below) — a bare `while (true) {}` in `jsk mjs` blocks the whole process with no recovery short of a restart, since that protection is a `vm.Script` feature `jsk mjs` doesn't use. `jsk cancel` still works for an eval stuck *awaiting* something.

**Cancelling a running eval.** All three register themselves in `jsk tasks`, and are cancellable two ways:

- `jsk cancel` — stops an eval stuck *awaiting* something (an infinite retry loop with an `await` in it, a Discord call that never resolves, `await new Promise(() => {})`, ...). `signal` is provided so eval'd code can cooperate explicitly too — pass it to anything that accepts an `AbortSignal` (`fetch(url, { signal })`) or poll `signal.aborted` inside a loop.
- `evalTimeout` — a hard cap (ms, default `10000`) on any single *synchronous* stretch of a `jsk js`/`jsk cjs` eval, e.g. a bare `while (true) {}`. This case can't be helped by `jsk cancel`: while the eval is stuck in synchronous code, the entire bot process is blocked and can't process *any* Discord events, including a cancel request — so it's enforced automatically instead (via V8's execution watchdog, which can genuinely preempt a tight loop), terminating the eval once it's exceeded. Not available for `jsk mjs` — see above.

Between the two, a `jsk js`/`jsk cjs` eval can (almost) always be recovered from without restarting the bot. `evalTimeout` only preempts synchronous *JS* execution, not time spent parked in a blocking *native* call (`child_process.execSync` on a slow command, say) — for `execSync`/`execFileSync`/`spawnSync` specifically (reached via `dynamicImport('node:child_process')`, since bare `import(...)` isn't available — see above), a call that doesn't set its own `timeout` gets `evalTimeout` as one automatically, since those three already support it natively (killing the child and unblocking the parent). Other blocking natives with no such option (`fs.readFileSync` hung on a slow pipe, a bare `Atomics.wait()`, ...) remain a real, if rarer, gap that still needs a restart.

> [!Note]
>   
> JavaScript cannot retain lexical `let`/`const` bindings across separate evaluations.  
> When `jsk retain` is on, persist state by assigning to the `vars` object.

## Development

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
pnpm build       # tsup -> dist (ESM + CJS + d.ts)
pnpm check       # biome check --write + tsc
```

## License

[MIT License](./LICENSE) &copy; otoneko.
