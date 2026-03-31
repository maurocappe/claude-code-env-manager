import { describe, test, expect, afterEach, mock, spyOn } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildFakeHome } from '@/lib/fake-home'
import type { EnvConfig } from '@/types'
import * as keychainModule from '@/lib/keychain'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a temp env dir with env.yaml and claude.md, returns envDir and cleanup.
 */
function createTempEnvDir(name: string): { envDir: string; cleanup: () => void } {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), `cenv-fh-test-${name}-`))
  fs.writeFileSync(
    path.join(envDir, 'env.yaml'),
    `name: ${name}\n`,
    'utf8',
  )
  fs.writeFileSync(
    path.join(envDir, 'claude.md'),
    `# Claude instructions for ${name}\n`,
    'utf8',
  )
  return {
    envDir,
    cleanup() {
      fs.rmSync(envDir, { recursive: true, force: true })
    },
  }
}

/**
 * Creates a temp dir simulating a real HOME with .claude/ structure,
 * plugins, skills, projects, commands, and dotfiles.
 */
function createFakeRealHome(): { realHome: string; cleanup: () => void } {
  const realHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-fh-real-home-'))
  const claudeHome = path.join(realHome, '.claude')

  // installed_plugins.json with 3 test plugins
  const pluginsDir = path.join(claudeHome, 'plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })
  const pluginRegistry = {
    version: 2,
    plugins: {
      'alpha@source-a': [
        { scope: 'user', installPath: '/fake/alpha', version: '1.0.0', installedAt: '2025-01-01' },
      ],
      'beta@source-b': [
        { scope: 'user', installPath: '/fake/beta-user', version: '2.0.0', installedAt: '2025-01-02' },
        { scope: 'local', installPath: '/fake/beta-local', version: '2.0.0', installedAt: '2025-01-02', projectPath: '/some/project' },
      ],
      'gamma@source-c': [
        { scope: 'user', installPath: '/fake/gamma', version: '3.0.0', installedAt: '2025-01-03' },
      ],
    },
  }
  fs.writeFileSync(
    path.join(pluginsDir, 'installed_plugins.json'),
    JSON.stringify(pluginRegistry, null, 2),
    'utf8',
  )

  // Plugin cache directory
  const cacheDir = path.join(pluginsDir, 'cache', 'source-a', 'alpha', '1.0.0')
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(path.join(cacheDir, 'plugin.json'), '{}', 'utf8')

  // Plugin metadata files
  fs.writeFileSync(
    path.join(pluginsDir, 'known_marketplaces.json'),
    JSON.stringify({ marketplaces: ['official'] }),
    'utf8',
  )
  fs.writeFileSync(
    path.join(pluginsDir, 'blocklist.json'),
    JSON.stringify({ blocked: [] }),
    'utf8',
  )

  // projects/ directory
  fs.mkdirSync(path.join(claudeHome, 'projects'), { recursive: true })

  // commands/ directory
  fs.mkdirSync(path.join(claudeHome, 'commands'), { recursive: true })

  // skills/test-skill/SKILL.md
  const skillDir = path.join(claudeHome, 'skills', 'test-skill')
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill\n', 'utf8')

  // .gitconfig file
  fs.writeFileSync(path.join(realHome, '.gitconfig'), '[user]\n  name = Test\n', 'utf8')

  return {
    realHome,
    cleanup() {
      fs.rmSync(realHome, { recursive: true, force: true })
    },
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildFakeHome — directory structure', () => {
  let envCleanup: () => void
  let homeCleanup: () => void

  afterEach(() => {
    envCleanup?.()
    homeCleanup?.()
  })

  test('creates home/.claude/ directory structure', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('struct')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'struct' }
    const result = await buildFakeHome(config, envDir, realHome)

    expect(fs.existsSync(result.homePath)).toBe(true)
    expect(fs.existsSync(result.claudeHome)).toBe(true)
    expect(result.homePath).toBe(path.join(envDir, 'home'))
    expect(result.claudeHome).toBe(path.join(envDir, 'home', '.claude'))
  })

  test('creates persistent dirs: plugins/data, sessions, session-env', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('persist')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'persist' }
    const result = await buildFakeHome(config, envDir, realHome)

    expect(fs.existsSync(path.join(result.claudeHome, 'plugins', 'data'))).toBe(true)
    expect(fs.existsSync(path.join(result.claudeHome, 'sessions'))).toBe(true)
    expect(fs.existsSync(path.join(result.claudeHome, 'session-env'))).toBe(true)
  })

  test('preserves persistent dirs across regenerations', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('regen')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'regen' }

    // First build
    const result1 = await buildFakeHome(config, envDir, realHome)
    const markerPath = path.join(result1.claudeHome, 'plugins', 'data', 'marker.txt')
    fs.writeFileSync(markerPath, 'preserved', 'utf8')

    // Second build (regeneration)
    await buildFakeHome(config, envDir, realHome)

    expect(fs.existsSync(markerPath)).toBe(true)
    expect(fs.readFileSync(markerPath, 'utf8')).toBe('preserved')
  })
})

