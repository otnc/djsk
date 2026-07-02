import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDiscordJsRange } from './discord-api'

function mockRegistryResponse(versions: string[]): void {
  const body = { versions: Object.fromEntries(versions.map((v) => [v, {}])) }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response),
  )
}

describe('resolveDiscordJsRange', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves to the highest published v14.x.x version', async () => {
    mockRegistryResponse(['13.17.1', '14.0.0', '14.7.1', '14.16.3', '14.9.0', '15.0.0-dev.1'])
    expect(await resolveDiscordJsRange('v14')).toBe('^14.16.3')
  })

  it('resolves to the highest published v13.x.x version', async () => {
    mockRegistryResponse(['13.0.0', '13.17.1', '13.6.0', '14.0.0'])
    expect(await resolveDiscordJsRange('v13')).toBe('^13.17.1')
  })

  it('falls back to the known-good range when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }) as unknown as Response),
    )
    expect(await resolveDiscordJsRange('v14')).toBe('^14.0.0')
  })

  it('falls back to the known-good range when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network error')
      }),
    )
    expect(await resolveDiscordJsRange('v13')).toBe('^13.17.1')
  })

  it('falls back when no version matches the requested major', async () => {
    mockRegistryResponse(['13.17.1'])
    expect(await resolveDiscordJsRange('v14')).toBe('^14.0.0')
  })
})
