import fs from 'node:fs'
import path from 'node:path'
import { satisfies } from 'semver'
import { spinner } from '@clack/prompts'
import { CACHE_DIR, CLAUDE_INSTALLED_PLUGINS_PATH } from '../constants'
import { scanInstalledPlugins } from './scanner'
import type { DepResolution, EnvConfig, McpServerConfig, PluginRef, SkillRef } from '../types'

// ── Plugin dependency resolution ───────────────────────────────────────────────

/**
 * Resolve the installation status of every plugin listed in config.plugins.enable.
 *
 * Resolution order per plugin:
 * 1. Check installed in Claude Code (installed_plugins.json) — version match via semver
 * 2. Check cached in `<cachePath>/plugins/<name>/<version>/`
 * 3. Otherwise: missing
 *
 * @param config             The environment config
 * @param installedPluginsPath Override path to installed_plugins.json (for testing)
 * @param cachePath          Override path to cenv cache directory (for testing)
 */
export function resolvePluginDeps(
  config: EnvConfig,
  installedPluginsPath: string = CLAUDE_INSTALLED_PLUGINS_PATH,
  cachePath: string = CACHE_DIR
): DepResolution[] {
  const enabled = config.plugins?.enable ?? []
  if (enabled.length === 0) return []

  const installed = scanInstalledPlugins(installedPluginsPath)

  return enabled.map((ref): DepResolution => {
    // Look for a matching installed entry by name and source
    const match = installed.find(
      (p) => p.name === ref.name && (ref.source === '' || p.source === ref.source)
    )

    if (match) {
      // Check version constraint
      const versionOk =
        !ref.version || satisfies(match.version, ref.version, { includePrerelease: false })

      if (versionOk) {
        return {
          ref,
          status: 'installed',
          installedVersion: match.version,
          resolvedPath: match.path,
        }
      }

      // Version mismatch — check cache for the specific requested version
      const cachedPath = resolveCachedPlugin(ref, cachePath)
      if (cachedPath) {
        return { ref, status: 'cached', installedVersion: match.version, resolvedPath: cachedPath }
      }

      return { ref, status: 'version-mismatch', installedVersion: match.version }
    }

    // Not installed in Claude Code — check cache
    const cachedPath = resolveCachedPlugin(ref, cachePath)
    if (cachedPath) {
      return { ref, status: 'cached', resolvedPath: cachedPath }
    }

    return { ref, status: 'missing' }
  })
}

/**
 * Return the cached plugin path if it exists in <cachePath>/plugins/<name>/<version>/,
 * or null if not present.
 */
function resolveCachedPlugin(ref: PluginRef, cachePath: string): string | null {
  if (!ref.version) return null
  const dir = path.join(cachePath, 'plugins', ref.name, ref.version)
  return fs.existsSync(dir) ? dir : null
}

// ── Skill dependency resolution ────────────────────────────────────────────────

/**
 * Resolve the installation status of every skill listed in config.skills.
 *
 * - Local skills (path starts with `.`) → check if path exists relative to envDir
 * - Source-based skills → check cache at `<cachePath>/skills/<name>/`
 *
 * @param config    The environment config
 * @param envDir    Directory of the environment (for resolving relative local paths)
 * @param cachePath Override path to cenv cache directory (for testing)
 */
export function resolveSkillDeps(
  config: EnvConfig,
  envDir?: string,
  cachePath: string = CACHE_DIR
): DepResolution[] {
  const skills = config.skills ?? []
  if (skills.length === 0) return []

  return skills.map((ref): DepResolution => {
    // Local skill — path starts with '.'
    if (ref.path?.startsWith('.')) {
      if (!envDir) {
        return { ref, status: 'missing' }
      }
      const localPath = path.resolve(envDir, ref.path)
      if (fs.existsSync(localPath)) {
        return { ref, status: 'installed', resolvedPath: localPath }
      }
      return { ref, status: 'missing' }
    }

    // Source-based skill — check cache
    if (ref.source) {
      const skillName = ref.name ?? deriveSkillNameFromSource(ref.source)
      const cachedPath = path.join(cachePath, 'skills', skillName)
      if (fs.existsSync(cachedPath)) {
        return { ref, status: 'cached', resolvedPath: cachedPath }
      }
      return { ref, status: 'missing' }
    }

    // No path, no source — treat as missing
    return { ref, status: 'missing' }
  })
}

/**
 * Derive a skill name from a source string like `github:user/repo` → `repo`.
 */
function deriveSkillNameFromSource(source: string): string {
  const parts = source.split('/')
  return parts[parts.length - 1] ?? source
}

// ── MCP server availability ────────────────────────────────────────────────────

/**
 * Check whether the MCP server's command binary exists on the system PATH.
 * Uses `which` (macOS/Linux) to locate the binary.
 *
 * @param config  MCP server configuration with a `command` field
 */