describe('buildFakeHome — shared symlinks', () => {
  let envCleanup: () => void
  let homeCleanup: () => void

  afterEach(() => {
    envCleanup?.()
    homeCleanup?.()
  })

  test('creates plugins/cache symlink to real HOME', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('cache-sym')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'cache-sym' }
    const result = await buildFakeHome(config, envDir, realHome)

    const cacheLink = path.join(result.claudeHome, 'plugins', 'cache')
    const stat = fs.lstatSync(cacheLink)
    expect(stat.isSymbolicLink()).toBe(true)

    const target = fs.readlinkSync(cacheLink)
    expect(target).toBe(path.join(realHome, '.claude', 'plugins', 'cache'))
  })

  test('creates projects symlink to real HOME', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('proj-sym')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'proj-sym' }
    const result = await buildFakeHome(config, envDir, realHome)

    const projectsLink = path.join(result.claudeHome, 'projects')
    const stat = fs.lstatSync(projectsLink)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(projectsLink)).toBe(path.join(realHome, '.claude', 'projects'))
  })

  test('creates plugins/marketplaces symlink to real HOME', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('mkt-sym')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Create marketplaces dir in the fake real home
    const marketplacesDir = path.join(realHome, '.claude', 'plugins', 'marketplaces')
    fs.mkdirSync(marketplacesDir, { recursive: true })
    fs.writeFileSync(path.join(marketplacesDir, 'repo.json'), '{}', 'utf8')

    const config: EnvConfig = { name: 'mkt-sym' }
    const result = await buildFakeHome(config, envDir, realHome)

    const mktLink = path.join(result.claudeHome, 'plugins', 'marketplaces')
    const stat = fs.lstatSync(mktLink)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(mktLink)).toBe(marketplacesDir)
  })

  test('does not create commands symlink (commands not shared)', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('cmd-sym')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'cmd-sym' }
    const result = await buildFakeHome(config, envDir, realHome)

    const commandsPath = path.join(result.claudeHome, 'commands')
    expect(fs.existsSync(commandsPath)).toBe(false)
  })

  test('creates dotfile symlinks for existing files', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('dotfile-exist')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'dotfile-exist' }
    const result = await buildFakeHome(config, envDir, realHome)

    // .gitconfig was created in the fake real HOME
    const gitconfigLink = path.join(result.homePath, '.gitconfig')
    const stat = fs.lstatSync(gitconfigLink)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(gitconfigLink)).toBe(path.join(realHome, '.gitconfig'))
  })

  test('skips dotfile symlinks for missing files', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('dotfile-miss')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'dotfile-miss' }
    const result = await buildFakeHome(config, envDir, realHome)

    // .npmrc was NOT created in the fake real HOME, so no symlink should exist
    const npmrcLink = path.join(result.homePath, '.npmrc')
    expect(fs.existsSync(npmrcLink)).toBe(false)
    // Also confirm lstat would fail (truly absent, not just a broken symlink)
    expect(() => fs.lstatSync(npmrcLink)).toThrow()
  })
})

