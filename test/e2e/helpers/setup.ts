import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface E2EContext {
  root: string
  home: string
  claudeHome: string
  cenvHome: string
  projectDir: string
  binDir: string
  outputFile: string
  keychainFile: string
  originalPath: string
  originalHome: string
  cleanup: () => void
}

export async function createE2EContext(): Promise<E2EContext> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-e2e-'))
  const home = path.join(root, 'home')
  const claudeHome = path.join(home, '.claude')
  const cenvHome = path.join(home, '.claude-envs')
  const projectDir = path.join(root, 'project')
  const binDir = path.join(root, 'bin')
  const outputFile = path.join(root, 'output', 'claude-invocation.json')
  const keychainFile = path.join(root, 'keychain.txt')

  // Create dirs
  fs.mkdirSync(path.join(root, 'output'), { recursive: true })
  fs.mkdirSync(binDir, { recursive: true })

  // Copy fixtures
  const fixturesDir = path.join(__dirname, '..', 'fixtures')
  fs.cpSync(path.join(fixturesDir, 'claude-home'), claudeHome, { recursive: true })
  fs.cpSync(path.join(fixturesDir, 'project'), projectDir, { recursive: true })

  // Patch installed_plugins.json with actual paths
  const installedPluginsPath = path.join(claudeHome, 'plugins', 'installed_plugins.json')
  let pluginsJson = fs.readFileSync(installedPluginsPath, 'utf8')
  const actualPluginPath = path.join(claudeHome, 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '5.0.6')
  pluginsJson = pluginsJson.replace('PLACEHOLDER_PLUGIN_PATH', actualPluginPath)
  fs.writeFileSync(installedPluginsPath, pluginsJson, 'utf8')

  // Copy mock binaries
  const helpersDir = path.join(__dirname)
  fs.copyFileSync(path.join(helpersDir, 'mock-claude.sh'), path.join(binDir, 'claude'))
  fs.copyFileSync(path.join(helpersDir, 'mock-security.sh'), path.join(binDir, 'security'))
  fs.chmodSync(path.join(binDir, 'claude'), 0o755)
  fs.chmodSync(path.join(binDir, 'security'), 0o755)

  // Create empty keychain file
  fs.writeFileSync(keychainFile, '', 'utf8')

  // Save original env
  const originalPath = process.env.PATH ?? ''
  const originalHome = process.env.HOME ?? ''

  // Set isolated env
  process.env.PATH = `${binDir}:${originalPath}`
  process.env.HOME = home
  process.env.CENV_E2E_OUTPUT = outputFile
  process.env.CENV_E2E_KEYCHAIN = keychainFile

  const cleanup = () => {
    process.env.PATH = originalPath
    process.env.HOME = originalHome
    delete process.env.CENV_E2E_OUTPUT
    delete process.env.CENV_E2E_KEYCHAIN
    fs.rmSync(root, { recursive: true, force: true })
  }

  return { root, home, claudeHome, cenvHome, projectDir, binDir, outputFile, keychainFile, originalPath, originalHome, cleanup }
}

export function readClaudeInvocation(ctx: E2EContext): { args: string[], env: Record<string, string | null> } {
  if (!fs.existsSync(ctx.outputFile)) throw new Error('No claude invocation captured')
  return JSON.parse(fs.readFileSync(ctx.outputFile, 'utf8'))
}

export function readMockKeychain(ctx: E2EContext): Record<string, string> {
  // Returns { "service:account": "value" }
  const content = fs.readFileSync(ctx.keychainFile, 'utf8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n').filter(Boolean)) {
    const [service, account, ...valueParts] = line.split('\t')
    result[`${service}:${account}`] = valueParts.join('\t')
  }
  return result
}

export function writeMockKeychain(ctx: E2EContext, entries: Array<{ service: string, account: string, value: string }>): void {
  const lines = entries.map(e => `${e.service}\t${e.account}\t${e.value}`)
  fs.writeFileSync(ctx.keychainFile, lines.join('\n') + '\n', 'utf8')
}
