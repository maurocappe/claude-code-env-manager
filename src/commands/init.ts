import { intro, outro, log } from '@clack/prompts'
import pc from 'picocolors'
import { CENV_HOME } from '../constants'
import { ensureCenvHome } from '../lib/environments'

export async function runInit(cenvHome: string = CENV_HOME): Promise<void> {
  intro(pc.cyan('cenv') + ' — first-time setup')

  ensureCenvHome(cenvHome)

  const homeDisplay = cenvHome.replace(process.env.HOME ?? '', '~')

  const tick = pc.green('✓')
  log.message(
    [
      `${tick} Created ${homeDisplay}/`,
      `${tick} Created envs/`,
      `${tick} Created auth/ ${pc.dim('(gitignored)')}`,
      `${tick} Created cache/`,
    ].join('\n')
  )

  outro(`Ready! Create your first environment with: ${pc.cyan('cenv create <name>')}`)
}
