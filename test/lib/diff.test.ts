import { describe, expect, test } from 'bun:test'
import { diffEnvConfigs, isDiffEmpty } from '@/lib/diff'
import type { EnvConfig } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    name: 'test-env',
    ...overrides,
  }
}

// ── isDiffEmpty ────────────────────────────────────────────────────────────────

describe('isDiffEmpty', () => {
  test('returns true for identical configs', () => {
    const a = makeConfig({ name: 'env-a' })
    const b = makeConfig({ name: 'env-b' })
    expect(isDiffEmpty(diffEnvConfigs(a, b))).toBe(true)
  })

  test('returns false when there are plugin changes', () => {
    const a = makeConfig({ plugins: { enable: [{ name: 'p1', source: 'github:x/y' }] } })
    const b = makeConfig()
    expect(isDiffEmpty(diffEnvConfigs(a, b))).toBe(false)
  })
})

// ── diffEnvConfigs: identical ──────────────────────────────────────────────────

describe('diffEnvConfigs — identical configs', () => {
  test('returns empty diff for identical configs', () => {
    const config: EnvConfig = {
      name: 'env',
      plugins: { enable: [{ name: 'p1', source: 'github:x/y', version: '1.0.0' }] },
      skills: [{ name: 'skill-a' }],
      mcp_servers: { myServer: { command: 'npx', args: ['server'] } },
      hooks: { PreToolUse: [{ command: 'echo hi' }] },
      settings: { effortLevel: 'high', permissions: { allow: ['read', 'write'] } },
    }

    const diff = diffEnvConfigs(config, { ...config, name: 'env-2' })

    expect(diff.plugins.added).toHaveLength(0)
    expect(diff.plugins.removed).toHaveLength(0)
    expect(diff.plugins.changed).toHaveLength(0)
    expect(diff.skills.added).toHaveLength(0)
    expect(diff.skills.removed).toHaveLength(0)
    expect(diff.mcpServers.added).toHaveLength(0)
    expect(diff.mcpServers.removed).toHaveLength(0)
    expect(diff.hooks.added).toHaveLength(0)
    expect(diff.hooks.removed).toHaveLength(0)
    expect(diff.settings).toHaveLength(0)
  })

  test('both configs empty → empty diff', () => {
    const diff = diffEnvConfigs(makeConfig(), makeConfig())
    expect(isDiffEmpty(diff)).toBe(true)
  })
})

// ── diffEnvConfigs: plugins ────────────────────────────────────────────────────

