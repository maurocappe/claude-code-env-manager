import { outro, log } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { createEnvDir } from '../lib/environments'

/**
 * Implement `cenv create <name>`.
 *
 * @param name      Environment name to create
 * @param options   Optional flags from the CLI
 * @param cenvHome  Override for cenv home (for testing)
 */
export async function runCreate(
  name: string,
  options: {
    snapshot?: boolean
    from?: string
    wizard?: boolean
  } = {},
  cenvHome: string = CENV_HOME
): Promise<void> {
  if (options.snapshot) {
    log.warn('--snapshot is not implemented yet.')
    return
  }

  if (options.from) {
    log.warn('--from is not implemented yet.')
    return
  }

  if (options.wizard) {
    log.warn('--wizard is not implemented yet.')
    return
  }

  const envPath = createEnvDir(name, cenvHome)
  const displayPath = envPath.replace(process.env.HOME ?? '', '~')

  outro(`${pc.green('✓')} Created environment ${pc.cyan(pc.bold(name))} at ${pc.dim(displayPath)}`)
}
