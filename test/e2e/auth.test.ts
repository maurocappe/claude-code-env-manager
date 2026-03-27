import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome } from '../../src/lib/environments'
import {
  createAuthProfile,
  loadAuthProfile,
  listAuthProfiles,
  deleteAuthProfile,
  resolveAuthEnvVars,
} from '../../src/lib/auth'

describe('Auth', () => {
  let ctx: E2EContext
  let authDir: string

  beforeEach(async () => {
    ctx = await createE2EContext()
    ensureCenvHome(ctx.cenvHome)
    authDir = path.join(ctx.cenvHome, 'auth')
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('createAuthProfile with api-key: JSON written to auth dir', async () => {
    await createAuthProfile(
      'test-api',
      { type: 'api-key' },
      'sk-test-key-123',
      authDir
    )

    const profileFile = path.join(authDir, 'test-api.json')
    expect(fs.existsSync(profileFile)).toBe(true)

    const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'))
    expect(profile.type).toBe('api-key')
  })

  test('createAuthProfile with api-key: profile JSON has keychainEntry set', async () => {
    await createAuthProfile(
      'test-api',
      { type: 'api-key' },
      'sk-test-key-123',
      authDir
    )

    // The profile JSON should have keychainEntry set (key is stored in keychain separately)
    const profile = loadAuthProfile('test-api', authDir)
    expect(profile.keychainEntry).toBe('cenv-auth:test-api')
    // The raw env should NOT contain the API key (it's in keychain)
    expect(profile.env?.ANTHROPIC_API_KEY).toBeUndefined()
  })

  test('createAuthProfile with bedrock: JSON written, no keychain entry', async () => {
    await createAuthProfile(
      'test-bedrock',
      { type: 'bedrock', env: { AWS_REGION: 'us-east-1' } },
      undefined,
      authDir
    )

    const profileFile = path.join(authDir, 'test-bedrock.json')
    expect(fs.existsSync(profileFile)).toBe(true)

    const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'))
    expect(profile.type).toBe('bedrock')
    expect(profile.env?.AWS_REGION).toBe('us-east-1')

    // Bedrock profiles don't use the keychain — no keychainEntry in the JSON
    expect(profile.keychainEntry).toBeUndefined()
  })

  test('listAuthProfiles shows both profiles with correct types', async () => {
    await createAuthProfile(
      'test-api',
      { type: 'api-key' },
      'sk-test-key-123',
      authDir
    )
    await createAuthProfile(
      'test-bedrock',
      { type: 'bedrock', env: { AWS_REGION: 'us-east-1' } },
      undefined,
      authDir
    )

    const profiles = listAuthProfiles(authDir)

    const apiProfile = profiles.find(p => p.name === 'test-api')
    const bedrockProfile = profiles.find(p => p.name === 'test-bedrock')

    expect(apiProfile).toBeDefined()
    expect(apiProfile?.type).toBe('api-key')
    expect(bedrockProfile).toBeDefined()
    expect(bedrockProfile?.type).toBe('bedrock')
  })

  test('deleteAuthProfile: JSON file gone', async () => {
    await createAuthProfile(
      'test-api',
      { type: 'api-key' },
      'sk-test-key-123',
      authDir
    )

    const profileFile = path.join(authDir, 'test-api.json')
    expect(fs.existsSync(profileFile)).toBe(true)

    await deleteAuthProfile('test-api', authDir)

    expect(fs.existsSync(profileFile)).toBe(false)
  })

  test('resolveAuthEnvVars with api-key: returns ANTHROPIC_API_KEY after writing to keychain', async () => {
    // Write to the real keychain via createAuthProfile (which calls keychainWrite internally)
    await createAuthProfile(
      'test-api-e2e',
      { type: 'api-key' },
      'sk-e2e-test-key-999',
      authDir
    )

    const profile = loadAuthProfile('test-api-e2e', authDir)
    expect(profile.keychainEntry).toBe('cenv-auth:test-api-e2e')

    const envVars = await resolveAuthEnvVars(profile, 'test-api-e2e')
    expect(envVars.ANTHROPIC_API_KEY).toBe('sk-e2e-test-key-999')

    // Clean up the real keychain entry
    await deleteAuthProfile('test-api-e2e', authDir)
  })

  test('resolveAuthEnvVars with bedrock: returns correct env vars without keychain', async () => {
    await createAuthProfile(
      'test-bedrock',
      {
        type: 'bedrock',
        env: {
          AWS_REGION: 'us-east-1',
          AWS_PROFILE: 'myprofile',
        },
      },
      undefined,
      authDir
    )

    const profile = loadAuthProfile('test-bedrock', authDir)
    const envVars = await resolveAuthEnvVars(profile, 'test-bedrock')

    expect(envVars.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(envVars.AWS_REGION).toBe('us-east-1')
    expect(envVars.AWS_PROFILE).toBe('myprofile')
  })
})
