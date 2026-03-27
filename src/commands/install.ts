import { intro, outro, spinner, select, log } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME, CACHE_DIR, CLAUDE_INSTALLED_PLUGINS_PATH } from '../constants'
import { resolveEnv } from '../lib/resolver'
import {
  resolvePluginDeps,
  resolveSkillDeps,
  checkMcpAvailable,
  installPlugin,
  installSkill,
  installMcpServer,
} from '../lib/installer'
import type { DepResolution, PluginRef, SkillRef } from '../types'

// ── Status icons ──────────────────────────────────────────────────────────────

const ICON_OK = pc.green('✓')
const ICON_DOWNLOAD = pc.cyan('↓')
const ICON_WARN = pc.yellow('⚠')
const ICON_CACHED = pc.blue('◆')

// ── Main command ───────────────────────────────────────────────────────────────

/**
 * Resolve and install all missing dependencies for the given environment.
 *
 * @param envNameOrPath   Environment name or path
 * @param cenvHome        Override for CENV_HOME (for testing)
 * @param cwd             Override for CWD (for testing)
 */
export async function runInstall(
  envNameOrPath: string,
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  intro(pc.bold('cenv install'))

  // 1. Resolve env and load config
  const env = await resolveEnv(envNameOrPath, cenvHome, cwd)
  const { config } = env

  log.info(`Environment: ${pc.cyan(config.name)} (${env.source})`)

  // 2. Resolve plugin deps
  const pluginDeps = resolvePluginDeps(
    config,
    CLAUDE_INSTALLED_PLUGINS_PATH,
    CACHE_DIR
  )

  // 3. Resolve skill deps
  const skillDeps = resolveSkillDeps(config, env.path, CACHE_DIR)

  // 4. Check MCP availability
  const mcpEntries = Object.entries(config.mcp_servers ?? [])
  const mcpStatus = mcpEntries.map(([name, mcpConfig]) => ({
    name,
    config: mcpConfig,
    available: checkMcpAvailable(mcpConfig),
    hasInstall: Boolean(mcpConfig.install),
  }))

  // 5. Display dependency status
  if (pluginDeps.length > 0) {
    log.message(pc.bold('Plugins:'))
    for (const dep of pluginDeps) {
      const name = (dep.ref as PluginRef).name
      console.log(`  ${statusIcon(dep)} ${name}${formatVersion(dep)}`)
    }
  }

  if (skillDeps.length > 0) {
    log.message(pc.bold('Skills:'))
    for (const dep of skillDeps) {
      const ref = dep.ref as SkillRef
      const label = ref.name ?? ref.path ?? 'unknown'
      console.log(`  ${statusIcon(dep)} ${label}`)
    }
  }

  if (mcpStatus.length > 0) {
    log.message(pc.bold('MCP Servers:'))
    for (const mcp of mcpStatus) {
      const icon = mcp.available
        ? ICON_OK
        : mcp.hasInstall
          ? ICON_DOWNLOAD
          : ICON_WARN
      const hint = mcp.available
        ? ''
        : mcp.hasInstall
          ? ' (will install)'
          : ' (no install command — manual setup required)'
      console.log(`  ${icon} ${mcp.name}${hint}`)
    }
  }

  if (pluginDeps.length === 0 && skillDeps.length === 0 && mcpStatus.length === 0) {
    outro(pc.green('No dependencies defined for this environment.'))
    return
  }

  // 6. Handle version mismatches interactively
  const mismatched = pluginDeps.filter((d) => d.status === 'version-mismatch')
  const resolvedMismatches = new Map<DepResolution, 'cache' | 'use-installed' | 'upgrade'>()

  for (const dep of mismatched) {
    const ref = dep.ref as PluginRef
    const choice = await select({
      message: `Plugin ${pc.cyan(ref.name)}: installed ${pc.yellow(dep.installedVersion ?? '?')}, required ${pc.cyan(ref.version ?? '*')}. What to do?`,
      options: [
        {
          value: 'cache',
          label: 'Cache the required version (use alongside installed)',
          hint: 'recommended',
        },
        {
          value: 'use-installed',
          label: 'Use the installed version anyway',
          hint: 'may cause issues',
        },
        {
          value: 'upgrade',
          label: 'Upgrade the installed version',
          hint: 'modifies Claude Code global install',
        },
      ],
    })

    if (typeof choice === 'string') {
      resolvedMismatches.set(dep, choice as 'cache' | 'use-installed' | 'upgrade')
    }
  }

  // 7. Install missing and user-chosen items
  const spin = spinner()

  // Plugins: missing
  const missingPlugins = pluginDeps.filter((d) => d.status === 'missing')
  for (const dep of missingPlugins) {
    const ref = dep.ref as PluginRef
    spin.start(`Installing plugin ${ref.name}...`)
    try {
      await installPlugin(ref)
      spin.stop(`${ICON_OK} Installed plugin ${ref.name}`)
    } catch (err) {
      spin.stop(`${ICON_WARN} Failed to install plugin ${ref.name}: ${(err as Error).message}`)
    }
  }

  // Plugins: version-mismatch resolutions
  for (const [dep, resolution] of resolvedMismatches) {
    const ref = dep.ref as PluginRef
    if (resolution === 'upgrade' || resolution === 'cache') {
      spin.start(`${resolution === 'upgrade' ? 'Upgrading' : 'Caching'} plugin ${ref.name}...`)
      try {
        await installPlugin(ref)
        spin.stop(`${ICON_OK} ${resolution === 'upgrade' ? 'Upgraded' : 'Cached'} plugin ${ref.name}`)
      } catch (err) {
        spin.stop(
          `${ICON_WARN} Failed to ${resolution === 'upgrade' ? 'upgrade' : 'cache'} plugin ${ref.name}: ${(err as Error).message}`
        )
      }
    }
    // use-installed: no action needed
  }

  // Skills: missing source-based skills
  const missingSkills = skillDeps.filter((d) => d.status === 'missing')
  for (const dep of missingSkills) {
    const ref = dep.ref as SkillRef
    if (!ref.source) continue // local path skills that are missing can't be auto-installed
    const label = ref.name ?? ref.path ?? 'unknown'
    spin.start(`Installing skill ${label}...`)
    try {
      await installSkill(ref, CACHE_DIR)
      spin.stop(`${ICON_OK} Installed skill ${label}`)
    } catch (err) {
      spin.stop(`${ICON_WARN} Failed to install skill ${label}: ${(err as Error).message}`)
    }
  }

  // MCP: missing with install command
  for (const mcp of mcpStatus) {
    if (!mcp.available && mcp.hasInstall) {
      spin.start(`Installing MCP server ${mcp.name}...`)
      try {
        await installMcpServer(mcp.config)
        spin.stop(`${ICON_OK} Installed MCP server ${mcp.name}`)
      } catch (err) {
        spin.stop(`${ICON_WARN} Failed to install MCP server ${mcp.name}: ${(err as Error).message}`)
      }
    }
  }

  // 8. Summary
  const totalInstalled =
    missingPlugins.length +
    resolvedMismatches.size +
    missingSkills.filter((d) => !!(d.ref as SkillRef).source).length +
    mcpStatus.filter((m) => !m.available && m.hasInstall).length

  if (totalInstalled === 0) {
    outro(pc.green('All dependencies are already satisfied.'))
  } else {
    outro(pc.green(`Done. Installed ${totalInstalled} item(s).`))
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(dep: DepResolution): string {
  switch (dep.status) {
    case 'installed':
      return ICON_OK
    case 'cached':
      return ICON_CACHED
    case 'missing':
      return ICON_DOWNLOAD
    case 'version-mismatch':
      return ICON_WARN
    default:
      return '?'
  }
}

function formatVersion(dep: DepResolution): string {
  const ref = dep.ref as PluginRef
  if (!ref.version) return ''
  if (dep.installedVersion) {
    return ` (${dep.installedVersion} installed, required ${ref.version})`
  }
  return ` (${ref.version})`
}
