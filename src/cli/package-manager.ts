import { spawn } from 'node:child_process'

/** A package manager djsk's CLI knows how to drive. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

const KNOWN: readonly PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun']

/**
 * Detects which package manager invoked this CLI, via the `npm_config_user_agent`
 * environment variable that npm/pnpm/yarn/bun all set (e.g. `pnpm/9.1.0 npm/? node/v20 ...`).
 * Falls back to `npm` when it can't be determined.
 */
export function detectPackageManager(env: NodeJS.ProcessEnv = process.env): PackageManager {
  const userAgent = env.npm_config_user_agent
  if (!userAgent) return 'npm'

  const name = userAgent.split('/')[0]?.trim().toLowerCase()
  return (KNOWN as readonly string[]).includes(name) ? (name as PackageManager) : 'npm'
}

/** The install command line for `pm`, run with the working directory set to the project root. */
function installCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm install'
    case 'yarn':
      return 'yarn install'
    case 'bun':
      return 'bun install'
    default:
      return 'npm install'
  }
}

/**
 * Runs `pm`'s install command in `cwd`, streaming its output directly to this process's
 * stdio. Resolves with the exit code (0 on success).
 */
export function runInstall(pm: PackageManager, cwd: string): Promise<number> {
  return new Promise((resolve) => {
    // npm/yarn/pnpm/bun are batch files (.cmd) on Windows; shell:true resolves them correctly.
    // The command line is a fixed constant (never built from user input), so it's passed as a
    // single string rather than a separate `args` array — passing `args` alongside
    // `shell: true` is deprecated (DEP0190) since Node only concatenates them unescaped.
    const child = spawn(installCommand(pm), { cwd, stdio: 'inherit', shell: true })
    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}