describe('buildFakeHome — config regeneration', () => {
  let envCleanup: () => void
  let homeCleanup: () => void

  afterEach(() => {
    envCleanup?.()
    homeCleanup?.()
  })

  test('generates settings.json with effortLevel and permissions', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('settings')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = {
      name: 'settings',
      settings: {
        effortLevel: 'high',
        permissions: { allow: ['Bash(*)', 'Edit'] },
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const settingsPath = path.join(result.claudeHome, 'settings.json')
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(settings.effortLevel).toBe('high')
    expect(settings.permissions.allow).toEqual(['Bash(*)', 'Edit'])
  })

  test('generates settings.json with hooks in Claude Code format', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('hooks')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = {
      name: 'hooks',
      hooks: {
        UserPromptSubmit: [{ command: 'echo hello' }],
        Stop: [{ command: 'echo bye' }],
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const settings = JSON.parse(
      fs.readFileSync(path.join(result.claudeHome, 'settings.json'), 'utf8'),
    )
    expect(settings.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: 'command', command: 'echo hello' }] },
    ])
    expect(settings.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'echo bye' }] },
    ])
  })

  test('generates settings.json with disallowedTools from plugins.disable', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('disable')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = {
      name: 'disable',
      plugins: {
        disable: ['superpowers:brainstorming', 'superpowers:tdd'],
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const settings = JSON.parse(
      fs.readFileSync(path.join(result.claudeHome, 'settings.json'), 'utf8'),
    )
    expect(settings.disallowedTools).toEqual([
      'Skill(superpowers:brainstorming)',
      'Skill(superpowers:tdd)',
    ])
  })

  test('generates settings.json with statusLine when configured', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('statusline')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = {
      name: 'statusline',
      settings: {
        statusLine: {
          'plugin:claude-hud': { enabled: true, refresh: 5 },
        },
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const settingsPath = path.join(result.claudeHome, 'settings.json')
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(settings.statusLine).toEqual({
      'plugin:claude-hud': { enabled: true, refresh: 5 },
    })
  })

  test('omits statusLine from settings.json when not configured', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('no-statusline')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'no-statusline' }
    const result = await buildFakeHome(config, envDir, realHome)

    const settingsPath = path.join(result.claudeHome, 'settings.json')
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    expect(settings.statusLine).toBeUndefined()
  })

  test('generates installed_plugins.json with only selected plugins', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('plugins-filter')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Real HOME has alpha, beta, gamma — only enable alpha
    const config: EnvConfig = {
      name: 'plugins-filter',
      plugins: {
        enable: [{ name: 'alpha', source: 'source-a' }],
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const registryPath = path.join(result.claudeHome, 'plugins', 'installed_plugins.json')
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    expect(registry.version).toBe(2)
    expect(Object.keys(registry.plugins)).toEqual(['alpha@source-a'])
    expect(registry.plugins['alpha@source-a']).toHaveLength(1)
  })

  test('preserves all scope entries for a selected plugin', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('plugins-scopes')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // beta has both user and local scope entries in the real HOME
    const config: EnvConfig = {
      name: 'plugins-scopes',
      plugins: {
        enable: [{ name: 'beta', source: 'source-b' }],
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const registry = JSON.parse(
      fs.readFileSync(path.join(result.claudeHome, 'plugins', 'installed_plugins.json'), 'utf8'),
    )
    expect(Object.keys(registry.plugins)).toEqual(['beta@source-b'])
    expect(registry.plugins['beta@source-b']).toHaveLength(2)
    expect(registry.plugins['beta@source-b'][0].scope).toBe('user')
    expect(registry.plugins['beta@source-b'][1].scope).toBe('local')
  })

  test('writes empty plugins when none selected', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('plugins-empty')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'plugins-empty' }
    const result = await buildFakeHome(config, envDir, realHome)

    const registry = JSON.parse(
      fs.readFileSync(path.join(result.claudeHome, 'plugins', 'installed_plugins.json'), 'utf8'),
    )
    expect(registry.version).toBe(2)
    expect(registry.plugins).toEqual({})
  })

  test('creates CLAUDE.md symlink pointing to env claude.md', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('claudemd')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'claudemd' }
    const result = await buildFakeHome(config, envDir, realHome)

    const claudeMdLink = path.join(result.claudeHome, 'CLAUDE.md')
    const stat = fs.lstatSync(claudeMdLink)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(claudeMdLink)).toBe(path.join(envDir, 'claude.md'))
  })

  test('generates .mcp.json with server configs', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('mcp')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = {
      name: 'mcp',
      mcp_servers: {
        sqlite: {
          command: 'npx',
          args: ['-y', 'mcp-server-sqlite'],
          env: { DB_PATH: '/tmp/test.db' },
        },
        simple: {
          command: 'echo',
        },
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const mcpPath = path.join(result.homePath, '.mcp.json')
    const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8'))
    expect(mcpConfig.mcpServers.sqlite.command).toBe('npx')
    expect(mcpConfig.mcpServers.sqlite.args).toEqual(['-y', 'mcp-server-sqlite'])
    expect(mcpConfig.mcpServers.sqlite.env.DB_PATH).toBe('/tmp/test.db')
    expect(mcpConfig.mcpServers.simple.command).toBe('echo')
    expect(mcpConfig.mcpServers.simple.args).toBeUndefined()
  })

  test('resolves keychain: references in MCP env vars for allowed services', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('mcp-keychain')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Mock keychainRead via spyOn (same pattern as auth.test.ts)
    const keychainSpy = spyOn(keychainModule, 'keychainRead').mockImplementation(
      async (_service: string) => 'resolved-secret',
    )

    try {
      const config: EnvConfig = {
        name: 'mcp-keychain',
        mcp_servers: {
          'auth-server': {
            command: 'node',
            args: ['server.js'],
            env: {
              API_KEY: 'keychain:cenv-auth:my-api-key',
              PLAIN_VAR: 'plain-value',
            },
          },
        },
      }
      const result = await buildFakeHome(config, envDir, realHome)

      const mcpConfig = JSON.parse(
        fs.readFileSync(path.join(result.homePath, '.mcp.json'), 'utf8'),
      )
      expect(keychainSpy).toHaveBeenCalledWith('cenv-auth:my-api-key')
      expect(mcpConfig.mcpServers['auth-server'].env.API_KEY).toBe('resolved-secret')
      expect(mcpConfig.mcpServers['auth-server'].env.PLAIN_VAR).toBe('plain-value')
    } finally {
      mock.restore()
    }
  })

  test('rejects keychain: lookups for non-cenv services', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('mcp-keychain-reject')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const keychainSpy = spyOn(keychainModule, 'keychainRead').mockImplementation(
      async (_service: string) => 'should-not-appear',
    )

    try {
      const config: EnvConfig = {
        name: 'mcp-keychain-reject',
        mcp_servers: {
          'evil-server': {
            command: 'node',
            env: {
              LEAKED: 'keychain:some-other-app',
              LEAKED2: 'keychain:com.apple.safari',
              SAFE: 'plain-value',
            },
          },
        },
      }
      // skipCredentials to avoid writeCredentialsFile calling keychainRead
      const result = await buildFakeHome(config, envDir, realHome, { skipCredentials: true })

      const mcpConfig = JSON.parse(
        fs.readFileSync(path.join(result.homePath, '.mcp.json'), 'utf8'),
      )

      // keychainRead should never be called for non-cenv services
      expect(keychainSpy).not.toHaveBeenCalled()
      // The unauthorized keychain env vars should be absent
      expect(mcpConfig.mcpServers['evil-server'].env?.LEAKED).toBeUndefined()
      expect(mcpConfig.mcpServers['evil-server'].env?.LEAKED2).toBeUndefined()
      // Plain values still pass through
      expect(mcpConfig.mcpServers['evil-server'].env.SAFE).toBe('plain-value')
    } finally {
      mock.restore()
    }
  })

  test('allows keychain: lookups for Claude Code- prefixed services', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('mcp-keychain-claude')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const keychainSpy = spyOn(keychainModule, 'keychainRead').mockImplementation(
      async (_service: string) => 'claude-secret',
    )

    try {
      const config: EnvConfig = {
        name: 'mcp-keychain-claude',
        mcp_servers: {
          'claude-server': {
            command: 'node',
            env: {
              TOKEN: 'keychain:Claude Code-oauth',
            },
          },
        },
      }
      const result = await buildFakeHome(config, envDir, realHome)

      const mcpConfig = JSON.parse(
        fs.readFileSync(path.join(result.homePath, '.mcp.json'), 'utf8'),
      )
      expect(keychainSpy).toHaveBeenCalledWith('Claude Code-oauth')
      expect(mcpConfig.mcpServers['claude-server'].env.TOKEN).toBe('claude-secret')
    } finally {
      mock.restore()
    }
  })
})

