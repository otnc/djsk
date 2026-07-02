import type { Context } from '../context'

const PREV_EMOJI = '⬅️'
const NEXT_EMOJI = '➡️'
const COLLECTOR_TIMEOUT = 5 * 60_000

/**
 * Adds ⬅️/➡️ reaction pagination to `message`, letting `authorId` page through `pages`
 * (already-rendered page bodies, via `render`) by reacting. Each reaction is removed right
 * after being processed so the same arrow can be clicked again immediately instead of needing
 * to be un-reacted first.
 *
 * Silently does nothing beyond adding the two reactions if collecting them fails — most
 * commonly because the bot's client wasn't given the `GuildMessageReactions` (or equivalent,
 * e.g. `DirectMessageReactions` for DMs) gateway intent, so reaction events never arrive.
 *
 * `render(page, index, total)` builds the full message content for a given page — callers
 * control formatting (codeblock wrapping, page footer, etc.) so this utility stays
 * format-agnostic and is reused by both {@link Context.sendResult} and
 * {@link Context.sendCodeblock}.
 *
 * `startIndex` (default `0`) is which page `message` was already sent showing — `jsk sh`
 * passes the last page here, since it sends the tail (most recent output) up front and
 * pagination is for browsing backward into history.
 */
export async function paginate(
  ctx: Context,
  // biome-ignore lint/suspicious/noExplicitAny: cross-library Message duck typing.
  message: any,
  pages: string[],
  render: (page: string, index: number, total: number) => string,
  authorId: string,
  startIndex = 0,
): Promise<void> {
  if (pages.length <= 1) return

  try {
    await message.react(PREV_EMOJI)
    await message.react(NEXT_EMOJI)
  } catch {
    return
  }

  let index = startIndex
  const filter = (
    // biome-ignore lint/suspicious/noExplicitAny: cross-library duck typing.
    reaction: any,
    // biome-ignore lint/suspicious/noExplicitAny: cross-library duck typing.
    user: any,
  ): boolean =>
    !user.bot && user.id === authorId && [PREV_EMOJI, NEXT_EMOJI].includes(reaction.emoji.name)

  // biome-ignore lint/suspicious/noExplicitAny: cross-library duck typing (collector shape differs slightly across forks).
  let collector: any
  try {
    collector = message.createReactionCollector({ filter, time: COLLECTOR_TIMEOUT })
  } catch {
    return
  }

  // biome-ignore lint/suspicious/noExplicitAny: cross-library duck typing.
  collector.on('collect', async (reaction: any, user: any) => {
    index =
      reaction.emoji.name === PREV_EMOJI
        ? (index - 1 + pages.length) % pages.length
        : (index + 1) % pages.length

    try {
      await ctx.edit(message, {
        content: render(pages[index], index, pages.length),
        allowedMentions: { parse: [] },
      })
    } catch {
      // transient edit failure; state stays put, the next reaction will retry
    }

    try {
      await reaction.users.remove(user.id)
    } catch {
      // missing permission (e.g. DMs) — the user can un-react and re-react manually instead
    }
  })
}
