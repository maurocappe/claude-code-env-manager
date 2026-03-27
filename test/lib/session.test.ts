import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSession, cleanupStaleSessions } from '../../src/lib/session'
import * as keychain from '../../src/lib/keychain'
import type { EnvConfig } from '../../src/types'

describe('createSession', () => {
  let tmpDir: string
  let envDir: string
  let sessionsDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-session-test-'))
    envDir = path.join(tmpDir, 'env')
    sessionsDir = path.join(tmpDir, 'sessions')
    fs.mkdirSync(envDir, { recursive: true })
    fs.writeFileSync(path.join(envDir, 'claude.md'), '# Test env\n', 'utf8')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('generates settings.json with effortLevel and permissions', async () => {
    const config: EnvConfig = {
      name: 'test-env',
      settings: {
        effortLevel: 'high',
        permissions: { allow: ['Bash(pytest *)'] },
      },
    }

    const session = await createSession(config, envDir, sessionsDir)

    const settings = JSON.parse(fs.readFileSync(session.settingsPath, 'utf8'))
    expect(settings.effortLevel).toBe('high')
    expect(settings.permissions.allow).toEqual(['Bash(pytest *)'])
  })

  test('generates settings.json with hooks in Claude Code format', async () => {
    const config: EnvConfig = {
      name: 'hooks-env',
      hooks: {
        SessionStart: [{ command: 'echo hello' }],
        Stop: [{ command: './notify.sh' }],
      },
    }

    const session = await createSession(config, envDir, sessionsDir)

    const settings = JSON.parse(fs.readFileSync(session.settingsPath, 'utf8'))
    expect(settings.hooks.SessionStart[0].hooks[0]).toEqual({
      type: 'command',
      command: 'echo hello',
    })
    expect(settings.hooks.Stop[0].hooks[0]).toEqual({
      type: 'command',
      command: './notify.sh',
    })
  })

  test('maps disabled skills to disallowedTools', async () => {
    const config: EnvConfig = {
      name: 'disable-env',
      plugins: {
        disable: ['superpowers:brainstorming', 'superpowers:writing-plans'],
      },
    }

    const session = await createSession(config, envDir, sessionsDir)

    const settings = JSON.parse(fs.readFileSync(session.settingsPath, 'utf8'))
    expect(settings.disallowedTools).toEqual([
      'Skill(superpowers:brainstorming)',
      'Skill(superpowers:writing-plans)',
    ])
  })

  test('generates mcp.json with server configs', async () => {
    const config: EnvConfig = {
      name: 'mcp-env',
      mcp_servers: {
        postgres: {
          command: 'uvx',
          args: ['mcp-server-postgres', 'postgresql://localhost/mydb'],
        },
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'plain-token-value' },
        },
      },
    }

    const session = await createSession(config, envDir, sessionsDir)

    const mcp = JSON.parse(fs.readFileSync(session.mcpConfigPath, 'utf8'))
    expect(mcp.mcpServers.postgres.command).toBe('uvx')
    expect(mcp.mcpServers.postgres.args).toEqual(['mcp-server-postgres', 'postgresql://localhost/mydb'])
    expect(mcp.mcpServers.github.env.GITHUB_TOKEN).toBe('plain-token-value')
  })

  test('resolves keychain: references in MCP server env vars', async () => {
    const spy = spyOn(keychain, 'keychainRead').mockResolvedValue('resolved-secret')

    const config: EnvConfig = {
      name: 'keychain-mcp-env',
      mcp_servers: {
        myserver: {
          command: 'npx',
          env: { SECRET: 'keychain:my-secret-key' },
        },
      },
    }

    const session = await createSession(config, envDir, sessionsDir)

    const mcp = JSON.parse(fs.readFileSync(session.mcpConfigPath, 'utf8'))
    expect(mcp.mcpServers.myserver.env.SECRET).toBe('resolved-secret')
    expect(spy).toHaveBeenCalledWith('my-secret-key')

    spy.mockRestore()
  })

  test('claudeMdPath points to env directory', async () => {
    const config: EnvConfig = { name: 'md-env' }
    const session = await createSession(config, envDir, sessionsDir)
    expect(session.claudeMdPath).toBe(path.join(envDir, 'claude.md'))
  })

  test('session dir is PID-based', async () => {
    const config: EnvConfig = { name: 'pid-env' }
    const session = await createSession(config, envDir, sessionsDir)
    expect(session.dir).toContain(`pid-env-${process.pid}`)
  })

  test('generates empty mcp.json when no servers configured', async () => {
    const config: EnvConfig = { name: 'no-mcp' }
    const session = await createSession(config, envDir, sessionsDir)
    const mcp = JSON.parse(fs.readFileSync(session.mcpConfigPath, 'utf8'))
    expect(mcp.mcpServers).toEqual({})
  })
})

describe('cleanupStaleSessions', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-cleanup-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('removes directories with dead PIDs', () => {
    // Create a session dir with a PID that definitely doesn't exist
    const deadPid = 999999
    const deadDir = path.join(tmpDir, `test-env-${deadPid}`)
    fs.mkdirSync(deadDir, { recursive: true })
    fs.writeFileSync(path.join(deadDir, 'settings.json'), '{}', 'utf8')

    const cleaned = cleanupStaleSessions(tmpDir)
    expect(cleaned).toBe(1)
    expect(fs.existsSync(deadDir)).toBe(false)
  })

  test('keeps directories with alive PIDs', () => {
    // Use current PID — definitely alive
    const aliveDir = path.join(tmpDir, `test-env-${process.pid}`)
    fs.mkdirSync(aliveDir, { recursive: true })

    const cleaned = cleanupStaleSessions(tmpDir)
    expect(cleaned).toBe(0)
    expect(fs.existsSync(aliveDir)).toBe(true)
  })

  test('returns 0 when sessions dir does not exist', () => {
    const cleaned = cleanupStaleSessions('/tmp/nonexistent-cenv-sessions')
    expect(cleaned).toBe(0)
  })

  test('ignores directories without PID suffix', () => {
    const weirdDir = path.join(tmpDir, 'no-pid-here')
    fs.mkdirSync(weirdDir, { recursive: true })

    const cleaned = cleanupStaleSessions(tmpDir)
    expect(cleaned).toBe(0)
    expect(fs.existsSync(weirdDir)).toBe(true)
  })
})
