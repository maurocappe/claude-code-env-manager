import { describe, expect, test, afterEach, mock, spyOn } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as clack from '@clack/prompts'
import { resolveEnv, listAllEnvs } from '@/lib/resolver'
import { EnvironmentNotFoundError } from '@/errors'
import { createTempCenvHome } from '../helpers/mock-env'
import { ensureCenvHome, createEnvDir } from '@/lib/environments'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Create a minimal project-level .claude-envs/<name> directory */
function createProjectEnv(cwd: string, name: string): string {
  const dir = path.join(cwd, '.claude-envs', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'env.yaml'),
    `name: ${name}\n`,
    'utf8'
  )
  fs.writeFileSync(path.join(dir, 'claude.md'), `# ${name}\n`, 'utf8')
  return dir
}

/** Create a temp cwd directory */
function createTempCwd(): { cwd: string; cleanup: () => void } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-cwd-test-'))
  return {
    cwd,
    cleanup() {
      fs.rmSync(cwd, { recursive: true, force: true })
    },
  }
}

// ── resolveEnv: path-based resolution ─────────────────────────────────────────

describe('resolveEnv — path-based resolution', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
  })

  test('resolves an absolute path directly', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    const envPath = createEnvDir('abs-env', tmp.cenvHome)

    const result = await resolveEnv(envPath, tmp.cenvHome)

    expect(result.path).toBe(envPath)
    expect(result.source).toBe('project')
    expect(result.config.name).toBe('abs-env')
  })

  test('resolves a relative ./path', async () => {
    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup

    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    const envPath = createEnvDir('rel-env', tmp.cenvHome)

    // Pass absolute path as if it were relative (resolveEnv resolves it against cwd)
    const relativeLike = envPath // absolute paths pass through path.resolve unchanged

    const result = await resolveEnv(relativeLike, tmp.cenvHome, cwd.cwd)

    expect(result.config.name).toBe('rel-env')
    expect(result.source).toBe('project')
  })

  test('resolves a ./relative path against cwd', async () => {
    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup

    // Create env directly inside cwd
    const envDir = path.join(cwd.cwd, 'my-env')
    fs.mkdirSync(envDir, { recursive: true })
    fs.writeFileSync(path.join(envDir, 'env.yaml'), 'name: dot-slash-env\n', 'utf8')

    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup

    const result = await resolveEnv('./my-env', tmp.cenvHome, cwd.cwd)

    expect(result.config.name).toBe('dot-slash-env')
    expect(result.source).toBe('project')
  })
})

// ── resolveEnv: personal only ──────────────────────────────────────────────────

describe('resolveEnv — personal env only', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
  })

  test('resolves an env that exists only in personal location', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('personal-only', tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup

    const result = await resolveEnv('personal-only', tmp.cenvHome, cwd.cwd)

    expect(result.source).toBe('personal')
    expect(result.config.name).toBe('personal-only')
    expect(result.path).toBe(path.join(tmp.cenvHome, 'envs', 'personal-only'))
  })
})

// ── resolveEnv: project only ───────────────────────────────────────────────────

describe('resolveEnv — project env only', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
  })

  test('resolves an env that exists only in project location', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup
    createProjectEnv(cwd.cwd, 'project-only')

    const result = await resolveEnv('project-only', tmp.cenvHome, cwd.cwd)

    expect(result.source).toBe('project')
    expect(result.config.name).toBe('project-only')
    expect(result.path).toBe(path.join(cwd.cwd, '.claude-envs', 'project-only'))
  })
})

// ── resolveEnv: not found ──────────────────────────────────────────────────────

describe('resolveEnv — not found', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
  })

  test('throws EnvironmentNotFoundError when env does not exist anywhere', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup

    await expect(resolveEnv('ghost-env', tmp.cenvHome, cwd.cwd)).rejects.toThrow(
      EnvironmentNotFoundError
    )
  })

  test('error message references the env name', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup

    await expect(resolveEnv('missing-env', tmp.cenvHome, cwd.cwd)).rejects.toThrow(
      /missing-env/
    )
  })
})

// ── resolveEnv: ambiguous (both locations) ────────────────────────────────────

