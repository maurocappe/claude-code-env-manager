import path from 'node:path'
import { log } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { resolveEnv } from '../lib/resolver'

/**
 * Implement `cenv edit <name> [--md]`.
 * Resolves the environment and opens its env.yaml (or claude.md) in $EDITOR.
 *
 * @param nameOrPath  Environment name or path
 * @param options     { md: boolean } — open claude.md instead of env.yaml
 * @param cenvHome    Override for cenv home (for testing)
 * @param cwd         Override for cwd (for testing)
 */
export async function runEdit(
  nameOrPath: string,
  options: { md?: boolean } = {},
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  const resolved = await resolveEnv(nameOrPath, cenvHome, cwd)

  const fileName = options.md ? 'claude.md' : 'env.yaml'
  const filePath = path.join(resolved.path, fileName)
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi'

  log.step(`Opening ${pc.cyan(fileName)} in ${pc.bold(editor)}…`)

  const proc = Bun.spawn([editor, filePath], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited
}