describe('buildFakeHome — .claude.json generation', () => {
  let envCleanup: () => void
  let homeCleanup: () => void

  afterEach(() => {
    envCleanup?.()
    homeCleanup?.()
  })

  test('generates minimal .claude.json without projects key', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('claude-json-minimal')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Create real .claude.json with projects, numStartups, and hasCompletedOnboarding
    fs.writeFileSync(
      path.join(realHome, '.claude.json'),
      JSON.stringify({
        numStartups: 42,
        hasCompletedOnboarding: true,
        projects: {
          'abc123': {
            mcpServers: { gmail: { command: 'gmail-mcp' } },
            allowedTools: ['Bash'],
          },
        },
      }, null, 2),
      'utf8',
    )

    const config: EnvConfig = { name: 'claude-json-minimal' }
    const result = await buildFakeHome(config, envDir, realHome)

    const claudeJsonPath = path.join(result.homePath, '.claude.json')
    expect(fs.existsSync(claudeJsonPath)).toBe(true)

    const generated = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'))
    expect(generated.numStartups).toBe(42)
    expect(generated.hasCompletedOnboarding).toBe(true)
    expect(generated.projects).toBeUndefined()
  })

  test('generates .claude.json without oauthAccount or anonymousId', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('claude-json-sensitive')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    fs.writeFileSync(
      path.join(realHome, '.claude.json'),
      JSON.stringify({
        numStartups: 5,
        hasCompletedOnboarding: true,
        oauthAccount: { email: 'user@example.com', id: 'acct-123' },
        anonymousId: 'anon-abc-123',
        claudeAiMcpEverConnected: true,
        githubRepoPaths: ['/home/user/repos/secret-project'],
      }, null, 2),
      'utf8',
    )

    const config: EnvConfig = { name: 'claude-json-sensitive' }
    const result = await buildFakeHome(config, envDir, realHome)

    const generated = JSON.parse(
      fs.readFileSync(path.join(result.homePath, '.claude.json'), 'utf8'),
    )
    expect(generated.numStartups).toBe(5)
    expect(generated.hasCompletedOnboarding).toBe(true)
    expect(generated.oauthAccount).toBeUndefined()
    expect(generated.anonymousId).toBeUndefined()
    expect(generated.claudeAiMcpEverConnected).toBeUndefined()
    expect(generated.githubRepoPaths).toBeUndefined()
  })

  test('handles missing .claude.json gracefully', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('claude-json-missing')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Do NOT create .claude.json in real home

    const config: EnvConfig = { name: 'claude-json-missing' }
    const result = await buildFakeHome(config, envDir, realHome)

    // Should not crash, and .claude.json should not exist in fake home
    const claudeJsonPath = path.join(result.homePath, '.claude.json')
    expect(fs.existsSync(claudeJsonPath)).toBe(false)
  })

  test('.claude.json is a generated file, not a symlink', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('claude-json-not-symlink')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    fs.writeFileSync(
      path.join(realHome, '.claude.json'),
      JSON.stringify({ numStartups: 1 }),
      'utf8',
    )

    const config: EnvConfig = { name: 'claude-json-not-symlink' }
    const result = await buildFakeHome(config, envDir, realHome)

    const claudeJsonPath = path.join(result.homePath, '.claude.json')
    const stat = fs.lstatSync(claudeJsonPath)
    expect(stat.isSymbolicLink()).toBe(false)
    expect(stat.isFile()).toBe(true)
  })
})

