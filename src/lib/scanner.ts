import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
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

// ── Current hooks ─────────────────────────────────────────────────────────────

/**
 * Extract hook commands from Claude Code settings in the simplified format
 * used by env.yaml.
 *
 * Claude Code stores hooks as:
 *   `{ "EventName": [{ "hooks": [{ "type": "command", "command": "..." }] }] }`
 *
 * This returns:
 *   `{ "EventName": [{ "command": "..." }] }`
 *
 * @param settingsPath Override for the settings.json path (for testing)
 */
export function scanCurrentHooks(
  settingsPath: string = CLAUDE_SETTINGS_PATH
): Record<string, Array<{ command: string }>> {
  const settings = scanCurrentSettings(settingsPath)
  if (!settings?.hooks || typeof settings.hooks !== 'object') return {}

  const result: Record<string, Array<{ command: string }>> = {}
  for (const [event, hookGroups] of Object.entries(
    settings.hooks as Record<string, unknown[]>
  )) {
    const commands: Array<{ command: string }> = []
    if (!Array.isArray(hookGroups)) continue
    for (const group of hookGroups) {
      const g = group as Record<string, unknown>
      if (!Array.isArray(g.hooks)) continue
      for (const hook of g.hooks) {
        const h = hook as Record<string, unknown>
        if (h.type === 'command' && typeof h.command === 'string') {
          commands.push({ command: h.command })
        }
      }
    }
    if (commands.length > 0) result[event] = commands
  }
  return result
}

// ── Status line ───────────────────────────────────────────────────────────────

/**
 * Read the `statusLine` object from Claude Code settings, or null if not
 * present.
 *
 * @param settingsPath Override for the settings.json path (for testing)
 */
export function scanStatusLine(
  settingsPath: string = CLAUDE_SETTINGS_PATH
): Record<string, unknown> | null {
  const settings = scanCurrentSettings(settingsPath)
  if (!settings?.statusLine || typeof settings.statusLine !== 'object')
    return null
  return settings.statusLine as Record<string, unknown>
}

// ── Installed rules ──────────────────────────────────────────────────────────

/**
 * Scan `~/.claude/rules/` for markdown rule files.
 * Rules are .md files (can be nested in subdirectories).
 *
 * @param rulesDir Override for the rules directory path (for testing)
 */
export function scanInstalledRules(
  rulesDir: string = path.join(CLAUDE_HOME, 'rules')
): Array<{ name: string; path: string }> {
  if (!fs.existsSync(rulesDir)) return []

  const results: Array<{ name: string; path: string }> = []

  function walk(dir: string, prefix: string = '') {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath, prefix ? `${prefix}/${entry.name}` : entry.name)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name
        results.push({ name, path: fullPath })
      }
    }
  }

  walk(rulesDir)
  return results
}

// ── Installed commands ────────────────────────────────────────────────────────

/**
 * Scan `~/.claude/commands/` for installed command files (.md).
 *
 * Each entry includes the command name (filename without .md), the full path,
 * and an optional description extracted from YAML frontmatter.
 *
 * @param commandsDir Override for the commands directory path (for testing)
 */
export function scanInstalledCommands(
  commandsDir: string = path.join(CLAUDE_HOME, 'commands')
): Array<{ name: string; path: string; description?: string }> {
  if (!fs.existsSync(commandsDir)) return []

  const results: Array<{ name: string; path: string; description?: string }> =
    []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(commandsDir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue

    const filePath = path.join(commandsDir, entry.name)
    const name = entry.name.slice(0, -3) // remove .md

    // Try to parse YAML frontmatter for description
    let description: string | undefined
    try {
      const content = fs.readFileSync(filePath, 'utf8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (fmMatch) {
        const fm = parseYaml(fmMatch[1])
        if (fm?.description && typeof fm.description === 'string') {
          description = fm.description
        }
      }
    } catch {
      // ignore parse errors
    }

    results.push({ name, path: filePath, description })
  }

  return results
}
