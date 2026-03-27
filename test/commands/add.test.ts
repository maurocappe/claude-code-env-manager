import { describe, expect, test, afterEach, spyOn } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as clackPrompts from '@clack/prompts'
import { runAdd } from '@/commands/add'
import { ensureCenvHome } from '@/lib/environments'
import { createTempCenvHome } from '../helpers/mock-env'

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Create a minimal project .claude-envs/<name>/ directory in a temp cwd.
 */
function createProjectEnv(
  cwd: string,
  name: string,
  extra: {
    skills?: boolean
    hooks?: boolean
    claudeMd?: boolean
  } = {}
): string {
  const dir = path.join(cwd, '.claude-envs', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'env.yaml'), `name: ${name}\n`, 'utf8')

  if (extra.claudeMd !== false) {
    fs.writeFileSync(path.join(dir, 'claude.md'), `# ${name}\n`, 'utf8')
  }
  if (extra.skills) {
    fs.mkdirSync(path.join(dir, 'skills'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'skills', 'my-skill.md'), '# skill\n', 'utf8')
  }
  if (extra.hooks) {
    fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'hooks', 'pre.sh'), '#!/bin/sh\n', 'utf8')
  }

  return dir
}

function createTempCwd(): { cwd: string; cleanup: () => void } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-add-cwd-'))
  return {
    cwd,
    cleanup: () => fs.rmSync(cwd, { recursive: true, force: true }),
  }
}

// ── runAdd ────────────────────────────────────────────────────────────────────

describe('runAdd — add from project env', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void
  let outroSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
    outroSpy?.mockRestore()
  })

  test('copies env.yaml to personal envs', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'my-team-env')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runAdd('my-team-env', {}, tmp.cenvHome, cwdTmp.cwd)

    const destEnvYaml = path.join(tmp.cenvHome, 'envs', 'my-team-env', 'env.yaml')
    expect(fs.existsSync(destEnvYaml)).toBe(true)
    const content = fs.readFileSync(destEnvYaml, 'utf8')
    expect(content).toContain('my-team-env')
  })

  test('copies claude.md when present', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'env-with-md')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runAdd('env-with-md', {}, tmp.cenvHome, cwdTmp.cwd)

    expect(fs.existsSync(path.join(tmp.cenvHome, 'envs', 'env-with-md', 'claude.md'))).toBe(true)
  })

  test('copies skills/ directory recursively', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'env-with-skills', { skills: true })

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runAdd('env-with-skills', {}, tmp.cenvHome, cwdTmp.cwd)

    expect(
      fs.existsSync(path.join(tmp.cenvHome, 'envs', 'env-with-skills', 'skills', 'my-skill.md'))
    ).toBe(true)
  })

  test('copies hooks/ directory recursively', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'env-with-hooks', { hooks: true })

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runAdd('env-with-hooks', {}, tmp.cenvHome, cwdTmp.cwd)

    expect(
      fs.existsSync(path.join(tmp.cenvHome, 'envs', 'env-with-hooks', 'hooks', 'pre.sh'))
    ).toBe(true)
  })

  test('calls outro on success', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'outro-env')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runAdd('outro-env', {}, tmp.cenvHome, cwdTmp.cwd)

    expect(outroSpy).toHaveBeenCalledTimes(1)
  })
})

// ── runAdd — --as rename ──────────────────────────────────────────────────────

describe('runAdd — --as rename', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void
  let outroSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
    outroSpy?.mockRestore()
  })

  test('imports with a different name using --as', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'original-name')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runAdd('original-name', { as: 'renamed' }, tmp.cenvHome, cwdTmp.cwd)

    // Should exist under the new name
    expect(fs.existsSync(path.join(tmp.cenvHome, 'envs', 'renamed', 'env.yaml'))).toBe(true)
    // Should NOT exist under the original name
    expect(fs.existsSync(path.join(tmp.cenvHome, 'envs', 'original-name'))).toBe(false)
  })

  test('outro message mentions the renamed env', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'source-env')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runAdd('source-env', { as: 'my-local-name' }, tmp.cenvHome, cwdTmp.cwd)

    const outroArg = (outroSpy.mock.calls[0] as [string])[0]
    expect(outroArg).toContain('my-local-name')
  })
})

// ── runAdd — direct path ──────────────────────────────────────────────────────

