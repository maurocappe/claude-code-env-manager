import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, readClaudeInvocation, readMockKeychain, writeMockKeychain, type E2EContext } from './helpers/setup'

describe('E2E Infrastructure', () => {
  let ctx: E2EContext

  beforeEach(async () => {
    ctx = await createE2EContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('createE2EContext creates all expected directories', () => {
    expect(fs.existsSync(ctx.root)).toBe(true)
    expect(fs.existsSync(ctx.home)).toBe(true)
    expect(fs.existsSync(ctx.claudeHome)).toBe(true)
    expect(fs.existsSync(ctx.projectDir)).toBe(true)
    expect(fs.existsSync(ctx.binDir)).toBe(true)
    expect(fs.existsSync(path.join(ctx.root, 'output'))).toBe(true)
  })

  test('fixtures are copied correctly', () => {
    // Claude home fixtures
    expect(fs.existsSync(path.join(ctx.claudeHome, 'settings.json'))).toBe(true)
    expect(fs.existsSync(path.join(ctx.claudeHome, 'CLAUDE.md'))).toBe(true)
    expect(fs.existsSync(path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json'))).toBe(true)
    expect(fs.existsSync(path.join(ctx.claudeHome, 'skills', 'gstack-review', 'SKILL.md'))).toBe(true)

    // Plugin cache fixtures
    const pluginCache = path.join(ctx.claudeHome, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '5.0.6')
    expect(fs.existsSync(path.join(pluginCache, '.claude-plugin', 'plugin.json'))).toBe(true)
    expect(fs.existsSync(path.join(pluginCache, 'skills', 'test-driven-development', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(pluginCache, 'skills', 'brainstorming', 'SKILL.md'))).toBe(true)
    expect(fs.existsSync(path.join(pluginCache, 'hooks', 'hooks.json'))).toBe(true)

    // Project fixtures
    expect(fs.existsSync(path.join(ctx.projectDir, '.claude-envs', 'team-env', 'env.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(ctx.projectDir, '.claude-envs', 'team-env', 'claude.md'))).toBe(true)
  })

  test('installed_plugins.json paths are patched with actual temp dir paths', () => {
    const installedPluginsPath = path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json')
    const content = fs.readFileSync(installedPluginsPath, 'utf8')
    const parsed = JSON.parse(content)

    const installPath = parsed.plugins['superpowers@claude-plugins-official'][0].installPath

    // Must not contain the placeholder
    expect(installPath).not.toContain('PLACEHOLDER_PLUGIN_PATH')

    // Must point to the actual temp dir
    expect(installPath).toContain(ctx.claudeHome)
    expect(installPath).toContain('cache/claude-plugins-official/superpowers/5.0.6')

    // The path must actually exist
    expect(fs.existsSync(installPath)).toBe(true)
  })

  test('mock claude binary runs and writes invocation JSON', async () => {
    const { exited } = Bun.spawn(
      [path.join(ctx.binDir, 'claude'), '--settings', '/tmp/test.json', '--print', 'hello'],
      {
        env: {
          ...process.env,
          CENV_E2E_OUTPUT: ctx.outputFile,
          ANTHROPIC_API_KEY: 'test-key-123',
        },
      }
    )
    const code = await exited
    expect(code).toBe(0)

    const invocation = readClaudeInvocation(ctx)
    expect(invocation.args).toEqual(['--settings', '/tmp/test.json', '--print', 'hello'])
    expect(invocation.env.ANTHROPIC_API_KEY).toBe('test-key-123')
    expect(invocation.env.CLAUDE_CODE_OAUTH_TOKEN).toBeNull()
    expect(invocation.env.CLAUDE_CODE_USE_BEDROCK).toBeNull()
  })

  test('mock security binary writes entries correctly', async () => {
    const { exited } = Bun.spawn(
      [path.join(ctx.binDir, 'security'), 'add-generic-password', '-U', '-a', 'testuser', '-s', 'my-service', '-w', 'secret-value'],
      { env: { ...process.env, CENV_E2E_KEYCHAIN: ctx.keychainFile } }
    )
    expect(await exited).toBe(0)

    const keychain = readMockKeychain(ctx)
    expect(keychain['my-service:testuser']).toBe('secret-value')
  })

  test('mock security binary reads entries correctly', async () => {
    writeMockKeychain(ctx, [{ service: 'read-svc', account: 'alice', value: 'my-password' }])

    const proc = Bun.spawn(
      [path.join(ctx.binDir, 'security'), 'find-generic-password', '-s', 'read-svc', '-a', 'alice', '-w'],
      { stdout: 'pipe', env: { ...process.env, CENV_E2E_KEYCHAIN: ctx.keychainFile } }
    )
    const code = await proc.exited
    expect(code).toBe(0)

    const stdout = await new Response(proc.stdout).text()
    expect(stdout.trimEnd()).toBe('my-password')
  })

  test('mock security binary returns exit 44 when entry not found', async () => {
    const proc = Bun.spawn(
      [path.join(ctx.binDir, 'security'), 'find-generic-password', '-s', 'nonexistent-svc', '-a', 'nobody', '-w'],
      { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CENV_E2E_KEYCHAIN: ctx.keychainFile } }
    )
    const code = await proc.exited
    expect(code).toBe(44)
  })

  test('mock security binary deletes entries correctly', async () => {
    writeMockKeychain(ctx, [
      { service: 'del-svc', account: 'bob', value: 'to-delete' },
      { service: 'keep-svc', account: 'bob', value: 'keep-this' },
    ])

    const { exited } = Bun.spawn(
      [path.join(ctx.binDir, 'security'), 'delete-generic-password', '-a', 'bob', '-s', 'del-svc'],
      { env: { ...process.env, CENV_E2E_KEYCHAIN: ctx.keychainFile } }
    )
    expect(await exited).toBe(0)

    const keychain = readMockKeychain(ctx)
    expect(keychain['del-svc:bob']).toBeUndefined()
    expect(keychain['keep-svc:bob']).toBe('keep-this')
  })

  test('mock security delete returns exit 44 for missing entry', async () => {
    const proc = Bun.spawn(
      [path.join(ctx.binDir, 'security'), 'delete-generic-password', '-a', 'nobody', '-s', 'ghost-svc'],
      { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CENV_E2E_KEYCHAIN: ctx.keychainFile } }
    )
    expect(await proc.exited).toBe(44)
  })

  test('cleanup restores PATH and HOME', async () => {
    const pathDuringTest = process.env.PATH
    const homeDuringTest = process.env.HOME

    // Verify isolation is active
    expect(pathDuringTest).toContain(ctx.binDir)
    expect(homeDuringTest).toBe(ctx.home)

    ctx.cleanup()

    // Verify restoration
    expect(process.env.PATH).toBe(ctx.originalPath)
    expect(process.env.HOME).toBe(ctx.originalHome)
    expect(process.env.CENV_E2E_OUTPUT).toBeUndefined()
    expect(process.env.CENV_E2E_KEYCHAIN).toBeUndefined()

    // Temp dir is removed
    expect(fs.existsSync(ctx.root)).toBe(false)

    // Re-create to avoid double-cleanup in afterEach
    ctx = await createE2EContext()
  })

  test('settings.json fixture has expected content', () => {
    const settingsPath = path.join(ctx.claudeHome, 'settings.json')
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))

    expect(settings.effortLevel).toBe('high')
    expect(settings.permissions.allow).toContain('Edit')
    expect(settings.permissions.allow).toContain('Write')
    expect(settings.enabledPlugins['superpowers@claude-plugins-official']).toBe(true)
  })

  test('team-env fixture has expected env.yaml content', () => {
    const { parse } = require('yaml')
    const envYamlPath = path.join(ctx.projectDir, '.claude-envs', 'team-env', 'env.yaml')
    const config = parse(fs.readFileSync(envYamlPath, 'utf8'))

    expect(config.name).toBe('team-env')
    expect(config.isolation).toBe('additive')
    expect(config.plugins.enable[0].name).toBe('superpowers')
    expect(config.plugins.disable).toContain('superpowers:brainstorming')
    expect(config.mcp_servers['test-server'].command).toBe('echo')
    expect(config.settings.effortLevel).toBe('high')
  })
})
