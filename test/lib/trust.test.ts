import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hashEnvDir, isAllowed, allowEnv, isPersonalEnv } from '../../src/lib/trust'

describe('trust', () => {
  let tmpDir: string
  let cenvHome: string
  let envDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-trust-test-'))
    cenvHome = path.join(tmpDir, 'cenv-home')
    fs.mkdirSync(cenvHome, { recursive: true })
    envDir = path.join(tmpDir, 'project', '.claude-envs', 'test-env')
    fs.mkdirSync(envDir, { recursive: true })
    fs.writeFileSync(path.join(envDir, 'env.yaml'), 'name: test-env\n', 'utf8')
    fs.writeFileSync(path.join(envDir, 'claude.md'), '# Test\n', 'utf8')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('hashEnvDir produces consistent hashes', () => {
    const h1 = hashEnvDir(envDir)
    const h2 = hashEnvDir(envDir)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  test('hashEnvDir changes when env.yaml changes', () => {
    const h1 = hashEnvDir(envDir)
    fs.writeFileSync(path.join(envDir, 'env.yaml'), 'name: modified\n', 'utf8')
    const h2 = hashEnvDir(envDir)
    expect(h1).not.toBe(h2)
  })

  test('hashEnvDir changes when claude.md changes', () => {
    const h1 = hashEnvDir(envDir)
    fs.writeFileSync(path.join(envDir, 'claude.md'), '# Changed\n', 'utf8')
    const h2 = hashEnvDir(envDir)
    expect(h1).not.toBe(h2)
  })

  test('hashEnvDir includes skills/ files', () => {
    const h1 = hashEnvDir(envDir)
    const skillDir = path.join(envDir, 'skills', 'my-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Skill\n', 'utf8')
    const h2 = hashEnvDir(envDir)
    expect(h1).not.toBe(h2)
  })

  test('isAllowed returns false when no .allowed file', () => {
    expect(isAllowed(envDir, cenvHome)).toBe(false)
  })

  test('allowEnv → isAllowed returns true', () => {
    allowEnv(envDir, cenvHome)
    expect(isAllowed(envDir, cenvHome)).toBe(true)
  })

  test('isAllowed returns false after file modification', () => {
    allowEnv(envDir, cenvHome)
    expect(isAllowed(envDir, cenvHome)).toBe(true)

    fs.writeFileSync(path.join(envDir, 'env.yaml'), 'name: tampered\n', 'utf8')
    expect(isAllowed(envDir, cenvHome)).toBe(false)
  })

  test('allowEnv updates hash on re-allow after modification', () => {
    allowEnv(envDir, cenvHome)
    fs.writeFileSync(path.join(envDir, 'env.yaml'), 'name: updated\n', 'utf8')
    expect(isAllowed(envDir, cenvHome)).toBe(false)

    allowEnv(envDir, cenvHome) // re-allow
    expect(isAllowed(envDir, cenvHome)).toBe(true)
  })

  test('isPersonalEnv returns true for paths under cenv home envs/', () => {
    expect(isPersonalEnv('/home/user/.claude-envs/envs/my-env', '/home/user/.claude-envs')).toBe(true)
  })

  test('isPersonalEnv returns false for project paths', () => {
    expect(isPersonalEnv('/projects/app/.claude-envs/my-env', '/home/user/.claude-envs')).toBe(false)
  })
})
