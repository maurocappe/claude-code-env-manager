import fs from 'node:fs'
import path from 'node:path'
import { CLAUDE_HOME, CLAUDE_MD_PATH } from '../constants'
import type { EnvConfig, PluginRef, SettingsConfig } from '../types'
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

  // 5. Assemble the EnvConfig
  const config: EnvConfig = {
    name: envName,
    description: 'Snapshot of current Claude Code setup',
    isolation: 'additive',
    ...(pluginRefs.length > 0 ? { plugins: { enable: pluginRefs } } : {}),
    ...(skillRefs.length > 0 ? { skills: skillRefs } : {}),
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
