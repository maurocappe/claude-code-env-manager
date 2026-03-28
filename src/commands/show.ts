import { log } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { resolveEnv } from '../lib/resolver'
import type { EnvConfig } from '../types'

/**
 * Implement `cenv show <name>`.
 * Resolves the environment and displays a structured summary.
 *
 * @param nameOrPath  Environment name or path
 * @param cenvHome    Override for cenv home (for testing)
 * @param cwd         Override for cwd (for testing)
 */
export async function runShow(
  nameOrPath: string,
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  const resolved = await resolveEnv(nameOrPath, cenvHome, cwd)
  const { config, source, path: envPath } = resolved

  const displayPath = envPath.replace(process.env.HOME ?? '', '~')

  const lines = buildSummary(config, source, displayPath)
  log.message(lines.join('\n'))
}

function buildSummary(
  config: EnvConfig,
  source: 'personal' | 'project',
  displayPath: string
): string[] {
  const sourceLabel =
    source === 'personal' ? pc.blue('personal') : pc.magenta('project')

  const pluginsEnabled = config.plugins?.enable?.length ?? 0
  const pluginsDisabled = config.plugins?.disable?.length ?? 0
  const skillsCount = config.skills?.length ?? 0
  const mcpCount = Object.keys(config.mcp_servers ?? {}).length
  const hooksCount = Object.values(config.hooks ?? {}).reduce(
    (sum, arr) => sum + arr.length,
    0
  )

  const lines: string[] = [
    `${pc.bold(config.name)}  ${sourceLabel}`,
    '',
  ]

  if (config.description) {
    lines.push(`  ${pc.dim('description')}  ${config.description}`)
  }

  lines.push(`  ${pc.dim('path')}         ${pc.dim(displayPath)}`)
  lines.push('')

  // Component counts
  const components: string[] = []
  if (pluginsEnabled > 0) {
    components.push(`${pc.bold(pluginsEnabled)} plugin${pluginsEnabled !== 1 ? 's' : ''}`)
    if (pluginsDisabled > 0) {
      components.push(`${pc.dim(`(${pluginsDisabled} disabled)`)}`)
    }
  }
  if (skillsCount > 0) {
    components.push(`${pc.bold(skillsCount)} skill${skillsCount !== 1 ? 's' : ''}`)
  }
  if (mcpCount > 0) {
    components.push(`${pc.bold(mcpCount)} MCP server${mcpCount !== 1 ? 's' : ''}`)
  }
  if (hooksCount > 0) {
    components.push(`${pc.bold(hooksCount)} hook${hooksCount !== 1 ? 's' : ''}`)
  }

  if (components.length > 0) {
    lines.push(`  ${components.join('  ')}`)
  } else {
    lines.push(`  ${pc.dim('(empty environment)')}`)
  }

  // Settings summary
  if (config.settings) {
    lines.push('')
    const settingParts: string[] = []
    if (config.settings.effortLevel) {
      settingParts.push(`effort: ${config.settings.effortLevel}`)
    }
    const allowCount = config.settings.permissions?.allow?.length ?? 0
    if (allowCount > 0) {
      settingParts.push(`${allowCount} permission${allowCount !== 1 ? 's' : ''}`)
    }
    if (settingParts.length > 0) {
      lines.push(`  ${pc.dim('settings')}     ${settingParts.join(', ')}`)
    }
  }

  return lines
}
