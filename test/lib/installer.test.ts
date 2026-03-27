import { describe, test, expect, mock, afterEach, beforeEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  resolvePluginDeps,
  resolveSkillDeps,
  checkMcpAvailable,
} from '@/lib/installer'
import type { EnvConfig } from '@/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTempDir(prefix = 'cenv-installer-test-'): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

/** Write an installed_plugins.json fixture to the given path */
function writeInstalledPlugins(
  filePath: string,
  plugins: Record<
    string,
    Array<{ scope: string; installPath: string; version: string }>
  >
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ version: 2, plugins }), 'utf8')
}

// ── resolvePluginDeps ──────────────────────────────────────────────────────────

describe('resolvePluginDeps', () => {
  let tmp: { dir: string; cleanup: () => void }

  beforeEach(() => {
    tmp = makeTempDir()
  })

  afterEach(() => {
    tmp.cleanup()
  })

  test('returns installed status for all plugins when they are installed in Claude Code', () => {
    const installedPluginsPath = path.join(tmp.dir, 'installed_plugins.json')
    writeInstalledPlugins(installedPluginsPath, {
      'superpowers@marketplace': [
        { scope: 'user', installPath: '/path/to/superpowers', version: '5.1.0' },
      ],
    })

    const config: EnvConfig = {
      name: 'test',
      plugins: {
        enable: [{ name: 'superpowers', source: 'marketplace', version: '^5.0.0' }],
      },
    }

    const result = resolvePluginDeps(config, installedPluginsPath)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('installed')
    expect(result[0].resolvedPath).toBe('/path/to/superpowers')
    expect(result[0].installedVersion).toBe('5.1.0')
  })

  test('returns missing status when no plugins are installed', () => {
    const installedPluginsPath = path.join(tmp.dir, 'installed_plugins.json')
    // File does not exist — scanner returns []

    const config: EnvConfig = {
      name: 'test',
      plugins: {
        enable: [{ name: 'superpowers', source: 'marketplace', version: '^5.0.0' }],
      },
    }

    const result = resolvePluginDeps(config, installedPluginsPath)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('missing')
    expect(result[0].resolvedPath).toBeUndefined()
  })

  test('returns version-mismatch when installed version does not satisfy range', () => {
    const installedPluginsPath = path.join(tmp.dir, 'installed_plugins.json')
    // Installed: 4.0.3, required: ^5.0.0
    writeInstalledPlugins(installedPluginsPath, {
      'superpowers@marketplace': [
        { scope: 'user', installPath: '/path/to/superpowers', version: '4.0.3' },
      ],
    })

    const config: EnvConfig = {
      name: 'test',
      plugins: {
        enable: [{ name: 'superpowers', source: 'marketplace', version: '^5.0.0' }],
      },
    }

    const result = resolvePluginDeps(config, installedPluginsPath)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('version-mismatch')
    expect(result[0].installedVersion).toBe('4.0.3')
  })

  test('returns installed when no version constraint is specified (any installed version matches)', () => {
    const installedPluginsPath = path.join(tmp.dir, 'installed_plugins.json')
    writeInstalledPlugins(installedPluginsPath, {
      'superpowers@marketplace': [
        { scope: 'user', installPath: '/path/to/superpowers', version: '3.0.0' },
      ],
    })

    const config: EnvConfig = {
      name: 'test',
      plugins: {
        enable: [{ name: 'superpowers', source: 'marketplace' }], // no version
      },
    }

    const result = resolvePluginDeps(config, installedPluginsPath)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('installed')
  })

  test('returns cached status when plugin is in cenv cache but not installed in Claude Code', () => {
    const installedPluginsPath = path.join(tmp.dir, 'installed_plugins.json')
    // installed_plugins.json does not exist

    // Create a cache entry
    const cachePath = path.join(tmp.dir, 'cache')
    const pluginCacheDir = path.join(cachePath, 'plugins', 'superpowers', '5.0.0')
    fs.mkdirSync(pluginCacheDir, { recursive: true })

    const config: EnvConfig = {
      name: 'test',
      plugins: {
        enable: [{ name: 'superpowers', source: 'marketplace', version: '5.0.0' }],
      },
    }

    const result = resolvePluginDeps(config, installedPluginsPath, cachePath)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('cached')
    expect(result[0].resolvedPath).toBe(pluginCacheDir)
  })

  test('returns empty array when config has no plugins', () => {
    const installedPluginsPath = path.join(tmp.dir, 'installed_plugins.json')

    const config: EnvConfig = { name: 'test' }
    const result = resolvePluginDeps(config, installedPluginsPath)

    expect(result).toEqual([])
  })

  test('handles multiple plugins with mixed statuses', () => {
    const installedPluginsPath = path.join(tmp.dir, 'installed_plugins.json')
    writeInstalledPlugins(installedPluginsPath, {
      'superpowers@marketplace': [
        { scope: 'user', installPath: '/path/to/superpowers', version: '5.1.0' },
      ],
      // my-plugin not installed
    })

    const config: EnvConfig = {
      name: 'test',
      plugins: {
        enable: [
          { name: 'superpowers', source: 'marketplace', version: '^5.0.0' },
          { name: 'my-plugin', source: 'github', version: '^1.0.0' },
        ],
      },
    }

    const result = resolvePluginDeps(config, installedPluginsPath)

    expect(result).toHaveLength(2)
    const superpowers = result.find((r) => (r.ref as { name: string }).name === 'superpowers')
    const myPlugin = result.find((r) => (r.ref as { name: string }).name === 'my-plugin')
    expect(superpowers?.status).toBe('installed')
    expect(myPlugin?.status).toBe('missing')
  })
})

