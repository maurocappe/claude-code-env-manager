import fs from 'node:fs'
import path from 'node:path'
import { log, outro } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { allowEnv } from '../lib/trust'
import { loadEnvConfig } from '../lib/config'

/**
 * Trust a project environment or all envs in a directory.
 */
export async function runAllow(
  name?: string,
  opts?: { dir?: string },
  cenvHome: string = CENV_HOME,
  cwd: string = process.cwd()
): Promise<void> {
  if (opts?.dir) {
    // Trust all envs in the specified directory's .claude-envs/
    const targetDir = path.resolve(cwd, opts.dir, '.claude-envs')
    if (!fs.existsSync(targetDir)) {
      log.error(`No .claude-envs/ found in ${opts.dir}`)
      return
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true })
    let count = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const envDir = path.join(targetDir, entry.name)
      if (!fs.existsSync(path.join(envDir, 'env.yaml'))) continue
      allowEnv(envDir, cenvHome)
      count++
    }
    outro(`${pc.green('✓')} Trusted ${count} environment${count !== 1 ? 's' : ''} in ${opts.dir}`)
    return
  }

  if (name) {
    // Trust a specific project env by name
    const envDir = path.join(cwd, '.claude-envs', name)
    if (!fs.existsSync(path.join(envDir, 'env.yaml'))) {
      log.error(`No project environment "${name}" found in .claude-envs/`)
      return
    }
    const config = loadEnvConfig(envDir)
    allowEnv(envDir, cenvHome)
    outro(`${pc.green('✓')} Trusted environment: ${pc.cyan(config.name)}`)
    return
  }

  // No args — trust all envs in current dir's .claude-envs/
  const targetDir = path.join(cwd, '.claude-envs')
  if (!fs.existsSync(targetDir)) {
    log.error('No .claude-envs/ found in current directory')
    return
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true })
  let count = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const envDir = path.join(targetDir, entry.name)
    if (!fs.existsSync(path.join(envDir, 'env.yaml'))) continue
    allowEnv(envDir, cenvHome)
    count++
  }
  outro(`${pc.green('✓')} Trusted ${count} environment${count !== 1 ? 's' : ''} in current project`)
}
