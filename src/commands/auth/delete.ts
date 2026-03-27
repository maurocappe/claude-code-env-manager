import { confirm, cancel, outro, isCancel } from '@clack/prompts'
import pc from 'picocolors'
import { AUTH_DIR } from '../../constants'
import { deleteAuthProfile } from '../../lib/auth'
import { AuthError } from '../../errors'

/**
 * `cenv auth delete <name>` — confirm then remove an auth profile.
 *
 * @param name    Profile name to delete
 * @param authDir Override for auth directory (for testing)
 */
export async function runAuthDelete(name: string, authDir: string = AUTH_DIR): Promise<void> {
  const confirmed = await confirm({
    message: `Delete auth profile ${pc.cyan(pc.bold(name))}? This will also remove the keychain entry.`,
    initialValue: false,
  })

  if (isCancel(confirmed) || !confirmed) {
    cancel('Cancelled')
    return
  }

  try {
    await deleteAuthProfile(name, authDir)
    outro(`${pc.green('✓')} Auth profile ${pc.cyan(pc.bold(name))} deleted`)
  } catch (err) {
    if (err instanceof AuthError) {
      console.error(pc.red(`Error: ${err.message}`))
      process.exit(1)
    }
    throw err
  }
}
