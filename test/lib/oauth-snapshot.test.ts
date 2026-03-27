import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { snapshotOAuthSession, readClaudeOAuthCredentials } from '../../src/lib/oauth-snapshot'
import * as keychain from '../../src/lib/keychain'
import { CLAUDE_KEYCHAIN_SERVICE, KEYCHAIN_SERVICE_PREFIX } from '../../src/constants'

describe('readClaudeOAuthCredentials', () => {
  test('parses valid Claude Code keychain entry', async () => {
    const mockCreds = {
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-test-token',
        refreshToken: 'sk-ant-ort01-test-refresh',
        expiresAt: Date.now() + 3600000,
        scopes: ['user:inference'],
        subscriptionType: 'max',
      },
    }

    const spy = spyOn(keychain, 'keychainRead').mockResolvedValue(JSON.stringify(mockCreds))

    const result = await readClaudeOAuthCredentials()
    expect(result.accessToken).toBe('sk-ant-oat01-test-token')
    expect(result.refreshToken).toBe('sk-ant-ort01-test-refresh')
    expect(result.subscriptionType).toBe('max')
    expect(spy).toHaveBeenCalledWith(CLAUDE_KEYCHAIN_SERVICE)

    spy.mockRestore()
  })

  test('throws when no credentials in keychain', async () => {
    const spy = spyOn(keychain, 'keychainRead').mockResolvedValue(null)

    await expect(readClaudeOAuthCredentials()).rejects.toThrow('No Claude Code OAuth credentials found')

    spy.mockRestore()
  })

  test('throws when credentials are malformed JSON', async () => {
    const spy = spyOn(keychain, 'keychainRead').mockResolvedValue('not-json')

    await expect(readClaudeOAuthCredentials()).rejects.toThrow('malformed')

    spy.mockRestore()
  })

  test('throws when accessToken is missing', async () => {
    const spy = spyOn(keychain, 'keychainRead').mockResolvedValue(
      JSON.stringify({ claudeAiOauth: { refreshToken: 'x' } })
    )

    await expect(readClaudeOAuthCredentials()).rejects.toThrow('missing accessToken')

    spy.mockRestore()
  })
})

describe('snapshotOAuthSession', () => {
  let tmpDir: string
  let authDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-oauth-test-'))
    authDir = path.join(tmpDir, 'auth')
    fs.mkdirSync(authDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('snapshots current OAuth session into auth profile', async () => {
    const mockCreds = {
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-snapshot-token',
        refreshToken: 'sk-ant-ort01-snapshot-refresh',
        expiresAt: Date.now() + 3600000,
        scopes: ['user:inference'],
        subscriptionType: 'pro',
      },
    }

    const readSpy = spyOn(keychain, 'keychainRead').mockResolvedValue(JSON.stringify(mockCreds))
    const writeSpy = spyOn(keychain, 'keychainWrite').mockResolvedValue(undefined)

    const result = await snapshotOAuthSession('test-oauth', authDir)

    expect(result.subscriptionType).toBe('pro')

    // Verify keychain write was called with our service prefix
    expect(writeSpy).toHaveBeenCalledWith(
      `${KEYCHAIN_SERVICE_PREFIX}test-oauth`,
      'test-oauth',
      expect.stringContaining('sk-ant-oat01-snapshot-token')
    )

    // Verify profile JSON was written
    const profilePath = path.join(authDir, 'test-oauth.json')
    expect(fs.existsSync(profilePath)).toBe(true)
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'))
    expect(profile.type).toBe('oauth')
    expect(profile.keychainEntry).toBe(`${KEYCHAIN_SERVICE_PREFIX}test-oauth`)

    readSpy.mockRestore()
    writeSpy.mockRestore()
  })
})
