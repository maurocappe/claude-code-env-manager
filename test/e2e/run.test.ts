import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome, createEnvDir } from '../../src/lib/environments'
import { assembleClaudeArgs } from '../../src/lib/runner'
import { createSession } from '../../src/lib/session'
import type { EnvConfig, SessionFiles } from '../../src/types'

describe('Run Engine', () => {
  let ctx: E2EContext

  beforeEach(async () => {
    ctx = await createE2EContext()
    ensureCenvHome(ctx.cenvHome)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ── assembleClaudeArgs (direct, no process spawning) ─────────────────────────

  test('assembleClaudeArgs in additive mode: no --bare, no --strict-mcp-config', () => {
    const session: SessionFiles = {
      dir: '/tmp/test-session',
      settingsPath: '/tmp/test-session/settings.json',
      mcpConfigPath: '/tmp/test-session/mcp.json',
      claudeMdPath: '/tmp/test-session/claude.md',
      pluginDirs: [],
      disallowedTools: [],
    }
    const config: EnvConfig = { name: 'test-env' }

    const args = assembleClaudeArgs(session, config)

    expect(args).not.toContain('--bare')
    expect(args).not.toContain('--strict-mcp-config')
    expect(args).toContain('--settings')
  })

  test('assembleClaudeArgs never adds --bare or --strict-mcp-config (isolation dropped)', () => {
    const session: SessionFiles = {
      dir: '/tmp/test-session',
      settingsPath: '/tmp/test-session/settings.json',
      mcpConfigPath: '/tmp/test-session/mcp.json',
      claudeMdPath: '/tmp/test-session/claude.md',
      pluginDirs: [],
      disallowedTools: [],
    }
    const config: EnvConfig = { name: 'bare-env' }

    const args = assembleClaudeArgs(session, config)

    expect(args).not.toContain('--bare')
    expect(args).not.toContain('--strict-mcp-config')
  })

  test('assembleClaudeArgs with plugin dirs: --plugin-dir flags present', () => {
    const session: SessionFiles = {
      dir: '/tmp/test-session',
      settingsPath: '/tmp/test-session/settings.json',
      mcpConfigPath: '/tmp/test-session/mcp.json',
      claudeMdPath: '/tmp/test-session/claude.md',
      pluginDirs: ['/path/to/plugin-a', '/path/to/plugin-b'],
      disallowedTools: [],
    }
    const config: EnvConfig = { name: 'plugin-env' }

    const args = assembleClaudeArgs(session, config)

    expect(args).toContain('--plugin-dir')
    expect(args).toContain('/path/to/plugin-a')
    expect(args).toContain('/path/to/plugin-b')
    // There should be two --plugin-dir flags
    const pluginDirCount = args.filter(a => a === '--plugin-dir').length
    expect(pluginDirCount).toBe(2)
  })

  // ── createSession (writes files) ─────────────────────────────────────────────

  test('createSession with disabled skills: settings.json has disallowedTools', async () => {
    const envDir = createEnvDir('skills-env', ctx.cenvHome)
    const config: EnvConfig = {
      name: 'skills-env',
      plugins: {
        disable: ['superpowers:brainstorming', 'superpowers:test-driven-development'],
      },
    }

    const sessionsDir = path.join(ctx.cenvHome, 'sessions')
    const session = await createSession(config, envDir, sessionsDir)

    const settings = JSON.parse(fs.readFileSync(session.settingsPath, 'utf8'))
    expect(settings.disallowedTools).toBeDefined()
    expect(settings.disallowedTools).toContain('Skill(superpowers:brainstorming)')
    expect(settings.disallowedTools).toContain('Skill(superpowers:test-driven-development)')
  })

  test('createSession with MCP servers: mcp.json has mcpServers structure', async () => {
    const envDir = createEnvDir('mcp-env', ctx.cenvHome)
    const config: EnvConfig = {
      name: 'mcp-env',
      mcp_servers: {
        'my-server': { command: 'echo', args: ['hello'] },
        'another-server': { command: 'cat' },
      },
    }

    const sessionsDir = path.join(ctx.cenvHome, 'sessions')
    const session = await createSession(config, envDir, sessionsDir)

    const mcpConfig = JSON.parse(fs.readFileSync(session.mcpConfigPath, 'utf8'))
    expect(mcpConfig.mcpServers).toBeDefined()
    expect(mcpConfig.mcpServers['my-server']).toBeDefined()
    expect(mcpConfig.mcpServers['my-server'].command).toBe('echo')
    expect(mcpConfig.mcpServers['another-server']).toBeDefined()
  })

  test('createSession with hooks: settings.json has hooks in Claude Code format', async () => {
    const envDir = createEnvDir('hooks-env', ctx.cenvHome)
    const config: EnvConfig = {
      name: 'hooks-env',
      hooks: {
        PostToolUse: [{ command: 'echo "tool used"' }],
        Stop: [{ command: 'echo "stopped"' }],
      },
    }

    const sessionsDir = path.join(ctx.cenvHome, 'sessions')
    const session = await createSession(config, envDir, sessionsDir)

    const settings = JSON.parse(fs.readFileSync(session.settingsPath, 'utf8'))
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks.PostToolUse).toBeDefined()
    expect(Array.isArray(settings.hooks.PostToolUse)).toBe(true)
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('echo "tool used"')
    expect(settings.hooks.Stop).toBeDefined()
  })

  // ── Full run flow (subprocess with mock claude) ───────────────────────────────

  test('dry-run output contains --settings and --append-system-prompt-file', async () => {
    // Create a personal env first
    createEnvDir('my-env', ctx.cenvHome)

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

    expect(output).toContain('--settings')
    expect(output).toContain('--append-system-prompt-file')
  })

  test('dry-run creates the session settings.json at the mentioned path', async () => {
    createEnvDir('my-env', ctx.cenvHome)

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

    // Extract the settings path from the dry-run output.
    // The output uses line-continuation format: "--settings \" then path on next line with "│" prefix.
    // Match the path that appears on the line after "--settings"
    const match = output.match(/--settings\s*\\\s*\n[│\s]*(\S+)/) ?? output.match(/--settings\s+(\S+)/)
    expect(match).not.toBeNull()

    const settingsPath = match![1]
    expect(fs.existsSync(settingsPath)).toBe(true)
  })
})