describe('diffEnvConfigs — plugins', () => {
  test('added plugin shows in added', () => {
    const a = makeConfig()
    const b = makeConfig({ plugins: { enable: [{ name: 'new-plugin', source: 'github:x/y' }] } })

    const diff = diffEnvConfigs(a, b)

    expect(diff.plugins.added).toEqual(['new-plugin'])
    expect(diff.plugins.removed).toHaveLength(0)
    expect(diff.plugins.changed).toHaveLength(0)
  })

  test('removed plugin shows in removed', () => {
    const a = makeConfig({ plugins: { enable: [{ name: 'old-plugin', source: 'github:x/y' }] } })
    const b = makeConfig()

    const diff = diffEnvConfigs(a, b)

    expect(diff.plugins.removed).toEqual(['old-plugin'])
    expect(diff.plugins.added).toHaveLength(0)
    expect(diff.plugins.changed).toHaveLength(0)
  })

  test('same plugin different version shows in changed', () => {
    const a = makeConfig({ plugins: { enable: [{ name: 'p1', source: 'github:x/y', version: '1.0.0' }] } })
    const b = makeConfig({ plugins: { enable: [{ name: 'p1', source: 'github:x/y', version: '2.0.0' }] } })

    const diff = diffEnvConfigs(a, b)

    expect(diff.plugins.changed).toHaveLength(1)
    expect(diff.plugins.changed[0]).toEqual({ name: 'p1', from: '1.0.0', to: '2.0.0' })
    expect(diff.plugins.added).toHaveLength(0)
    expect(diff.plugins.removed).toHaveLength(0)
  })

  test('plugin with undefined version vs defined version shows in changed', () => {
    const a = makeConfig({ plugins: { enable: [{ name: 'p1', source: 'github:x/y' }] } })
    const b = makeConfig({ plugins: { enable: [{ name: 'p1', source: 'github:x/y', version: '2.0.0' }] } })

    const diff = diffEnvConfigs(a, b)

    expect(diff.plugins.changed).toHaveLength(1)
    expect(diff.plugins.changed[0].from).toBe('latest')
    expect(diff.plugins.changed[0].to).toBe('2.0.0')
  })

  test('multiple plugins mixed — added, removed, changed', () => {
    const a = makeConfig({
      plugins: {
        enable: [
          { name: 'keep', source: 'github:x/y', version: '1.0.0' },
          { name: 'remove-me', source: 'github:x/y' },
          { name: 'change-me', source: 'github:x/y', version: '1.0.0' },
        ],
      },
    })
    const b = makeConfig({
      plugins: {
        enable: [
          { name: 'keep', source: 'github:x/y', version: '1.0.0' },
          { name: 'add-me', source: 'github:x/y' },
          { name: 'change-me', source: 'github:x/y', version: '2.0.0' },
        ],
      },
    })

    const diff = diffEnvConfigs(a, b)

    expect(diff.plugins.added).toEqual(['add-me'])
    expect(diff.plugins.removed).toEqual(['remove-me'])
    expect(diff.plugins.changed).toHaveLength(1)
    expect(diff.plugins.changed[0].name).toBe('change-me')
  })
})

// ── diffEnvConfigs: skills ─────────────────────────────────────────────────────

describe('diffEnvConfigs — skills', () => {
  test('added skill shows in added', () => {
    const a = makeConfig()
    const b = makeConfig({ skills: [{ name: 'new-skill' }] })

    const diff = diffEnvConfigs(a, b)

    expect(diff.skills.added).toEqual(['new-skill'])
    expect(diff.skills.removed).toHaveLength(0)
  })

  test('removed skill shows in removed', () => {
    const a = makeConfig({ skills: [{ name: 'old-skill' }] })
    const b = makeConfig()

    const diff = diffEnvConfigs(a, b)

    expect(diff.skills.removed).toEqual(['old-skill'])
    expect(diff.skills.added).toHaveLength(0)
  })

  test('path-based skill key', () => {
    const a = makeConfig({ skills: [{ path: '/some/path/skill' }] })
    const b = makeConfig()

    const diff = diffEnvConfigs(a, b)

    expect(diff.skills.removed).toEqual(['/some/path/skill'])
  })

  test('source-based skill key', () => {
    const a = makeConfig({ skills: [{ source: 'github:user/repo' }] })
    const b = makeConfig({ skills: [{ source: 'github:user/repo' }] })

    const diff = diffEnvConfigs(a, b)

    expect(diff.skills.removed).toHaveLength(0)
    expect(diff.skills.added).toHaveLength(0)
  })

  test('same skill in both → no changes', () => {
    const a = makeConfig({ skills: [{ name: 'skill-a' }] })
    const b = makeConfig({ skills: [{ name: 'skill-a' }] })

    const diff = diffEnvConfigs(a, b)

    expect(diff.skills.added).toHaveLength(0)
    expect(diff.skills.removed).toHaveLength(0)
  })
})

// ── diffEnvConfigs: mcp servers ────────────────────────────────────────────────

