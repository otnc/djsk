// Discord.js v14 bot example.
//
// Requires the Message Content intent to be enabled for the bot,
// both in the Developer Portal and in the intents below.
import { Client, GatewayIntentBits } from 'discord.js'
import { Jishaku } from 'djsk'

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

const jsk = new Jishaku(client, {
  prefix: '.', // The root command becomes `.jsk`. Default: '.'
  // owners: ['957885295251034112'], // Optional; defaults to the application owner/team.
  encoding: 'UTF-8', // Use 'Shift_JIS' for Japanese Windows shell output.
  // security: true, // Redact secrets (token, .env values, credentials) from all output.
})

client.once('ready', (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`)
})

client.on('messageCreate', (message) => jsk.onMessageCreated(message))

client.login(process.env.DISCORD_TOKEN)