describe('buildFakeHome — skill symlinks', () => {
  let envCleanup: () => void
  let homeCleanup: () => void

  afterEach(() => {
    envCleanup?.()
    homeCleanup?.()
  })

  test('creates skill symlinks for selected skills', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('skills')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const skillPath = path.join(realHome, '.claude', 'skills', 'test-skill')

    const config: EnvConfig = {
      name: 'skills',
      skills: [{ name: 'test-skill', path: skillPath }],
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const skillsDir = path.join(result.claudeHome, 'skills')
    const entries = fs.readdirSync(skillsDir)
    expect(entries).toContain('test-skill')

    const skillLink = path.join(skillsDir, 'test-skill')
    const stat = fs.lstatSync(skillLink)
    expect(stat.isSymbolicLink()).toBe(true)
  })

  test('clears and recreates skill symlinks on regeneration', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('skills-regen')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const skillPath = path.join(realHome, '.claude', 'skills', 'test-skill')

    // Create a second skill in the real HOME
    const skillBDir = path.join(realHome, '.claude', 'skills', 'skill-b')
    fs.mkdirSync(skillBDir, { recursive: true })
    fs.writeFileSync(path.join(skillBDir, 'SKILL.md'), '# Skill B\n', 'utf8')

    // First build with skill A
    const configA: EnvConfig = {
      name: 'skills-regen',
      skills: [{ name: 'test-skill', path: skillPath }],
    }
    const result = await buildFakeHome(configA, envDir, realHome)

    let entries = fs.readdirSync(path.join(result.claudeHome, 'skills'))
    expect(entries).toContain('test-skill')
    expect(entries).not.toContain('skill-b')

    // Second build with skill B only
    const configB: EnvConfig = {
      name: 'skills-regen',
      skills: [{ name: 'skill-b', path: skillBDir }],
    }
    await buildFakeHome(configB, envDir, realHome)

    entries = fs.readdirSync(path.join(result.claudeHome, 'skills'))
    expect(entries).toContain('skill-b')
    expect(entries).not.toContain('test-skill')
  })

  test('skips skills with nonexistent paths', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('skills-missing')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = {
      name: 'skills-missing',
      skills: [{ name: 'ghost', path: '/nonexistent/skill/path' }],
    }

    // Should not throw
    const result = await buildFakeHome(config, envDir, realHome)

    const skillsDir = path.join(result.claudeHome, 'skills')
    const entries = fs.readdirSync(skillsDir)
    expect(entries).toHaveLength(0)
  })
})

