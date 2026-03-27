import { select, log, intro, cancel, isCancel } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { resolveEnv, listAllEnvs } from '../lib/resolver'
import { loadAuthProfile, listAuthProfiles, resolveAuthEnvVars } from '../lib/auth'
import { createSession, cleanupStaleSessions } from '../lib/session'
import { isPersonalEnv, isAllowed } from '../lib/trust'
import { assembleClaudeArgs, findClaudeBinary } from '../lib/runner'

interface RunOpts {
  auth?: string | boolean
  dryRun?: boolean
}

/**
 * Core `cenv run` command.
 * Resolves env, checks trust, generates session files, and launches claude.
 */
export async function runRun(
  envNameOrPath?: string,
  passThroughArgs: string[] = [],
  opts: RunOpts = {},
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  // 1. If no env specified, interactive picker
  if (!envNameOrPath) {
    const envs = listAllEnvs(cenvHome, cwd)
    if (envs.length === 0) {
      log.error(`No environments found. Create one with: ${pc.cyan('cenv create <name>')}`)
      return
    }

    const selected = await select({
      message: 'Select environment',
      options: envs.map(e => ({
        value: e.name,
        label: e.name,
        hint: `${e.source} — ${e.path.replace(process.env.HOME ?? '', '~')}`,
      })),
    })
    if (isCancel(selected)) { cancel('Cancelled'); return }
    envNameOrPath = selected as string
  }

  // 2. Resolve env
  const resolved = await resolveEnv(envNameOrPath, cenvHome, cwd)

  intro(`${pc.cyan('cenv run')} ${pc.bold(resolved.config.name)}`)

  // 3. Check trust for project envs
  if (!isPersonalEnv(resolved.path, cenvHome)) {
    if (!isAllowed(resolved.path, cenvHome)) {
      const hookDetails = Object.entries(resolved.config.hooks ?? {})
        .flatMap(([event, hooks]) => hooks.map(h => `    ${event}: ${h.command}`))
        .join('\n')

      log.error(
        `This environment is from the project repository and has not been trusted.\n\n` +
        `  Path: ${resolved.path}\n` +
        `  Plugins: ${resolved.config.plugins?.enable?.length ?? 0}\n` +
        `  Skills: ${resolved.config.skills?.length ?? 0}\n` +
        `  MCP: ${Object.keys(resolved.config.mcp_servers ?? {}).length}\n` +
        `  Hooks: ${Object.keys(resolved.config.hooks ?? {}).length}\n` +
        (hookDetails ? `\n  Hook commands:\n${hookDetails}\n` : '') +
        `\nRun ${pc.cyan('cenv allow ' + resolved.config.name)} to trust this environment.`
      )
      return
    }
  }

  // 4. Resolve auth
  let authEnvVars: Record<string, string> = {}

  if (opts.auth === true) {
    // Bare --auth flag → interactive picker
    const profiles = listAuthProfiles(undefined)
    if (profiles.length === 0) {
      log.warn(`No auth profiles found. Create one with: ${pc.cyan('cenv auth create')}`)
    } else {
      const selected = await select({
        message: 'Select auth profile',
        options: profiles.map(p => ({
          value: p.name,
          label: p.name,
          hint: `${p.type} — ${p.detail}`,
        })),
      })
      if (isCancel(selected)) { cancel('Cancelled'); return }
      const profile = loadAuthProfile(selected as string)
      authEnvVars = await resolveAuthEnvVars(profile, selected as string)
    }
  } else if (typeof opts.auth === 'string') {
    // Explicit auth profile name
    const profile = loadAuthProfile(opts.auth)
    authEnvVars = await resolveAuthEnvVars(profile, opts.auth)
  }

  // 5. Clean stale sessions
  cleanupStaleSessions()

  // 6. Generate session files
  const session = await createSession(resolved.config, resolved.path)

  // 7. Assemble claude CLI args
  const claudeArgs = assembleClaudeArgs(session, resolved.config, passThroughArgs)

  // 8. Find claude binary
  const claudeBin = findClaudeBinary()

  if (opts.dryRun) {
    // Print the command instead of executing
    const envStr = Object.entries(authEnvVars)
      .map(([k, v]) => `${k}=${k.includes('KEY') || k.includes('TOKEN') ? '***' : v}`)
      .join(' ')
    const cmd = [envStr, claudeBin, ...claudeArgs].filter(Boolean).join(' \\\n  ')
    log.info(`Dry run — would execute:\n\n${pc.dim(cmd)}`)
    log.info(`Session dir: ${pc.dim(session.dir)}`)
    return
  }

  // 9. Launch claude
  log.step(`Launching claude...`)

  const env = { ...process.env, ...authEnvVars }
  const proc = Bun.spawn([claudeBin, ...claudeArgs], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env,
    cwd,
  })

  await proc.exited
  process.exit(proc.exitCode ?? 0)
}
