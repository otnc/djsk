// Security mode example (discord.js v14).
//
// Shows the difference between `security: false` (default) and `security: true`.
// See the "Security mode" section in the README for exactly what each one covers.
import { Client, GatewayIntentBits } from 'discord.js'
import { Jishaku } from 'djsk'

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions, // Required for ⬅️/➡️ pagination on long output.
  ],
})

// --- security: false (default) ---------------------------------------------------------------
// Only the Discord token is ever redacted from djsk's own output. `jsk js`, `jsk cat`/`jsk curl`,
// and shell output otherwise show exactly what the code/file/command produced.
//
// const jsk = new Jishaku(client, { owners: ['957885295251034112'] })

// --- security: true ----------------------------------------------------------------------------
// In addition to the token, djsk best-effort redacts secret-like `process.env` values,
// `.env`-style assignments, and common credential formats (Discord tokens/webhooks, bearer
// tokens, PEM keys) from everything it sends, replies with, edits, or logs — including what
// `jsk js` user code sends directly (guarded for the duration of each eval).
const jsk = new Jishaku(client, {
  owners: ['957885295251034112'],
  security: true,
  // Provider-specific formats aren't built in (keeps false positives low) — add your own:
  secretPatterns: [/\bsk-live-[A-Za-z0-9]{10,}\b/g, /\bAKIA[0-9A-Z]{16}\b/g],
  // secretValues: ['some-specific-literal-to-always-redact'],
})

client.once('ready', (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`)
})

client.on('messageCreate', (message) => jsk.onMessageCreated(message))

client.login(process.env.DISCORD_TOKEN)
