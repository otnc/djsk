import type { AnyClient } from './types'

/**
 * Resolves and checks which users are allowed to use djsk.
 *
 * Resolution order:
 *  1. Explicit `configOwners` (highest priority).
 *  2. The application's owner or team members (fetched lazily, cached).
 *  3. For selfbots (user accounts), the logged-in user itself.
 */
export class OwnerResolver {
  private readonly explicit: Set<string> | null
  private resolved: Set<string> | null = null
  private resolving: Promise<Set<string>> | null = null

  constructor(
    private readonly client: AnyClient,
    configOwners: string[] | null,
  ) {
    this.explicit = configOwners && configOwners.length > 0 ? new Set(configOwners) : null
  }

  /** Returns whether `userId` is permitted to use djsk. */
  async isOwner(userId: string): Promise<boolean> {
    if (this.explicit) return this.explicit.has(userId)
    const owners = await this.resolve()
    return owners.has(userId)
  }

  /** Resolves the owner set from the application info (or the selfbot user), cached after first call. */
  private resolve(): Promise<Set<string>> {
    if (this.resolved) return Promise.resolve(this.resolved)
    this.resolving ??= this.doResolve().then((set) => {
      this.resolved = set
      this.resolving = null
      return set
    })
    return this.resolving
  }

  private async doResolve(): Promise<Set<string>> {
    const owners = new Set<string>()
    // biome-ignore lint/suspicious/noExplicitAny: cross-library duck typing (v13/v14/selfbot forks differ).
    const client = this.client as any

    try {
      const application = client.application
      const info = application?.owner ? application : await application?.fetch?.()
      const owner = info?.owner

      if (owner) {
        // A Team has a `members` collection; a User has an `id`.
        if (owner.members && typeof owner.members.forEach === 'function') {
          for (const member of owner.members.values()) {
            const id = member?.user?.id ?? member?.id
            if (id) owners.add(String(id))
          }
        } else if (owner.id) {
          owners.add(String(owner.id))
        }
      }
    } catch {
      // application_info may be unavailable (e.g. selfbots); fall through.
    }

    // Selfbot fallback: allow the logged-in user itself.
    if (owners.size === 0 && client.user?.id) {
      owners.add(String(client.user.id))
    }

    return owners
  }
}