describe('buildFakeHome — command symlinks', () => {
  let envCleanup: () => void
  let homeCleanup: () => void

  afterEach(() => {
    envCleanup?.()
    homeCleanup?.()
  })

  test('creates command symlinks for selected commands', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('cmds')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Create a .md command file in the real HOME commands dir
    const realCmdDir = path.join(realHome, '.claude', 'commands')
    fs.mkdirSync(realCmdDir, { recursive: true })
    const cmdFile = path.join(realCmdDir, 'deploy.md')
    fs.writeFileSync(cmdFile, '# Deploy\nRun deploy script\n', 'utf8')

    const config: EnvConfig = {
      name: 'cmds',
      commands: [{ path: cmdFile }],
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const commandsDir = path.join(result.claudeHome, 'commands')
    const entries = fs.readdirSync(commandsDir)
    expect(entries).toContain('deploy.md')

    const cmdLink = path.join(commandsDir, 'deploy.md')
    const stat = fs.lstatSync(cmdLink)
    expect(stat.isSymbolicLink()).toBe(true)
  })

  test('skips commands with nonexistent paths', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('cmds-missing')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = {
      name: 'cmds-missing',
      commands: [{ path: '/nonexistent/cmd.md' }],
    }

    // Should not throw
    const result = await buildFakeHome(config, envDir, realHome)

    const commandsDir = path.join(result.claudeHome, 'commands')
    // commands dir exists because config.commands has length
    const entries = fs.readdirSync(commandsDir).filter(e =>
      fs.lstatSync(path.join(commandsDir, e)).isSymbolicLink()
    )
    expect(entries).toHaveLength(0)
  })

  test('clears and recreates command symlinks on regeneration', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('cmds-regen')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const realCmdDir = path.join(realHome, '.claude', 'commands')
    fs.mkdirSync(realCmdDir, { recursive: true })
    const cmdA = path.join(realCmdDir, 'alpha.md')
    const cmdB = path.join(realCmdDir, 'beta.md')
    fs.writeFileSync(cmdA, '# Alpha\n', 'utf8')
    fs.writeFileSync(cmdB, '# Beta\n', 'utf8')

    // First build with alpha
    const configA: EnvConfig = {
      name: 'cmds-regen',
      commands: [{ path: cmdA }],
    }
    const result = await buildFakeHome(configA, envDir, realHome)

    let entries = fs.readdirSync(path.join(result.claudeHome, 'commands'))
    expect(entries).toContain('alpha.md')
    expect(entries).not.toContain('beta.md')

    // Second build with beta only
    const configB: EnvConfig = {
      name: 'cmds-regen',
      commands: [{ path: cmdB }],
    }
    await buildFakeHome(configB, envDir, realHome)

    entries = fs.readdirSync(path.join(result.claudeHome, 'commands'))
    expect(entries).toContain('beta.md')
    expect(entries).not.toContain('alpha.md')
  })
})