describe('resolveEnv — found in both locations', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void
  let selectSpy: ReturnType<typeof spyOn>

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
    selectSpy?.mockRestore()
  })

  test('calls clack select when env exists in both personal and project', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('shared-env', tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup
    createProjectEnv(cwd.cwd, 'shared-env')

    // Mock clack select to return 'personal'
    selectSpy = spyOn(clack, 'select').mockResolvedValue('personal')

    const result = await resolveEnv('shared-env', tmp.cenvHome, cwd.cwd)

    expect(selectSpy).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('personal')
    expect(result.config.name).toBe('shared-env')
  })

  test('returns project env when user selects project', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('shared-env', tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup
    createProjectEnv(cwd.cwd, 'shared-env')

    selectSpy = spyOn(clack, 'select').mockResolvedValue('project')

    const result = await resolveEnv('shared-env', tmp.cenvHome, cwd.cwd)

    expect(result.source).toBe('project')
    expect(result.path).toBe(path.join(cwd.cwd, '.claude-envs', 'shared-env'))
  })

  test('throws EnvironmentNotFoundError when user cancels picker', async () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('shared-env', tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup
    createProjectEnv(cwd.cwd, 'shared-env')

    // clack returns a Symbol when user cancels
    selectSpy = spyOn(clack, 'select').mockResolvedValue(Symbol('cancel') as unknown as string)

    await expect(resolveEnv('shared-env', tmp.cenvHome, cwd.cwd)).rejects.toThrow(
      EnvironmentNotFoundError
    )
  })
})

// ── listAllEnvs ────────────────────────────────────────────────────────────────

describe('listAllEnvs', () => {
  let cleanupCenvHome: () => void
  let cleanupCwd: () => void

  afterEach(() => {
    cleanupCenvHome?.()
    cleanupCwd?.()
  })

  test('returns empty array when directories do not exist', () => {
    const nonExistentHome = path.join(os.tmpdir(), 'cenv-nonexistent-' + Date.now())
    const nonExistentCwd = path.join(os.tmpdir(), 'cenv-cwd-nonexistent-' + Date.now())

    const entries = listAllEnvs(nonExistentHome, nonExistentCwd)

    expect(entries).toEqual([])
  })

  test('returns personal envs when only personal dir exists', () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('alpha', tmp.cenvHome)
    createEnvDir('beta', tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup

    const entries = listAllEnvs(tmp.cenvHome, cwd.cwd)

    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.name)).toEqual(['alpha', 'beta'])
    expect(entries.every((e) => e.source === 'personal')).toBe(true)
  })

  test('returns project envs when only project dir exists', () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup
    createProjectEnv(cwd.cwd, 'proj-a')
    createProjectEnv(cwd.cwd, 'proj-b')

    const entries = listAllEnvs(tmp.cenvHome, cwd.cwd)

    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.source === 'project')).toBe(true)
  })

  test('returns both personal and project envs sorted by name', () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('zebra', tmp.cenvHome)
    createEnvDir('alpha', tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup
    createProjectEnv(cwd.cwd, 'mango')

    const entries = listAllEnvs(tmp.cenvHome, cwd.cwd)

    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.name)).toEqual(['alpha', 'mango', 'zebra'])
  })

  test('includes path and source for each entry', () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('check-env', tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup

    const entries = listAllEnvs(tmp.cenvHome, cwd.cwd)

    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('check-env')
    expect(entries[0].path).toBe(path.join(tmp.cenvHome, 'envs', 'check-env'))
    expect(entries[0].source).toBe('personal')
  })

  test('ignores directories without env.yaml', () => {
    const tmp = createTempCenvHome()
    cleanupCenvHome = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    // Create a dir without env.yaml
    fs.mkdirSync(path.join(tmp.cenvHome, 'envs', 'no-yaml'), { recursive: true })
    createEnvDir('valid-env', tmp.cenvHome)

    const cwd = createTempCwd()
    cleanupCwd = cwd.cleanup

    const entries = listAllEnvs(tmp.cenvHome, cwd.cwd)

    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('valid-env')
  })
})
