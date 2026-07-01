import { describe, expect, it } from 'vitest'
import { detectPackageManager } from './package-manager'

describe('detectPackageManager', () => {
  it('detects pnpm from npm_config_user_agent', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'pnpm/9.1.0 npm/? node/v20.11.0' })).toBe(
      'pnpm',
    )
  })

  it('detects yarn and bun similarly', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'yarn/4.1.0 npm/? node/v20.11.0' })).toBe(
      'yarn',
    )
    expect(detectPackageManager({ npm_config_user_agent: 'bun/1.1.0 npm/? node/v20.11.0' })).toBe(
      'bun',
    )
  })

  it('detects npm explicitly', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'npm/10.5.0 node/v20.11.0' })).toBe('npm')
  })

  it('falls back to npm when the variable is unset', () => {
    expect(detectPackageManager({})).toBe('npm')
  })

  it('falls back to npm for an unrecognized package manager name', () => {
    expect(detectPackageManager({ npm_config_user_agent: 'deno/1.40.0' })).toBe('npm')
  })
})