export function checkMcpAvailable(config: McpServerConfig): boolean {
  if (!config.command) return false

  try {
    const proc = Bun.spawnSync(['which', config.command], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return proc.exitCode === 0
  } catch {
    return false
  }
}

// ── Installation functions ─────────────────────────────────────────────────────

/**
 * Install a plugin into Claude Code by running `claude plugins install <name>@<source>`.
 * Inherits stdio so the user can respond to interactive prompts.
 */
export async function installPlugin(ref: PluginRef): Promise<void> {
  const target = ref.version ? `${ref.name}@${ref.source}@${ref.version}` : `${ref.name}@${ref.source}`
  const proc = Bun.spawn(['claude', 'plugins', 'install', target], {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`claude plugins install exited with code ${exitCode}`)
  }
}

/**
 * Clone/cache a plugin to `<cachePath>/plugins/<name>/<version>/` so it can be
 * used via `--plugin-dir` without installing into the global Claude Code setup.
 */
export async function cachePlugin(ref: PluginRef, cachePath: string = CACHE_DIR): Promise<void> {
  const version = ref.version ?? 'latest'
  const targetDir = path.join(cachePath, 'plugins', ref.name, version)
  fs.mkdirSync(targetDir, { recursive: true })

  const spin = spinner()
  spin.start(`Caching plugin ${ref.name}@${version}...`)
  try {
    const proc = Bun.spawn(['git', 'clone', '--depth=1', ref.source, targetDir], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      fs.rmSync(targetDir, { recursive: true, force: true })
      spin.stop(`Failed to cache plugin ${ref.name}`)
      throw new Error(`git clone exited with code ${exitCode}`)
    }
    spin.stop(`Cached plugin ${ref.name}@${version}`)
  } catch (err) {
    spin.stop(`Failed to cache plugin ${ref.name}`)
    throw err
  }
}

/**
 * Install a skill by git-cloning the repo specified in ref.source.
 * Stores in `<cachePath>/skills/<name>/`.
 *
 * Source format: `github:<user>/<repo>` or `github:<user>/<repo>/<subpath>`
 */
export async function installSkill(ref: SkillRef, cachePath: string = CACHE_DIR): Promise<void> {
  if (!ref.source) {
    throw new Error(`Skill has no source to install from`)
  }

  const skillName = ref.name ?? deriveSkillNameFromSource(ref.source)
  const targetDir = path.join(cachePath, 'skills', skillName)

  if (fs.existsSync(targetDir)) {
    // Already cached — skip
    return
  }

  const spin = spinner()
  spin.start(`Installing skill ${skillName}...`)

  try {
    const { cloneUrl, subPath } = parseSkillSource(ref.source)

    if (subPath && ref.path) {
      // Sparse checkout — only pull the subdirectory
      await sparseCloneSkill(cloneUrl, subPath, targetDir)
    } else {
      // Full clone
      fs.mkdirSync(targetDir, { recursive: true })
      const proc = Bun.spawn(['git', 'clone', '--depth=1', cloneUrl, targetDir], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const exitCode = await proc.exited
      if (exitCode !== 0) {
        fs.rmSync(targetDir, { recursive: true, force: true })
        spin.stop(`Failed to install skill ${skillName}`)
        throw new Error(`git clone exited with code ${exitCode}`)
      }
    }

    spin.stop(`Installed skill ${skillName}`)
  } catch (err) {
    spin.stop(`Failed to install skill ${skillName}`)
    throw err
  }
}

/**
 * Parse a skill source string into a git clone URL and optional subpath.
 * Supports:
 *  - `github:user/repo`          → https://github.com/user/repo.git
 *  - `github:user/repo/subpath`  → https://github.com/user/repo.git + subpath
 */
function parseSkillSource(source: string): { cloneUrl: string; subPath?: string } {
  if (source.startsWith('github:')) {
    const rest = source.slice('github:'.length)
    const parts = rest.split('/')
    const user = parts[0]
    const repo = parts[1]
    const subPath = parts.slice(2).join('/') || undefined
    return {
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      subPath,
    }
  }
  // Fall through: treat as a raw git URL
  return { cloneUrl: source }
}

/**
 * Sparse-clone only `subPath` from `cloneUrl` into `targetDir`.
 */
async function sparseCloneSkill(
  cloneUrl: string,
  subPath: string,
  targetDir: string
): Promise<void> {
  fs.mkdirSync(targetDir, { recursive: true })

  const cmds: string[][] = [
    ['git', 'init'],
    ['git', 'remote', 'add', 'origin', cloneUrl],
    ['git', 'sparse-checkout', 'init', '--cone'],
    ['git', 'sparse-checkout', 'set', subPath],
    ['git', 'pull', '--depth=1', 'origin', 'HEAD'],
  ]

  for (const cmd of cmds) {
    const proc = Bun.spawn(cmd, {
      cwd: targetDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      fs.rmSync(targetDir, { recursive: true, force: true })
      throw new Error(`Sparse clone command [${cmd.join(' ')}] exited with code ${exitCode}`)
    }
  }
}

/**
 * Install an MCP server by running the command specified in config.install.
 * Inherits stdio so the user sees progress output.
 */
export async function installMcpServer(config: McpServerConfig): Promise<void> {
  if (!config.install) {
    throw new Error('MCP server config has no install command')
  }

  const spin = spinner()
  spin.start(`Installing MCP server (${config.command})...`)
  try {
    // Run as a shell command so install scripts work correctly
    const proc = Bun.spawn(['sh', '-c', config.install], {
      stdio: ['inherit', 'inherit', 'inherit'],
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      spin.stop(`MCP install failed (exit ${exitCode})`)
      throw new Error(`MCP server install exited with code ${exitCode}`)
    }
    spin.stop(`MCP server (${config.command}) installed`)
  } catch (err) {
    spin.stop(`Failed to install MCP server (${config.command})`)
    throw err
  }
}
