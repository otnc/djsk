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
- **Cross-library** — one API for discord.js v13/v14 and the selfbot forks; no builder-class lock-in.
- **Zero runtime dependencies** — discord.js is a peer dependency; Shift_JIS and HTTP use Node built-ins.

## Installation

```sh
npm install djsk
# discord.js (or a supported fork) is a peer dependency:
npm install discord.js
```

## Examples

Full examples are in [examples/](./examples) (bot and selfbot).

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

> You may use djsk on a user account (selfbot) via a fork. Automating a user account is
> prohibited by the [Discord ToS](https://discord.com/terms) and can lead to account termination.
> Use at your own risk — the authors take no responsibility for banned accounts.

## Configuration

| Option           | Type       | Default    | Description                                                                 |
| ---------------- | ---------- | ---------- | --------------------------------------------------------------------------- |
| `prefix`         | `string`   | `'.'`      | Command prefix. The root command is `${prefix}jsk`.                         |
| `owners`         | `string[]` | *(auto)*   | Allowed user IDs. Omitted → application owner/team (or the selfbot user).   |
| `encoding`       | `string`   | `'UTF-8'`  | Shell output decoding. `Shift_JIS` is supported natively.                   |
| `consoleLog`     | `boolean`  | `true`     | Print init notices and command errors to the console.                       |
| `shellTimeout`   | `number`   | `120000`   | Kill a `jsk sh` process after this many ms of inactivity.                   |
| `exitOnShutdown` | `boolean`  | `false`    | Call `process.exit(0)` after `jsk shutdown` destroys the client.            |

## Commands

All commands are used as `${prefix}jsk <command>` (e.g. `.jsk js 1 + 1`).

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

`client` / `bot`, `ctx`, `message` / `msg`, `author`, `channel`, `guild`, `me`,
`_` (last result), and `vars` (a persistent object when retention is on).

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
