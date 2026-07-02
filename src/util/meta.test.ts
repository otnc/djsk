import { describe, expect, it, vi } from 'vitest'

const isPackageLatestMock = vi.fn()

vi.mock('is-package-latest', () => ({
  isPackageLatest: (...args: unknown[]) => isPackageLatestMock(...args),
}))

const { checkForUpdate, DJSK_VERSION } = await import('./meta')

describe('checkForUpdate', () => {
  it('checks the real package name and the current DJSK_VERSION', async () => {
    isPackageLatestMock.mockResolvedValueOnce({
      success: true,
      name: 'djsk',
      isLatest: true,
      currentVersion: DJSK_VERSION,
      latestVersion: DJSK_VERSION,
      error: null,
    })

    await checkForUpdate()

    expect(isPackageLatestMock).toHaveBeenCalledWith({ name: 'djsk', version: DJSK_VERSION })
  })

  it('reports isLatest: false with the newer version when outdated', async () => {
    isPackageLatestMock.mockResolvedValueOnce({
      success: true,
      name: 'djsk',
      isLatest: false,
      currentVersion: DJSK_VERSION,
      latestVersion: '99.0.0',
      error: null,
    })

    const result = await checkForUpdate()

    expect(result).toEqual({ isLatest: false, latestVersion: '99.0.0' })
  })

  it('returns null when the check reports failure (offline, registry error, ...)', async () => {
    isPackageLatestMock.mockResolvedValueOnce({
      success: false,
      name: 'djsk',
      isLatest: null,
      currentVersion: DJSK_VERSION,
      latestVersion: null,
      error: 'network error',
    })

    const result = await checkForUpdate()

    expect(result).toBeNull()
  })

  it('returns null instead of throwing if the check itself rejects', async () => {
    isPackageLatestMock.mockRejectedValueOnce(new Error('boom'))

    const result = await checkForUpdate()

    expect(result).toBeNull()
  })
})
