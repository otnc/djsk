import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Encoding, ShellOverride } from '../types'
import { stripAnsi } from './format'

const WINDOWS = process.platform === 'win32'
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

const ZWSP = '​'

function toDecoderLabel(encoding: Encoding): string {
  const normalized = encoding.toLowerCase().replace(/[_\s]/g, '-')
  if (normalized === 'shift-jis' || normalized === 'sjis' || normalized === 'shiftjis')
    return 'shift-jis'
  return 'utf-8'
}

/**
 * PowerShell writes its own console output (including localized error records) using
 * `[Console]::OutputEncoding`, which defaults to the system's legacy OEM/ANSI codepage —
 * not UTF-8 — on non-English Windows. Left alone, that mismatches the `TextDecoder(label)`
 * used to read the piped output back in Node, producing mojibake. Prepending this forces
 * PowerShell's output encoding to match whatever `label` we're about to decode with.
 */
function powershellEncodingPrelude(label: string): string {
  const encodingExpr =
    label === 'shift-jis'
      ? '[System.Text.Encoding]::GetEncoding(932)'
      : '[System.Text.Encoding]::UTF8'
  return `[Console]::OutputEncoding = ${encodingExpr}; `
}

/** The `chcp` codepage matching `label`, for the `cmd.exe` fallback shell. */
function cmdCodepage(label: string): number {
  return label === 'shift-jis' ? 932 : 65001
}

function cleanLine(line: string): string {
  return stripAnsi(line).replace('\r', '').replaceAll('```', `\`\`${ZWSP}\``)
}

export interface ShellReaderOptions {
  encoding: Encoding
  /** Inactivity timeout in ms; the process is killed if no output arrives for this long. */
  timeout: number
  /** Called for each decoded, cleaned output line. */
  onLine: (line: string) => void
  /** Overrides which shell to spawn, bypassing platform auto-detection entirely. */
  shell?: ShellOverride | null
}

/**
 * Spawns the system shell for `code` and streams its output line by line.
 *
 * Windows uses PowerShell (falling back to cmd); other platforms use `$SHELL -c`. This
 * auto-detection is skipped entirely when `options.shell` is set — the encoding workarounds
 * below are specific to Windows PowerShell/cmd's legacy codepage behavior, which a custom
 * shell (e.g. `pwsh`, `zsh`, `fish`) generally won't need.
 *
 * Output is decoded with the configured encoding (UTF-8 or Shift_JIS) using a
 * streaming decoder so multibyte characters split across chunks are handled correctly.
 *
 * Mirrors the shell selection in jishaku's `jishaku.shell.ShellReader`.
 */
export class ShellReader {
  readonly ps1: string
  readonly highlight: string
  /** Resolves with the process exit code once it closes. */
  readonly done: Promise<number>

  private readonly process: ChildProcessWithoutNullStreams
  private inactivityTimer: NodeJS.Timeout | undefined
  private killed = false

  constructor(code: string, options: ShellReaderOptions) {
    let command: string
    let args: string[]

    const label = toDecoderLabel(options.encoding)

    if (options.shell) {
      command = options.shell.command
      args = [...(options.shell.args ?? []), code]
      this.ps1 = options.shell.ps1 ?? '$'
      this.highlight = options.shell.highlight ?? 'ansi'
    } else if (WINDOWS) {
      if (existsSync(POWERSHELL)) {
        command = 'powershell'
        args = [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          powershellEncodingPrelude(label) + code,
        ]
        this.ps1 = 'PS >'
        this.highlight = 'powershell'
      } else {
        command = 'cmd'
        args = ['/c', `chcp ${cmdCodepage(label)} >nul && ${code}`]
        this.ps1 = 'cmd >'
        this.highlight = 'cmd'
      }
    } else {
      command = process.env.SHELL || '/bin/bash'
      args = ['-c', code]
      this.ps1 = '$'
      this.highlight = 'ansi'
    }

    this.process = spawn(command, args, { windowsHide: true })

    this.attachStream(this.process.stdout, label, options, '')
    this.attachStream(this.process.stderr, label, options, '[stderr] ')

    this.resetTimer(options)

    this.done = new Promise<number>((resolve) => {
      this.process.on('close', (exitCode) => {
        if (this.inactivityTimer) clearTimeout(this.inactivityTimer)
        resolve(exitCode ?? -1)
      })
      this.process.on('error', () => {
        if (this.inactivityTimer) clearTimeout(this.inactivityTimer)
        resolve(-1)
      })
    })
  }

  /** Terminates the shell process. */
  kill(): void {
    if (this.killed) return
    this.killed = true
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer)
    try {
      this.process.kill()
    } catch {
      // already dead
    }
  }

  private resetTimer(options: ShellReaderOptions): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer)
    this.inactivityTimer = setTimeout(() => {
      options.onLine(`[status] Timed out after ${options.timeout}ms of inactivity.`)
      this.kill()
    }, options.timeout)
  }

  private attachStream(
    stream: NodeJS.ReadableStream,
    label: string,
    options: ShellReaderOptions,
    prefix: string,
  ): void {
    const decoder = new TextDecoder(label)
    let buffer = ''

    const emit = (text: string) => {
      buffer += text
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        options.onLine(prefix + cleanLine(line))
        this.resetTimer(options)
        newline = buffer.indexOf('\n')
      }
    }

    stream.on('data', (chunk: Buffer) => emit(decoder.decode(chunk, { stream: true })))
    stream.on('end', () => {
      emit(decoder.decode())
      if (buffer.length > 0) {
        options.onLine(prefix + cleanLine(buffer))
        buffer = ''
      }
    })
  }
}
