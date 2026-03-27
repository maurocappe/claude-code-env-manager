import { log, outro } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { listAllEnvs } from '../lib/resolver'

// Strips ANSI escape codes to measure visible string width
const ANSI_RE = /\x1B\[[0-9;]*m/g
function visibleLen(s: string): number {
  return s.replace(ANSI_RE, '').length
}

/**
 * Implement `cenv list`.
 * Displays all environments from personal (~/.claude-envs/envs/) and project (./.claude-envs/).
 *
 * @param cenvHome  Override for cenv home (for testing)
 * @param cwd       Override for cwd (for testing)
 */
export async function runList(
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  const envs = listAllEnvs(cenvHome, cwd)

  if (envs.length === 0) {
    outro(
      `No environments found. Create one with: ${pc.cyan('cenv create <name>')}`
    )
    return
  }

  // Build table rows
  const rows = envs.map((e) => {
    const sourceLabel =
      e.source === 'personal'
        ? pc.blue('personal')
        : pc.magenta('project')
    const displayPath = e.path.replace(process.env.HOME ?? '', '~')
    return { name: pc.bold(e.name), source: sourceLabel, path: pc.dim(displayPath) }
  })

  // Compute column widths (based on visible character counts, not raw string lengths with ANSI)
  const nameWidth = Math.max(4, ...rows.map((r) => visibleLen(r.name)))
  const sourceWidth = Math.max(6, ...rows.map((r) => visibleLen(r.source)))

  const header =
    pc.underline('NAME').padEnd(nameWidth + 4) +
    pc.underline('SOURCE').padEnd(sourceWidth + 4) +
    pc.underline('PATH')

  const lines = [header]
  for (const row of rows) {
    const namePad = nameWidth - visibleLen(row.name)
    const sourcePad = sourceWidth - visibleLen(row.source)
    lines.push(
      row.name + ' '.repeat(namePad + 4) +
      row.source + ' '.repeat(sourcePad + 4) +
      row.path
    )
  }

  log.message(lines.join('\n'))
  log.message(pc.dim(`${envs.length} environment${envs.length === 1 ? '' : 's'}`))
}
