// Selfbot example using discord.js-selfbot-v13.
//
// WARNING: Automating a user account is against the Discord Terms of Service and
// can get the account terminated. Use at your own risk. djsk provides no warranty.
import { Client } from 'discord.js-selfbot-v13'
import { Jishaku } from 'djsk'

const client = new Client()

// Selfbots have no application owner, so djsk defaults to the logged-in user.
// You can still restrict access explicitly with `owners`.
const jsk = new Jishaku(client, {
  prefix: '.',
  // owners: ['957885295251034112'],
  encoding: 'UTF-8',
})

client.on('ready', () => {
  console.log(`Ready! Logged in as ${client.user?.tag}`)
})

client.on('messageCreate', (message) => jsk.onMessageCreated(message))

client.login(process.env.SELFBOT_TOKEN)
