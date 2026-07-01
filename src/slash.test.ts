import { describe, expect, it } from 'vitest'
import {
  buildCodeModal,
  CODE_FIELD_ID,
  CODE_SUBCOMMANDS,
  getSlashCommandData,
  modalCustomId,
  subcommandFromModalId,
} from './slash'

describe('getSlashCommandData', () => {
  it('uses the given name and includes every registered subcommand', () => {
    const data = getSlashCommandData('customname')
    expect(data.name).toBe('customname')

    const names = data.options.map((option) => option.name)
    expect(names).toEqual([
      'status',
      'help',
      'js',
      'sh',
      'cat',
      'curl',
      'ping',
      'shutdown',
      'tasks',
      'cancel',
      'retain',
    ])
  })

  it('defaults to the name "jsk"', () => {
    expect(getSlashCommandData().name).toBe('jsk')
  })

  it('marks cat/curl/cancel options as required and retain as optional', () => {
    const data = getSlashCommandData()
    const byName = Object.fromEntries(data.options.map((option) => [option.name, option]))

    expect(byName.cat.options?.[0].required).toBe(true)
    expect(byName.curl.options?.[0].required).toBe(true)
    expect(byName.cancel.options?.[0].required).toBe(true)
    expect(byName.retain.options?.[0].required).toBe(false)
  })

  it('gives js/sh no options, since they use a code-input modal instead', () => {
    const data = getSlashCommandData()
    const byName = Object.fromEntries(data.options.map((option) => [option.name, option]))

    expect(byName.js.options).toBeUndefined()
    expect(byName.sh.options).toBeUndefined()
  })
})

describe('modalCustomId / subcommandFromModalId', () => {
  it('round-trips a subcommand through its modal custom id', () => {
    expect(subcommandFromModalId(modalCustomId('js'))).toBe('js')
    expect(subcommandFromModalId(modalCustomId('sh'))).toBe('sh')
  })

  it('returns null for ids that are not djsk modals', () => {
    expect(subcommandFromModalId('some-other-modal')).toBeNull()
  })
})

describe('buildCodeModal', () => {
  it('builds a plain-object modal payload with a paragraph text input', () => {
    const modal = buildCodeModal('js')

    expect(modal.customId).toBe('djsk:js')
    expect(modal.components).toHaveLength(1)

    const actionRow = modal.components[0]
    expect(actionRow.type).toBe(1)
    expect(actionRow.components).toHaveLength(1)

    const input = actionRow.components[0]
    expect(input.type).toBe(4)
    expect(input.style).toBe(2)
    expect(input.customId).toBe(CODE_FIELD_ID)
    expect(input.required).toBe(true)
  })

  it('produces distinct titles/labels for js vs sh', () => {
    const js = buildCodeModal('js')
    const sh = buildCodeModal('sh')

    expect(js.title).not.toBe(sh.title)
    expect(js.components[0].components[0].label).not.toBe(sh.components[0].components[0].label)
  })
})

describe('CODE_SUBCOMMANDS', () => {
  it('contains exactly js and sh', () => {
    expect(CODE_SUBCOMMANDS.has('js')).toBe(true)
    expect(CODE_SUBCOMMANDS.has('sh')).toBe(true)
    expect(CODE_SUBCOMMANDS.has('cat')).toBe(false)
  })
})
