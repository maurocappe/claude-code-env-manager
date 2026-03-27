import { confirm, outro, log, isCancel } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { resolveEnv } from '../lib/resolver'
import { deleteEnvDir } from '../lib/environments'

/**
 * Implement `cenv delete <name>`.
 * Resolves the environment, asks for confirmation, then deletes it.
 * Only personal environments can be deleted via this command.
 *
 * @param nameOrPath  Environment name or path
 * @param cenvHome    Override for cenv home (for testing)
 * @param cwd         Override for cwd (for testing)
 */
export async function runDelete(
  nameOrPath: string,
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  const resolved = await resolveEnv(nameOrPath, cenvHome, cwd)

  if (resolved.source !== 'personal') {
    log.error(
      `Only personal environments can be deleted with ${pc.cyan('cenv delete')}.\n` +
        `  The environment "${resolved.config.name}" lives in a project directory.\n` +
        `  Remove it manually from: ${pc.dim(resolved.path)}`
    )
    return
  }

  const confirmed = await confirm({
    message: `Delete environment ${pc.bold(resolved.config.name)}? This cannot be undone.`,
  })

  if (isCancel(confirmed) || !confirmed) {
    log.message(pc.dim('Cancelled.'))
    return
  }

  // deleteEnvDir expects the name, not the path
  const name = resolved.config.name
  deleteEnvDir(name, cenvHome)

  outro(`${pc.green('✓')} Deleted environment ${pc.cyan(pc.bold(name))}`)
}
