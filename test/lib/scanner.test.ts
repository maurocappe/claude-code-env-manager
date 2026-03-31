import { describe, expect, test, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  scanInstalledPlugins,
  scanInstalledSkills,
  scanCurrentSettings,
  scanPluginComponents,
  scanCurrentHooks,
  scanStatusLine,
  scanInstalledCommands,
  scanInstalledRules,
} from '@/lib/scanner'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-scanner-test-'))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

// ── scanInstalledPlugins ───────────────────────────────────────────────────────

describe('scanInstalledPlugins', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('returns empty array when file does not exist', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const result = scanInstalledPlugins(path.join(dir, 'installed_plugins.json'))
    expect(result).toEqual([])
  })

  test('returns empty array when file contains invalid JSON', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'installed_plugins.json')
    fs.writeFileSync(p, 'not json', 'utf8')
    expect(scanInstalledPlugins(p)).toEqual([])
  })

  test('returns empty array when plugins field is missing', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'installed_plugins.json')
    fs.writeFileSync(p, JSON.stringify({ version: 2 }), 'utf8')
    expect(scanInstalledPlugins(p)).toEqual([])
  })

  test('parses a single plugin entry correctly', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'installed_plugins.json')

    const fixture = {
      version: 2,
      plugins: {
        'superpowers@marketplace': [
          {
            scope: 'user',
            installPath: '/Users/test/.claude/plugins/superpowers',
            version: '5.1.0',
          },
        ],
      },
    }
    fs.writeFileSync(p, JSON.stringify(fixture), 'utf8')

    const result = scanInstalledPlugins(p)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('superpowers')
    expect(result[0].source).toBe('marketplace')
    expect(result[0].version).toBe('5.1.0')
    expect(result[0].scope).toBe('user')
    expect(result[0].path).toBe('/Users/test/.claude/plugins/superpowers')
  })

  test('parses multiple plugin entries from multiple keys', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'installed_plugins.json')

    const fixture = {
      version: 2,
      plugins: {
        'superpowers@marketplace': [
          { scope: 'user', installPath: '/path/to/superpowers', version: '5.0.0' },
        ],
        'my-plugin@github': [
          { scope: 'local', installPath: '/path/to/my-plugin', version: '1.2.3' },
        ],
      },
    }
    fs.writeFileSync(p, JSON.stringify(fixture), 'utf8')

    const result = scanInstalledPlugins(p)
    expect(result).toHaveLength(2)

    const names = result.map((r) => r.name)
    expect(names).toContain('superpowers')
    expect(names).toContain('my-plugin')

    const local = result.find((r) => r.name === 'my-plugin')
    expect(local?.scope).toBe('local')
    expect(local?.source).toBe('github')
  })

  test('handles plugin key with no @ (no source)', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'installed_plugins.json')

    const fixture = {
      version: 2,
      plugins: {
        'bare-plugin': [
          { scope: 'user', installPath: '/path', version: '0.1.0' },
        ],
      },
    }
    fs.writeFileSync(p, JSON.stringify(fixture), 'utf8')

    const result = scanInstalledPlugins(p)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('bare-plugin')
    expect(result[0].source).toBe('')
  })

  test('multiple installs per key produce multiple entries', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'installed_plugins.json')

    const fixture = {
      version: 2,
      plugins: {
        'myplugin@market': [
          { scope: 'user', installPath: '/path/user', version: '1.0.0' },
          { scope: 'local', installPath: '/path/local', version: '1.0.0' },
        ],
      },
    }
    fs.writeFileSync(p, JSON.stringify(fixture), 'utf8')

    const result = scanInstalledPlugins(p)
    expect(result).toHaveLength(2)
  })
})

// ── scanInstalledSkills ────────────────────────────────────────────────────────

