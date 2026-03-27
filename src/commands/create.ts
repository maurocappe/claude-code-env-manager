import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { outro, log } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { createEnvDir } from '../lib/environments'
import { snapshotCurrentSetup } from '../lib/snapshot'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Recursively copy env files (env.yaml, claude.md, skills/, hooks/) from src to dest.
 * dest must already exist.
 */
function copyEnvContents(srcDir: string, destDir: string): void {
  const envYaml = path.join(srcDir, 'env.yaml')
  if (fs.existsSync(envYaml)) {
    fs.cpSync(envYaml, path.join(destDir, 'env.yaml'))
  }

  const claudeMd = path.join(srcDir, 'claude.md')
  if (fs.existsSync(claudeMd)) {
    fs.cpSync(claudeMd, path.join(destDir, 'claude.md'))
  }

  const skillsDir = path.join(srcDir, 'skills')
  if (fs.existsSync(skillsDir)) {
    fs.cpSync(skillsDir, path.join(destDir, 'skills'), { recursive: true })
  }

  const hooksDir = path.join(srcDir, 'hooks')
  if (fs.existsSync(hooksDir)) {
    fs.cpSync(hooksDir, path.join(destDir, 'hooks'), { recursive: true })
  }
}

/**
 * Implement `--from <source>` creation mode.
 *
 * Supported sources:
 * - `github:user/repo` or `github:user/repo/subpath` — git clone then look for .claude-envs/ or env.yaml
 * - `./local/path` or `/absolute/path` — copy from local filesystem
 *
 * After copying, suggests running `cenv install <name>`.
 */
async function createFromSource(
  name: string,
  source: string,
  cenvHome: string
): Promise<void> {
  const envsDir = path.join(cenvHome, 'envs')
  const destDir = path.join(envsDir, name)

  if (fs.existsSync(destDir)) {
    throw new Error(`Environment "${name}" already exists at ${destDir}`)
  }

  // ── GitHub source ────────────────────────────────────────────────────────────

  if (source.startsWith('github:') || source.includes('/') && !source.startsWith('.') && !source.startsWith('/')) {
    // Parse github: prefix or plain user/repo format
    let repoSpec = source.startsWith('github:') ? source.slice('github:'.length) : source
    // repoSpec may be: user/repo or user/repo/subpath
    const parts = repoSpec.split('/')
    const user = parts[0]
    const repo = parts[1]
    const subPath = parts.slice(2).join('/')

    if (!user || !repo) {
      log.error(`Invalid GitHub source: "${source}". Expected format: github:user/repo`)
      process.exit(1)
    }

    const repoUrl = `https://github.com/${user}/${repo}.git`
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-from-'))

    try {
      log.step(`Cloning ${repoUrl} ...`)

      const cloneResult = Bun.spawnSync(['git', 'clone', '--depth=1', repoUrl, tmpDir], {
        stderr: 'inherit',
      })

      if (cloneResult.exitCode !== 0) {
        log.error(`git clone failed for ${repoUrl}`)
        process.exit(1)
      }

      // Find the env source inside the cloned repo
      let envSrcDir: string | null = null

      if (subPath) {
        // Explicit subpath provided
        const candidate = path.join(tmpDir, subPath)
        if (fs.existsSync(path.join(candidate, 'env.yaml'))) {
          envSrcDir = candidate
        } else if (fs.existsSync(path.join(candidate, '.claude-envs', name, 'env.yaml'))) {
          envSrcDir = path.join(candidate, '.claude-envs', name)
        }
      } else {
        // Look for .claude-envs/<name>/ first, then .claude-envs/ (any env), then root env.yaml
        const claudeEnvsDir = path.join(tmpDir, '.claude-envs')
        if (fs.existsSync(path.join(claudeEnvsDir, name, 'env.yaml'))) {
          envSrcDir = path.join(claudeEnvsDir, name)
        } else if (fs.existsSync(claudeEnvsDir)) {
          // Pick the first env found
          const entries = fs.readdirSync(claudeEnvsDir, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isDirectory() && fs.existsSync(path.join(claudeEnvsDir, entry.name, 'env.yaml'))) {
              envSrcDir = path.join(claudeEnvsDir, entry.name)
              break
            }
          }
        } else if (fs.existsSync(path.join(tmpDir, 'env.yaml'))) {
          envSrcDir = tmpDir
        }
      }

      if (!envSrcDir) {
        log.error(`Could not find an env.yaml in the cloned repository ${repoUrl}`)
        process.exit(1)
      }

      fs.mkdirSync(destDir, { recursive: true })
      copyEnvContents(envSrcDir, destDir)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  } else {
    // ── Local path ──────────────────────────────────────────────────────────────

    const srcDir = path.resolve(source)

    if (!fs.existsSync(srcDir)) {
      log.error(`Source path not found: ${srcDir}`)
      process.exit(1)
    }

    // Check if it's a directory with env.yaml, or if it contains .claude-envs/
    let envSrcDir: string | null = null

    if (fs.existsSync(path.join(srcDir, 'env.yaml'))) {
      envSrcDir = srcDir
    } else if (fs.existsSync(path.join(srcDir, '.claude-envs', name, 'env.yaml'))) {
      envSrcDir = path.join(srcDir, '.claude-envs', name)
    } else if (fs.existsSync(path.join(srcDir, '.claude-envs'))) {
      const claudeEnvsDir = path.join(srcDir, '.claude-envs')
      const entries = fs.readdirSync(claudeEnvsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && fs.existsSync(path.join(claudeEnvsDir, entry.name, 'env.yaml'))) {
          envSrcDir = path.join(claudeEnvsDir, entry.name)
          break
        }
      }
    }

    if (!envSrcDir) {
      log.error(`Could not find an env.yaml at: ${srcDir}`)
      process.exit(1)
    }

    fs.mkdirSync(destDir, { recursive: true })
    copyEnvContents(envSrcDir, destDir)
  }

  const displayPath = destDir.replace(process.env.HOME ?? '', '~')
  outro(
    `${pc.green('✓')} Created environment ${pc.cyan(pc.bold(name))} at ${pc.dim(displayPath)}\n` +
    `  ${pc.dim(`Run ${pc.bold(`cenv install ${name}`)} to install dependencies.`)}`
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

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
  if (options.from) {
    await createFromSource(name, options.from, cenvHome)
    return
  }

  if (options.wizard) {
    log.warn('--wizard is not implemented yet.')
    return
  }

  const envPath = createEnvDir(name, cenvHome)
  const displayPath = envPath.replace(process.env.HOME ?? '', '~')

  if (options.snapshot) {
    snapshotCurrentSetup(envPath, name)
    outro(
      `${pc.green('✓')} Created environment ${pc.cyan(pc.bold(name))} at ${pc.dim(displayPath)} (snapshotted current setup)`
    )
    return
  }

  outro(`${pc.green('✓')} Created environment ${pc.cyan(pc.bold(name))} at ${pc.dim(displayPath)}`)
}
