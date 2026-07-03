/**
 * Best-effort secret redaction for security mode.
 *
 * Redacts three classes of secret from any text djsk is about to expose:
 *  1. Exact literals — the Discord token, secret-like `process.env` values, and any
 *     extra `secretValues` from config.
 *  2. `.env`-style assignments (`SECRET_KEY=...`) even when not loaded into the environment.
 *  3. A small set of high-confidence, provider-agnostic credential formats (Discord tokens
 *     & webhooks, bearer tokens, PEM private keys), plus any extra `secretPatterns` from config.
 *
 * Provider-specific keys (AWS, GitHub, Slack, ...) are intentionally NOT built in — add the
 * ones you use via the `secretPatterns` config option so the defaults stay low false-positive.
 *
 * This is heuristic and cannot guarantee every secret is caught, but it dramatically reduces
 * the chance of leaking one through `jsk js`, `jsk cat`/`jsk curl`, shell output or logs.
 */

const REDACTED = '[redacted]'

/** Keys whose `process.env` values are treated as secrets. */
const SECRET_KEY =
  /TOKEN|SECRET|KEY|PASS(?:WORD)?|PWD|PASSWD|AUTH|PRIVATE|WEBHOOK|CREDENTIAL|API|DSN/i

/** Minimum length for an env value to be redacted as a literal (avoids nuking trivial values). */
const MIN_SECRET_LENGTH = 6

/** Built-in credential formats. Kept deliberately small; extend via `secretPatterns`. */
const BUILTIN_PATTERNS: RegExp[] = [
  // Discord bot/user tokens (classic and mfa formats)
  /(?:mfa\.[\w-]{20,})|(?:[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,})/g,
  // Discord webhook URLs
  /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/gi,
  // Bearer / OAuth tokens
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  // PEM private key blocks
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
]

// `KEY=value` / `export KEY="value"` lines where the key looks like a secret.
const ENV_ASSIGNMENT =
  /^([ \t]*(?:export[ \t]+)?[A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASS(?:WORD)?|PWD|PASSWD|AUTH|PRIVATE|WEBHOOK|CREDENTIAL|API|DSN)[A-Za-z0-9_]*[ \t]*=[ \t]*)["']?[^"'\n\r]+["']?[ \t]*$/gim

export interface ScrubberOptions {
  /** Extra credential regexes to redact (e.g. provider-specific API key formats). */
  patterns?: RegExp[]
  /** Extra exact strings to always redact. */
  values?: string[]
}

export class SecretScrubber {
  private readonly patterns: RegExp[]
  private readonly extraValues: string[]

  constructor(
    // `unknown`, not `AnyClient`: `Jishaku`'s client is generic (see jishaku.ts) so any concrete
    // client type may flow in here — this is cast to `any` below regardless (duck-typed at runtime).
    private readonly client: unknown,
    options: ScrubberOptions = {},
  ) {
    this.patterns = [...BUILTIN_PATTERNS, ...(options.patterns ?? [])]
    this.extraValues = options.values ?? []
  }

  /** Gathers exact strings to redact (token + secret-like env values + config), longest first. */
  private literals(): string[] {
    const out: string[] = [...this.extraValues]

    // biome-ignore lint/suspicious/noExplicitAny: token location is stable across libraries.
    const token = (this.client as any)?.token
    // Real Discord tokens are long; guard against pathologically short values redacting everything.
    if (typeof token === 'string' && token.length >= 8) out.push(token)

    for (const [key, value] of Object.entries(process.env)) {
      if (value && value.length >= MIN_SECRET_LENGTH && SECRET_KEY.test(key)) out.push(value)
    }

    // Redact the longest literals first so overlapping values collapse cleanly.
    return out.filter(Boolean).sort((a, b) => b.length - a.length)
  }

  /** Returns `text` with all detected secrets replaced by a placeholder. */
  scrub(text: string): string {
    let out = text

    for (const literal of this.literals()) {
      out = out.split(literal).join(REDACTED)
    }

    out = out.replace(ENV_ASSIGNMENT, (_match, prefix: string) => `${prefix}${REDACTED}`)

    for (const pattern of this.patterns) {
      out = out.replace(pattern, REDACTED)
    }

    return out
  }
}

// --- Outbound payload guarding -------------------------------------------------------------
//
// djsk's own output funnels through Context and is always scrubbed. To also catch secrets in
// user code run via `jsk js` (e.g. `message.reply(client.token)` or `interaction.editReply(...)`),
// security mode hands the eval scope Proxy-wrapped objects whose response methods scrub first.

// biome-ignore lint/suspicious/noExplicitAny: message payloads differ across discord.js versions/forks.
export type MessagePayload = string | Record<string, any>

/** Response methods (message / channel / interaction / webhook) whose payload is scrubbed. */
const OUTBOUND_METHODS = new Set(['send', 'reply', 'edit', 'editReply', 'followUp', 'update'])

/** Reachable sub-objects that should themselves be guarded (e.g. `message.channel.send`). */
const WRAP_PROPS = new Set(['channel', 'author'])

/** Redacts the `content` and (optionally) text file attachments of a message payload. */
export function scrubMessagePayload(
  payload: MessagePayload,
  scrub: (text: string) => string,
  scrubFiles: boolean,
): MessagePayload {
  if (typeof payload === 'string') return scrub(payload)
  if (!payload || typeof payload !== 'object') return payload

  const out = { ...payload }
  if (typeof out.content === 'string') out.content = scrub(out.content)

  if (scrubFiles && Array.isArray(out.files)) {
    // biome-ignore lint/suspicious/noExplicitAny: file entries are duck-typed across libraries.
    out.files = out.files.map((file: any) => {
      const attachment = file?.attachment
      if (Buffer.isBuffer(attachment) || typeof attachment === 'string') {
        const text = Buffer.isBuffer(attachment) ? attachment.toString('utf-8') : attachment
        return { ...file, attachment: Buffer.from(scrub(text), 'utf-8') }
      }
      return file
    })
  }
  return out
}

/**
 * Wraps a Discord object so its response methods (`send`, `reply`, `edit`, `editReply`,
 * `followUp`, `update`) scrub their payload before sending. Reachable sub-objects
 * (`channel`, `author`) are guarded recursively. Non-method reads pass through unchanged,
 * and methods keep running against the original object, so behaviour is otherwise preserved.
 */
export function guardOutbound<T extends object>(target: T, scrub: (text: string) => string): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop)

      if (typeof prop === 'string' && typeof value === 'function' && OUTBOUND_METHODS.has(prop)) {
        // biome-ignore lint/suspicious/noExplicitAny: forwarding arbitrary call signatures.
        return (...args: any[]) => {
          if (args.length > 0) args[0] = scrubMessagePayload(args[0], scrub, true)
          return value.apply(obj, args)
        }
      }

      if (value && typeof value === 'object' && typeof prop === 'string' && WRAP_PROPS.has(prop)) {
        return guardOutbound(value, scrub)
      }

      return value
    },
  })
}
