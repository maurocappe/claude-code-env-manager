import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { EnvConfig } from '../types'
import { keychainRead } from './keychain'
import { CLAUDE_KEYCHAIN_SERVICE } from '../constants'

// ── Types ────────────────────────────────────────────────────────────────────

export interface FakeHomeResult {
  homePath: string     // path to the fake HOME directory (e.g., ~/.claude-envs/envs/test/home)
  claudeHome: string   // path to fake HOME's .claude/ (e.g., ~/.claude-envs/envs/test/home/.claude)
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Dotfiles/directories from the real HOME that are symlinked into the fake HOME. */
const DOTFILE_SYMLINKS = [
  '.gitconfig',
  '.ssh',
  '.config',
  '.local',
  '.npmrc',
  '.bunfig.toml',
  '.claude.json',  // Claude Code app state (startup count, theme, tips) — prevents first-run wizard
] as const

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Build (or regenerate) a fake HOME directory for a cenv environment.
 *
 * Persistent directories (sessions, plugin data) are created once and preserved
 * across runs. Config-layer files (settings, plugin registry, skill symlinks,
 * MCP config) are regenerated every run from the env.yaml config.
 */
export async function buildFakeHome(
  config: EnvConfig,
  envDir: string,
  realHome?: string,
  opts?: { skipCredentials?: boolean },
): Promise<FakeHomeResult> {
  const home = realHome ?? os.homedir()
  const homePath = path.join(envDir, 'home')
  const claudeHome = path.join(homePath, '.claude')
  const realClaudeHome = path.join(home, '.claude')

  // ── 1. Persistent directories (create if missing, restrictive perms) ────
  fs.mkdirSync(homePath, { recursive: true, mode: 0o700 })
  fs.mkdirSync(claudeHome, { recursive: true, mode: 0o700 })
  for (const sub of ['plugins/data', 'sessions', 'session-env']) {
    fs.mkdirSync(path.join(claudeHome, sub), { recursive: true, mode: 0o700 })
  }

  // ── 2. Shared symlinks (create once, skip if exists) ───────────────────
  createSharedSymlinks(claudeHome, realClaudeHome)
  ensureDotfileSymlinks(homePath, home)

  // ── 3. Regenerate config layer (every run) ─────────────────────────────

  // settings.json
  const settings = generateSettings(config)
  fs.writeFileSync(
    path.join(claudeHome, 'settings.json'),
    JSON.stringify(settings, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )

  // plugins/installed_plugins.json
  const pluginRegistry = generateFilteredPluginRegistry(config, realClaudeHome)
  const pluginsDir = path.join(claudeHome, 'plugins')
  fs.mkdirSync(pluginsDir, { recursive: true })
  fs.writeFileSync(
    path.join(pluginsDir, 'installed_plugins.json'),
    JSON.stringify(pluginRegistry, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )

  // CLAUDE.md — symlink to the env's own claude.md
  const claudeMdLink = path.join(claudeHome, 'CLAUDE.md')
  const claudeMdTarget = path.join(envDir, 'claude.md')
  try {
    fs.unlinkSync(claudeMdLink)
  } catch {
    // didn't exist — fine
  }
  if (fs.existsSync(claudeMdTarget)) {
    fs.symlinkSync(claudeMdTarget, claudeMdLink)
  }

  // skills/
  regenerateSkillSymlinks(claudeHome, config)

  // Commands — symlink selected commands into fake .claude/commands/
  if (config.commands?.length) {
    const commandsDir = path.join(claudeHome, 'commands')
    fs.mkdirSync(commandsDir, { recursive: true })
    // Clear existing command symlinks
    try {
      for (const entry of fs.readdirSync(commandsDir)) {
        const p = path.join(commandsDir, entry)
        if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p)
      }
    } catch { /* empty dir — fine */ }
    // Create new symlinks
    for (const cmd of config.commands) {
      if (!cmd.path) continue
      try {
        const resolved = fs.realpathSync(cmd.path)
        const name = path.basename(resolved)
        safeSymlink(resolved, path.join(commandsDir, name))
      } catch { /* skip missing commands */ }
    }
  }

  // Hooks — symlink real hooks dir so hook scripts can find siblings
  if (config.hooks && Object.keys(config.hooks).length > 0) {
    const hooksDir = path.join(claudeHome, 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    const realHooksDir = path.join(realClaudeHome, 'hooks')
    if (fs.existsSync(realHooksDir)) {
      try {
        for (const entry of fs.readdirSync(realHooksDir)) {
          safeSymlink(
            path.join(realHooksDir, entry),
            path.join(hooksDir, entry)
          )
        }
      } catch { /* ignore errors */ }
    }
  }

  // .mcp.json at fake HOME root
  const mcpConfig = await generateMcpConfig(config)
  fs.writeFileSync(
    path.join(homePath, '.mcp.json'),
    JSON.stringify(mcpConfig, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )

  // .credentials.json — passthrough current OAuth from keychain (skip in dry-run)
  if (!opts?.skipCredentials) {
    await writeCredentialsFile(claudeHome)
  }

  return { homePath, claudeHome }
}

// ── Credentials passthrough ──────────────────────────────────────────────────

/**
 * Read current OAuth credentials from macOS Keychain and write them as
 * .credentials.json in the fake .claude/ directory. This makes Claude Code
 * recognize the user as authenticated on startup.
 *
 * Silently skips if no credentials are found (Claude will prompt for login).
 */
async function writeCredentialsFile(claudeHome: string): Promise<void> {
  try {
    const raw = await keychainRead(CLAUDE_KEYCHAIN_SERVICE)
    if (!raw) return

    const parsed = JSON.parse(raw)
    if (!parsed?.claudeAiOauth?.accessToken) return

    fs.writeFileSync(
      path.join(claudeHome, '.credentials.json'),
      JSON.stringify(parsed, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    )
  } catch {
    // Keychain read failed or credentials malformed — skip silently
  }
}

// ── Shared symlinks ──────────────────────────────────────────────────────────

/**
 * Create symlinks inside fake .claude/ that point to shared resources in
 * the real .claude/ directory. Only creates links that don't already exist
 * and whose target is present.
 */
function createSharedSymlinks(claudeHome: string, realClaudeHome: string): void {
  const links: Array<{ link: string; target: string }> = [
    // Plugin cache — shared across all envs
    {
      link: path.join(claudeHome, 'plugins', 'cache'),
      target: path.join(realClaudeHome, 'plugins', 'cache'),
    },
    // Plugin metadata files
    {
      link: path.join(claudeHome, 'plugins', 'known_marketplaces.json'),
      target: path.join(realClaudeHome, 'plugins', 'known_marketplaces.json'),
    },
    {
      link: path.join(claudeHome, 'plugins', 'blocklist.json'),
      target: path.join(realClaudeHome, 'plugins', 'blocklist.json'),
    },
    // Projects & commands — shared memory across envs
    {
      link: path.join(claudeHome, 'projects'),
      target: path.join(realClaudeHome, 'projects'),
    },
  ]

  for (const { link, target } of links) {
    safeSymlink(target, link)
  }
}

// ── Dotfile symlinks ─────────────────────────────────────────────────────────

/**
 * Symlink common dotfiles/directories from the real HOME into the fake HOME
 * so that tools invoked under the fake HOME still find SSH keys, git config, etc.
 */
function ensureDotfileSymlinks(homePath: string, realHome: string): void {
  for (const dotfile of DOTFILE_SYMLINKS) {
    const target = path.join(realHome, dotfile)
    const link = path.join(homePath, dotfile)
    safeSymlink(target, link)
  }
}

// ── Settings generation ──────────────────────────────────────────────────────

/**
 * Build a settings.json object purely from env.yaml config.
 * Only what's explicitly defined in the env ends up in settings.
 */
function generateSettings(config: EnvConfig): Record<string, unknown> {
  const settings: Record<string, unknown> = {}

  if (config.settings?.effortLevel) {
    settings.effortLevel = config.settings.effortLevel
  }

  if (config.settings?.permissions) {
    settings.permissions = config.settings.permissions
  }

  // Map hooks from env.yaml format to Claude Code hook format
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
  const disables = (config.plugins?.disable ?? []).map(skill => `Skill(${skill})`)
  if (disables.length > 0) {
    settings.disallowedTools = disables
  }

  // enabledPlugins — always set explicitly (empty = no plugins active)
  const enabledPlugins: Record<string, boolean> = {}
  if (config.plugins?.enable?.length) {
    for (const plugin of config.plugins.enable) {
      enabledPlugins[`${plugin.name}@${plugin.source}`] = true
    }
  }
  settings.enabledPlugins = enabledPlugins

  // StatusLine — passthrough as-is
  if (config.settings?.statusLine) {
    settings.statusLine = config.settings.statusLine
  }

  return settings
}

// ── Plugin registry filtering ────────────────────────────────────────────────

interface PluginRegistryFile {
  version: number
  plugins: Record<string, unknown[]>
}

/**
 * Read the real installed_plugins.json and filter it to only include plugins
 * that are enabled in the env config. Preserves all scope entries (user + local)
 * for each matching plugin.
 */
function generateFilteredPluginRegistry(
  config: EnvConfig,
  realClaudeHome: string,
): PluginRegistryFile {
  const empty: PluginRegistryFile = { version: 2, plugins: {} }

  const enabledPlugins = config.plugins?.enable
  if (!enabledPlugins?.length) return empty

  // Build a Set of enabled plugin keys: "name@source"
  const enabledKeys = new Set(
    enabledPlugins.map(p => `${p.name}@${p.source}`),
  )

  const realRegistryPath = path.join(
    realClaudeHome,
    'plugins',
    'installed_plugins.json',
  )

  if (!fs.existsSync(realRegistryPath)) return empty

  let registry: PluginRegistryFile
  try {
    registry = JSON.parse(
      fs.readFileSync(realRegistryPath, 'utf8'),
    ) as PluginRegistryFile
  } catch {
    return empty
  }

  const filtered: Record<string, unknown[]> = {}
  for (const [key, entries] of Object.entries(registry.plugins)) {
    if (enabledKeys.has(key)) {
      filtered[key] = entries
    }
  }

  return { version: 2, plugins: filtered }
}

// ── MCP config generation ────────────────────────────────────────────────────

/**
 * Build .mcp.json from env.yaml mcp_servers config.
 * Resolves keychain: references in env vars.
 */
async function generateMcpConfig(
  config: EnvConfig,
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

// ── Skill symlink regeneration ───────────────────────────────────────────────

/**
 * Remove all existing skill symlinks and recreate them from the env config.
 * Each skill.path is resolved through realpathSync to handle symlink chains.
 */
function regenerateSkillSymlinks(claudeHome: string, config: EnvConfig): void {
  const skillsDir = path.join(claudeHome, 'skills')

  // Clear and recreate the skills directory
  fs.rmSync(skillsDir, { recursive: true, force: true })
  fs.mkdirSync(skillsDir, { recursive: true })

  if (!config.skills?.length) return

  for (const skill of config.skills) {
    if (!skill.path) continue
    if (!fs.existsSync(skill.path)) continue

    try {
      const resolved = fs.realpathSync(skill.path)
      const linkName = path.basename(resolved)
      const link = path.join(skillsDir, linkName)
      fs.symlinkSync(resolved, link)
    } catch {
      // Permission error or broken chain — skip
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a symlink only if the target exists and the link doesn't already exist.
 * Silently skips on permission errors.
 */
function safeSymlink(target: string, link: string): void {
  if (!fs.existsSync(target)) return
  if (fs.existsSync(link) || symlinkExists(link)) return

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(link), { recursive: true })

  try {
    fs.symlinkSync(target, link)
  } catch {
    // Permission error — skip
  }
}

/**
 * Check if a symlink exists at the given path (even if the target is broken).
 * fs.existsSync follows symlinks and returns false for broken ones, so we
 * use lstatSync instead.
 */
function symlinkExists(p: string): boolean {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}
