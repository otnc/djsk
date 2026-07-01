import pkg from '../../package.json'

/** The current djsk version, read from package.json at build time. */
export const DJSK_VERSION: string = pkg.version

/** Package names of the supported discord.js-compatible libraries, in detection order. */
const LIBRARY_CANDIDATES = [
  'discord.js',
  'discord.js-selfbot-v13',
  'discord.js-selfbot-youtsuho-v13',
] as const

export interface LibraryInfo {
  name: string
  version: string
}

/**
 * Best-effort detection of which discord.js-compatible library is installed.
 *
 * The module is almost certainly already loaded by the host bot, so the dynamic
 * import resolves from cache. Returns `null` if none can be resolved.
 */
export async function detectLibrary(): Promise<LibraryInfo | null> {
  for (const name of LIBRARY_CANDIDATES) {
    try {
      const mod = (await import(name)) as { version?: string; default?: { version?: string } }
      const version = mod.version ?? mod.default?.version
      if (version) return { name, version }
    } catch {
      // Not installed; try the next candidate.
    }
  }
  return null
}

/**
 * Loads the installed discord.js-compatible library's module namespace.
 *
 * Used by security mode to reach the library's exported classes for prototype guarding.
 * Returns `null` if none can be resolved.
 */
export async function loadLibraryModule(): Promise<Record<string, unknown> | null> {
  for (const name of LIBRARY_CANDIDATES) {
    try {
      const mod = (await import(name)) as Record<string, unknown> & { version?: string }
      if (mod.version ?? (mod.default as { version?: string } | undefined)?.version) return mod
    } catch {
      // Not installed; try the next candidate.
    }
  }
  return null
}
