import { describe, expect, test, afterEach, spyOn } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import * as clackPrompts from '@clack/prompts'
import { runWizard } from '@/commands/wizard'
import { ensureCenvHome } from '@/lib/environments'
import { createTempCenvHome } from '../helpers/mock-env'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a fixture plugin directory structure for scanPluginComponents tests.
 */
function createFixturePlugin(
  baseDir: string,
  pluginName: string,
  options: {
    skills?: string[]
    hooks?: Record<string, unknown[]>
    mcpServers?: Record<string, unknown>
    agents?: string[]
  } = {}
): string {
  const pluginDir = path.join(baseDir, pluginName)
  fs.mkdirSync(pluginDir, { recursive: true })

  if (options.skills && options.skills.length > 0) {
    for (const skill of options.skills) {
      const skillDir = path.join(pluginDir, 'skills', skill)
      fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${skill}\n`, 'utf8')
    }
  }

  if (options.hooks) {
    const hooksDir = path.join(pluginDir, 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    fs.writeFileSync(path.join(hooksDir, 'hooks.json'), JSON.stringify(options.hooks), 'utf8')
  }

  if (options.mcpServers) {
    fs.writeFileSync(
      path.join(pluginDir, '.mcp.json'),
      JSON.stringify({ mcpServers: options.mcpServers }),
      'utf8'
    )
  }

  if (options.agents && options.agents.length > 0) {
    for (const agent of options.agents) {
      fs.mkdirSync(path.join(pluginDir, '.claude-plugin', 'agents', agent), { recursive: true })
    }
  }

  return pluginDir
}

/**
 * Write a fake installed_plugins.json pointing to real paths.
 */
function writeInstalledPlugins(
  filePath: string,
  plugins: Array<{ name: string; source: string; version: string; path: string; scope?: string }>
): void {
  const data: Record<string, unknown> = { version: 2, plugins: {} }
  const pluginsObj = data.plugins as Record<string, unknown>

  for (const p of plugins) {
    const key = p.source ? `${p.name}@${p.source}` : p.name
    pluginsObj[key] = [
      {
        scope: p.scope ?? 'user',
        installPath: p.path,
        version: p.version,
      },
    ]
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf8')
}

// ── Mock clack helpers ─────────────────────────────────────────────────────────

type ClackSpies = {
  intro: ReturnType<typeof spyOn>
  outro: ReturnType<typeof spyOn>
  multiselect: ReturnType<typeof spyOn>
  confirm: ReturnType<typeof spyOn>
  select: ReturnType<typeof spyOn>
  logInfo: ReturnType<typeof spyOn>
  logError: ReturnType<typeof spyOn>
  restoreAll: () => void
}

function mockClack(overrides: {
  multiselect?: unknown[][]   // Each call returns the next entry
  confirm?: unknown[]
  select?: unknown[]
}): ClackSpies {
  let multiselectCallIdx = 0
  let confirmCallIdx = 0
  let selectCallIdx = 0

  const multiselectResponses = overrides.multiselect ?? []
  const confirmResponses = overrides.confirm ?? []
  const selectResponses = overrides.select ?? []

  const intro = spyOn(clackPrompts, 'intro').mockImplementation(() => {})
  const outro = spyOn(clackPrompts, 'outro').mockImplementation(() => {})
  const multiselect = spyOn(clackPrompts, 'multiselect').mockImplementation(async () => {
    const res = multiselectResponses[multiselectCallIdx] ?? []
    multiselectCallIdx++
    return res as never
  })
  const confirm = spyOn(clackPrompts, 'confirm').mockImplementation(async () => {
    const res = confirmResponses[confirmCallIdx] ?? false
    confirmCallIdx++
    return res as never
  })
  const select = spyOn(clackPrompts, 'select').mockImplementation(async () => {
    const res = selectResponses[selectCallIdx] ?? 'high'
    selectCallIdx++
    return res as never
  })
  const logInfo = spyOn(clackPrompts.log, 'info').mockImplementation(() => {})
  const logError = spyOn(clackPrompts.log, 'error').mockImplementation(() => {})

  return {
    intro,
    outro,
    multiselect,
    confirm,
    select,
    logInfo,
    logError,
    restoreAll() {
      intro.mockRestore()
      outro.mockRestore()
      multiselect.mockRestore()
      confirm.mockRestore()
      select.mockRestore()
      logInfo.mockRestore()
      logError.mockRestore()
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runWizard — no plugins installed', () => {
  let cleanupCenvHome: () => void
  let spies: ClackSpies

  afterEach(() => {
    cleanupCenvHome?.()
    spies?.restoreAll()
  })

  test('creates env dir with env.yaml and claude.md even when no plugins exist', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    // No plugins installed — empty installed_plugins.json path
    const emptyPluginsPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    fs.writeFileSync(emptyPluginsPath, JSON.stringify({ version: 2, plugins: {} }), 'utf8')

    // Empty settings
    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf8')

    // Mock clack: skip plugin step (no plugins) → no standalone skills
    // → no MCP → import perms? false → effort=high → CLAUDE.md=empty
    spies = mockClack({
      multiselect: [],        // no multiselects needed (no plugins, no skills, no mcp)
      confirm: [false],       // import permissions? no
      select: ['high', 'empty'], // effort=high, claude.md=empty
    })

    await runWizard('no-plugins-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: emptyPluginsPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const envDir = path.join(tmp.cenvHome, 'envs', 'no-plugins-env')
    expect(fs.existsSync(envDir)).toBe(true)
    expect(fs.existsSync(path.join(envDir, 'env.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(envDir, 'claude.md'))).toBe(true)
  })

  test('calls outro once on success', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const emptyPluginsPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    fs.writeFileSync(emptyPluginsPath, JSON.stringify({ version: 2, plugins: {} }), 'utf8')

    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf8')

    spies = mockClack({
      multiselect: [],
      confirm: [false],
      select: ['high', 'empty'],
    })

    await runWizard('outro-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: emptyPluginsPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    expect(spies.outro).toHaveBeenCalledTimes(1)
  })
})

describe('runWizard — plugins selected', () => {
  let cleanupCenvHome: () => void
  let cleanupPluginsDir: () => void
  let spies: ClackSpies

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupPluginsDir?.()
    spies?.restoreAll()
  })

  test('generates valid env.yaml with selected plugins', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    // Create a fixture plugin dir
    const pluginsDir = fs.mkdtempSync('/tmp/cenv-wizard-plugins-')
    cleanupPluginsDir = () => fs.rmSync(pluginsDir, { recursive: true, force: true })

    const pluginPath = createFixturePlugin(pluginsDir, 'superpowers', {
      skills: ['tdd', 'debugging'],
    })

    // Write installed_plugins.json pointing to the fixture
    const pluginsJsonPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    writeInstalledPlugins(pluginsJsonPath, [
      { name: 'superpowers', source: 'marketplace', version: '5.0.0', path: pluginPath },
    ])

    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf8')

    // Mock:
    // multiselect 1 = plugin picker → select superpowers
    // confirm 1 = customize superpowers? no
    // confirm 2 = import permissions? no
    // select 1 = effort = high
    // select 2 = claude.md = empty
    spies = mockClack({
      multiselect: [['superpowers']],  // select superpowers
      confirm: [false, false],          // don't customize, don't import perms
      select: ['high', 'empty'],
    })

    await runWizard('with-plugins-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: pluginsJsonPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const envDir = path.join(tmp.cenvHome, 'envs', 'with-plugins-env')
    const yamlContent = fs.readFileSync(path.join(envDir, 'env.yaml'), 'utf8')

    expect(yamlContent).toContain('superpowers')
    expect(yamlContent).toContain('marketplace')
  })

  test('puts deselected skills into plugins.disable', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const pluginsDir = fs.mkdtempSync('/tmp/cenv-wizard-disable-')
    cleanupPluginsDir = () => fs.rmSync(pluginsDir, { recursive: true, force: true })

    const pluginPath = createFixturePlugin(pluginsDir, 'superpowers', {
      skills: ['tdd', 'debugging', 'brainstorming'],
    })

    const pluginsJsonPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    writeInstalledPlugins(pluginsJsonPath, [
      { name: 'superpowers', source: 'marketplace', version: '5.0.0', path: pluginPath },
    ])

    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf8')

    // Mock:
    // multiselect 1 = plugin picker → superpowers selected
    // confirm 1 = customize? YES
    // multiselect 2 = skill picker → keep only tdd + debugging (drop brainstorming)
    // confirm 2 = import permissions? no
    // select 1 = effort = high
    // select 2 = claude.md = empty
    spies = mockClack({
      multiselect: [
        ['superpowers'],                                   // plugin picker
        ['superpowers:tdd', 'superpowers:debugging'],     // keep tdd + debugging only
      ],
      confirm: [true, false],   // customize=yes, import perms=no
      select: ['high', 'empty'],
    })

    await runWizard('disable-skills-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: pluginsJsonPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const envDir = path.join(tmp.cenvHome, 'envs', 'disable-skills-env')
    const yamlContent = fs.readFileSync(path.join(envDir, 'env.yaml'), 'utf8')

    // brainstorming was deselected → should appear in plugins.disable
    expect(yamlContent).toContain('superpowers:brainstorming')
    // tdd and debugging should NOT appear in disable list
    expect(yamlContent).not.toContain('superpowers:tdd')
    expect(yamlContent).not.toContain('superpowers:debugging')
  })
})

describe('runWizard — invalid plugin versions', () => {
  let cleanupCenvHome: () => void
  let cleanupPluginsDir: () => void
  let spies: ClackSpies

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupPluginsDir?.()
    spies?.restoreAll()
  })

  test('omits version from env.yaml when plugin has non-semver version like "unknown"', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const pluginsDir = fs.mkdtempSync('/tmp/cenv-wizard-badver-')
    cleanupPluginsDir = () => fs.rmSync(pluginsDir, { recursive: true, force: true })

    const pluginPath = createFixturePlugin(pluginsDir, 'bad-version-plugin', {
      skills: ['some-skill'],
    })

    const pluginsJsonPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    writeInstalledPlugins(pluginsJsonPath, [
      { name: 'bad-version-plugin', source: 'marketplace', version: 'unknown', path: pluginPath },
    ])

    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf8')

    spies = mockClack({
      multiselect: [['bad-version-plugin']],
      confirm: [false, false],
      select: ['high', 'empty'],
    })

    await runWizard('badver-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: pluginsJsonPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const envDir = path.join(tmp.cenvHome, 'envs', 'badver-env')
    const yamlContent = fs.readFileSync(path.join(envDir, 'env.yaml'), 'utf8')

    // The "unknown" version should NOT appear in the generated env.yaml
    expect(yamlContent).not.toContain('unknown')
    // But the plugin should still be there
    expect(yamlContent).toContain('bad-version-plugin')
    expect(yamlContent).toContain('marketplace')

    // And loadEnvConfig should not throw
    const { loadEnvConfig } = await import('@/lib/config')
    expect(() => loadEnvConfig(envDir)).not.toThrow()
  })
})

describe('runWizard — CLAUDE.md handling', () => {
  let cleanupCenvHome: () => void
  let spies: ClackSpies

  afterEach(() => {
    cleanupCenvHome?.()
    spies?.restoreAll()
  })

  test('copies CLAUDE.md when user selects "current"', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    // Write a fake CLAUDE.md source
    const claudeMdSrc = path.join(tmp.cenvHome, 'CLAUDE.md')
    fs.writeFileSync(claudeMdSrc, '# My global CLAUDE.md content\n', 'utf8')

    const emptyPluginsPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    fs.writeFileSync(emptyPluginsPath, JSON.stringify({ version: 2, plugins: {} }), 'utf8')

    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf8')

    spies = mockClack({
      multiselect: [],
      confirm: [false],
      select: ['high', 'current'],  // select "current" CLAUDE.md
    })

    await runWizard('copy-md-env', {
      cenvHome: tmp.cenvHome,
      claudeMdPath: claudeMdSrc,
      installedPluginsPath: emptyPluginsPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const destMd = path.join(tmp.cenvHome, 'envs', 'copy-md-env', 'claude.md')
    expect(fs.existsSync(destMd)).toBe(true)
    const content = fs.readFileSync(destMd, 'utf8')
    expect(content).toContain('My global CLAUDE.md content')
  })

  test('creates empty claude.md when user selects "empty"', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const claudeMdSrc = path.join(tmp.cenvHome, 'CLAUDE.md')
    fs.writeFileSync(claudeMdSrc, '# My global CLAUDE.md content\n', 'utf8')

    const emptyPluginsPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    fs.writeFileSync(emptyPluginsPath, JSON.stringify({ version: 2, plugins: {} }), 'utf8')

    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf8')

    spies = mockClack({
      multiselect: [],
      confirm: [false],
      select: ['high', 'empty'],   // select "empty" CLAUDE.md
    })

    await runWizard('empty-md-env', {
      cenvHome: tmp.cenvHome,
      claudeMdPath: claudeMdSrc,
      installedPluginsPath: emptyPluginsPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const destMd = path.join(tmp.cenvHome, 'envs', 'empty-md-env', 'claude.md')
    expect(fs.existsSync(destMd)).toBe(true)
    const content = fs.readFileSync(destMd, 'utf8')
    // Should NOT contain the global CLAUDE.md content
    expect(content).not.toContain('My global CLAUDE.md content')
    // Should be a minimal placeholder
    expect(content).toContain('empty-md-env')
  })
})

describe('runWizard — MCP servers', () => {
  let cleanupCenvHome: () => void
  let spies: ClackSpies

  afterEach(() => {
    cleanupCenvHome?.()
    spies?.restoreAll()
  })

  test('includes selected MCP servers in env.yaml', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const emptyPluginsPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    fs.writeFileSync(emptyPluginsPath, JSON.stringify({ version: 2, plugins: {} }), 'utf8')

    // Settings with MCP servers
    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        mcpServers: {
          postgres: { command: 'uvx', args: ['mcp-server-postgres'] },
          github: { command: 'npx', args: ['-y', '@mcp/server-github'] },
        },
      }),
      'utf8'
    )

    // Mock: no plugins → multiselect 1 = MCP picker (pick postgres only)
    // confirm 1 = import perms? no
    // select 1 = effort=high, select 2 = empty
    spies = mockClack({
      multiselect: [['postgres']],  // pick only postgres
      confirm: [false],
      select: ['high', 'empty'],
    })

    await runWizard('mcp-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: emptyPluginsPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const envDir = path.join(tmp.cenvHome, 'envs', 'mcp-env')
    const yamlContent = fs.readFileSync(path.join(envDir, 'env.yaml'), 'utf8')

    expect(yamlContent).toContain('postgres')
    expect(yamlContent).not.toContain('github')
  })
})

describe('runWizard — commands selection', () => {
  let cleanupCenvHome: () => void
  let spies: ClackSpies

  afterEach(() => {
    cleanupCenvHome?.()
    spies?.restoreAll()
  })

  test('includes selected commands in env.yaml', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    // Create commands dir with test commands
    const commandsDir = path.join(tmp.cenvHome, 'commands')
    fs.mkdirSync(commandsDir, { recursive: true })
    fs.writeFileSync(
      path.join(commandsDir, 'deploy.md'),
      '---\ndescription: Deploy to prod\n---\n# Deploy\n',
      'utf8'
    )
    fs.writeFileSync(
      path.join(commandsDir, 'review.md'),
      '# Review\nReview code\n',
      'utf8'
    )

    const emptyPluginsPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    fs.writeFileSync(emptyPluginsPath, JSON.stringify({ version: 2, plugins: {} }), 'utf8')

    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({}), 'utf8')

    // Mock: no plugins → no standalone skills → commands picker (select deploy only)
    // → no MCP → no hooks → no statusLine → import perms? no → effort=high → claude.md=empty
    spies = mockClack({
      multiselect: [[path.join(commandsDir, 'deploy.md')]],  // select deploy command
      confirm: [false],   // import permissions? no
      select: ['high', 'empty'],
    })

    await runWizard('cmd-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: emptyPluginsPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
      commandsDir,
    })

    const envDir = path.join(tmp.cenvHome, 'envs', 'cmd-env')
    const yamlContent = fs.readFileSync(path.join(envDir, 'env.yaml'), 'utf8')

    expect(yamlContent).toContain('deploy.md')
    expect(yamlContent).not.toContain('review.md')
    expect(yamlContent).toContain('commands')
  })
})

describe('runWizard — hooks import', () => {
  let cleanupCenvHome: () => void
  let spies: ClackSpies

  afterEach(() => {
    cleanupCenvHome?.()
    spies?.restoreAll()
  })

  test('includes hooks when user confirms import', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const emptyPluginsPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    fs.writeFileSync(emptyPluginsPath, JSON.stringify({ version: 2, plugins: {} }), 'utf8')

    // Settings with hooks in Claude Code format
    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo stopped' }] }],
      },
    }), 'utf8')

    // Mock: no plugins → no skills → no commands → no MCP
    // → hooks confirm (yes) → no statusLine → import perms? no → effort=high → claude.md=empty
    spies = mockClack({
      multiselect: [],
      confirm: [true, false],   // import hooks=yes, import permissions=no
      select: ['high', 'empty'],
    })

    await runWizard('hooks-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: emptyPluginsPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const envDir = path.join(tmp.cenvHome, 'envs', 'hooks-env')
    const yamlContent = fs.readFileSync(path.join(envDir, 'env.yaml'), 'utf8')

    expect(yamlContent).toContain('hooks')
    expect(yamlContent).toContain('echo stopped')
    expect(yamlContent).toContain('Stop')
  })
})

describe('runWizard — statusLine import', () => {
  let cleanupCenvHome: () => void
  let spies: ClackSpies

  afterEach(() => {
    cleanupCenvHome?.()
    spies?.restoreAll()
  })

  test('includes statusLine when user confirms import', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const emptyPluginsPath = path.join(tmp.cenvHome, 'installed_plugins.json')
    fs.writeFileSync(emptyPluginsPath, JSON.stringify({ version: 2, plugins: {} }), 'utf8')

    // Settings with statusLine
    const settingsPath = path.join(tmp.cenvHome, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({
      statusLine: { type: 'command', command: 'echo status' },
    }), 'utf8')

    // Mock: no plugins → no skills → no commands → no MCP
    // → no hooks → statusLine confirm (yes) → import perms? no → effort=high → claude.md=empty
    spies = mockClack({
      multiselect: [],
      confirm: [true, false],   // import statusLine=yes, import permissions=no
      select: ['high', 'empty'],
    })

    await runWizard('status-env', {
      cenvHome: tmp.cenvHome,
      installedPluginsPath: emptyPluginsPath,
      skillsDir: path.join(tmp.cenvHome, 'skills'),
      settingsPath,
    })

    const envDir = path.join(tmp.cenvHome, 'envs', 'status-env')
    const yamlContent = fs.readFileSync(path.join(envDir, 'env.yaml'), 'utf8')

    expect(yamlContent).toContain('statusLine')
    expect(yamlContent).toContain('echo status')
  })
})

