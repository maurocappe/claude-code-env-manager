import { describe, expect, test, afterEach, mock, spyOn } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as keychainModule from '@/lib/keychain'
import { createAuthProfile, loadAuthProfile, listAuthProfiles, deleteAuthProfile, resolveAuthEnvVars } from '@/lib/auth'
import { AuthError } from '@/errors'

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTempDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-auth-test-'))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

// ── Keychain stubs ─────────────────────────────────────────────────────────────
// We stub keychainRead/Write/Delete so auth tests don't hit the real macOS Keychain.

let keychainStore: Map<string, string>

function setupKeychainMocks() {
  keychainStore = new Map()

  spyOn(keychainModule, 'keychainWrite').mockImplementation(
    async (service: string, account: string, data: string) => {
      keychainStore.set(`${service}::${account}`, data)
    }
  )

  spyOn(keychainModule, 'keychainRead').mockImplementation(
    async (service: string, account?: string) => {
      const key = `${service}::${account ?? ''}`
      return keychainStore.get(key) ?? null
    }
  )

  spyOn(keychainModule, 'keychainDelete').mockImplementation(
    async (_service: string, _account: string) => {
      // silently succeed even if not found
    }
  )
}

// ── createAuthProfile / loadAuthProfile ────────────────────────────────────────

describe('createAuthProfile + loadAuthProfile', () => {
  let cleanup: () => void

  afterEach(() => {
    cleanup?.()
    mock.restore()
  })

  test('creates and loads an api-key profile', async () => {
    setupKeychainMocks()
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    const profile = { type: 'api-key' as const }
    await createAuthProfile('work', profile, 'sk-ant-abc123', dir)

    // JSON file should exist
    expect(fs.existsSync(path.join(dir, 'work.json'))).toBe(true)

    // Load it back
    const loaded = loadAuthProfile('work', dir)
    expect(loaded.type).toBe('api-key')
    // keychainEntry should be set
    expect(loaded.keychainEntry).toBe('cenv-auth:work')

    // Key should be in the keychain store
    expect(keychainStore.get('cenv-auth:work::work')).toBe('sk-ant-abc123')
  })

  test('creates and loads a bedrock profile (no keychain)', async () => {
    setupKeychainMocks()
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    const profile = {
      type: 'bedrock' as const,
      env: { AWS_REGION: 'us-east-1', AWS_PROFILE: 'myprofile' },
    }
    await createAuthProfile('aws', profile, undefined, dir)

    expect(fs.existsSync(path.join(dir, 'aws.json'))).toBe(true)
    // No keychain write should have happened for bedrock
    expect(keychainStore.size).toBe(0)

    const loaded = loadAuthProfile('aws', dir)
    expect(loaded.type).toBe('bedrock')
    expect(loaded.env?.AWS_REGION).toBe('us-east-1')
    expect(loaded.env?.AWS_PROFILE).toBe('myprofile')
  })

  test('creates and loads a vertex profile (no keychain)', async () => {
    setupKeychainMocks()
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    const profile = {
      type: 'vertex' as const,
      env: { ANTHROPIC_VERTEX_PROJECT_ID: 'my-project', CLOUD_ML_REGION: 'us-east5' },
    }
    await createAuthProfile('gcp', profile, undefined, dir)

    const loaded = loadAuthProfile('gcp', dir)
    expect(loaded.type).toBe('vertex')
    expect(loaded.env?.ANTHROPIC_VERTEX_PROJECT_ID).toBe('my-project')
    expect(loaded.env?.CLOUD_ML_REGION).toBe('us-east5')
  })

  test('throws AuthError when loading a non-existent profile', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    expect(() => loadAuthProfile('ghost', dir)).toThrow(AuthError)
    expect(() => loadAuthProfile('ghost', dir)).toThrow(/not found/)
  })
})

// ── listAuthProfiles ───────────────────────────────────────────────────────────

describe('listAuthProfiles', () => {
  let cleanup: () => void

  afterEach(() => {
    cleanup?.()
    mock.restore()
  })

  test('returns empty array when auth dir does not exist', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    const result = listAuthProfiles(path.join(dir, 'no-such-dir'))
    expect(result).toEqual([])
  })

  test('lists multiple profiles with correct names and types', async () => {
    setupKeychainMocks()
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    await createAuthProfile('work', { type: 'api-key' as const }, 'sk-ant-xxx', dir)
    await createAuthProfile('aws', {
      type: 'bedrock' as const,
      env: { AWS_REGION: 'us-west-2' },
    }, undefined, dir)
    await createAuthProfile('gcp', {
      type: 'vertex' as const,
      env: { ANTHROPIC_VERTEX_PROJECT_ID: 'proj', CLOUD_ML_REGION: 'us-central1' },
    }, undefined, dir)

    const profiles = listAuthProfiles(dir)
    expect(profiles).toHaveLength(3)

    const names = profiles.map((p) => p.name)
    expect(names).toContain('work')
    expect(names).toContain('aws')
    expect(names).toContain('gcp')

    const work = profiles.find((p) => p.name === 'work')!
    expect(work.type).toBe('api-key')
    expect(work.detail).toContain('cenv-auth:work')

    const aws = profiles.find((p) => p.name === 'aws')!
    expect(aws.type).toBe('bedrock')
    expect(aws.detail).toContain('us-west-2')

    const gcp = profiles.find((p) => p.name === 'gcp')!
    expect(gcp.type).toBe('vertex')
    expect(gcp.detail).toContain('proj')
  })

  test('skips malformed JSON files gracefully', () => {
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'bad.json'), 'not json', 'utf8')
    const result = listAuthProfiles(dir)
    expect(result).toEqual([])
  })
})

