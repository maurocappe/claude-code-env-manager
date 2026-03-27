import fs from 'node:fs'
import path from 'node:path'
import {
  CLAUDE_HOME,
  CLAUDE_INSTALLED_PLUGINS_PATH,
  CLAUDE_SETTINGS_PATH,
} from '../constants'
import type { InstalledPlugin, InstalledSkill, PluginComponents } from '../types'

// ── Installed plugins ──────────────────────────────────────────────────────────

interface RawInstalledPluginsFile {
  version: number
  plugins: Record<
    string,
    Array<{
      scope: string
      installPath: string
      version: string
      [key: string]: unknown
    }>
  >
}

/**
 * Read `~/.claude/plugins/installed_plugins.json` and return structured info
 * for every installed plugin entry.
 *
 * @param installedPluginsPath Override for the installed_plugins.json path (for testing)
 */
export function scanInstalledPlugins(
  installedPluginsPath: string = CLAUDE_INSTALLED_PLUGINS_PATH
): InstalledPlugin[] {
  if (!fs.existsSync(installedPluginsPath)) {
    return []
  }

  let raw: RawInstalledPluginsFile
  try {
    raw = JSON.parse(fs.readFileSync(installedPluginsPath, 'utf8'))
  } catch {
    return []
  }

  if (!raw?.plugins || typeof raw.plugins !== 'object') {
    return []
  }

  const results: InstalledPlugin[] = []

  for (const [key, entries] of Object.entries(raw.plugins)) {
    if (!Array.isArray(entries)) continue

    // Key format: "name@marketplace" or just "name"
    const atIdx = key.lastIndexOf('@')
    const name = atIdx > 0 ? key.slice(0, atIdx) : key
    const source = atIdx > 0 ? key.slice(atIdx + 1) : ''

    for (const entry of entries) {
      const scope = entry.scope === 'local' ? 'local' : 'user'
      results.push({
        name,
        source,
        version: entry.version ?? '',
        scope,
        path: entry.installPath ?? '',
      })
    }
  }

  return results
}

// ── Installed skills ───────────────────────────────────────────────────────────

interface SkillLockEntry {
  source?: string
  [key: string]: unknown
}

interface SkillLockFile {
  [skillName: string]: SkillLockEntry
}

/**
 * Read `~/.claude/skills/` directory and return one entry per skill.
 * A directory is considered a skill if it contains a `SKILL.md` file.
 *
 * Also reads `~/.agents/.skill-lock.json` for source metadata when available.
 *
 * @param skillsDir Override for the skills directory path (for testing)
 * @param skillLockPath Override for the skill-lock.json path (for testing)
 */
export function scanInstalledSkills(
  skillsDir: string = path.join(CLAUDE_HOME, 'skills'),
  skillLockPath: string = path.join(
    path.dirname(path.dirname(CLAUDE_HOME)),
    '.agents',
    '.skill-lock.json'
  )
): InstalledSkill[] {
  if (!fs.existsSync(skillsDir)) {
    return []
  }

  // Load skill-lock.json for source info (optional)
  let lockData: SkillLockFile = {}
  if (fs.existsSync(skillLockPath)) {
    try {
      lockData = JSON.parse(fs.readFileSync(skillLockPath, 'utf8'))
    } catch {
      // ignore parse errors — lock file is optional
    }
  }

  const results: InstalledSkill[] = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const skillDir = path.join(skillsDir, entry.name)
    const skillMdPath = path.join(skillDir, 'SKILL.md')

    if (!fs.existsSync(skillMdPath)) continue

    const lockEntry = lockData[entry.name]
    results.push({
      name: entry.name,
      source: lockEntry?.source,
      path: skillDir,
    })
  }

  return results
}

// ── Plugin components ──────────────────────────────────────────────────────────

/**
 * Scan the internal components of an installed plugin directory.
 *
 * Reads:
 * - `pluginPath/skills/` → list skill directories (each with SKILL.md)
 * - `pluginPath/hooks/hooks.json` → parse hook event types
 * - `pluginPath/.mcp.json` → list MCP server names
 * - `pluginPath/.claude-plugin/agents/` → list agent directory names
 *
 * Missing subdirectories/files return empty arrays for those fields.
 *
 * @param pluginPath Absolute path to the installed plugin directory
 */
export function scanPluginComponents(pluginPath: string): PluginComponents {
  const skills: string[] = []
  const hooks: Record<string, unknown[]> = {}
  const mcpServers: string[] = []
  const agents: string[] = []

  // ── Skills ──────────────────────────────────────────────────────────────────

  const skillsDir = path.join(pluginPath, 'skills')
  if (fs.existsSync(skillsDir)) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
      if (fs.existsSync(skillMd)) {
        skills.push(entry.name)
      }
    }
  }

  // ── Hooks ───────────────────────────────────────────────────────────────────

  const hooksJsonPath = path.join(pluginPath, 'hooks', 'hooks.json')
  if (fs.existsSync(hooksJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'))
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [hookType, hookList] of Object.entries(raw)) {
          hooks[hookType] = Array.isArray(hookList) ? hookList : []
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  // ── MCP servers ─────────────────────────────────────────────────────────────

  const mcpJsonPath = path.join(pluginPath, '.mcp.json')
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'))
      if (raw?.mcpServers && typeof raw.mcpServers === 'object') {
        mcpServers.push(...Object.keys(raw.mcpServers))
      }
    } catch {
      // ignore parse errors
    }
  }

  // ── Agents ──────────────────────────────────────────────────────────────────

  const agentsDir = path.join(pluginPath, '.claude-plugin', 'agents')
  if (fs.existsSync(agentsDir)) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(agentsDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        agents.push(entry.name)
      }
    }
  }

  return { skills, hooks, mcpServers, agents }
}

// ── Current settings ───────────────────────────────────────────────────────────

/**
 * Read `~/.claude/settings.json` and return the parsed object, or null if
 * the file does not exist.
 *
 * @param settingsPath Override for the settings.json path (for testing)
 */
export function scanCurrentSettings(
  settingsPath: string = CLAUDE_SETTINGS_PATH
): Record<string, unknown> | null {
  if (!fs.existsSync(settingsPath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch {
    return null
  }
}