describe('scanInstalledSkills', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('returns empty array when skills directory does not exist', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const result = scanInstalledSkills(path.join(dir, 'skills'))
    expect(result).toEqual([])
  })

  test('returns empty array when skills dir has no subdirs with SKILL.md', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const skillsDir = path.join(dir, 'skills')
    fs.mkdirSync(skillsDir)
    // A dir without SKILL.md — should be ignored
    fs.mkdirSync(path.join(skillsDir, 'not-a-skill'))
    expect(scanInstalledSkills(skillsDir)).toEqual([])
  })

  test('detects a skill directory that contains SKILL.md', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const skillsDir = path.join(dir, 'skills')
    fs.mkdirSync(skillsDir)

    const skillDir = path.join(skillsDir, 'my-skill')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\n', 'utf8')

    const result = scanInstalledSkills(skillsDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('my-skill')
    expect(result[0].path).toBe(skillDir)
    expect(result[0].source).toBeUndefined()
  })

  test('picks up source from skill-lock.json', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const skillsDir = path.join(dir, 'skills')
    fs.mkdirSync(skillsDir)

    const skillDir = path.join(skillsDir, 'my-skill')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# My Skill\n', 'utf8')

    const lockPath = path.join(dir, '.skill-lock.json')
    fs.writeFileSync(lockPath, JSON.stringify({ 'my-skill': { source: 'github:user/repo' } }), 'utf8')

    const result = scanInstalledSkills(skillsDir, lockPath)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('github:user/repo')
  })

  test('ignores non-directory entries in skills dir', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const skillsDir = path.join(dir, 'skills')
    fs.mkdirSync(skillsDir)

    // A file in the skills dir (not a dir) should be ignored
    fs.writeFileSync(path.join(skillsDir, 'some-file.md'), '# not a skill\n', 'utf8')

    // A valid skill
    const skillDir = path.join(skillsDir, 'real-skill')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Real\n', 'utf8')

    const result = scanInstalledSkills(skillsDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('real-skill')
  })

  test('handles malformed skill-lock.json gracefully', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const skillsDir = path.join(dir, 'skills')
    fs.mkdirSync(skillsDir)

    const skillDir = path.join(skillsDir, 'my-skill')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# \n', 'utf8')

    const lockPath = path.join(dir, '.skill-lock.json')
    fs.writeFileSync(lockPath, 'INVALID JSON', 'utf8')

    const result = scanInstalledSkills(skillsDir, lockPath)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBeUndefined()
  })
})

// ── scanCurrentSettings ────────────────────────────────────────────────────────

describe('scanCurrentSettings', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('returns null when settings.json does not exist', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const result = scanCurrentSettings(path.join(dir, 'settings.json'))
    expect(result).toBeNull()
  })

  test('returns null when settings.json contains invalid JSON', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')
    fs.writeFileSync(p, 'not json', 'utf8')
    expect(scanCurrentSettings(p)).toBeNull()
  })

  test('parses a valid settings.json', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')
    const settings = {
      effortLevel: 'high',
      permissions: { allow: ['Bash(*)', 'Read(*)'] },
    }
    fs.writeFileSync(p, JSON.stringify(settings), 'utf8')

    const result = scanCurrentSettings(p)
    expect(result).not.toBeNull()
    expect(result?.effortLevel).toBe('high')
    expect((result?.permissions as { allow: string[] })?.allow).toEqual(['Bash(*)', 'Read(*)'])
  })
})

// ── scanPluginComponents ───────────────────────────────────────────────────────

