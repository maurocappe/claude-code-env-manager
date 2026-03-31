import fs from 'node:fs'
import path from 'node:path'
import {
  intro,
  outro,
  multiselect,
  select,
  confirm,
  isCancel,
  cancel,
  log,
} from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME, CLAUDE_HOME, CLAUDE_MD_PATH, CLAUDE_SETTINGS_PATH } from '../constants'
import { ensureCenvHome } from '../lib/environments'
import { writeEnvConfig } from '../lib/config'
import {
  scanInstalledPlugins,
  scanInstalledSkills,
  scanCurrentSettings,
  scanPluginComponents,
  scanCurrentHooks,
  scanStatusLine,
  scanInstalledCommands,
  scanInstalledRules,
} from '../lib/scanner'
import { validRange } from 'semver'
import type { EnvConfig, InstalledPlugin, McpServerConfig, PluginRef, HookConfig, CommandRef, RuleRef } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function abortOnCancel(value: unknown): void {
  if (isCancel(value)) {
    cancel('Wizard cancelled.')
    process.exit(0)
  }
}

/**
 * Collect MCP server entries from settings.json and any .mcp.json referenced.
 * Returns a record of serverName → McpServerConfig.
 */
function collectMcpServers(
  settingsPath: string
): Record<string, McpServerConfig> {
  const settings = (() => {
    if (!fs.existsSync(settingsPath)) return null
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    } catch {
      return null
    }
  })()

  const servers: Record<string, McpServerConfig> = {}

  if (settings?.mcpServers && typeof settings.mcpServers === 'object') {
    for (const [name, cfg] of Object.entries(settings.mcpServers as Record<string, unknown>)) {
      if (cfg && typeof cfg === 'object') {
        servers[name] = cfg as McpServerConfig
      }
    }
  }

  return servers
}

// ── Wizard ────────────────────────────────────────────────────────────────────

export interface WizardPaths {
  /** Override for CENV_HOME (testing) */
  cenvHome?: string
  /** Override for ~/.claude/CLAUDE.md path (testing) */
  claudeMdPath?: string
  /** Override for ~/.claude/settings.json path (testing) */
  settingsPath?: string
  /** Override for installed_plugins.json path (testing) */
  installedPluginsPath?: string
  /** Override for ~/.claude/skills/ directory (testing) */
  skillsDir?: string
  /** Override for skill-lock.json path (testing) */
  skillLockPath?: string
  /** Override for ~/.claude/commands/ directory (testing) */
  commandsDir?: string
  /** Override for ~/.claude/rules/ directory (testing) */
  rulesDir?: string
}

/**
 * Interactive creation wizard for `cenv create --wizard`.
 *
 * Flow:
 *  1. Intro
 *  2. Plugins (with optional per-plugin skill cherry-pick)
 *  3. Standalone skills
 *  4. Commands
 *  5. Rules
 *  6. MCP servers
 *  7. Hooks
 *  8. StatusLine
 *  9. Settings (import permissions?, effort level)
 * 10. CLAUDE.md source (current / empty)
 * 11. Write files
 * 12. Outro summary
 */
