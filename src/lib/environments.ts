import fs from 'node:fs'
import path from 'node:path'
import { CENV_HOME } from '../constants'
import { CenvError, EnvironmentNotFoundError } from '../errors'
import { writeEnvConfig } from './config'

const VALID_NAME_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Validate that a name is safe for use in file paths.
 * Prevents path traversal attacks via `../` or absolute paths.
 * @throws CenvError if the name is invalid
 */
export function validateName(name: string): void {
  if (!name || !VALID_NAME_RE.test(name)) {
    throw new CenvError(
      `Invalid name "${name}". Names may only contain letters, digits, hyphens, and underscores.`
    )
  }
}

/**
 * Ensure the ~/.claude-envs/ directory structure exists.
 * Creates: envs/, auth/, cache/, sessions/
 * Creates .gitignore in auth/ that ignores all files.
 * Safe to call multiple times (idempotent).
 *
 * @param cenvHome Override for the cenv home directory (defaults to ~/.claude-envs/)
 */
export function ensureCenvHome(cenvHome: string = CENV_HOME): void {
  const envsDir = path.join(cenvHome, 'envs')
  const authDir = path.join(cenvHome, 'auth')
  const cacheDir = path.join(cenvHome, 'cache')
  const sessionsDir = path.join(cenvHome, 'sessions')

  fs.mkdirSync(envsDir, { recursive: true })
  fs.mkdirSync(authDir, { recursive: true })
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.mkdirSync(sessionsDir, { recursive: true })

  // Create .gitignore in auth/ to protect secrets from accidental commits.
  // Only write it if it doesn't already exist (idempotent, preserves mtime).
  const gitignorePath = path.join(authDir, '.gitignore')
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*\n!.gitignore\n', 'utf8')
  }
}

/**
 * Create a scaffold environment directory at ~/.claude-envs/envs/<name>/.
 * Writes a minimal env.yaml and an empty claude.md with a comment header.
 *
 * @param name Environment name
 * @param cenvHome Override for the cenv home directory (defaults to ~/.claude-envs/)
 * @returns Full path to the created directory
 * @throws Error if the directory already exists
 */
export function createEnvDir(name: string, cenvHome: string = CENV_HOME): string {
  validateName(name)
  const envsDir = path.join(cenvHome, 'envs')
  const envDir = path.join(envsDir, name)

  if (fs.existsSync(envDir)) {
    throw new Error(`Environment "${name}" already exists at ${envDir}`)
  }

  fs.mkdirSync(envDir, { recursive: true })

  // Scaffold env.yaml
  writeEnvConfig(envDir, {
    name,
    description: '',
    isolation: 'additive',
  })

  // Empty claude.md with comment header
  fs.writeFileSync(
    path.join(envDir, 'claude.md'),
    `# Claude Code instructions for ${name}\n`,
    'utf8'
  )

  return envDir
}

/**
 * Delete an environment directory recursively.
 *
 * @param name Environment name
 * @param cenvHome Override for the cenv home directory (defaults to ~/.claude-envs/)
 * @throws EnvironmentNotFoundError if the directory does not exist
 */
export function deleteEnvDir(name: string, cenvHome: string = CENV_HOME): void {
  validateName(name)
  const envsDir = path.join(cenvHome, 'envs')
  const envDir = path.join(envsDir, name)

  if (!fs.existsSync(envDir)) {
    throw new EnvironmentNotFoundError(name)
  }

  fs.rmSync(envDir, { recursive: true, force: true })
}

/**
 * Check whether an environment exists (has an env.yaml).
 *
 * @param name Environment name
 * @param cenvHome Override for the cenv home directory (defaults to ~/.claude-envs/)
 */
export function envExists(name: string, cenvHome: string = CENV_HOME): boolean {
  const envYamlPath = path.join(cenvHome, 'envs', name, 'env.yaml')
  return fs.existsSync(envYamlPath)
}

/**
 * Copy an environment directory's contents to a destination.
 * Copies: env.yaml (required), claude.md, skills/, hooks/ (optional).
 */
export function copyEnvContents(srcDir: string, destDir: string): void {
  fs.cpSync(path.join(srcDir, 'env.yaml'), path.join(destDir, 'env.yaml'))

  for (const name of ['claude.md']) {
    const src = path.join(srcDir, name)
    if (fs.existsSync(src)) fs.cpSync(src, path.join(destDir, name))
  }

  for (const dir of ['skills', 'hooks']) {
    const src = path.join(srcDir, dir)
    if (fs.existsSync(src)) fs.cpSync(src, path.join(destDir, dir), { recursive: true })
  }
}

// ── Path helpers ───────────────────────────────────────────────────────────────

export function getEnvPath(name: string, cenvHome: string = CENV_HOME): string {
  return path.join(cenvHome, 'envs', name)
}

export function getAuthPath(cenvHome: string = CENV_HOME): string {
  return path.join(cenvHome, 'auth')
}

export function getCachePath(cenvHome: string = CENV_HOME): string {
  return path.join(cenvHome, 'cache')
}

export function getSessionsPath(cenvHome: string = CENV_HOME): string {
  return path.join(cenvHome, 'sessions')
}
