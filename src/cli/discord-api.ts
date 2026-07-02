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

/** Known-good floor for each discord.js major, used when the registry lookup below fails. */
const FALLBACK_DISCORD_JS_RANGE: Record<'v13' | 'v14', string> = {
  v14: '^14.0.0',
  v13: '^13.17.1',
}

/** Ascending numeric compare for plain `X.Y.Z` version strings (no prerelease tags). */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/**
 * Resolves the `discord.js` dependency range to write for `version` ('v13' or 'v14'), by
 * looking up the actual highest published version of that major on the npm registry — so
 * scaffolded projects get e.g. `^14.26.4` instead of a stale hardcoded floor like `^14.0.0`
 * (which, while functionally equivalent under semver, reads as pinned-to-old to anyone
 * looking at the generated `package.json`).
 *
 * Falls back to a known-good hardcoded range on any failure (network error, registry
 * shape change, ...), so scaffolding never hard-fails on this lookup.
 */
export async function resolveDiscordJsRange(version: 'v13' | 'v14'): Promise<string> {
  const major = version === 'v14' ? 14 : 13
  const fallback = FALLBACK_DISCORD_JS_RANGE[version]

  try {
    const response = await fetch('https://registry.npmjs.org/discord.js')
    if (!response.ok) return fallback

    const data = (await response.json()) as { versions?: Record<string, unknown> }
    const versions = Object.keys(data.versions ?? {}).filter(
      (v) => /^\d+\.\d+\.\d+$/.test(v) && v.startsWith(`${major}.`),
    )
    if (versions.length === 0) return fallback

    const latest = versions.sort(compareSemver).at(-1) as string
    return `^${latest}`
  } catch {
    return fallback
  }
}
