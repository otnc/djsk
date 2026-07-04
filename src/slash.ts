/**
 * Slash command registration data and modal payloads for interaction-based djsk usage.
 *
 * Built as plain objects (no `SlashCommandBuilder`/`ModalBuilder` classes) so the same data
 * works whether you register it via `client.application.commands.set(...)` (discord.js reads
 * these field names directly) or a raw REST call to Discord's application-commands endpoint
 * (the same field names are also the raw API's snake_case-free keys: name/description/type/
 * options/required). This mirrors djsk's no-builder-class approach used everywhere else.
 */

/** Discord command option types used below (stable API values, not library-specific). */
const OPTION_TYPE = {
  SUB_COMMAND: 1,
  STRING: 3,
} as const

/** Subcommands that take free-form code and prompt with a modal instead of a string option. */
export const CODE_SUBCOMMANDS = new Set(['js', 'cjs', 'mjs', 'sh'])

/** Prefix used for the modal `customId`, so a submission can be traced back to its subcommand. */
const MODAL_ID_PREFIX = 'djsk:'

/**
 * Builds the application command payload for djsk's slash command.
 *
 * Register it yourself, e.g.:
 *
 * ```ts
 * await client.application.commands.set([getSlashCommandData()])
 * ```
 *
 * @param name Command name. Must match the `slashCommandName` passed to {@link Jishaku}. Default: `jsk`.
 */
export function getSlashCommandData(name = 'jsk') {
  return {
    name,
    description: 'The djsk debug and diagnostic commands.',
    options: [
      { type: OPTION_TYPE.SUB_COMMAND, name: 'status', description: 'Shows a status summary.' },
      { type: OPTION_TYPE.SUB_COMMAND, name: 'help', description: 'Lists all commands.' },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'js',
        description: 'Evaluates JavaScript (opens a code input prompt).',
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'cjs',
        description: 'Evaluates JavaScript with `require` available (opens a code input prompt).',
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'mjs',
        description: 'Evaluates JavaScript as a real ES module (opens a code input prompt).',
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'sh',
        description: 'Executes a system shell command (opens a code input prompt).',
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'cat',
        description: 'Reads a file.',
        options: [
          {
            type: OPTION_TYPE.STRING,
            name: 'path',
            description: 'File path, optionally with #L10-20 for a line span.',
            required: true,
          },
        ],
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'curl',
        description: 'Downloads and displays a text resource.',
        options: [
          { type: OPTION_TYPE.STRING, name: 'url', description: 'URL to fetch.', required: true },
        ],
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'ping',
        description: 'Measures websocket latency and message round-trip time.',
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'shutdown',
        description: 'Logs the bot out and destroys the client.',
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'tasks',
        description: 'Lists the currently running djsk tasks.',
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'cancel',
        description: 'Cancels a task.',
        options: [
          {
            type: OPTION_TYPE.STRING,
            name: 'index',
            description: 'Task index. `-1` for the most recent, `~` for all.',
            required: true,
          },
        ],
      },
      {
        type: OPTION_TYPE.SUB_COMMAND,
        name: 'retain',
        description: 'Toggles REPL variable retention.',
        options: [
          {
            type: OPTION_TYPE.STRING,
            name: 'toggle',
            description: 'Omit to see the current status.',
            required: false,
            choices: [
              { name: 'on', value: 'on' },
              { name: 'off', value: 'off' },
            ],
          },
        ],
      },
    ],
  }
}

const MODAL_LABELS: Record<string, { title: string; label: string; placeholder: string }> = {
  js: {
    title: 'jsk js',
    label: 'JavaScript code',
    placeholder: 'Use `return` to produce a result.',
  },
  cjs: {
    title: 'jsk cjs',
    label: 'JavaScript code',
    placeholder: '`require` is available. Use `return` to produce a result.',
  },
  mjs: {
    title: 'jsk mjs',
    label: 'JavaScript code (ES module)',
    placeholder: '`import` is available. Use `export default` to produce a result.',
  },
  sh: {
    title: 'jsk sh',
    label: 'Shell command',
    placeholder: 'Executed in the system shell (PowerShell/cmd/$SHELL).',
  },
}

/** Builds the `customId` for a code-input modal belonging to `subcommand` (e.g. `js` -> `djsk:js`). */
export function modalCustomId(subcommand: string): string {
  return `${MODAL_ID_PREFIX}${subcommand}`
}

/** Extracts the subcommand name from a modal `customId`, or `null` if it isn't one of djsk's. */
export function subcommandFromModalId(customId: string): string | null {
  return customId.startsWith(MODAL_ID_PREFIX) ? customId.slice(MODAL_ID_PREFIX.length) : null
}

/** The `customId` of the code text input within a djsk code modal. */
export const CODE_FIELD_ID = 'code'

/**
 * Builds the raw modal payload for a code-input subcommand (`js`/`sh`).
 *
 * Plain data, not a `ModalBuilder`/`Modal` instance — accepted directly by
 * `interaction.showModal()` on both discord.js v13 and v14 (and the selfbot forks).
 */
export function buildCodeModal(subcommand: 'js' | 'cjs' | 'mjs' | 'sh') {
  const meta = MODAL_LABELS[subcommand]
  return {
    customId: modalCustomId(subcommand),
    title: meta.title,
    components: [
      {
        type: 1, // ACTION_ROW
        components: [
          {
            type: 4, // TEXT_INPUT
            customId: CODE_FIELD_ID,
            style: 2, // PARAGRAPH
            label: meta.label,
            placeholder: meta.placeholder,
            required: true,
          },
        ],
      },
    ],
  }
}
