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

describe('Jishaku — process-wide error safety net', () => {
  // Jishaku registers real `process.on` listeners for the life of the process; every test here
  // captures and removes exactly the ones its own instance added, so no listener leaks into
  // later tests (or fires against an unrelated later `uncaughtException`/`unhandledRejection`).
  const captureProcessListeners = () => {
    const onSpy = vi.spyOn(process, 'on')
    return {
      onSpy,
      cleanup: () => {
        for (const [event, listener] of onSpy.mock.calls) {
          if (event === 'uncaughtException' || event === 'unhandledRejection') {
            process.removeListener(event, listener as (...args: unknown[]) => void)
          }
        }
        onSpy.mockRestore()
      },
    }
  }

  it('installs uncaughtException/unhandledRejection listeners by default', () => {
    const { onSpy, cleanup } = captureProcessListeners()

    new Jishaku(fakeClient, { consoleLog: false })

    expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function))
    expect(onSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function))
    cleanup()
  })

  it('does not install those listeners when catchProcessErrors is false', () => {
    const { onSpy, cleanup } = captureProcessListeners()

    new Jishaku(fakeClient, { consoleLog: false, catchProcessErrors: false })

    expect(onSpy).not.toHaveBeenCalledWith('uncaughtException', expect.any(Function))
    expect(onSpy).not.toHaveBeenCalledWith('unhandledRejection', expect.any(Function))
    cleanup()
  })

  it('logs an escaped error instead of letting it propagate', () => {
    const { onSpy, cleanup } = captureProcessListeners()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    new Jishaku(fakeClient, { consoleLog: true })
    const handler = onSpy.mock.calls.find((call) => call[0] === 'uncaughtException')?.[1] as (
      err: unknown,
    ) => void

    expect(() => handler(new Error('boom'))).not.toThrow()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Uncaught error'),
      expect.stringContaining('boom'),
    )

    error.mockRestore()
    cleanup()
  })

  it('does not log when consoleLog is off', () => {
    const { onSpy, cleanup } = captureProcessListeners()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    new Jishaku(fakeClient, { consoleLog: false })
    const handler = onSpy.mock.calls.find((call) => call[0] === 'uncaughtException')?.[1] as (
      err: unknown,
    ) => void
    handler(new Error('boom'))

    expect(error).not.toHaveBeenCalled()

    error.mockRestore()
    cleanup()
  })
})