describe('buildFakeHome — rule symlinks', () => {
  let envCleanup: () => void
  let homeCleanup: () => void

  afterEach(() => {
    envCleanup?.()
    homeCleanup?.()
  })

  test('creates rule symlinks for selected rules', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('rules')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Create rule files in the real HOME rules dir
    const realRulesDir = path.join(realHome, '.claude', 'rules')
    fs.mkdirSync(realRulesDir, { recursive: true })
    const ruleFile = path.join(realRulesDir, 'security.md')
    fs.writeFileSync(ruleFile, '# Security rules\n', 'utf8')

    const config: EnvConfig = {
      name: 'rules',
      rules: [{ path: ruleFile }],
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const rulesDir = path.join(result.claudeHome, 'rules')
    const entries = fs.readdirSync(rulesDir)
    expect(entries).toContain('security.md')

    const ruleLink = path.join(rulesDir, 'security.md')
    const stat = fs.lstatSync(ruleLink)
    expect(stat.isSymbolicLink()).toBe(true)
  })

  test('skips rules with nonexistent paths', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('rules-missing')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = {
      name: 'rules-missing',
      rules: [{ path: '/nonexistent/rule.md' }],
    }

    // Should not throw
    const result = await buildFakeHome(config, envDir, realHome)

    const rulesDir = path.join(result.claudeHome, 'rules')
    const entries = fs.readdirSync(rulesDir).filter(e =>
      fs.lstatSync(path.join(rulesDir, e)).isSymbolicLink()
    )
    expect(entries).toHaveLength(0)
  })
})

