import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { detectPackageManager, runInstall } from './package-manager'
import {
  buildBotEntry,
  buildDeployCommands,
  buildEnv,
  buildGitignore,
  buildPackageJson,
  buildSelfbotEntry,
  buildTsconfig,
  deployCommandsFilePath,
  entryFilePath,
} from './templates'
import type { Answers } from './types'

/** Sanitizes a directory name into a valid npm package name. */
export function derivePackageName(directory: string): string {
  const name = basename(resolve(directory)) || 'djsk-bot'
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-_.]+/g, '-')
    .replace(/^[-_.]+/, '')
  return sanitized || 'djsk-bot'
}

/** Whether `directory` exists and already contains files. */
export async function isNonEmptyDirectory(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory)
    return entries.length > 0
  } catch {
    return false // doesn't exist (or isn't readable) — treated as empty
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

/**
 * Writes every scaffolded file for `answers` into its target directory, then runs the
 * detected package manager's install. Returns the list of files written, relative to the
 * project directory (used for the final summary).
 */
export async function scaffold(answers: Answers, djskVersion: string): Promise<string[]> {
  const dir = resolve(answers.directory)
  await mkdir(dir, { recursive: true })

  const written: string[] = []
  const write = async (relativePath: string, content: string) => {
    const target = join(dir, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf-8')
    written.push(relativePath)
  }

  await writeJson(join(dir, 'package.json'), buildPackageJson(answers, djskVersion))
  written.push('package.json')

  await write('.env', buildEnv(answers))
  await write('.gitignore', buildGitignore())

  if (answers.format === 'ts') {
    await writeJson(join(dir, 'tsconfig.json'), buildTsconfig())
    written.push('tsconfig.json')
  }

  const entryContent = answers.kind === 'bot' ? buildBotEntry(answers) : buildSelfbotEntry(answers)
  await write(entryFilePath(answers.format), entryContent)

  if (answers.kind === 'bot' && answers.commandMode !== 'text') {
    await write(deployCommandsFilePath(answers.format), buildDeployCommands())
  }

  const pm = detectPackageManager()
  await runInstall(pm, dir)

  return written
}
