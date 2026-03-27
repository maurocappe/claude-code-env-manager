import type { EnvConfig } from '../types'

// ── Types ───────────────────────────────────────────────────────────────────────

export interface EnvDiff {
  plugins: {
    added: string[]
    removed: string[]
    changed: Array<{ name: string; from: string; to: string }>
  }
  skills: {
    added: string[]
    removed: string[]
  }
  mcpServers: {
    added: string[]
    removed: string[]
  }
  hooks: {
    added: string[]
    removed: string[]
  }
  settings: Array<{ key: string; from: unknown; to: unknown }>
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

function skillKey(skill: NonNullable<EnvConfig['skills']>[number]): string {
  return skill.name ?? skill.path ?? skill.source ?? JSON.stringify(skill)
}

// ── Public API ───────────────────────────────────────────────────────────────────

/**
 * Compare two EnvConfig objects and return a structured diff.
 *
 * - Plugins: compared by name. Added = in B not A. Removed = in A not B. Changed = same name, different version.
 * - Skills: compared by name or path.
 * - MCP servers: compared by key.
 * - Hooks: compared by event type key.
 * - Settings: compares effortLevel and permissions.allow entries.
 */
export function diffEnvConfigs(a: EnvConfig, b: EnvConfig): EnvDiff {
  const diff: EnvDiff = {
    plugins: { added: [], removed: [], changed: [] },
    skills: { added: [], removed: [] },
    mcpServers: { added: [], removed: [] },
    hooks: { added: [], removed: [] },
    settings: [],
  }

  // ── Plugins ──────────────────────────────────────────────────────────────────

  const aPlugins = new Map<string, string | undefined>(
    (a.plugins?.enable ?? []).map((p) => [p.name, p.version])
  )
  const bPlugins = new Map<string, string | undefined>(
    (b.plugins?.enable ?? []).map((p) => [p.name, p.version])
  )

  for (const [name, version] of aPlugins) {
    if (!bPlugins.has(name)) {
      diff.plugins.removed.push(name)
    } else if (version !== bPlugins.get(name)) {
      diff.plugins.changed.push({
        name,
        from: version ?? 'latest',
        to: bPlugins.get(name) ?? 'latest',
      })
    }
  }
  for (const [name] of bPlugins) {
    if (!aPlugins.has(name)) {
      diff.plugins.added.push(name)
    }
  }

  // ── Skills ───────────────────────────────────────────────────────────────────

  const aSkills = new Set((a.skills ?? []).map(skillKey))
  const bSkills = new Set((b.skills ?? []).map(skillKey))

  for (const key of aSkills) {
    if (!bSkills.has(key)) diff.skills.removed.push(key)
  }
  for (const key of bSkills) {
    if (!aSkills.has(key)) diff.skills.added.push(key)
  }

  // ── MCP Servers ──────────────────────────────────────────────────────────────

  const aMcp = new Set(Object.keys(a.mcp_servers ?? {}))
  const bMcp = new Set(Object.keys(b.mcp_servers ?? {}))

  for (const key of aMcp) {
    if (!bMcp.has(key)) diff.mcpServers.removed.push(key)
  }
  for (const key of bMcp) {
    if (!aMcp.has(key)) diff.mcpServers.added.push(key)
  }

  // ── Hooks ────────────────────────────────────────────────────────────────────

  const aHooks = new Set(Object.keys(a.hooks ?? {}))
  const bHooks = new Set(Object.keys(b.hooks ?? {}))

  for (const key of aHooks) {
    if (!bHooks.has(key)) diff.hooks.removed.push(key)
  }
  for (const key of bHooks) {
    if (!aHooks.has(key)) diff.hooks.added.push(key)
  }

  // ── Settings ─────────────────────────────────────────────────────────────────

  const aSettings = a.settings ?? {}
  const bSettings = b.settings ?? {}

  if (aSettings.effortLevel !== bSettings.effortLevel) {
    diff.settings.push({
      key: 'effortLevel',
      from: aSettings.effortLevel,
      to: bSettings.effortLevel,
    })
  }

  const aPerms = (aSettings.permissions?.allow ?? []).join(',')
  const bPerms = (bSettings.permissions?.allow ?? []).join(',')
  if (aPerms !== bPerms) {
    diff.settings.push({
      key: 'permissions.allow',
      from: aSettings.permissions?.allow,
      to: bSettings.permissions?.allow,
    })
  }

  return diff
}

/**
 * Return true if the diff has no changes at all.
 */
export function isDiffEmpty(diff: EnvDiff): boolean {
  return (
    diff.plugins.added.length === 0 &&
    diff.plugins.removed.length === 0 &&
    diff.plugins.changed.length === 0 &&
    diff.skills.added.length === 0 &&
    diff.skills.removed.length === 0 &&
    diff.mcpServers.added.length === 0 &&
    diff.mcpServers.removed.length === 0 &&
    diff.hooks.added.length === 0 &&
    diff.hooks.removed.length === 0 &&
    diff.settings.length === 0
  )
}
