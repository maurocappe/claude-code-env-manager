import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome, createEnvDir } from '../../src/lib/environments'
import { resolveEnv } from '../../src/lib/resolver'
import { EnvironmentNotFoundError } from '../../src/errors'

describe('Name Resolution', () => {
  let ctx: E2EContext

  beforeEach(async () => {
    ctx = await createE2EContext()
    ensureCenvHome(ctx.cenvHome)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('resolveEnv with personal env name → finds it with source personal', async () => {
    createEnvDir('my-env', ctx.cenvHome)

    const resolved = await resolveEnv('my-env', ctx.cenvHome, ctx.projectDir)

    expect(resolved.source).toBe('personal')
    expect(resolved.config.name).toBe('my-env')
    expect(resolved.path).toContain('my-env')
  })

  test('resolveEnv with project env name → finds fixture team-env with source project', async () => {
    const resolved = await resolveEnv('team-env', ctx.cenvHome, ctx.projectDir)

    expect(resolved.source).toBe('project')
    expect(resolved.config.name).toBe('team-env')
  })

  test('resolveEnv with explicit absolute path → resolves directly', async () => {
    const explicitPath = path.join(ctx.projectDir, '.claude-envs', 'team-env')

    const resolved = await resolveEnv(explicitPath, ctx.cenvHome, ctx.projectDir)

    expect(resolved.config.name).toBe('team-env')
    expect(resolved.path).toBe(explicitPath)
  })

  test('resolveEnv with nonexistent name → throws EnvironmentNotFoundError', async () => {
    await expect(
      resolveEnv('nonexistent-env', ctx.cenvHome, ctx.projectDir)
    ).rejects.toThrow(EnvironmentNotFoundError)
  })
})
