import { describe, expect, test, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { scanInstalledPlugins, scanInstalledSkills, scanCurrentSettings } from '@/lib/scanner'

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
