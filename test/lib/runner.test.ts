import { describe, test, expect } from 'bun:test'
import { assembleClaudeArgs } from '../../src/lib/runner'
import type { EnvConfig, SessionFiles } from '../../src/types'

function makeSession(overrides?: Partial<SessionFiles>): SessionFiles {
  return {
    dir: '/tmp/cenv-sessions/test-1234',
    settingsPath: '/tmp/cenv-sessions/test-1234/settings.json',
    mcpConfigPath: '/tmp/cenv-sessions/test-1234/mcp.json',
    claudeMdPath: '/home/user/.claude-envs/envs/test/claude.md',
    pluginDirs: [],
    ...overrides,
  }
}

describe('assembleClaudeArgs', () => {
  test('produces minimal args for additive mode', () => {
    const config: EnvConfig = { name: 'test' }
    const session = makeSession()

    const args = assembleClaudeArgs(session, config)

    expect(args).toContain('--settings')
    expect(args).toContain(session.settingsPath)
    expect(args).toContain('--mcp-config')
    expect(args).toContain(session.mcpConfigPath)
    expect(args).toContain('--append-system-prompt-file')
    expect(args).toContain(session.claudeMdPath)
    expect(args).not.toContain('--bare')
    expect(args).not.toContain('--strict-mcp-config')
  })

  test('adds --bare and --strict-mcp-config in bare mode', () => {
    const config: EnvConfig = { name: 'test', isolation: 'bare' }
    const session = makeSession()

    const args = assembleClaudeArgs(session, config)

    expect(args).toContain('--bare')
    expect(args).toContain('--strict-mcp-config')
  })

  test('adds --plugin-dir for each plugin directory', () => {
    const config: EnvConfig = { name: 'test' }
    const session = makeSession({
      pluginDirs: ['/path/to/superpowers', '/path/to/pyright-lsp'],
    })

    const args = assembleClaudeArgs(session, config)

    const pluginDirIndices = args
      .map((a, i) => a === '--plugin-dir' ? i : -1)
      .filter(i => i !== -1)

    expect(pluginDirIndices).toHaveLength(2)
    expect(args[pluginDirIndices[0] + 1]).toBe('/path/to/superpowers')
    expect(args[pluginDirIndices[1] + 1]).toBe('/path/to/pyright-lsp')
  })

  test('appends pass-through args', () => {
    const config: EnvConfig = { name: 'test' }
    const session = makeSession()

    const args = assembleClaudeArgs(session, config, ['-p', 'fix the bug'])

    expect(args[args.length - 2]).toBe('-p')
    expect(args[args.length - 1]).toBe('fix the bug')
  })

  test('correct flag ordering: settings before plugins before mcp before prompt', () => {
    const config: EnvConfig = { name: 'test', isolation: 'bare' }
    const session = makeSession({ pluginDirs: ['/path/to/plugin'] })

    const args = assembleClaudeArgs(session, config)

    const settingsIdx = args.indexOf('--settings')
    const pluginIdx = args.indexOf('--plugin-dir')
    const mcpIdx = args.indexOf('--mcp-config')
    const promptIdx = args.indexOf('--append-system-prompt-file')

    expect(settingsIdx).toBeLessThan(pluginIdx)
    expect(pluginIdx).toBeLessThan(mcpIdx)
    expect(mcpIdx).toBeLessThan(promptIdx)
  })
})
