import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CENV_HOME } from '../constants'

const ALLOWED_FILE = '.allowed'

function allowedPath(cenvHome: string = CENV_HOME): string {
  return path.join(cenvHome, ALLOWED_FILE)
}

/**
 * Compute a SHA-256 hash of all files in an env directory that affect behavior.
 * Includes: env.yaml, claude.md, and any files in skills/ and hooks/ subdirs.
 */
export function hashEnvDir(envDir: string): string {
  const hash = crypto.createHash('sha256')

  const filesToHash: string[] = []

  // Core files
  for (const name of ['env.yaml', 'claude.md']) {
    const p = path.join(envDir, name)
    if (fs.existsSync(p)) filesToHash.push(p)
  }

  // Recursively collect files from skills/ and hooks/ subdirs
  for (const subdir of ['skills', 'hooks']) {
    const dirPath = path.join(envDir, subdir)
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      collectFiles(dirPath, filesToHash)
    }
  }

  // Sort for deterministic ordering
  filesToHash.sort()

  for (const file of filesToHash) {
    // Hash the relative path + content for each file
    const relPath = path.relative(envDir, file)
    hash.update(relPath)
    hash.update(fs.readFileSync(file))
  }

  return hash.digest('hex')
}

function collectFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, out)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
}

/**
 * Check if an env directory is allowed (trusted).
 */
export function isAllowed(envDir: string, cenvHome?: string): boolean {
  const p = allowedPath(cenvHome)
  if (!fs.existsSync(p)) return false

  const currentHash = hashEnvDir(envDir)
  const allowed = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)

  return allowed.includes(`${envDir}:${currentHash}`)
}

/**
 * Mark an env directory as allowed.
 */
export function allowEnv(envDir: string, cenvHome?: string): void {
  const p = allowedPath(cenvHome)
  const currentHash = hashEnvDir(envDir)
  const entry = `${envDir}:${currentHash}`

  let existing: string[] = []
  if (fs.existsSync(p)) {
    existing = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
  }

  // Remove any old entries for this envDir (hash may have changed)
  existing = existing.filter(line => !line.startsWith(`${envDir}:`))
  existing.push(entry)

  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, existing.join('\n') + '\n', 'utf8')
}

/**
 * Check if an env path is a personal env (always trusted) vs project env (needs allow).
 */
export function isPersonalEnv(envPath: string, cenvHome: string = CENV_HOME): boolean {
  const envsDir = path.join(cenvHome, 'envs')
  return envPath.startsWith(envsDir)
}
