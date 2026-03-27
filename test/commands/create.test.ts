import { describe, expect, test, afterEach, spyOn } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as clackPrompts from '@clack/prompts'
import { runCreate } from '@/commands/create'
import { ensureCenvHome } from '@/lib/environments'
import { createTempCenvHome } from '../helpers/mock-env'

// ── runCreate ──────────────────────────────────────────────────────────────────

describe('runCreate', () => {
  let cleanupCenvHome: () => void
  let outroSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    cleanupCenvHome?.()
    outroSpy?.mockRestore()
  })

  test('creates env directory with env.yaml and claude.md', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runCreate('test-env', {}, tmp.cenvHome)

    const envPath = path.join(tmp.cenvHome, 'envs', 'test-env')
    expect(fs.existsSync(envPath)).toBe(true)
    expect(fs.existsSync(path.join(envPath, 'env.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(envPath, 'claude.md'))).toBe(true)
  })

  test('env.yaml contains the environment name', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runCreate('my-env', {}, tmp.cenvHome)

    const envPath = path.join(tmp.cenvHome, 'envs', 'my-env')
    const yamlContent = fs.readFileSync(path.join(envPath, 'env.yaml'), 'utf8')
    expect(yamlContent).toContain('my-env')
  })

  test('calls outro with success message', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runCreate('success-env', {}, tmp.cenvHome)

    expect(outroSpy).toHaveBeenCalledTimes(1)
  })

  test('throws when environment already exists', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runCreate('dup-env', {}, tmp.cenvHome)

    await expect(runCreate('dup-env', {}, tmp.cenvHome)).rejects.toThrow(/already exists/)
  })

  test('--snapshot creates directory and writes snapshotted env.yaml', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runCreate('snap-env', { snapshot: true }, tmp.cenvHome)

    // Directory should be created (snapshot is now implemented)
    const envPath = path.join(tmp.cenvHome, 'envs', 'snap-env')
    expect(fs.existsSync(envPath)).toBe(true)
    expect(fs.existsSync(path.join(envPath, 'env.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(envPath, 'claude.md'))).toBe(true)
    // env.yaml should contain the env name
    const yaml = fs.readFileSync(path.join(envPath, 'env.yaml'), 'utf8')
    expect(yaml).toContain('snap-env')
  })

  test('returns early without creating directory for --wizard flag', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    await runCreate('wizard-env', { wizard: true }, tmp.cenvHome)

    expect(fs.existsSync(path.join(tmp.cenvHome, 'envs', 'wizard-env'))).toBe(false)
  })

  test('--from local path copies env.yaml to personal envs', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    // Create a local env dir to copy from
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-create-from-'))
    fs.writeFileSync(path.join(srcDir, 'env.yaml'), 'name: from-env\n', 'utf8')
    fs.writeFileSync(path.join(srcDir, 'claude.md'), '# from-env\n', 'utf8')

    try {
      await runCreate('from-env', { from: srcDir }, tmp.cenvHome)

      const envDir = path.join(tmp.cenvHome, 'envs', 'from-env')
      expect(fs.existsSync(envDir)).toBe(true)
      expect(fs.existsSync(path.join(envDir, 'env.yaml'))).toBe(true)
      expect(outroSpy).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
    }
  })

  test('--from local path also copies claude.md', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-create-from-'))
    fs.writeFileSync(path.join(srcDir, 'env.yaml'), 'name: from-md-env\n', 'utf8')
    fs.writeFileSync(path.join(srcDir, 'claude.md'), '# from-md-env\n', 'utf8')

    try {
      await runCreate('from-md-env', { from: srcDir }, tmp.cenvHome)

      expect(fs.existsSync(path.join(tmp.cenvHome, 'envs', 'from-md-env', 'claude.md'))).toBe(true)
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
    }
  })

  test('--from local path with .claude-envs subfolder picks first env', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    outroSpy = spyOn(clackPrompts, 'outro').mockImplementation(() => {})

    // Simulate a repo with .claude-envs/my-env/
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-create-repo-'))
    const envInRepo = path.join(repoDir, '.claude-envs', 'my-env')
    fs.mkdirSync(envInRepo, { recursive: true })
    fs.writeFileSync(path.join(envInRepo, 'env.yaml'), 'name: my-env\n', 'utf8')

    try {
      await runCreate('from-repo-env', { from: repoDir }, tmp.cenvHome)

      expect(fs.existsSync(path.join(tmp.cenvHome, 'envs', 'from-repo-env', 'env.yaml'))).toBe(true)
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true })
    }
  })
})