describe('runAdd — direct path', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void
  let outroSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
    outroSpy?.mockRestore()
  })

  test('imports from an absolute path', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup

    // Create env at a direct absolute path (outside .claude-envs)
    const srcDir = path.join(cwdTmp.cwd, 'my-env-dir')
    fs.mkdirSync(srcDir, { recursive: true })
    fs.writeFileSync(path.join(srcDir, 'env.yaml'), 'name: path-env\n', 'utf8')
    fs.writeFileSync(path.join(srcDir, 'claude.md'), '# path-env\n', 'utf8')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runAdd(srcDir, {}, tmp.cenvHome, cwdTmp.cwd)

    expect(fs.existsSync(path.join(tmp.cenvHome, 'envs', 'path-env', 'env.yaml'))).toBe(true)
  })
})

// ── runAdd — conflict handling ────────────────────────────────────────────────

describe('runAdd — conflict handling', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void
  let outroSpy: ReturnType<typeof spyOn>
  let selectSpy: ReturnType<typeof spyOn>
  let textSpy: ReturnType<typeof spyOn>
  let logInfoSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
    outroSpy?.mockRestore()
    selectSpy?.mockRestore()
    textSpy?.mockRestore()
    logInfoSpy?.mockRestore()
  })

  test('overwrites existing env when user selects overwrite', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'conflict-env')

    // Pre-create the target env with different content
    const existingDir = path.join(tmp.cenvHome, 'envs', 'conflict-env')
    fs.mkdirSync(existingDir, { recursive: true })
    fs.writeFileSync(path.join(existingDir, 'env.yaml'), 'name: conflict-env\ndescription: old\n', 'utf8')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})
    selectSpy = spyOn(clackPrompts, 'select').mockResolvedValue('overwrite')

    await runAdd('conflict-env', {}, tmp.cenvHome, cwdTmp.cwd)

    expect(selectSpy).toHaveBeenCalledTimes(1)
    expect(outroSpy).toHaveBeenCalledTimes(1)

    // The env.yaml should now be the copied version (from project, without description)
    const content = fs.readFileSync(path.join(existingDir, 'env.yaml'), 'utf8')
    expect(content).not.toContain('old')
  })

  test('cancels import when user selects cancel', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'cancel-env')

    // Pre-create existing
    const existingDir = path.join(tmp.cenvHome, 'envs', 'cancel-env')
    fs.mkdirSync(existingDir, { recursive: true })
    fs.writeFileSync(path.join(existingDir, 'env.yaml'), 'name: cancel-env\n', 'utf8')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})
    logInfoSpy = spyOn(clackPrompts.log, 'info').mockImplementation(() => {})
    selectSpy = spyOn(clackPrompts, 'select').mockResolvedValue('cancel')

    await runAdd('cancel-env', {}, tmp.cenvHome, cwdTmp.cwd)

    expect(outroSpy).not.toHaveBeenCalled()
    expect(logInfoSpy).toHaveBeenCalledWith('Cancelled.')
  })

  test('renames when user selects rename and provides new name', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'rename-env')

    // Pre-create existing
    const existingDir = path.join(tmp.cenvHome, 'envs', 'rename-env')
    fs.mkdirSync(existingDir, { recursive: true })
    fs.writeFileSync(path.join(existingDir, 'env.yaml'), 'name: rename-env\n', 'utf8')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})
    selectSpy = spyOn(clackPrompts, 'select').mockResolvedValue('rename')
    textSpy = spyOn(clackPrompts, 'text').mockResolvedValue('renamed-env')

    await runAdd('rename-env', {}, tmp.cenvHome, cwdTmp.cwd)

    expect(fs.existsSync(path.join(tmp.cenvHome, 'envs', 'renamed-env', 'env.yaml'))).toBe(true)
    expect(outroSpy).toHaveBeenCalledTimes(1)
  })

  test('cancels when user cancels the rename text prompt', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwdTmp = createTempCwd()
    cleanupCwd = cwdTmp.cleanup
    createProjectEnv(cwdTmp.cwd, 'text-cancel-env')

    const existingDir = path.join(tmp.cenvHome, 'envs', 'text-cancel-env')
    fs.mkdirSync(existingDir, { recursive: true })
    fs.writeFileSync(path.join(existingDir, 'env.yaml'), 'name: text-cancel-env\n', 'utf8')

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})
    logInfoSpy = spyOn(clackPrompts.log, 'info').mockImplementation(() => {})
    selectSpy = spyOn(clackPrompts, 'select').mockResolvedValue('rename')
    // Simulate user cancelling the text prompt (clack returns a Symbol)
    textSpy = spyOn(clackPrompts, 'text').mockResolvedValue(Symbol('cancel') as unknown as string)

    await runAdd('text-cancel-env', {}, tmp.cenvHome, cwdTmp.cwd)

    expect(outroSpy).not.toHaveBeenCalled()
    expect(logInfoSpy).toHaveBeenCalledWith('Cancelled.')
  })
})