describe('scanPluginComponents', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('returns empty arrays when plugin dir does not exist', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const result = scanPluginComponents(path.join(dir, 'nonexistent'))
    expect(result.skills).toEqual([])
    expect(result.hooks).toEqual({})
    expect(result.mcpServers).toEqual([])
    expect(result.agents).toEqual([])
  })

  test('scans skills/ directory and returns skill names with SKILL.md', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    // Create skills
    fs.mkdirSync(path.join(dir, 'skills', 'my-skill'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'skills', 'my-skill', 'SKILL.md'), '# skill\n', 'utf8')
    fs.mkdirSync(path.join(dir, 'skills', 'not-a-skill'), { recursive: true })
    // no SKILL.md in not-a-skill — should be excluded

    const result = scanPluginComponents(dir)
    expect(result.skills).toEqual(['my-skill'])
  })

  test('scans multiple skills', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    for (const name of ['tdd', 'debugging', 'brainstorming']) {
      fs.mkdirSync(path.join(dir, 'skills', name), { recursive: true })
      fs.writeFileSync(path.join(dir, 'skills', name, 'SKILL.md'), `# ${name}\n`, 'utf8')
    }

    const result = scanPluginComponents(dir)
    expect(result.skills).toHaveLength(3)
    expect(result.skills).toContain('tdd')
    expect(result.skills).toContain('debugging')
    expect(result.skills).toContain('brainstorming')
  })

  test('parses hooks/hooks.json into hooks record', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true })
    const hooksData = {
      SessionStart: [{ command: 'echo hello' }],
      Stop: [{ command: 'echo bye' }],
    }
    fs.writeFileSync(path.join(dir, 'hooks', 'hooks.json'), JSON.stringify(hooksData), 'utf8')

    const result = scanPluginComponents(dir)
    expect(Object.keys(result.hooks)).toContain('SessionStart')
    expect(Object.keys(result.hooks)).toContain('Stop')
    expect(result.hooks.SessionStart).toHaveLength(1)
  })

  test('returns empty hooks when hooks/hooks.json does not exist', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    const result = scanPluginComponents(dir)
    expect(result.hooks).toEqual({})
  })

  test('returns empty hooks when hooks.json contains invalid JSON', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'hooks', 'hooks.json'), 'INVALID', 'utf8')

    const result = scanPluginComponents(dir)
    expect(result.hooks).toEqual({})
  })

  test('parses MCP server names from .mcp.json', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    const mcpData = {
      mcpServers: {
        postgres: { command: 'uvx', args: ['mcp-server-postgres'] },
        github: { command: 'npx', args: ['@mcp/server-github'] },
      },
    }
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify(mcpData), 'utf8')

    const result = scanPluginComponents(dir)
    expect(result.mcpServers).toContain('postgres')
    expect(result.mcpServers).toContain('github')
    expect(result.mcpServers).toHaveLength(2)
  })

  test('returns empty mcpServers when .mcp.json does not exist', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    const result = scanPluginComponents(dir)
    expect(result.mcpServers).toEqual([])
  })

  test('returns empty mcpServers when .mcp.json is malformed', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    fs.writeFileSync(path.join(dir, '.mcp.json'), 'BAD JSON', 'utf8')

    const result = scanPluginComponents(dir)
    expect(result.mcpServers).toEqual([])
  })

  test('scans .claude-plugin/agents/ for agent names', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    fs.mkdirSync(path.join(dir, '.claude-plugin', 'agents', 'my-agent'), { recursive: true })
    fs.mkdirSync(path.join(dir, '.claude-plugin', 'agents', 'other-agent'), { recursive: true })

    const result = scanPluginComponents(dir)
    expect(result.agents).toContain('my-agent')
    expect(result.agents).toContain('other-agent')
    expect(result.agents).toHaveLength(2)
  })

  test('returns empty agents when agents dir does not exist', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    const result = scanPluginComponents(dir)
    expect(result.agents).toEqual([])
  })

  test('returns all components together when full plugin structure exists', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    // Skills
    fs.mkdirSync(path.join(dir, 'skills', 'tdd'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'skills', 'tdd', 'SKILL.md'), '# tdd\n', 'utf8')

    // Hooks
    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'hooks', 'hooks.json'),
      JSON.stringify({ SessionStart: [{ command: 'echo' }] }),
      'utf8'
    )

    // MCP
    fs.writeFileSync(
      path.join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { pg: { command: 'uvx' } } }),
      'utf8'
    )

    // Agents
    fs.mkdirSync(path.join(dir, '.claude-plugin', 'agents', 'helper'), { recursive: true })

    const result = scanPluginComponents(dir)
    expect(result.skills).toEqual(['tdd'])
    expect(result.hooks).toHaveProperty('SessionStart')
    expect(result.mcpServers).toEqual(['pg'])
    expect(result.agents).toEqual(['helper'])
  })
})

// ── scanCurrentHooks ──────────────────────────────────────────────────────────

