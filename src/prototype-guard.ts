import { scrubMessagePayload } from './security'

/**
 * Comprehensive outbound guarding for `jsk js` in security mode.
 *
 * The Proxy-based scope guard only covers the objects djsk hands to the eval scope. To also
 * catch secrets sent through objects reached any other way (e.g. `client.channels.cache.get(id)`,
 * webhooks, interactions, raw REST wrappers), this temporarily patches the response methods on
 * the installed library's exported classes for the duration of a single eval, then restores them.
 *
 * This mutates shared prototypes, so while an eval runs, other messages the bot happens to send
 * are scrubbed too. That window is limited to the eval's execution and only happens in security
 * mode, which deliberately favours over-redaction.
 */

// biome-ignore lint/suspicious/noExplicitAny: patches duck-typed library internals.
type Any = any

const OUTBOUND_METHODS = ['send', 'reply', 'edit', 'editReply', 'followUp', 'update']

// Classes whose `send`/`edit` are NOT message content (gateway/IPC/shard control). Never patch.
const DENY_CLASSES = new Set(['Shard', 'ShardClientUtil', 'WebSocketShard', 'WebSocketManager'])

// Marks a wrapped method so nested/concurrent evals don't double-wrap or wrongly restore.
const GUARD_TAG = Symbol.for('djsk.guarded')

interface Patched {
  proto: Any
  method: string
  original: Any
}

/** Collects the library's exported class constructors from both named and default exports. */
function collectClasses(module: Record<string, unknown>): Set<Any> {
  const classes = new Set<Any>()
  const sources: Any[] = [module, (module as Any).default].filter(Boolean)
  for (const source of sources) {
    for (const value of Object.values(source)) {
      if (typeof value === 'function' && (value as Any).prototype) classes.add(value)
    }
  }
  return classes
}

/** Finds the prototype in `start`'s chain that owns `method`, or null. */
function findOwningPrototype(start: Any, method: string): Any {
  let proto = start
  while (proto && proto !== Object.prototype) {
    if (Object.hasOwn(proto, method)) return proto
    proto = Object.getPrototypeOf(proto)
  }
  return null
}

/**
 * Patches outbound response methods on the library's classes to scrub payloads.
 * Returns a function that restores the originals; always call it in a `finally`.
 */
export function installPrototypeGuards(
  module: Record<string, unknown>,
  scrub: (text: string) => string,
): () => void {
  const patched: Patched[] = []

  for (const cls of collectClasses(module)) {
    const name = (cls.name as string) || ''
    if (DENY_CLASSES.has(name) || name.endsWith('Manager')) continue

    for (const method of OUTBOUND_METHODS) {
      const proto = findOwningPrototype(cls.prototype, method)
      if (!proto) continue

      const ownerName = (proto.constructor?.name as string) || ''
      if (DENY_CLASSES.has(ownerName) || ownerName.endsWith('Manager')) continue

      const descriptor = Object.getOwnPropertyDescriptor(proto, method)
      if (!descriptor || typeof descriptor.value !== 'function' || !descriptor.writable) continue

      const original = descriptor.value
      if (original[GUARD_TAG]) continue // already guarded by an outer eval

      const wrapper = function (this: unknown, ...args: Any[]) {
        if (args.length > 0) args[0] = scrubMessagePayload(args[0], scrub, true)
        return original.apply(this, args)
      }
      wrapper[GUARD_TAG] = true

      try {
        proto[method] = wrapper
        patched.push({ proto, method, original })
      } catch {
        // Non-writable in this runtime; skip.
      }
    }
  }

  return () => {
    for (const { proto, method, original } of patched) {
      try {
        proto[method] = original
      } catch {
        // ignore
      }
    }
  }
}

/** `body` fields on a raw REST request that may carry user-visible text needing redaction. */
const REST_BODY_TEXT_FIELDS = ['content']

/**
 * Patches the library's `REST` class (discord.js v14+ only — v13 and the v13-based selfbot
 * forks route requests through an older `client.api` chainable builder with no equivalent
 * single choke point, so this is a no-op there) so a request's `body.content` is scrubbed
 * before being sent, for the duration of a single eval.
 *
 * `.get`/`.post`/`.put`/`.patch`/`.delete` all funnel through `REST.prototype.request`
 * internally (confirmed by inspecting discord.js v14's implementation), so patching just that
 * one method covers all of them. This narrows, but doesn't close, the gap `installPrototypeGuards`
 * already documents: a hand-built `fetch()` call using the raw token never touches this class
 * (or the library) at all, so it still isn't — and can't be — covered.
 *
 * Returns `null` (nothing to restore) if the library has no `REST` export, matching
 * {@link installPrototypeGuards}'s "best-effort" contract.
 */
export function installRestGuard(
  module: Record<string, unknown>,
  scrub: (text: string) => string,
): (() => void) | null {
  const RestClass = (module.REST ?? (module as Any).default?.REST) as Any
  if (typeof RestClass !== 'function' || !RestClass.prototype) return null

  const proto = RestClass.prototype
  const original = proto.request
  if (typeof original !== 'function' || original[GUARD_TAG]) return null

  const wrapper = function (this: unknown, options: Any, ...rest: Any[]) {
    if (
      options &&
      typeof options === 'object' &&
      options.body &&
      typeof options.body === 'object'
    ) {
      const body = { ...options.body }
      for (const field of REST_BODY_TEXT_FIELDS) {
        if (typeof body[field] === 'string') body[field] = scrub(body[field])
      }
      options = { ...options, body }
    }
    return original.call(this, options, ...rest)
  }
  wrapper[GUARD_TAG] = true

  try {
    proto.request = wrapper
  } catch {
    return null // non-writable in this runtime
  }

  return () => {
    try {
      proto.request = original
    } catch {
      // ignore
    }
  }
}
