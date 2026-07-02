# djsk

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
- **`jsk sh`** — Run system shell commands with live-streamed output (PowerShell/cmd/`$SHELL`).
- **`jsk cat` / `jsk curl`** — Read local files (with line spans) or remote text resources.
- **Diagnostics** — `jsk` status summary, `jsk ping` round-trip timing, `jsk tasks` / `jsk cancel`.
- **Slash commands** — `/jsk <subcommand>` (bot use, not selfbots); the same handlers as the text commands, with `js`/`sh` prompting a code-input modal instead of a plain string option.
- **Cross-library** — one API for discord.js v13/v14 and the selfbot forks; no builder-class lock-in.
- **Zero runtime dependencies** — discord.js is a peer dependency; Shift_JIS and HTTP use Node built-ins.
- **`djsk create`** — an interactive CLI that scaffolds a ready-to-run bot or selfbot project.

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

It asks whether you're setting up a **bot** or a **selfbot**, JavaScript or TypeScript, a Discord token (optional), whether to enable [security mode](#security-mode), and owner ID(s) (optional) — then, for bots, the discord.js version and command mode (slash + text / slash only / text only), fetching the application ID for `.env` when slash commands are included. It writes `package.json`, `.env`, `.gitignore`, the entry file, a `tsconfig.json` (TypeScript projects), and a standalone `deploy-commands` script (slash-inclusive bot projects), then installs dependencies with whichever package manager invoked it (npm/pnpm/yarn/bun). Anything you skipped (token, owner IDs, the application ID) is listed as a **Next Steps** checklist at the end.

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
| `shell`          | `ShellOverride` | *(auto)* | Override which shell `jsk sh` spawns (see below).                      |

### Security mode

The Discord token is **always** redacted from djsk's own output. Setting `security: true` additionally best-effort redacts, from everything djsk sends, replies with, edits, or logs — including `jsk js` results, `jsk cat` / `jsk curl` output (message and file attachments), and shell output:

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

**`jsk js` user code.** Because eval'd code can call Discord directly (e.g. `message.reply(...)`, `channel.send(...)`, `interaction.editReply(...)`) — bypassing djsk's own output path — security mode protects this in two layers, active only while an eval is running:

1. The eval scope's `message`, `msg`, `channel`, `author` and `me` are Proxy-guarded, so their response methods (and `channel`/DMs reached through them) scrub before sending.
2. For anything reached another way (`client.channels.cache.get(id).send(...)`, a webhook, an interaction, a fetched user, ...), djsk temporarily patches `send`/`reply`/`edit`/`editReply`/ `followUp`/`update` on the installed library's own exported classes for the duration of that single eval, then restores the originals — regardless of how the object was obtained. Gateway/IPC/shard-control methods that happen to share a name (e.g. `Shard.send`, any `*Manager.edit`) are excluded so they aren't corrupted.

Because layer 2 patches shared prototypes, any other message the bot happens to send *while that eval is running* is scrubbed too; the patch is removed as soon as the eval finishes. Calls that skip the library entirely (raw `fetch`/`client.rest` HTTP calls with a hand-built body) are still not covered — there is no method to intercept.

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

All commands are used as `${prefix}jsk <command>` (e.g. `.jsk js 1 + 1`) or `/jsk <command>`.

| Command                    | Description                                                          |
| -------------------------- | ------------------------------------------------------------------- |
| `jsk`                      | Status summary (versions, memory, cache counts, latency).           |
| `jsk help`                 | Lists all commands.                                                 |
| `jsk js <code>` (`eval`)   | Evaluates JavaScript. Single expressions auto-return.               |
| `jsk retain [on\|off]`     | Toggles REPL variable retention (the `vars` object and `_`).        |
| `jsk sh <command>` (`shell`) | Runs a system shell command, streaming output.                    |
| `jsk cat <path[#L1-3]>`    | Reads a file, optionally a line span.                              |
| `jsk curl <url>`           | Downloads and displays a text resource.                            |
| `jsk ping` (`rtt`)         | Measures websocket latency and message round-trip time.            |
| `jsk shutdown` (`logout`)  | Logs the bot out and destroys the client.                          |
| `jsk tasks`                | Lists running djsk tasks.                                          |
| `jsk cancel <index>`       | Cancels a task (`~` for all, `-1` for the most recent).            |

### `jsk js` scope

The following variables are injected into the evaluation scope:

`client` / `bot`, `ctx`, `message` / `msg`, `interaction`, `author`, `channel`, `guild`, `me`, `_` (last result), and `vars` (a persistent object when retention is on).

`message`/`msg` are `null` and `interaction` is set when `js`/`sh` was invoked via slash command (through the code-input modal) instead of a text command, and vice versa.

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
