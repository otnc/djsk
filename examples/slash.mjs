// Slash command (interaction-based) example (discord.js v14, bot only — not for selfbots).
//
// `/jsk js` and `/jsk sh` open a code-input modal instead of taking a string option
// (Discord's slash command input box isn't great for pasting/writing multi-line code).
// All other subcommands (cat, curl, ping, shutdown, tasks, cancel, retain, status, help)
// take normal options and reuse the exact same command handlers as `.jsk <subcommand>`.
import { Client, GatewayIntentBits } from 'discord.js'
import { getSlashCommandData, Jishaku } from 'djsk'

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
})

const jsk = new Jishaku(client, {
  owners: ['957885295251034112'], // Optional; defaults to the application owner/team.
  slashCommandName: 'jsk', // Must match the name used when registering below. Default: 'jsk'.
})

client.once('ready', async (readyClient) => {
  // Register the /jsk command. Do this once (e.g. behind a one-off script or a flag) rather
  // than on every boot — registering on every `ready` works but is unnecessary API traffic.
  await readyClient.application.commands.set([getSlashCommandData(jsk.config.slashCommandName)])

  console.log(`Ready! Logged in as ${readyClient.user.tag}`)
})

client.on('interactionCreate', (interaction) => jsk.onInteractionCreate(interaction))

client.login(process.env.DISCORD_TOKEN)
