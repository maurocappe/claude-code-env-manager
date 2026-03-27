import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome, createEnvDir } from '../../src/lib/environments'
import { isAllowed, allowEnv, isPersonalEnv } from '../../src/lib/trust'

describe('Trust', () => {
  let ctx: E2EContext
  let teamEnvDir: string
  let personalEnvPath: string

  beforeEach(async () => {
    ctx = await createE2EContext()
    ensureCenvHome(ctx.cenvHome)

    // team-env is in project fixtures
    teamEnvDir = path.join(ctx.projectDir, '.claude-envs', 'team-env')

    // create a personal env
    personalEnvPath = createEnvDir('my-env', ctx.cenvHome)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('isAllowed returns false for project env not yet allowed', () => {
    expect(isAllowed(teamEnvDir, ctx.cenvHome)).toBe(false)
  })

  test('allowEnv then isAllowed returns true', () => {
    allowEnv(teamEnvDir, ctx.cenvHome)
    expect(isAllowed(teamEnvDir, ctx.cenvHome)).toBe(true)
  })

  test('modifying env.yaml after allowEnv causes isAllowed to return false', () => {
    allowEnv(teamEnvDir, ctx.cenvHome)
    expect(isAllowed(teamEnvDir, ctx.cenvHome)).toBe(true)

    // Modify the env.yaml to change the hash
    const envYamlPath = path.join(teamEnvDir, 'env.yaml')
    const original = fs.readFileSync(envYamlPath, 'utf8')
    fs.writeFileSync(envYamlPath, original + '\n# modified\n', 'utf8')

    expect(isAllowed(teamEnvDir, ctx.cenvHome)).toBe(false)
  })

  test('re-allowing after modification makes isAllowed return true again', () => {
    allowEnv(teamEnvDir, ctx.cenvHome)

    // Modify then re-allow
    const envYamlPath = path.join(teamEnvDir, 'env.yaml')
    const original = fs.readFileSync(envYamlPath, 'utf8')
    fs.writeFileSync(envYamlPath, original + '\n# modified\n', 'utf8')

    expect(isAllowed(teamEnvDir, ctx.cenvHome)).toBe(false)

    allowEnv(teamEnvDir, ctx.cenvHome)
    expect(isAllowed(teamEnvDir, ctx.cenvHome)).toBe(true)
  })

  test('isPersonalEnv returns true for personal env, false for project env', () => {
    expect(isPersonalEnv(personalEnvPath, ctx.cenvHome)).toBe(true)
    expect(isPersonalEnv(teamEnvDir, ctx.cenvHome)).toBe(false)
  })
})