describe('buildFakeHome — hooks directory symlinks', () => {
  let envCleanup: () => void
  let homeCleanup: () => void

  afterEach(() => {
    envCleanup?.()
    homeCleanup?.()
  })

  test('symlinks hooks directory when env has hooks', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('hooks-dir')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Create a hook script in the real HOME hooks dir
    const realHooksDir = path.join(realHome, '.claude', 'hooks')
    fs.mkdirSync(realHooksDir, { recursive: true })
    fs.writeFileSync(path.join(realHooksDir, 'notify.sh'), '#!/bin/sh\necho ok\n', 'utf8')

    const config: EnvConfig = {
      name: 'hooks-dir',
      hooks: {
        Stop: [{ command: '~/.claude/hooks/notify.sh' }],
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const hooksDir = path.join(result.claudeHome, 'hooks')
    expect(fs.existsSync(hooksDir)).toBe(true)

    const notifyLink = path.join(hooksDir, 'notify.sh')
    const stat = fs.lstatSync(notifyLink)
    expect(stat.isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(notifyLink)).toBe(path.join(realHooksDir, 'notify.sh'))
  })

  test('does not create hooks dir when no hooks configured', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('no-hooks-dir')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    const config: EnvConfig = { name: 'no-hooks-dir' }
    const result = await buildFakeHome(config, envDir, realHome)

    const hooksDir = path.join(result.claudeHome, 'hooks')
    expect(fs.existsSync(hooksDir)).toBe(false)
  })

  test('clears stale hook symlinks on regeneration', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('hooks-stale')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // Create two hook scripts in the real HOME hooks dir
    const realHooksDir = path.join(realHome, '.claude', 'hooks')
    fs.mkdirSync(realHooksDir, { recursive: true })
    fs.writeFileSync(path.join(realHooksDir, 'notify.sh'), '#!/bin/sh\necho ok\n', 'utf8')
    fs.writeFileSync(path.join(realHooksDir, 'lint.sh'), '#!/bin/sh\necho lint\n', 'utf8')

    // First build: both hook scripts get symlinked
    const config: EnvConfig = {
      name: 'hooks-stale',
      hooks: {
        Stop: [{ command: '~/.claude/hooks/notify.sh' }],
      },
    }
    const result = await buildFakeHome(config, envDir, realHome)

    const hooksDir = path.join(result.claudeHome, 'hooks')
    let entries = fs.readdirSync(hooksDir)
    expect(entries).toContain('notify.sh')
    expect(entries).toContain('lint.sh')

    // Simulate removing lint.sh from the real hooks dir between runs
    fs.unlinkSync(path.join(realHooksDir, 'lint.sh'))

    // Second build: stale lint.sh symlink should be cleared
    await buildFakeHome(config, envDir, realHome)

    entries = fs.readdirSync(hooksDir)
    expect(entries).toContain('notify.sh')
    expect(entries).not.toContain('lint.sh')
  })

  test('handles missing real hooks dir gracefully', async () => {
    const { envDir, cleanup: ec } = createTempEnvDir('hooks-no-real')
    envCleanup = ec
    const { realHome, cleanup: hc } = createFakeRealHome()
    homeCleanup = hc

    // No hooks dir created in real HOME — just hooks in config
    const config: EnvConfig = {
      name: 'hooks-no-real',
      hooks: {
        Stop: [{ command: 'echo done' }],
      },
    }

    // Should not throw
    const result = await buildFakeHome(config, envDir, realHome)

    const hooksDir = path.join(result.claudeHome, 'hooks')
    // The hooks dir is created but will be empty (no real hooks to symlink)
    expect(fs.existsSync(hooksDir)).toBe(true)
    const entries = fs.readdirSync(hooksDir)
    expect(entries).toHaveLength(0)
  })
})
