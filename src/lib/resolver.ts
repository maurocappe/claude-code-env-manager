import fs from 'node:fs'
import path from 'node:path'
import { select } from '@clack/prompts'
import { CENV_HOME } from '../constants'
import { EnvironmentNotFoundError } from '../errors'
import type { EnvEntry, ResolvedEnv } from '../types'
import { loadEnvConfig } from './config'

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Scan a directory for env entries (subdirectories containing env.yaml).
 * Returns an empty array if the directory does not exist.
 */
function scanEnvDir(dir: string, source: 'personal' | 'project'): EnvEntry[] {
  if (!fs.existsSync(dir)) return []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const results: EnvEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const envYaml = path.join(dir, entry.name, 'env.yaml')
    if (fs.existsSync(envYaml)) {
      results.push({
        name: entry.name,
        path: path.join(dir, entry.name),
        source,
      })
    }
  }
  return results
}

/**
 * Returns the personal envs directory: <cenvHome>/envs/
 */
function personalEnvsDir(cenvHome: string): string {
  return path.join(cenvHome, 'envs')
}

/**
 * Returns the project envs directory: <cwd>/.claude-envs/
 */
function projectEnvsDir(cwd: string): string {
  return path.join(cwd, '.claude-envs')
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Resolve an environment name or path to a ResolvedEnv.
 *
 * Resolution order:
 * 1. If nameOrPath starts with `./` or `/` → use as direct path
 * 2. Search personal envs: <cenvHome>/envs/<name>/
 * 3. Search project envs: <cwd>/.claude-envs/<name>/
 * 4. Found in one location → return it
 * 5. Found in both → interactive clack select() picker
 * 6. Not found → throw EnvironmentNotFoundError with `cenv list` hint
 *
 * @param nameOrPath  Environment name or a path (starts with ./ or /)
 * @param cenvHome    Override for personal cenv home (default: ~/.claude-envs)
 * @param cwd         Override for current working directory (default: process.cwd())
 */
export async function resolveEnv(
  nameOrPath: string,
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<ResolvedEnv> {
  // 1. Path-based resolution
  if (nameOrPath.startsWith('./') || nameOrPath.startsWith('/')) {
    const envPath = path.resolve(cwd, nameOrPath)
    const config = loadEnvConfig(envPath)
    return { path: envPath, source: 'project', config }
  }

  // 2. Search personal and project locations
  const personalDir = path.join(personalEnvsDir(cenvHome), nameOrPath)
  const projectDir = path.join(projectEnvsDir(cwd), nameOrPath)

  const personalExists =
    fs.existsSync(personalDir) && fs.existsSync(path.join(personalDir, 'env.yaml'))
  const projectExists =
    fs.existsSync(projectDir) && fs.existsSync(path.join(projectDir, 'env.yaml'))

  // 3. Found in exactly one location
  if (personalExists && !projectExists) {
    return { path: personalDir, source: 'personal', config: loadEnvConfig(personalDir) }
  }

  if (projectExists && !personalExists) {
    return { path: projectDir, source: 'project', config: loadEnvConfig(projectDir) }
  }

  // 4. Found in both — interactive picker
  if (personalExists && projectExists) {
    const homeDisplay = cenvHome.replace(process.env.HOME ?? '', '~')
    const cwdDisplay = cwd.replace(process.env.HOME ?? '', '~')

    const choice = await select({
      message: `Found "${nameOrPath}" in multiple locations:`,
      options: [
        {
          value: 'personal',
          label: `${homeDisplay}/envs/${nameOrPath}`,
          hint: 'personal',
        },
        {
          value: 'project',
          label: `${cwdDisplay}/.claude-envs/${nameOrPath}`,
          hint: 'project',
        },
      ],
    })

    if (typeof choice !== 'string') {
      // User cancelled — treat as not found
      throw new EnvironmentNotFoundError(nameOrPath)
    }

    const chosenPath = choice === 'personal' ? personalDir : projectDir
    return {
      path: chosenPath,
      source: choice as 'personal' | 'project',
      config: loadEnvConfig(chosenPath),
    }
  }

  // 5. Not found — suggest nearby names from both locations
  const allEnvs = listAllEnvs(cenvHome, cwd)
  const suggestions = allEnvs
    .map((e) => e.name)
    .filter((n) => n.includes(nameOrPath) || nameOrPath.includes(n))
    .slice(0, 3)

  const hint = suggestions.length === 0 ? `\n  Run \`cenv list\` to see available environments.` : ''
  const error = new EnvironmentNotFoundError(nameOrPath, suggestions)
  // Append list hint if no close suggestions were found
  if (hint) {
    Object.defineProperty(error, 'message', { value: error.message + hint })
  }
  throw error
}

/**
 * List all environments from both personal and project locations.
 * Does not throw if directories don't exist — returns empty array.
 * Results are sorted alphabetically by name.
 *
 * @param cenvHome  Override for personal cenv home (default: ~/.claude-envs)
 * @param cwd       Override for current working directory (default: process.cwd())
 */
export function listAllEnvs(
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): EnvEntry[] {
  const personal = scanEnvDir(personalEnvsDir(cenvHome), 'personal')
  const project = scanEnvDir(projectEnvsDir(cwd), 'project')

  return [...personal, ...project].sort((a, b) => a.name.localeCompare(b.name))
}
