import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome, createEnvDir, deleteEnvDir, envExists } from '../../src/lib/environments'
import { loadEnvConfig } from '../../src/lib/config'
import { listAllEnvs } from '../../src/lib/resolver'

describe('Environment Lifecycle', () => {
  let ctx: E2EContext

  beforeEach(async () => {
    ctx = await createE2EContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('ensureCenvHome creates envs/, auth/, cache/, sessions/ subdirs', () => {
    ensureCenvHome(ctx.cenvHome)

    expect(fs.existsSync(path.join(ctx.cenvHome, 'envs'))).toBe(true)
    expect(fs.existsSync(path.join(ctx.cenvHome, 'auth'))).toBe(true)
    expect(fs.existsSync(path.join(ctx.cenvHome, 'cache'))).toBe(true)
    expect(fs.existsSync(path.join(ctx.cenvHome, 'sessions'))).toBe(true)
  })

  test('createEnvDir creates env.yaml and claude.md', () => {
    ensureCenvHome(ctx.cenvHome)
    const envDir = createEnvDir('my-env', ctx.cenvHome)

    expect(fs.existsSync(path.join(envDir, 'env.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(envDir, 'claude.md'))).toBe(true)
  })

  test('createEnvDir throws when env already exists', () => {
    ensureCenvHome(ctx.cenvHome)
    createEnvDir('my-env', ctx.cenvHome)

    expect(() => createEnvDir('my-env', ctx.cenvHome)).toThrow('already exists')
  })

  test('listAllEnvs shows the created personal env', () => {
    ensureCenvHome(ctx.cenvHome)
    createEnvDir('my-env', ctx.cenvHome)

    const envs = listAllEnvs(ctx.cenvHome, ctx.projectDir)
    const personalEnv = envs.find(e => e.name === 'my-env' && e.source === 'personal')
    expect(personalEnv).toBeDefined()
  })

  test('listAllEnvs also shows team-env from project fixtures', () => {
    ensureCenvHome(ctx.cenvHome)

    const envs = listAllEnvs(ctx.cenvHome, ctx.projectDir)
    const teamEnv = envs.find(e => e.name === 'team-env' && e.source === 'project')
    expect(teamEnv).toBeDefined()
  })

  test('loadEnvConfig on created env returns valid config with name', () => {
    ensureCenvHome(ctx.cenvHome)
    const envDir = createEnvDir('my-env', ctx.cenvHome)

    const config = loadEnvConfig(envDir)
    expect(config.name).toBe('my-env')
    expect(typeof config.name).toBe('string')
  })

  test('envExists returns true after create', () => {
    ensureCenvHome(ctx.cenvHome)
    createEnvDir('my-env', ctx.cenvHome)

    expect(envExists('my-env', ctx.cenvHome)).toBe(true)
  })

  test('deleteEnvDir removes the directory', () => {
    ensureCenvHome(ctx.cenvHome)
    const envDir = createEnvDir('my-env', ctx.cenvHome)

    deleteEnvDir('my-env', ctx.cenvHome)

    expect(fs.existsSync(envDir)).toBe(false)
  })

  test('envExists returns false after delete', () => {
    ensureCenvHome(ctx.cenvHome)
    createEnvDir('my-env', ctx.cenvHome)
    deleteEnvDir('my-env', ctx.cenvHome)

    expect(envExists('my-env', ctx.cenvHome)).toBe(false)
  })

  test('listAllEnvs after delete no longer shows the env', () => {
    ensureCenvHome(ctx.cenvHome)
    createEnvDir('my-env', ctx.cenvHome)
    deleteEnvDir('my-env', ctx.cenvHome)

    const envs = listAllEnvs(ctx.cenvHome, ctx.projectDir)
    const deleted = envs.find(e => e.name === 'my-env' && e.source === 'personal')
    expect(deleted).toBeUndefined()
  })
})
