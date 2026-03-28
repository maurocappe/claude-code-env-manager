import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome, createEnvDir } from '../../src/lib/environments'
import { buildFakeHome } from '../../src/lib/fake-home'
import type { EnvConfig } from '../../src/types'

describe('Run Engine', () => {
  let ctx: E2EContext

  beforeEach(async () => {
    ctx = await createE2EContext()
    ensureCenvHome(ctx.cenvHome)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ── buildFakeHome (config generation) ─────────────────────────────────────

  test('buildFakeHome creates settings.json with disallowedTools from explicit disable list', async () => {
    const envDir = createEnvDir('skills-env', ctx.cenvHome)
    fs.writeFileSync(path.join(envDir, 'claude.md'), '# test\n', 'utf8')

    const config: EnvConfig = {
      name: 'skills-env',
      plugins: {
        disable: ['superpowers:brainstorming', 'superpowers:test-driven-development'],
      },
    }

    const fakeHome = await buildFakeHome(config, envDir, ctx.home)

    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome.claudeHome, 'settings.json'), 'utf8'))
    expect(settings.disallowedTools).toBeDefined()
    expect(settings.disallowedTools).toContain('Skill(superpowers:brainstorming)')
    expect(settings.disallowedTools).toContain('Skill(superpowers:test-driven-development)')
  })

  test('buildFakeHome creates .mcp.json with mcpServers', async () => {
    const envDir = createEnvDir('mcp-env', ctx.cenvHome)
    fs.writeFileSync(path.join(envDir, 'claude.md'), '# test\n', 'utf8')

    const config: EnvConfig = {
      name: 'mcp-env',
      mcp_servers: {
        'my-server': { command: 'echo', args: ['hello'] },
        'another-server': { command: 'cat' },
      },
    }

    const fakeHome = await buildFakeHome(config, envDir, ctx.home)

    const mcpConfig = JSON.parse(fs.readFileSync(path.join(fakeHome.homePath, '.mcp.json'), 'utf8'))
    expect(mcpConfig.mcpServers).toBeDefined()
    expect(mcpConfig.mcpServers['my-server']).toBeDefined()
    expect(mcpConfig.mcpServers['my-server'].command).toBe('echo')
    expect(mcpConfig.mcpServers['another-server']).toBeDefined()
  })

  test('buildFakeHome creates settings.json with hooks in Claude Code format', async () => {
    const envDir = createEnvDir('hooks-env', ctx.cenvHome)
    fs.writeFileSync(path.join(envDir, 'claude.md'), '# test\n', 'utf8')

    const config: EnvConfig = {
      name: 'hooks-env',
      hooks: {
        PostToolUse: [{ command: 'echo "tool used"' }],
        Stop: [{ command: 'echo "stopped"' }],
      },
    }

    const fakeHome = await buildFakeHome(config, envDir, ctx.home)

    const settings = JSON.parse(fs.readFileSync(path.join(fakeHome.claudeHome, 'settings.json'), 'utf8'))
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks.PostToolUse).toBeDefined()
    expect(Array.isArray(settings.hooks.PostToolUse)).toBe(true)
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('echo "tool used"')
    expect(settings.hooks.Stop).toBeDefined()
  })

  // ── Full run flow (subprocess with mock claude) ───────────────────────────

  test('dry-run output contains HOME= and Fake HOME path', async () => {
    const envDir = createEnvDir('my-env', ctx.cenvHome)
    fs.writeFileSync(path.join(envDir, 'claude.md'), '# test\n', 'utf8')

    const proc = Bun.spawn(
      ['bun', 'run', 'src/index.ts', 'run', 'my-env', '--dry-run'],
      {
        cwd: '/Users/maurocapelloni/Documents/repos/claude-code-env-manager',
        env: {
          ...process.env,
          HOME: ctx.home,
          PATH: `${ctx.binDir}:${process.env.PATH}`,
          CENV_E2E_OUTPUT: ctx.outputFile,
          CENV_E2E_KEYCHAIN: ctx.keychainFile,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )

    const output = await new Response(proc.stdout).text()
    await proc.exited

    expect(output).toContain('HOME=')
    expect(output).toContain('Fake HOME:')
  })

  test('dry-run creates the fake HOME settings.json at the expected path', async () => {
    const envDir = createEnvDir('my-env', ctx.cenvHome)
    fs.writeFileSync(path.join(envDir, 'claude.md'), '# test\n', 'utf8')

    const proc = Bun.spawn(
      ['bun', 'run', 'src/index.ts', 'run', 'my-env', '--dry-run'],
      {
        cwd: '/Users/maurocapelloni/Documents/repos/claude-code-env-manager',
        env: {
          ...process.env,
          HOME: ctx.home,
          PATH: `${ctx.binDir}:${process.env.PATH}`,
          CENV_E2E_OUTPUT: ctx.outputFile,
          CENV_E2E_KEYCHAIN: ctx.keychainFile,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )

    const output = await new Response(proc.stdout).text()
    await proc.exited

    // Extract the fake HOME path from the "Fake HOME:" line in the dry-run output
    const match = output.match(/Fake HOME:\s*(\S+)/)
    expect(match).not.toBeNull()

    const fakeHomePath = match![1]
    const settingsPath = path.join(fakeHomePath, '.claude', 'settings.json')
    expect(fs.existsSync(settingsPath)).toBe(true)
  })
})