// ── resolveSkillDeps ───────────────────────────────────────────────────────────

describe('resolveSkillDeps', () => {
  let tmp: { dir: string; cleanup: () => void }

  beforeEach(() => {
    tmp = makeTempDir()
  })

  afterEach(() => {
    tmp.cleanup()
  })

  test('returns missing for a source-based skill not in cache', () => {
    const cachePath = path.join(tmp.dir, 'cache')

    const config: EnvConfig = {
      name: 'test',
      skills: [{ name: 'my-skill', source: 'github:user/skills-repo' }],
    }

    const result = resolveSkillDeps(config, undefined, cachePath)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('missing')
  })

  test('returns cached for a source-based skill found in cache', () => {
    const cachePath = path.join(tmp.dir, 'cache')
    const skillCacheDir = path.join(cachePath, 'skills', 'my-skill')
    fs.mkdirSync(skillCacheDir, { recursive: true })

    const config: EnvConfig = {
      name: 'test',
      skills: [{ name: 'my-skill', source: 'github:user/skills-repo' }],
    }

    const result = resolveSkillDeps(config, undefined, cachePath)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('cached')
    expect(result[0].resolvedPath).toBe(skillCacheDir)
  })

  test('returns installed for a local path skill that exists', () => {
    const envDir = path.join(tmp.dir, 'my-env')
    const localSkillDir = path.join(envDir, 'skills', 'my-local-skill')
    fs.mkdirSync(localSkillDir, { recursive: true })

    const config: EnvConfig = {
      name: 'test',
      skills: [{ path: './skills/my-local-skill' }],
    }

    const result = resolveSkillDeps(config, envDir)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('installed')
    expect(result[0].resolvedPath).toBe(localSkillDir)
  })

  test('returns missing for a local path skill that does not exist', () => {
    const envDir = path.join(tmp.dir, 'my-env')
    fs.mkdirSync(envDir, { recursive: true })

    const config: EnvConfig = {
      name: 'test',
      skills: [{ path: './skills/missing-skill' }],
    }

    const result = resolveSkillDeps(config, envDir)

    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('missing')
  })

  test('returns empty array when config has no skills', () => {
    const config: EnvConfig = { name: 'test' }
    const result = resolveSkillDeps(config)
    expect(result).toEqual([])
  })
})

// ── checkMcpAvailable ──────────────────────────────────────────────────────────

describe('checkMcpAvailable', () => {
  test('returns true for a command that exists (echo)', () => {
    const result = checkMcpAvailable({ command: 'echo', args: ['hello'] })
    expect(result).toBe(true)
  })

  test('returns false for a command that does not exist', () => {
    const result = checkMcpAvailable({
      command: 'cenv-definitely-not-a-real-binary-xyz',
      args: [],
    })
    expect(result).toBe(false)
  })

  test('returns false for empty command', () => {
    const result = checkMcpAvailable({ command: '', args: [] })
    expect(result).toBe(false)
  })
})
