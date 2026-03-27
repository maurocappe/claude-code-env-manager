import { describe, expect, test, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { scanInstalledPlugins, scanInstalledSkills, scanCurrentSettings, scanPluginComponents } from '@/lib/scanner'

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
