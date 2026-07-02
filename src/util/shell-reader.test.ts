import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

function makeFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => void
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  return proc
}

const { ShellReader } = await import('./shell-reader')

describe('ShellReader — shell override', () => {
  it('spawns the overridden command/args instead of platform auto-detection', () => {
    spawnMock.mockReturnValue(makeFakeProcess())

    const reader = new ShellReader('echo hi', {
      encoding: 'UTF-8',
      timeout: 5000,
      onLine: () => {},
      shell: { command: 'pwsh', args: ['-NoProfile', '-Command'] },
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'pwsh',
      ['-NoProfile', '-Command', 'echo hi'],
      expect.anything(),
    )
    expect(reader.ps1).toBe('$')
    expect(reader.highlight).toBe('ansi')
  })

  it('uses the override ps1/highlight when given', () => {
    spawnMock.mockReturnValue(makeFakeProcess())

    const reader = new ShellReader('ls', {
      encoding: 'UTF-8',
      timeout: 5000,
      onLine: () => {},
      shell: { command: 'zsh', args: ['-c'], ps1: 'zsh %', highlight: 'zsh' },
    })

    expect(reader.ps1).toBe('zsh %')
    expect(reader.highlight).toBe('zsh')
  })

  it('appends the code as the final argument after any override args', () => {
    spawnMock.mockReturnValue(makeFakeProcess())

    new ShellReader('pwd', {
      encoding: 'UTF-8',
      timeout: 5000,
      onLine: () => {},
      shell: { command: 'bash' },
    })

    expect(spawnMock).toHaveBeenCalledWith('bash', ['pwd'], expect.anything())
  })
})