// ── deleteAuthProfile ──────────────────────────────────────────────────────────

describe('deleteAuthProfile', () => {
  let cleanup: () => void

  afterEach(() => {
    cleanup?.()
    mock.restore()
  })

  test('deletes a profile and its file', async () => {
    setupKeychainMocks()
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c

    await createAuthProfile('todelete', { type: 'api-key' as const }, 'sk-ant-x', dir)
    expect(fs.existsSync(path.join(dir, 'todelete.json'))).toBe(true)

    await deleteAuthProfile('todelete', dir)
    expect(fs.existsSync(path.join(dir, 'todelete.json'))).toBe(false)
  })

  test('throws AuthError when deleting a non-existent profile', async () => {
    setupKeychainMocks()
    const { dir, cleanup: c } = makeTempDir()
    cleanup = c
    fs.mkdirSync(dir, { recursive: true })

    await expect(deleteAuthProfile('ghost', dir)).rejects.toThrow(AuthError)
    await expect(deleteAuthProfile('ghost', dir)).rejects.toThrow(/not found/)
  })
})

// ── resolveAuthEnvVars ─────────────────────────────────────────────────────────

describe('resolveAuthEnvVars', () => {
  afterEach(() => mock.restore())

  test('api-key: reads key from keychain, returns ANTHROPIC_API_KEY', async () => {
    setupKeychainMocks()
    keychainStore.set('cenv-auth:work::work', 'sk-ant-real-key')

    const profile = { type: 'api-key' as const, keychainEntry: 'cenv-auth:work' }
    const vars = await resolveAuthEnvVars(profile, 'work')

    expect(vars.ANTHROPIC_API_KEY).toBe('sk-ant-real-key')
    expect(vars.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  test('api-key: also returns ANTHROPIC_BASE_URL when set in profile.env', async () => {
    setupKeychainMocks()
    keychainStore.set('cenv-auth:custom::custom', 'sk-or-key')

    const profile = {
      type: 'api-key' as const,
      keychainEntry: 'cenv-auth:custom',
      env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1' },
    }
    const vars = await resolveAuthEnvVars(profile, 'custom')

    expect(vars.ANTHROPIC_API_KEY).toBe('sk-or-key')
    expect(vars.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api/v1')
  })

  test('api-key: throws AuthError when key not in keychain', async () => {
    setupKeychainMocks()
    // keychainStore is empty — key not found

    const profile = { type: 'api-key' as const, keychainEntry: 'cenv-auth:missing' }
    await expect(resolveAuthEnvVars(profile, 'missing')).rejects.toThrow(AuthError)
  })

  test('oauth: reads JSON from keychain and returns tokens', async () => {
    setupKeychainMocks()
    const creds = { accessToken: 'acc-tok', refreshToken: 'ref-tok' }
    keychainStore.set('cenv-auth:myoauth::myoauth', JSON.stringify(creds))

    const profile = { type: 'oauth' as const, keychainEntry: 'cenv-auth:myoauth' }
    const vars = await resolveAuthEnvVars(profile, 'myoauth')

    expect(vars.CLAUDE_CODE_OAUTH_TOKEN).toBe('acc-tok')
    expect(vars.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBe('ref-tok')
  })

  test('oauth: returns only access token when no refresh token', async () => {
    setupKeychainMocks()
    const creds = { accessToken: 'acc-only' }
    keychainStore.set('cenv-auth:norf::norf', JSON.stringify(creds))

    const profile = { type: 'oauth' as const, keychainEntry: 'cenv-auth:norf' }
    const vars = await resolveAuthEnvVars(profile, 'norf')

    expect(vars.CLAUDE_CODE_OAUTH_TOKEN).toBe('acc-only')
    expect(vars.CLAUDE_CODE_OAUTH_REFRESH_TOKEN).toBeUndefined()
  })

  test('bedrock: returns CLAUDE_CODE_USE_BEDROCK=1 and spreads env', async () => {
    const profile = {
      type: 'bedrock' as const,
      env: { AWS_REGION: 'us-east-1', AWS_PROFILE: 'myprofile' },
    }
    const vars = await resolveAuthEnvVars(profile, 'aws')

    expect(vars.CLAUDE_CODE_USE_BEDROCK).toBe('1')
    expect(vars.AWS_REGION).toBe('us-east-1')
    expect(vars.AWS_PROFILE).toBe('myprofile')
  })

  test('vertex: returns CLAUDE_CODE_USE_VERTEX=1 and spreads env', async () => {
    const profile = {
      type: 'vertex' as const,
      env: {
        ANTHROPIC_VERTEX_PROJECT_ID: 'my-project',
        CLOUD_ML_REGION: 'us-central1',
      },
    }
    const vars = await resolveAuthEnvVars(profile, 'gcp')

    expect(vars.CLAUDE_CODE_USE_VERTEX).toBe('1')
    expect(vars.ANTHROPIC_VERTEX_PROJECT_ID).toBe('my-project')
    expect(vars.CLOUD_ML_REGION).toBe('us-central1')
  })
})
