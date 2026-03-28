import fs from 'node:fs'
import path from 'node:path'
import { CLAUDE_HOME, CLAUDE_MD_PATH } from '../constants'
import type { EnvConfig, HookConfig, McpServerConfig, PluginRef, SettingsConfig } from '../types'
import { writeEnvConfig } from './config'
import {
  scanInstalledPlugins,
  scanInstalledSkills,
  scanCurrentSettings,
} from './scanner'

// ── Settings extraction helpers ────────────────────────────────────────────────

function extractSettingsConfig(raw: Record<string, unknown>): SettingsConfig {
  const settings: SettingsConfig = {}

  if (
    raw.effortLevel === 'low' ||
    raw.effortLevel === 'medium' ||
    raw.effortLevel === 'high'
  ) {
    settings.effortLevel = raw.effortLevel
  }

  if (raw.permissions && typeof raw.permissions === 'object') {
    const perms = raw.permissions as Record<string, unknown>
    if (Array.isArray(perms.allow) && perms.allow.every((a) => typeof a === 'string')) {
      settings.permissions = { allow: perms.allow as string[] }
    }
  }

  return settings
}

function extractMcpServers(raw: Record<string, unknown>): Record<string, McpServerConfig> | undefined {
  const mcpServers = raw.mcpServers as Record<string, { command?: string; args?: string[]; env?: Record<string, string> }> | undefined
  if (!mcpServers || typeof mcpServers !== 'object') return undefined

  const result: Record<string, McpServerConfig> = {}
  for (const [name, server] of Object.entries(mcpServers)) {
    if (!server.command) continue
    result[name] = {
      command: server.command,
      ...(server.args ? { args: server.args } : {}),
      ...(server.env ? { env: server.env } : {}),
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function extractHooks(raw: Record<string, unknown>): Record<string, HookConfig[]> | undefined {
  const hooks = raw.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>> | undefined
  if (!hooks || typeof hooks !== 'object') return undefined

  const result: Record<string, HookConfig[]> = {}
  for (const [event, hookEntries] of Object.entries(hooks)) {
    const commands: HookConfig[] = []
    for (const entry of hookEntries) {
      if (entry.hooks) {
        for (const h of entry.hooks) {
          if (h.command) commands.push({ command: h.command })
        }
      }
    }
    if (commands.length > 0) result[event] = commands
  }
  return Object.keys(result).length > 0 ? result : undefined
}

// ── Snapshot ───────────────────────────────────────────────────────────────────

export interface SnapshotOptions {
  /** Override for ~/.claude/skills/ path (for testing) */
  skillsDir?: string
  /** Override for ~/.agents/.skill-lock.json path (for testing) */
  skillLockPath?: string
  /** Override for ~/.claude/plugins/installed_plugins.json path (for testing) */
  installedPluginsPath?: string
  /** Override for ~/.claude/settings.json path (for testing) */
  settingsPath?: string
  /** Override for ~/.claude/CLAUDE.md path (for testing) */
  claudeMdPath?: string
}

/**
 * Snapshot the current Claude Code setup into an env.yaml + claude.md in
 * the given environment directory.
 *
 * - Reads installed plugins (user-scoped only) → plugins.enable
 * - Reads current settings → settings (effortLevel, permissions)
 * - Copies ~/.claude/CLAUDE.md → <envDir>/claude.md (if it exists)
 *
 * @param envDir  Full path to the environment directory (must exist)
 * @param envName Name to embed in the generated env.yaml
 * @param opts    Optional path overrides for testing
 */
export function snapshotCurrentSetup(
  envDir: string,
  envName: string,
  opts: SnapshotOptions = {}
): void {
  // 1. Scan installed components
  const installedPlugins = scanInstalledPlugins(opts.installedPluginsPath)
  const installedSkills = scanInstalledSkills(opts.skillsDir, opts.skillLockPath)
  const rawSettings = scanCurrentSettings(opts.settingsPath)

  // 2. Build plugin refs — only user-scoped plugins
  const pluginRefs: PluginRef[] = installedPlugins
    .filter((p) => p.scope === 'user')
    .map((p) => {
      const ref: PluginRef = { name: p.name, source: p.source }
      if (p.version) ref.version = p.version
      return ref
    })

  // 3. Build skill refs from standalone (non-plugin) skills
  const skillRefs = installedSkills.map((s) => ({
    name: s.name,
    ...(s.source ? { source: s.source } : {}),
    path: s.path,
  }))

  // 4. Extract settings
  const settings = rawSettings ? extractSettingsConfig(rawSettings) : undefined

  // 5. Extract MCP servers from settings
  const mcpServers = rawSettings ? extractMcpServers(rawSettings) : undefined

  // 6. Extract hooks from settings
  const hooks = rawSettings ? extractHooks(rawSettings) : undefined

  // 7. Assemble the EnvConfig
  const config: EnvConfig = {
    name: envName,
    description: 'Snapshot of current Claude Code setup',
    ...(pluginRefs.length > 0 ? { plugins: { enable: pluginRefs } } : {}),
    ...(skillRefs.length > 0 ? { skills: skillRefs } : {}),
    ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : {}),
    ...(hooks && Object.keys(hooks).length > 0 ? { hooks } : {}),
    ...(settings && Object.keys(settings).length > 0 ? { settings } : {}),
  }

  // 6. Write env.yaml
  writeEnvConfig(envDir, config)

  // 7. Copy CLAUDE.md → claude.md (if it exists)
  const sourceMd = opts.claudeMdPath ?? CLAUDE_MD_PATH
  const destMd = path.join(envDir, 'claude.md')
  if (fs.existsSync(sourceMd)) {
    fs.copyFileSync(sourceMd, destMd)
  } else {
    // Write an empty placeholder so the env dir is complete
    fs.writeFileSync(
      destMd,
      `# Claude Code instructions for ${envName}\n# (snapshot — no CLAUDE.md found at ${path.join(CLAUDE_HOME, 'CLAUDE.md')})\n`,
      'utf8'
    )
  }
}