describe('scanCurrentHooks', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('extracts hook commands from Claude Code settings format', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')

    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              { type: 'command', command: 'echo "before bash"' },
              { type: 'command', command: 'validate-bash.sh' },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: 'log-tool-use.sh' }],
          },
        ],
      },
    }
    fs.writeFileSync(p, JSON.stringify(settings), 'utf8')

    const result = scanCurrentHooks(p)
    expect(Object.keys(result)).toEqual(['PreToolUse', 'PostToolUse'])
    expect(result.PreToolUse).toEqual([
      { command: 'echo "before bash"' },
      { command: 'validate-bash.sh' },
    ])
    expect(result.PostToolUse).toEqual([{ command: 'log-tool-use.sh' }])
  })

  test('returns empty when no hooks in settings', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')
    fs.writeFileSync(p, JSON.stringify({ effortLevel: 'high' }), 'utf8')

    expect(scanCurrentHooks(p)).toEqual({})
  })

  test('returns empty when settings file missing', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    expect(scanCurrentHooks(path.join(dir, 'settings.json'))).toEqual({})
  })

  test('skips non-command hook types', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')

    const settings = {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: 'command', command: 'echo hello' },
              { type: 'other', value: 'something' },
            ],
          },
        ],
      },
    }
    fs.writeFileSync(p, JSON.stringify(settings), 'utf8')

    const result = scanCurrentHooks(p)
    expect(result.PreToolUse).toEqual([{ command: 'echo hello' }])
  })

  test('skips events where no command hooks are found', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')

    const settings = {
      hooks: {
        PreToolUse: [
          {
            hooks: [{ type: 'other', value: 'not a command' }],
          },
        ],
      },
    }
    fs.writeFileSync(p, JSON.stringify(settings), 'utf8')

    expect(scanCurrentHooks(p)).toEqual({})
  })
})

// ── scanStatusLine ────────────────────────────────────────────────────────────

describe('scanStatusLine', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('returns statusLine object from settings', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')

    const settings = {
      statusLine: {
        enabled: true,
        command: 'git-status-line.sh',
      },
    }
    fs.writeFileSync(p, JSON.stringify(settings), 'utf8')

    const result = scanStatusLine(p)
    expect(result).toEqual({ enabled: true, command: 'git-status-line.sh' })
  })

  test('returns null when no statusLine', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')
    fs.writeFileSync(p, JSON.stringify({ effortLevel: 'high' }), 'utf8')

    expect(scanStatusLine(p)).toBeNull()
  })

  test('returns null when settings file missing', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    expect(scanStatusLine(path.join(dir, 'settings.json'))).toBeNull()
  })

  test('returns null when statusLine is not an object', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const p = path.join(dir, 'settings.json')
    fs.writeFileSync(p, JSON.stringify({ statusLine: 'not an object' }), 'utf8')

    expect(scanStatusLine(p)).toBeNull()
  })
})

// ── scanInstalledCommands ─────────────────────────────────────────────────────