export async function runWizard(
  name: string,
  paths: WizardPaths = {}
): Promise<void> {
  const cenvHome = paths.cenvHome ?? CENV_HOME
  const claudeMdSrc = paths.claudeMdPath ?? CLAUDE_MD_PATH
  const settingsPath = paths.settingsPath ?? CLAUDE_SETTINGS_PATH

  // ── 1. Intro ────────────────────────────────────────────────────────────────

  intro(pc.cyan(`Creating environment: ${pc.bold(name)}`))

  // Ensure the cenv home exists
  ensureCenvHome(cenvHome)

  const envDir = path.join(cenvHome, 'envs', name)
  if (fs.existsSync(envDir)) {
    log.error(`Environment "${name}" already exists at ${envDir}`)
    process.exit(1)
  }

  // ── 2. Plugins ──────────────────────────────────────────────────────────────

  const allPlugins = scanInstalledPlugins(paths.installedPluginsPath)

  const selectedPluginRefs: PluginRef[] = []
  const disabledSkills: string[] = []
  let selectedPlugins: InstalledPlugin[] = []

  if (allPlugins.length > 0) {
    const pluginOptions = allPlugins.map((p) => ({
      value: p.name,
      label: `${pc.bold(p.name)}${p.source ? pc.dim(`@${p.source}`) : ''} ${pc.dim(`v${p.version}`)}`,
      hint: p.scope === 'local' ? 'local' : undefined,
    }))

    const chosen = await multiselect({
      message: 'Select plugins to include:',
      options: pluginOptions,
      required: false,
    })
    abortOnCancel(chosen)

    const chosenNames = chosen as string[]
    selectedPlugins = allPlugins.filter((p) => chosenNames.includes(p.name))

    // Cherry-pick: offer "Customize?" for each selected plugin
    for (const plugin of selectedPlugins) {
      const ref: PluginRef = { name: plugin.name, source: plugin.source }
      if (plugin.version && validRange(plugin.version) !== null) ref.version = plugin.version
      selectedPluginRefs.push(ref)

      // Only offer customization if the plugin has a valid path
      if (!plugin.path) continue

      const components = scanPluginComponents(plugin.path)
      if (components.skills.length === 0) continue

      const doCustomize = await confirm({
        message: `Customize ${pc.bold(plugin.name)}? (choose which skills to include)`,
        initialValue: false,
      })
      abortOnCancel(doCustomize)

      if (!doCustomize) continue

      // Skills multiselect — all selected by default
      const skillOptions = components.skills.map((s) => ({
        value: `${plugin.name}:${s}`,
        label: s,
      }))

      const chosenSkills = await multiselect({
        message: `Select skills to keep from ${pc.bold(plugin.name)}:`,
        options: skillOptions,
        initialValues: skillOptions.map((o) => o.value),
        required: false,
      })
      abortOnCancel(chosenSkills)

      const keptSkills = new Set(chosenSkills as string[])

      // Skills NOT selected go into plugins.disable
      for (const skill of components.skills) {
        const key = `${plugin.name}:${skill}`
        if (!keptSkills.has(key)) {
          disabledSkills.push(key)
        }
      }
    }
  } else {
    log.info('No installed plugins found — skipping plugin step.')
  }

  // ── 3. Standalone Skills ────────────────────────────────────────────────────

  // Collect names of skills that belong to selected plugins (to filter them out)
  const pluginSkillNames = new Set<string>()
  for (const plugin of selectedPlugins) {
    if (!plugin.path) continue
    const components = scanPluginComponents(plugin.path)
    for (const s of components.skills) {
      pluginSkillNames.add(s)
    }
  }

  const allSkills = scanInstalledSkills(paths.skillsDir, paths.skillLockPath)
  const standaloneSkills = allSkills.filter((s) => !pluginSkillNames.has(s.name))

  const selectedStandaloneSkillPaths: string[] = []

  if (standaloneSkills.length > 0) {
    const skillOptions = standaloneSkills.map((s) => ({
      value: s.path,
      label: s.name,
      hint: s.source ?? undefined,
    }))

    const chosen = await multiselect({
      message: 'Select standalone skills to include:',
      options: skillOptions,
      required: false,
    })
    abortOnCancel(chosen)

    selectedStandaloneSkillPaths.push(...(chosen as string[]))
  }

  // ── 4. Commands ─────────────────────────────────────────────────────────────

  const allCommands = scanInstalledCommands(paths.commandsDir)
  const selectedCommandPaths: string[] = []

  if (allCommands.length > 0) {
    const commandOptions = allCommands.map((c) => ({
      value: c.path,
      label: pc.bold(c.name),
      hint: c.description ?? undefined,
    }))

    const chosen = await multiselect({
      message: 'Select commands to include:',
      options: commandOptions,
      required: false,
    })
    abortOnCancel(chosen)

    selectedCommandPaths.push(...(chosen as string[]))
  }

  // ── 5. Rules ───────────────────────────────────────────────────────────────

  const allRules = scanInstalledRules(paths.rulesDir)
  const selectedRulePaths: string[] = []

  if (allRules.length > 0) {
    const ruleOptions = allRules.map((r) => ({
      value: r.path,
      label: pc.bold(r.name),
    }))

    const chosen = await multiselect({
      message: 'Select rules to include:',
      options: ruleOptions,
      required: false,
    })
    abortOnCancel(chosen)

    selectedRulePaths.push(...(chosen as string[]))
  }

  // ── 6. MCP Servers ──────────────────────────────────────────────────────────

  const allMcpServers = collectMcpServers(settingsPath)

  // Also discover MCP servers bundled with selected plugins
  for (const plugin of selectedPlugins) {
    if (!plugin.path) continue
    const components = scanPluginComponents(plugin.path)
    for (const serverName of components.mcpServers) {
      // Read the plugin's .mcp.json for the full server config
      const mcpJsonPath = path.join(plugin.path, '.mcp.json')
      try {
        const raw = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'))
        if (raw?.mcpServers?.[serverName]) {
          // Add with plugin prefix to distinguish from standalone MCPs
          const key = `${plugin.name}:${serverName}`
          if (!allMcpServers[key]) {
            allMcpServers[key] = raw.mcpServers[serverName] as McpServerConfig
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  const selectedMcpServers: Record<string, McpServerConfig> = {}

  const mcpNames = Object.keys(allMcpServers)
  if (mcpNames.length > 0) {
    const mcpOptions = mcpNames.map((name) => ({
      value: name,
      label: name,
      hint: allMcpServers[name].command,
    }))

    const chosen = await multiselect({
      message: 'Select MCP servers to include:',
      options: mcpOptions,
      required: false,
    })
    abortOnCancel(chosen)

    for (const serverName of chosen as string[]) {
      selectedMcpServers[serverName] = allMcpServers[serverName]
    }
  }

  // ── 7. Hooks ────────────────────────────────────────────────────────────────

  const currentHooks = scanCurrentHooks(paths.settingsPath)
  let selectedHooks: Record<string, HookConfig[]> | undefined

  const hookEventNames = Object.keys(currentHooks)
  if (hookEventNames.length > 0) {
    const importHooks = await confirm({
      message: `Import ${hookEventNames.length} hook(s) from current setup? (${hookEventNames.join(', ')})`,
      initialValue: true,
    })
    abortOnCancel(importHooks)

    if (importHooks) {
      selectedHooks = currentHooks
    }
  }

  // ── 8. StatusLine ──────────────────────────────────────────────────────────

  const currentStatusLine = scanStatusLine(paths.settingsPath)
  let selectedStatusLine: Record<string, unknown> | undefined

  if (currentStatusLine) {
    const importStatusLine = await confirm({
      message: 'Import current statusLine configuration?',
      initialValue: true,
    })
    abortOnCancel(importStatusLine)

    if (importStatusLine) {
      selectedStatusLine = currentStatusLine
    }
  }

  // ── 9. Settings ─────────────────────────────────────────────────────────────

  const importPerms = await confirm({
    message: 'Import current permissions from settings.json?',
    initialValue: true,
  })
  abortOnCancel(importPerms)

  const effortLevel = await select({
    message: 'Select effort level:',
    options: [
      { value: 'high', label: 'high', hint: 'maximum quality (default)' },
      { value: 'medium', label: 'medium' },
      { value: 'low', label: 'low', hint: 'faster responses' },
    ],
    initialValue: 'high',
  })
  abortOnCancel(effortLevel)

  // Resolve permissions if requested
  let allowedPermissions: string[] | undefined
  if (importPerms) {
    const rawSettings = (() => {
      if (!fs.existsSync(settingsPath)) return null
      try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      } catch {
        return null
      }
    })()
    if (rawSettings?.permissions?.allow && Array.isArray(rawSettings.permissions.allow)) {
      allowedPermissions = rawSettings.permissions.allow as string[]
    }
  }

  // ── 10. CLAUDE.md source ───────────────────────────────────────────────────

  const claudeMdChoice = await select({
    message: 'CLAUDE.md source:',
    options: [
      { value: 'current', label: 'Current ~/.claude/CLAUDE.md' },
      { value: 'empty', label: 'Empty' },
    ],
    initialValue: fs.existsSync(claudeMdSrc) ? 'current' : 'empty',
  })
  abortOnCancel(claudeMdChoice)

  // ── 11. Generate files ──────────────────────────────────────────────────────

  fs.mkdirSync(envDir, { recursive: true })

  // Build env.yaml config
  const config: EnvConfig = {
    name,
  }

  if (selectedPluginRefs.length > 0 || disabledSkills.length > 0) {
    config.plugins = {}
    if (selectedPluginRefs.length > 0) {
      config.plugins.enable = selectedPluginRefs
    }
    if (disabledSkills.length > 0) {
      config.plugins.disable = disabledSkills
    }
  }

  if (selectedStandaloneSkillPaths.length > 0) {
    config.skills = selectedStandaloneSkillPaths.map((p) => ({ path: p }))
  }

  if (selectedCommandPaths.length > 0) {
    config.commands = selectedCommandPaths.map((p) => ({ path: p }))
  }

  if (selectedRulePaths.length > 0) {
    config.rules = selectedRulePaths.map((p) => ({ path: p }))
  }

  if (Object.keys(selectedMcpServers).length > 0) {
    config.mcp_servers = selectedMcpServers
  }

  if (selectedHooks && Object.keys(selectedHooks).length > 0) {
    config.hooks = selectedHooks
  }

  const settingsConfig: EnvConfig['settings'] = {
    effortLevel: effortLevel as 'low' | 'medium' | 'high',
  }
  if (allowedPermissions && allowedPermissions.length > 0) {
    settingsConfig.permissions = { allow: allowedPermissions }
  }
  if (selectedStatusLine) {
    settingsConfig.statusLine = selectedStatusLine
  }
  config.settings = settingsConfig

  writeEnvConfig(envDir, config)

  // Write claude.md
  const destMd = path.join(envDir, 'claude.md')
  if (claudeMdChoice === 'current' && fs.existsSync(claudeMdSrc)) {
    fs.copyFileSync(claudeMdSrc, destMd)
  } else {
    fs.writeFileSync(destMd, `# Claude Code instructions for ${name}\n`, 'utf8')
  }

  // ── 12. Outro summary ──────────────────────────────────────────────────────

  const displayPath = envDir.replace(process.env.HOME ?? '', '~')
  const pluginCount = selectedPluginRefs.length
  const skillCount = selectedStandaloneSkillPaths.length
  const commandCount = selectedCommandPaths.length
  const ruleCount = selectedRulePaths.length
  const mcpCount = Object.keys(selectedMcpServers).length

  outro(
    `${pc.green('✓')} Created ${pc.cyan(pc.bold(name))} at ${pc.dim(displayPath)}\n` +
    `  ${pc.dim(`${pluginCount} plugin(s), ${skillCount} standalone skill(s), ${commandCount} command(s), ${ruleCount} rule(s), ${mcpCount} MCP server(s)`)}`
  )
}
