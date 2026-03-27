import { CLAUDE_KEYCHAIN_SERVICE, KEYCHAIN_SERVICE_PREFIX } from '../constants'
import { AuthError } from '../errors'
import type { AuthProfile } from '../types'
import { keychainRead, keychainWrite } from './keychain'
import { createAuthProfile } from './auth'

interface ClaudeOAuthCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
  subscriptionType: string
  rateLimitTier?: string
}

/**
 * Read the current Claude Code OAuth credentials from the macOS Keychain.
 * Claude Code stores them under service "Claude Code-credentials".
 * The JSON has shape: { claudeAiOauth: { accessToken, refreshToken, ... } }
 */
export async function readClaudeOAuthCredentials(): Promise<ClaudeOAuthCredentials> {
  const raw = await keychainRead(CLAUDE_KEYCHAIN_SERVICE)
  if (!raw) {
    throw new AuthError(
      'No Claude Code OAuth credentials found in keychain. ' +
      'Are you logged in? Run `claude auth status` to check.'
    )
  }

  let parsed: { claudeAiOauth?: ClaudeOAuthCredentials }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AuthError('Claude Code OAuth credentials are malformed.')
  }

  if (!parsed.claudeAiOauth?.accessToken) {
    throw new AuthError(
      'Claude Code OAuth credentials missing accessToken. ' +
      'Try logging out and back in: `claude logout && claude login`'
    )
  }

  return parsed.claudeAiOauth
}

/**
 * Snapshot the current Claude Code OAuth session into a cenv auth profile.
 * Stores the credentials in a separate keychain entry under our namespace.
 */
export async function snapshotOAuthSession(
  profileName: string,
  authDir?: string
): Promise<{ email?: string; subscriptionType: string }> {
  const creds = await readClaudeOAuthCredentials()

  // Store the full credentials JSON in our own keychain entry
  const keychainEntry = `${KEYCHAIN_SERVICE_PREFIX}${profileName}`
  await keychainWrite(keychainEntry, profileName, JSON.stringify(creds))

  // Create the auth profile JSON
  const profile: AuthProfile = {
    type: 'oauth',
    keychainEntry,
  }

  await createAuthProfile(profileName, profile, undefined, authDir)

  return { subscriptionType: creds.subscriptionType }
}

/**
 * Full flow for creating a new OAuth account:
 * 1. Backup current credentials
 * 2. Run `claude logout && claude login`
 * 3. Snapshot new credentials
 * 4. Restore original credentials
 *
 * Returns the snapshot result. Throws if any step fails.
 */
export async function loginAndSnapshotOAuth(
  profileName: string,
  authDir?: string
): Promise<{ subscriptionType: string }> {
  // 1. Backup current credentials
  const backupRaw = await keychainRead(CLAUDE_KEYCHAIN_SERVICE)

  // 2. Logout + login (interactive — needs user's browser)
  const logoutProc = Bun.spawn(['claude', 'logout'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  await logoutProc.exited
  if (logoutProc.exitCode !== 0) {
    throw new AuthError('claude logout failed')
  }

  const loginProc = Bun.spawn(['claude', 'login'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  await loginProc.exited
  if (loginProc.exitCode !== 0) {
    // Restore backup before throwing
    if (backupRaw) {
      await keychainWrite(
        CLAUDE_KEYCHAIN_SERVICE,
        process.env.USER ?? 'unknown',
        backupRaw
      )
    }
    throw new AuthError('claude login failed — original credentials restored')
  }

  // 3. Snapshot the new credentials
  const result = await snapshotOAuthSession(profileName, authDir)

  // 4. Restore original credentials
  if (backupRaw) {
    await keychainWrite(
      CLAUDE_KEYCHAIN_SERVICE,
      process.env.USER ?? 'unknown',
      backupRaw
    )
  }

  return result
}