describe('scanInstalledCommands', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('finds .md files in commands directory', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const cmdsDir = path.join(dir, 'commands')
    fs.mkdirSync(cmdsDir)

    fs.writeFileSync(path.join(cmdsDir, 'deploy.md'), '# Deploy\nRun deployment', 'utf8')
    fs.writeFileSync(path.join(cmdsDir, 'test.md'), '# Test\nRun tests', 'utf8')

    const result = scanInstalledCommands(cmdsDir)
    expect(result).toHaveLength(2)

    const names = result.map((r) => r.name)
    expect(names).toContain('deploy')
    expect(names).toContain('test')

    const deploy = result.find((r) => r.name === 'deploy')
    expect(deploy?.path).toBe(path.join(cmdsDir, 'deploy.md'))
    expect(deploy?.description).toBeUndefined()
  })

  test('extracts description from YAML frontmatter', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const cmdsDir = path.join(dir, 'commands')
    fs.mkdirSync(cmdsDir)

    const content = `---
description: Run the full deployment pipeline
author: test
---
# Deploy

Steps to deploy...`
    fs.writeFileSync(path.join(cmdsDir, 'deploy.md'), content, 'utf8')

    const result = scanInstalledCommands(cmdsDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('deploy')
    expect(result[0].description).toBe('Run the full deployment pipeline')
  })

  test('handles files without frontmatter', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const cmdsDir = path.join(dir, 'commands')
    fs.mkdirSync(cmdsDir)

    fs.writeFileSync(path.join(cmdsDir, 'simple.md'), '# Simple command\nJust do it', 'utf8')

    const result = scanInstalledCommands(cmdsDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('simple')
    expect(result[0].description).toBeUndefined()
  })

  test('returns empty when directory missing', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    expect(scanInstalledCommands(path.join(dir, 'nonexistent'))).toEqual([])
  })

  test('ignores non-.md files', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const cmdsDir = path.join(dir, 'commands')
    fs.mkdirSync(cmdsDir)

    fs.writeFileSync(path.join(cmdsDir, 'readme.txt'), 'not a command', 'utf8')
    fs.writeFileSync(path.join(cmdsDir, 'script.sh'), '#!/bin/bash', 'utf8')
    fs.writeFileSync(path.join(cmdsDir, 'deploy.md'), '# Deploy', 'utf8')

    const result = scanInstalledCommands(cmdsDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('deploy')
  })

  test('ignores subdirectories', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const cmdsDir = path.join(dir, 'commands')
    fs.mkdirSync(cmdsDir)

    fs.mkdirSync(path.join(cmdsDir, 'subdir.md')) // directory ending in .md
    fs.writeFileSync(path.join(cmdsDir, 'real.md'), '# Real command', 'utf8')

    const result = scanInstalledCommands(cmdsDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('real')
  })
})

// ── scanInstalledRules ───────────────────────────────────────────────────────

describe('scanInstalledRules', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('finds .md files in rules directory', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const rulesDir = path.join(dir, 'rules')
    fs.mkdirSync(rulesDir)

    fs.writeFileSync(path.join(rulesDir, 'security.md'), '# Security rules\n', 'utf8')
    fs.writeFileSync(path.join(rulesDir, 'coding.md'), '# Coding rules\n', 'utf8')

    const result = scanInstalledRules(rulesDir)
    expect(result).toHaveLength(2)

    const names = result.map((r) => r.name)
    expect(names).toContain('security.md')
    expect(names).toContain('coding.md')

    const security = result.find((r) => r.name === 'security.md')
    expect(security?.path).toBe(path.join(rulesDir, 'security.md'))
  })

  test('finds nested .md files in subdirectories', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const rulesDir = path.join(dir, 'rules')
    fs.mkdirSync(path.join(rulesDir, 'security'), { recursive: true })
    fs.mkdirSync(path.join(rulesDir, 'style'), { recursive: true })

    fs.writeFileSync(path.join(rulesDir, 'security', 'auth.md'), '# Auth rules\n', 'utf8')
    fs.writeFileSync(path.join(rulesDir, 'style', 'formatting.md'), '# Formatting\n', 'utf8')
    fs.writeFileSync(path.join(rulesDir, 'top-level.md'), '# Top level\n', 'utf8')

    const result = scanInstalledRules(rulesDir)
    expect(result).toHaveLength(3)

    const names = result.map((r) => r.name)
    expect(names).toContain('security/auth.md')
    expect(names).toContain('style/formatting.md')
    expect(names).toContain('top-level.md')

    const nested = result.find((r) => r.name === 'security/auth.md')
    expect(nested?.path).toBe(path.join(rulesDir, 'security', 'auth.md'))
  })

  test('returns empty when directory missing', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    expect(scanInstalledRules(path.join(dir, 'nonexistent'))).toEqual([])
  })

  test('ignores non-.md files', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const rulesDir = path.join(dir, 'rules')
    fs.mkdirSync(rulesDir)

    fs.writeFileSync(path.join(rulesDir, 'readme.txt'), 'not a rule', 'utf8')
    fs.writeFileSync(path.join(rulesDir, 'script.sh'), '#!/bin/bash', 'utf8')
    fs.writeFileSync(path.join(rulesDir, 'valid.md'), '# Valid rule', 'utf8')

    const result = scanInstalledRules(rulesDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('valid.md')
  })
})
