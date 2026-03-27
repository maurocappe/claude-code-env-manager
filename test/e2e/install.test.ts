import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome, createEnvDir } from '../../src/lib/environments'
import { writeEnvConfig, loadEnvConfig } from '../../src/lib/config'
import { resolvePluginDeps, resolveSkillDeps, checkMcpAvailable } from '../../src/lib/installer'

describe('Install: Dependency Resolution', () => {
  let ctx: E2EContext

  beforeEach(async () => {
    ctx = await createE2EContext()
    ensureCenvHome(ctx.cenvHome)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('plugin installed in fixture Claude Code matching version → status installed', () => {
    // superpowers@5.0.6 is installed; env requires ^5.0.0 → matches
    const envDir = createEnvDir('install-test', ctx.cenvHome)
    writeEnvConfig(envDir, {
      name: 'install-test',
      plugins: {
        enable: [{ name: 'superpowers', source: 'claude-plugins-official', version: '^5.0.0' }],
      },
    })

    const results = resolvePluginDeps(
      loadEnvConfig(envDir),
      path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json'),
      path.join(ctx.cenvHome, 'cache')
    )

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('installed')
    expect(results[0].installedVersion).toBe('5.0.6')
  })

  test('plugin not in fixtures and not cached → status missing', () => {
    const envDir = createEnvDir('missing-test', ctx.cenvHome)
    writeEnvConfig(envDir, {
      name: 'missing-test',
      plugins: {
        enable: [{ name: 'nonexistent-plugin', source: 'claude-plugins-official', version: '^1.0.0' }],
      },
    })

    const results = resolvePluginDeps(
      loadEnvConfig(envDir),
      path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json'),
      path.join(ctx.cenvHome, 'cache')
    )

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('missing')
  })

  test('plugin installed at 5.0.6 but env requires ^6.0.0 → status version-mismatch', () => {
    const envDir = createEnvDir('version-mismatch-test', ctx.cenvHome)
    writeEnvConfig(envDir, {
      name: 'version-mismatch-test',
      plugins: {
        enable: [{ name: 'superpowers', source: 'claude-plugins-official', version: '^6.0.0' }],
      },
    })

    const results = resolvePluginDeps(
      loadEnvConfig(envDir),
      path.join(ctx.claudeHome, 'plugins', 'installed_plugins.json'),
      path.join(ctx.cenvHome, 'cache')
    )

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('version-mismatch')
    expect(results[0].installedVersion).toBe('5.0.6')
  })

  test('skill with local path that exists in env dir → status installed', () => {
    const envDir = createEnvDir('skill-local-test', ctx.cenvHome)

    // Create the local skill directory inside the env dir
    const skillDir = path.join(envDir, 'skills', 'my-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\n', 'utf8')

    writeEnvConfig(envDir, {
      name: 'skill-local-test',
      skills: [{ path: './skills/my-skill' }],
    })

    const results = resolveSkillDeps(
      loadEnvConfig(envDir),
      envDir,
      path.join(ctx.cenvHome, 'cache')
    )

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('installed')
    expect(results[0].resolvedPath).toBe(skillDir)
  })

  test('checkMcpAvailable with echo command → true; with nonexistent command → false', () => {
    expect(checkMcpAvailable({ command: 'echo' })).toBe(true)
    expect(checkMcpAvailable({ command: 'nonexistent-cmd-xyz' })).toBe(false)
  })
})
