import fs from 'node:fs'
import path from 'node:path'
import { intro, outro, log } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { ensureCenvHome } from '../lib/environments'

/**
 * Run the `cenv init` command.
 * Creates ~/.claude-envs/ and all required subdirectories.
 * Prints a structured success message via @clack/prompts.
 */
export async function runInit(cenvHome: string = CENV_HOME): Promise<void> {
  intro(pc.cyan('cenv') + ' — first-time setup')

  ensureCenvHome(cenvHome)

  const homeDisplay = cenvHome.replace(process.env.HOME ?? '', '~')
  const envsDir = path.join(cenvHome, 'envs')
  const authDir = path.join(cenvHome, 'auth')
  const cacheDir = path.join(cenvHome, 'cache')
  const sessionsDir = path.join(cenvHome, 'sessions')

  const tick = pc.green('✓')
  log.message(
    [
      `${tick} Created ${homeDisplay}/`,
      `${tick} Created envs/`,
      `${tick} Created auth/ ${pc.dim('(gitignored)')}`,
      `${tick} Created cache/`,
      `${tick} Created sessions/`,
    ].join('\n')
  )

  outro(`Ready! Create your first environment with: ${pc.cyan('cenv create <name>')}`)
}
