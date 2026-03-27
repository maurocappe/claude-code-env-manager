import fs from 'node:fs'
import path from 'node:path'
import { outro, select, text, log } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { loadEnvConfig } from '../lib/config'

/**
 * Copy items from one env directory to another.
 * Copies env.yaml, claude.md (if present), and skills/ and hooks/ dirs (if present).
 */
// Use shared utility from lib/environments
import { copyEnvContents } from '../lib/environments'

/**
 * Implement `cenv add <nameOrPath> [--as <targetName>]`.
 *
 * Resolution:
 * - If nameOrPath starts with `.` or `/` → treat as a direct path
 * - Otherwise → look for it in `./.claude-envs/<name>/` (project env)
 *
 * Target: `<cenvHome>/envs/<targetName>/`
 *
 * If the target already exists, an interactive prompt offers: overwrite, rename, cancel.
 *
 * @param nameOrPath  Environment name (project env) or direct path
 * @param opts        Optional flags: `as` for renaming the target env name
 * @param cenvHome    Override for cenv home (for testing)
 * @param cwd         Override for cwd (for testing)
 */
export async function runAdd(
  nameOrPath: string,
  opts: { as?: string } = {},
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  // ── 1. Resolve source directory ──────────────────────────────────────────────

  let srcDir: string

  if (nameOrPath.startsWith('.') || nameOrPath.startsWith('/')) {
    // Direct path
    srcDir = path.resolve(cwd, nameOrPath)
  } else {
    // Look in project envs: ./.claude-envs/<name>/
    srcDir = path.join(cwd, '.claude-envs', nameOrPath)
  }

  if (!fs.existsSync(srcDir) || !fs.existsSync(path.join(srcDir, 'env.yaml'))) {
    log.error(`Source environment not found at: ${srcDir}`)
    process.exit(1)
  }

  // ── 2. Load source config to get the canonical name ──────────────────────────

  const config = loadEnvConfig(srcDir)

  // ── 3. Determine target name ─────────────────────────────────────────────────

  let targetName = opts.as ?? config.name

  // ── 4. Check for existing target ─────────────────────────────────────────────

  const envsDir = path.join(cenvHome, 'envs')
  fs.mkdirSync(envsDir, { recursive: true })

  let destDir = path.join(envsDir, targetName)

  if (fs.existsSync(destDir)) {
    const action = await select({
      message: `Environment "${targetName}" already exists in personal envs. What would you like to do?`,
      options: [
        { value: 'overwrite', label: 'Overwrite' },
        { value: 'rename', label: 'Rename' },
        { value: 'cancel', label: 'Cancel' },
      ],
    })

    if (typeof action !== 'string' || action === 'cancel') {
      log.info('Cancelled.')
      return
    }

    if (action === 'rename') {
      const newName = await text({
        message: 'Enter a new name for the imported environment:',
        validate(val) {
          if (!val || val.trim() === '') return 'Name cannot be empty'
          const candidate = path.join(envsDir, val.trim())
          if (fs.existsSync(candidate)) return `"${val.trim()}" already exists`
        },
      })

      if (typeof newName !== 'string') {
        log.info('Cancelled.')
        return
      }

      targetName = newName.trim()
      destDir = path.join(envsDir, targetName)
    } else {
      // overwrite — remove existing
      fs.rmSync(destDir, { recursive: true, force: true })
    }
  }

  // ── 5. Copy env files ────────────────────────────────────────────────────────

  fs.mkdirSync(destDir, { recursive: true })
  copyEnvContents(srcDir, destDir)

  // ── 6. Success ───────────────────────────────────────────────────────────────

  const displayDest = destDir.replace(process.env.HOME ?? '', '~')
  outro(
    `${pc.green('✓')} Imported environment ${pc.cyan(pc.bold(targetName))} to ${pc.dim(displayDest)}`
  )
}
