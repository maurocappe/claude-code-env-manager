import { describe, expect, test, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import {
  ensureCenvHome,
  createEnvDir,
  deleteEnvDir,
  envExists,
} from '@/lib/environments'
import { EnvironmentNotFoundError } from '@/errors'
import { createTempCenvHome } from '../helpers/mock-env'

// ── ensureCenvHome ─────────────────────────────────────────────────────────────

describe('ensureCenvHome', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('creates all required subdirectories', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup

    ensureCenvHome(tmp.cenvHome)

    expect(fs.existsSync(tmp.envsDir)).toBe(true)
    expect(fs.existsSync(tmp.authDir)).toBe(true)
    expect(fs.existsSync(tmp.cacheDir)).toBe(true)
  })

  test('creates .gitignore in auth/ that ignores all files', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup

    ensureCenvHome(tmp.cenvHome)

    const gitignore = fs.readFileSync(path.join(tmp.authDir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('*')
    expect(gitignore).toContain('!.gitignore')
  })

  test('is idempotent — safe to call multiple times', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup

    ensureCenvHome(tmp.cenvHome)
    ensureCenvHome(tmp.cenvHome)
    ensureCenvHome(tmp.cenvHome)

    // All dirs still exist and no errors thrown
    expect(fs.existsSync(tmp.envsDir)).toBe(true)
    expect(fs.existsSync(tmp.authDir)).toBe(true)
  })

  test('.gitignore is not overwritten when called again', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup

    ensureCenvHome(tmp.cenvHome)
    const gitignorePath = path.join(tmp.authDir, '.gitignore')
    const before = fs.statSync(gitignorePath).mtimeMs

    // Small delay to detect mtime change if file were rewritten
    const start = Date.now()
    while (Date.now() - start < 10) {} // spin 10ms

    ensureCenvHome(tmp.cenvHome)
    const after = fs.statSync(gitignorePath).mtimeMs

    expect(after).toBe(before)
  })
})

// ── createEnvDir ───────────────────────────────────────────────────────────────

describe('createEnvDir', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('creates the env directory with scaffold env.yaml', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const envPath = createEnvDir('my-env', tmp.cenvHome)

    expect(fs.existsSync(envPath)).toBe(true)
    expect(fs.existsSync(path.join(envPath, 'env.yaml'))).toBe(true)
  })

  test('scaffold env.yaml contains the env name', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const envPath = createEnvDir('test-env', tmp.cenvHome)
    const raw = fs.readFileSync(path.join(envPath, 'env.yaml'), 'utf8')
    const parsed = parse(raw)

    expect(parsed.name).toBe('test-env')
    expect(parsed.isolation).toBeUndefined()
  })

  test('scaffold creates claude.md with a comment header', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const envPath = createEnvDir('my-env', tmp.cenvHome)
    const claudeMd = fs.readFileSync(path.join(envPath, 'claude.md'), 'utf8')

    expect(claudeMd).toContain('my-env')
    expect(claudeMd.startsWith('#')).toBe(true)
  })

  test('returns the full path to the created directory', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    const envPath = createEnvDir('path-test', tmp.cenvHome)

    expect(envPath).toBe(path.join(tmp.envsDir, 'path-test'))
  })

  test('throws when the environment already exists', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    createEnvDir('duplicate', tmp.cenvHome)

    expect(() => createEnvDir('duplicate', tmp.cenvHome)).toThrow()
  })
})

// ── deleteEnvDir ───────────────────────────────────────────────────────────────

describe('deleteEnvDir', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('removes an existing environment directory', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('to-delete', tmp.cenvHome)

    deleteEnvDir('to-delete', tmp.cenvHome)

    expect(fs.existsSync(path.join(tmp.envsDir, 'to-delete'))).toBe(false)
  })

  test('throws EnvironmentNotFoundError when env does not exist', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    expect(() => deleteEnvDir('nonexistent', tmp.cenvHome)).toThrow(EnvironmentNotFoundError)
  })
})

// ── envExists ──────────────────────────────────────────────────────────────────

describe('envExists', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('returns true when env exists', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)
    createEnvDir('exists', tmp.cenvHome)

    expect(envExists('exists', tmp.cenvHome)).toBe(true)
  })

  test('returns false when env does not exist', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    expect(envExists('missing', tmp.cenvHome)).toBe(false)
  })

  test('returns false when only the dir exists but has no env.yaml', () => {
    const tmp = createTempCenvHome()
    cleanup = tmp.cleanup
    ensureCenvHome(tmp.cenvHome)

    // Create the dir manually without env.yaml
    fs.mkdirSync(path.join(tmp.envsDir, 'partial'))

    expect(envExists('partial', tmp.cenvHome)).toBe(false)
  })
})
