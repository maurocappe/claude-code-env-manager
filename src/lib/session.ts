import fs from 'node:fs'
import path from 'node:path'
import { SESSIONS_TMP_DIR, CLAUDE_PLUGINS_DIR, CACHE_DIR } from '../constants'
import type { EnvConfig, SessionFiles } from '../types'
import { keychainRead } from './keychain'
// scanner imports removed — bare-mode skill computation dropped

interface SessionCreateOptions {
  installedPluginsPath?: string
  skillsDir?: string
}

/**
 * Create a temporary session directory with generated config files
 * that can be passed to claude via CLI flags.
 *
 * Uses PID-based directories to allow multiple simultaneous sessions.
 */
export async function createSession(
  config: EnvConfig,
  envDir: string,
  sessionsDir: string = SESSIONS_TMP_DIR,
  opts: SessionCreateOptions = {}
): Promise<SessionFiles> {
  const sessionName = `${config.name}-${process.pid}`
  const dir = path.join(sessionsDir, sessionName)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  // Generate settings.json (restricted permissions — may contain sensitive config)
  const settingsPath = path.join(dir, 'settings.json')
  const settings = buildSettings(config)
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 })

  // Generate mcp.json (restricted permissions — may contain resolved secrets)
  const mcpConfigPath = path.join(dir, 'mcp.json')
  const mcpConfig = await buildMcpConfig(config)
  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), { encoding: 'utf8', mode: 0o600 })

  // Claude.md path — use the env's own file directly
  const claudeMdPath = path.join(envDir, 'claude.md')

  // Resolve plugin directories
  const pluginDirs = resolvePluginDirs(config)

  // Collect disallowedTools for CLI flags
  const disallowedTools = (settings.disallowedTools as string[] ?? [])

  return { dir, settingsPath, mcpConfigPath, claudeMdPath, pluginDirs, disallowedTools }
}

/**
 * Build a settings.json from env.yaml config.
 * Maps env.yaml fields to Claude Code's settings format.
 */
function buildSettings(config: EnvConfig): Record<string, unknown> {
  const settings: Record<string, unknown> = {}

  if (config.settings?.effortLevel) {
    settings.effortLevel = config.settings.effortLevel
  }

  if (config.settings?.permissions) {
    settings.permissions = config.settings.permissions
  }

  // Map hooks from env.yaml format to Claude Code format
  if (config.hooks) {
    const hooks: Record<string, unknown[]> = {}
    for (const [event, hookConfigs] of Object.entries(config.hooks)) {
      hooks[event] = [{
        hooks: hookConfigs.map(h => ({
          type: 'command',
          command: h.command,
        })),
      }]
    }
    settings.hooks = hooks
  }

  // Map disabled skills to disallowedTools
  const explicitDisables = (config.plugins?.disable ?? []).map(skill => `Skill(${skill})`)

  if (explicitDisables.length > 0) {
    settings.disallowedTools = explicitDisables
  }

  return settings
}

/**
 * Build mcp.json from env.yaml mcp_servers config.
 * Resolves keychain: references in env vars.
 */
async function buildMcpConfig(
  config: EnvConfig
): Promise<{ mcpServers: Record<string, unknown> }> {
  const mcpServers: Record<string, unknown> = {}

  if (!config.mcp_servers) {
    return { mcpServers }
  }

  for (const [name, server] of Object.entries(config.mcp_servers)) {
    const resolvedEnv: Record<string, string> = {}

    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        if (value.startsWith('keychain:')) {
          const keychainKey = value.slice('keychain:'.length)
          const resolved = await keychainRead(keychainKey)
          if (resolved) {
            resolvedEnv[key] = resolved
          }
        } else {
          resolvedEnv[key] = value
        }
      }
    }

    mcpServers[name] = {
      command: server.command,
      ...(server.args ? { args: server.args } : {}),
      ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
    }
  }

  return { mcpServers }
}

/**
 * Resolve plugin references in env.yaml to actual filesystem paths.
 * Checks Claude Code's plugin cache first, then cenv's cache.
 */
function resolvePluginDirs(
  config: EnvConfig,
  claudePluginsDir: string = CLAUDE_PLUGINS_DIR,
  cenvCacheDir: string = CACHE_DIR
): string[] {
  if (!config.plugins?.enable?.length) return []

  const dirs: string[] = []

  for (const plugin of config.plugins.enable) {
    // Search Claude Code's plugin cache: ~/.claude/plugins/cache/<source>/<name>/<version>/
    const claudeCachePath = path.join(claudePluginsDir, 'cache', plugin.source, plugin.name)
    if (fs.existsSync(claudeCachePath)) {
      // Find the highest version directory
      const versions = fs.readdirSync(claudeCachePath).filter(v =>
        fs.statSync(path.join(claudeCachePath, v)).isDirectory()
      )
      if (versions.length > 0) {
        // Sort versions descending, pick latest
        versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        dirs.push(path.join(claudeCachePath, versions[0]))
        continue
      }
    }

    // Search cenv's cache: ~/.claude-envs/cache/plugins/<name>/<version>/
    const cenvCachePath = path.join(cenvCacheDir, 'plugins', plugin.name)
    if (fs.existsSync(cenvCachePath)) {
      const versions = fs.readdirSync(cenvCachePath).filter(v =>
        fs.statSync(path.join(cenvCachePath, v)).isDirectory()
      )
      if (versions.length > 0) {
        versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        dirs.push(path.join(cenvCachePath, versions[0]))
        continue
      }
    }

    // Plugin not found — skip (install check happens before session creation)
  }

  return dirs
}

/**
 * Clean up stale session directories whose PID no longer exists.
 * Runs at the start of each `cenv run`.
 */
export function cleanupStaleSessions(sessionsDir: string = SESSIONS_TMP_DIR): number {
  if (!fs.existsSync(sessionsDir)) return 0

  let cleaned = 0
  const entries = fs.readdirSync(sessionsDir)

  for (const entry of entries) {
    const fullPath = path.join(sessionsDir, entry)
    if (!fs.statSync(fullPath).isDirectory()) continue

    // Extract PID from directory name: <env-name>-<pid>
    const lastDash = entry.lastIndexOf('-')
    if (lastDash === -1) continue

    const pidStr = entry.slice(lastDash + 1)
    const pid = parseInt(pidStr, 10)
    if (isNaN(pid)) continue

    // Check if PID is still running
    try {
      process.kill(pid, 0) // signal 0 = just check if process exists
    } catch {
      // Process doesn't exist — clean up
      fs.rmSync(fullPath, { recursive: true, force: true })
      cleaned++
    }
  }

  return cleaned
}
