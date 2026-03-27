import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome, createEnvDir } from '../../src/lib/environments'
import { snapshotCurrentSetup } from '../../src/lib/snapshot'
import { loadEnvConfig } from '../../src/lib/config'

describe('Snapshot', () => {
  let ctx: E2EContext

  beforeEach(async () => {
    ctx = await createE2EContext()
    ensureCenvHome(ctx.cenvHome)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('snapshotCurrentSetup creates env.yaml with superpowers plugin', () => {
    const envDir = createEnvDir('snap-env', ctx.cenvHome)

    snapshotCurrentSetup(envDir, 'snap-env', {
      installedPluginsPath: path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json'),
      settingsPath: path.join(ctx.claudeHome, 'settings.json'),
      claudeMdPath: path.join(ctx.claudeHome, 'CLAUDE.md'),
    })

    const config = loadEnvConfig(envDir)
    const plugin = config.plugins?.enable?.find(p => p.name === 'superpowers')
    expect(plugin).toBeDefined()
    expect(plugin?.source).toBe('claude-plugins-official')
  })

  test('snapshot env.yaml has the plugin version from fixtures (5.0.6)', () => {
    const envDir = createEnvDir('snap-env', ctx.cenvHome)

    snapshotCurrentSetup(envDir, 'snap-env', {
      installedPluginsPath: path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json'),
      settingsPath: path.join(ctx.claudeHome, 'settings.json'),
      claudeMdPath: path.join(ctx.claudeHome, 'CLAUDE.md'),
    })

    const config = loadEnvConfig(envDir)
    const plugin = config.plugins?.enable?.find(p => p.name === 'superpowers')
    expect(plugin?.version).toBe('5.0.6')
  })

  test('snapshot copies CLAUDE.md content from fixture', () => {
    const envDir = createEnvDir('snap-env', ctx.cenvHome)

    snapshotCurrentSetup(envDir, 'snap-env', {
      installedPluginsPath: path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json'),
      settingsPath: path.join(ctx.claudeHome, 'settings.json'),
      claudeMdPath: path.join(ctx.claudeHome, 'CLAUDE.md'),
    })

    const claudeMd = fs.readFileSync(path.join(envDir, 'claude.md'), 'utf8')
    // The fixture CLAUDE.md contains "Test CLAUDE.md"
    expect(claudeMd).toContain('Test CLAUDE.md')
  })

  test('snapshot env.yaml extracts effortLevel: high from fixture settings', () => {
    const envDir = createEnvDir('snap-env', ctx.cenvHome)

    snapshotCurrentSetup(envDir, 'snap-env', {
      installedPluginsPath: path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json'),
      settingsPath: path.join(ctx.claudeHome, 'settings.json'),
      claudeMdPath: path.join(ctx.claudeHome, 'CLAUDE.md'),
    })

    const config = loadEnvConfig(envDir)
    expect(config.settings?.effortLevel).toBe('high')
  })
})
