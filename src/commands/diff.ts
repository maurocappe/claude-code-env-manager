import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { resolveEnv } from '../lib/resolver'
import { diffEnvConfigs, isDiffEmpty } from '../lib/diff'

/**
 * Implement `cenv diff <env1> <env2>`.
 *
 * Resolves both environments, computes a structured diff, and prints it with
 * color-coded output: green for additions, red for removals, yellow for changes.
 *
 * @param env1     First environment name or path
 * @param env2     Second environment name or path
 * @param cenvHome Override for cenv home (for testing)
 * @param cwd      Override for cwd (for testing)
 */
export async function runDiff(
  env1: string,
  env2: string,
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  // ── Resolve both environments ─────────────────────────────────────────────────

  const [resolvedA, resolvedB] = await Promise.all([
    resolveEnv(env1, cenvHome, cwd),
    resolveEnv(env2, cenvHome, cwd),
  ])

  const diff = diffEnvConfigs(resolvedA.config, resolvedB.config)

  // ── Output header ─────────────────────────────────────────────────────────────

  console.log()
  console.log(
    `${pc.bold('Comparing')} ${pc.cyan(resolvedA.config.name)} ${pc.dim('→')} ${pc.cyan(resolvedB.config.name)}`
  )
  console.log()

  if (isDiffEmpty(diff)) {
    console.log(pc.dim('  Environments are identical'))
    console.log()
    return
  }

  // ── Plugins ───────────────────────────────────────────────────────────────────

  const hasPluginChanges =
    diff.plugins.added.length > 0 ||
    diff.plugins.removed.length > 0 ||
    diff.plugins.changed.length > 0

  if (hasPluginChanges) {
    console.log(pc.bold('Plugins'))
    for (const name of diff.plugins.added) {
      console.log(`  ${pc.green('+')} ${name}`)
    }
    for (const name of diff.plugins.removed) {
      console.log(`  ${pc.red('-')} ${name}`)
    }
    for (const { name, from, to } of diff.plugins.changed) {
      console.log(`  ${pc.yellow('~')} ${name} ${pc.dim(`${from} → ${to}`)}`)
    }
    console.log()
  }

  // ── Skills ────────────────────────────────────────────────────────────────────

  const hasSkillChanges = diff.skills.added.length > 0 || diff.skills.removed.length > 0

  if (hasSkillChanges) {
    console.log(pc.bold('Skills'))
    for (const name of diff.skills.added) {
      console.log(`  ${pc.green('+')} ${name}`)
    }
    for (const name of diff.skills.removed) {
      console.log(`  ${pc.red('-')} ${name}`)
    }
    console.log()
  }

  // ── MCP Servers ───────────────────────────────────────────────────────────────

  const hasMcpChanges = diff.mcpServers.added.length > 0 || diff.mcpServers.removed.length > 0

  if (hasMcpChanges) {
    console.log(pc.bold('MCP Servers'))
    for (const name of diff.mcpServers.added) {
      console.log(`  ${pc.green('+')} ${name}`)
    }
    for (const name of diff.mcpServers.removed) {
      console.log(`  ${pc.red('-')} ${name}`)
    }
    console.log()
  }

  // ── Hooks ─────────────────────────────────────────────────────────────────────

  const hasHookChanges = diff.hooks.added.length > 0 || diff.hooks.removed.length > 0

  if (hasHookChanges) {
    console.log(pc.bold('Hooks'))
    for (const name of diff.hooks.added) {
      console.log(`  ${pc.green('+')} ${name}`)
    }
    for (const name of diff.hooks.removed) {
      console.log(`  ${pc.red('-')} ${name}`)
    }
    console.log()
  }

  // ── Settings ──────────────────────────────────────────────────────────────────

  if (diff.settings.length > 0) {
    console.log(pc.bold('Settings'))
    for (const { key, from, to } of diff.settings) {
      const fromStr = JSON.stringify(from) ?? 'undefined'
      const toStr = JSON.stringify(to) ?? 'undefined'
      console.log(`  ${pc.yellow('~')} ${key}: ${pc.dim(`${fromStr} → ${toStr}`)}`)
    }
    console.log()
  }
}