describe('diffEnvConfigs — mcp servers', () => {
  test('added MCP server shows in added', () => {
    const a = makeConfig()
    const b = makeConfig({ mcp_servers: { myServer: { command: 'npx', args: ['x'] } } })

    const diff = diffEnvConfigs(a, b)

    expect(diff.mcpServers.added).toEqual(['myServer'])
    expect(diff.mcpServers.removed).toHaveLength(0)
  })

  test('removed MCP server shows in removed', () => {
    const a = makeConfig({ mcp_servers: { oldServer: { command: 'node' } } })
    const b = makeConfig()

    const diff = diffEnvConfigs(a, b)

    expect(diff.mcpServers.removed).toEqual(['oldServer'])
    expect(diff.mcpServers.added).toHaveLength(0)
  })

  test('same MCP server key in both → no changes', () => {
    const servers = { server1: { command: 'npx' } }
    const a = makeConfig({ mcp_servers: servers })
    const b = makeConfig({ mcp_servers: servers })

    const diff = diffEnvConfigs(a, b)

    expect(diff.mcpServers.added).toHaveLength(0)
    expect(diff.mcpServers.removed).toHaveLength(0)
  })
})

// ── diffEnvConfigs: hooks ──────────────────────────────────────────────────────

describe('diffEnvConfigs — hooks', () => {
  test('added hook event type shows in added', () => {
    const a = makeConfig()
    const b = makeConfig({ hooks: { PreToolUse: [{ command: 'echo before' }] } })

    const diff = diffEnvConfigs(a, b)

    expect(diff.hooks.added).toEqual(['PreToolUse'])
    expect(diff.hooks.removed).toHaveLength(0)
  })

  test('removed hook event type shows in removed', () => {
    const a = makeConfig({ hooks: { PostToolUse: [{ command: 'echo after' }] } })
    const b = makeConfig()

    const diff = diffEnvConfigs(a, b)

    expect(diff.hooks.removed).toEqual(['PostToolUse'])
    expect(diff.hooks.added).toHaveLength(0)
  })

  test('same hook key in both → no changes', () => {
    const a = makeConfig({ hooks: { PreToolUse: [{ command: 'echo' }] } })
    const b = makeConfig({ hooks: { PreToolUse: [{ command: 'echo' }] } })

    const diff = diffEnvConfigs(a, b)

    expect(diff.hooks.added).toHaveLength(0)
    expect(diff.hooks.removed).toHaveLength(0)
  })
})

// ── diffEnvConfigs: settings ───────────────────────────────────────────────────

describe('diffEnvConfigs — settings', () => {
  test('different effortLevel shows in settings changes', () => {
    const a = makeConfig({ settings: { effortLevel: 'low' } })
    const b = makeConfig({ settings: { effortLevel: 'high' } })

    const diff = diffEnvConfigs(a, b)

    expect(diff.settings).toHaveLength(1)
    expect(diff.settings[0]).toEqual({ key: 'effortLevel', from: 'low', to: 'high' })
  })

  test('same effortLevel → no settings changes', () => {
    const a = makeConfig({ settings: { effortLevel: 'medium' } })
    const b = makeConfig({ settings: { effortLevel: 'medium' } })

    const diff = diffEnvConfigs(a, b)

    expect(diff.settings).toHaveLength(0)
  })

  test('different permissions.allow shows in settings changes', () => {
    const a = makeConfig({ settings: { permissions: { allow: ['read'] } } })
    const b = makeConfig({ settings: { permissions: { allow: ['read', 'write'] } } })

    const diff = diffEnvConfigs(a, b)

    const permsChange = diff.settings.find((s) => s.key === 'permissions.allow')
    expect(permsChange).toBeDefined()
    expect(permsChange?.from).toEqual(['read'])
    expect(permsChange?.to).toEqual(['read', 'write'])
  })

  test('undefined vs undefined effortLevel → no change', () => {
    const a = makeConfig()
    const b = makeConfig()

    const diff = diffEnvConfigs(a, b)

    expect(diff.settings).toHaveLength(0)
  })

  test('settings undefined vs defined → shows change', () => {
    const a = makeConfig()
    const b = makeConfig({ settings: { effortLevel: 'high' } })

    const diff = diffEnvConfigs(a, b)

    const effortChange = diff.settings.find((s) => s.key === 'effortLevel')
    expect(effortChange).toBeDefined()
    expect(effortChange?.from).toBeUndefined()
    expect(effortChange?.to).toBe('high')
  })
})
