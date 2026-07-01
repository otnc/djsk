/**
 * Fetches the bot's application (client) ID from its token, using Discord's REST API directly
 * (no discord.js dependency needed for this one-off lookup during scaffolding).
 *
 * Returns `null` on any failure (bad token, network error, ...) — the caller treats that as
 * "skip and note it in the Next Steps summary" rather than failing the whole scaffold.
 */
export async function fetchApplicationId(token: string): Promise<string | null> {
  try {
    const response = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${token}` },
    })
    if (!response.ok) return null

    const data = (await response.json()) as { id?: string }
    return data.id ?? null
  } catch {
    return null
  }
}
