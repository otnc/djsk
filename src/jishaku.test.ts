import { beforeEach, describe, expect, it, vi } from 'vitest'

const isPackageLatestMock = vi.fn()

vi.mock('is-package-latest', () => ({
  isPackageLatest: (...args: unknown[]) => isPackageLatestMock(...args),
}))

const { Jishaku } = await import('./jishaku')
const { DJSK_VERSION } = await import('./util/meta')

// biome-ignore lint/suspicious/noExplicitAny: minimal fake client for tests.
const fakeClient = { token: 't0ken-fake' } as any

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  isPackageLatestMock.mockReset()
})

describe('Jishaku — update check on construction', () => {
  it('logs a notice when a newer version is available and consoleLog is on', async () => {
    isPackageLatestMock.mockResolvedValueOnce({
      success: true,
      isLatest: false,
      latestVersion: '99.0.0',
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    new Jishaku(fakeClient, { consoleLog: true })
    await flush()

    expect(info).toHaveBeenCalledWith(expect.stringContaining('A new version is available'))
    expect(info).toHaveBeenCalledWith(expect.stringContaining('99.0.0'))
    info.mockRestore()
  })

  it('does not log a notice when already on the latest version', async () => {
    isPackageLatestMock.mockResolvedValueOnce({
      success: true,
      isLatest: true,
      latestVersion: DJSK_VERSION,
    })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    new Jishaku(fakeClient, { consoleLog: true })
    await flush()

    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('A new version is available'))
    info.mockRestore()
  })

  it('does not check for updates at all when consoleLog is off', async () => {
    new Jishaku(fakeClient, { consoleLog: false })
    await flush()

    expect(isPackageLatestMock).not.toHaveBeenCalled()
  })

  it('does not throw or log a notice when the check fails', async () => {
    isPackageLatestMock.mockRejectedValueOnce(new Error('offline'))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    expect(() => new Jishaku(fakeClient, { consoleLog: true })).not.toThrow()
    await flush()

    expect(info).not.toHaveBeenCalledWith(expect.stringContaining('A new version is available'))
    info.mockRestore()
  })
})
