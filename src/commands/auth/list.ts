import pc from 'picocolors'
import { AUTH_DIR } from '../../constants'
import { listAuthProfiles } from '../../lib/auth'

/**
 * `cenv auth list` — display all auth profiles as a simple table.
 *
 * @param authDir Override for auth directory (for testing)
 */
export function runAuthList(authDir: string = AUTH_DIR): void {
  const profiles = listAuthProfiles(authDir)

  if (profiles.length === 0) {
    console.log(pc.dim('No auth profiles found. Run `cenv auth create` to add one.'))
    return
  }

  // Calculate column widths
  const nameWidth = Math.max(4, ...profiles.map((p) => p.name.length))
  const typeWidth = Math.max(4, ...profiles.map((p) => p.type.length))

  const header =
    pc.bold('NAME'.padEnd(nameWidth)) +
    '  ' +
    pc.bold('TYPE'.padEnd(typeWidth)) +
    '  ' +
    pc.bold('DETAIL')

  console.log(header)
  console.log(pc.dim('─'.repeat(nameWidth + typeWidth + 20)))

  for (const p of profiles) {
    const row =
      pc.cyan(p.name.padEnd(nameWidth)) +
      '  ' +
      p.type.padEnd(typeWidth) +
      '  ' +
      pc.dim(p.detail)
    console.log(row)
  }
}
