import fs from 'node:fs'
import path from 'node:path'
import { AUTH_DIR, KEYCHAIN_SERVICE_PREFIX } from '../constants'
import { AuthError } from '../errors'
import type { AuthProfile } from '../types'
import { keychainRead, keychainWrite, keychainDelete } from './keychain'

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolveAuthDir(authDir?: string): string {
  return authDir ?? AUTH_DIR
}

function profilePath(name: string, authDir: string): string {
  return path.join(authDir, `${name}.json`)
}

function keychainService(name: string): string {
  return `${KEYCHAIN_SERVICE_PREFIX}${name}`
}

/** Mask an API key: show first 6 chars + "..." + last 3 chars */
function maskApiKey(key: string): string {
  if (key.length <= 9) return '***'
  return `${key.slice(0, 6)}...${key.slice(-3)}`
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

/**
 * Write an auth profile JSON to <authDir>/<name>.json.
 * If the profile has type `api-key` and the caller provides a key via
 * `profile.env.ANTHROPIC_API_KEY`, it is stored in the macOS Keychain under
 * `cenv-auth:<name>` and removed from the persisted JSON.
 *
 * @param name     Profile name (used as filename and keychain account)
 * @param profile  The AuthProfile to persist
 * @param apiKey   Raw API key to store in keychain (api-key / openrouter / custom types)
 * @param authDir  Override for auth directory (for testing)
 */
export async function createAuthProfile(
  name: string,
  profile: AuthProfile,
  apiKey?: string,
  authDir?: string
): Promise<void> {
  const dir = resolveAuthDir(authDir)
  fs.mkdirSync(dir, { recursive: true })

  // Store secret in keychain when it's a key-based profile
  if (apiKey) {
    await keychainWrite(keychainService(name), name, apiKey)
    // Ensure keychainEntry is set in the profile so we know where to look later
    profile = { ...profile, keychainEntry: keychainService(name) }
  }

  fs.writeFileSync(profilePath(name, dir), JSON.stringify(profile, null, 2) + '\n', 'utf8')
}

/**
 * Load an auth profile from <authDir>/<name>.json.
 *
 * @throws AuthError if the file does not exist
 */
export function loadAuthProfile(name: string, authDir?: string): AuthProfile {
  const dir = resolveAuthDir(authDir)
  const p = profilePath(name, dir)

  if (!fs.existsSync(p)) {
    throw new AuthError(`Auth profile "${name}" not found`)
  }

  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as AuthProfile
  } catch (err) {
    throw new AuthError(`Auth profile "${name}" is malformed: ${(err as Error).message}`)
  }
}

/**
 * List all auth profiles in authDir, returning name, type, and a masked detail.
 *
 * @param authDir Override for auth directory (for testing)
 */
export function listAuthProfiles(
  authDir?: string
): Array<{ name: string; type: string; detail: string }> {
  const dir = resolveAuthDir(authDir)

  if (!fs.existsSync(dir)) {
    return []
  }

  const results: Array<{ name: string; type: string; detail: string }> = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    if (entry.name === '.gitignore') continue

    const name = entry.name.slice(0, -5) // strip .json
    const p = path.join(dir, entry.name)

    let profile: AuthProfile
    try {
      profile = JSON.parse(fs.readFileSync(p, 'utf8'))
    } catch {
      continue
    }

    results.push({
      name,
      type: profile.type,
      detail: buildDetail(profile),
    })
  }

  return results
}

function buildDetail(profile: AuthProfile): string {
  switch (profile.type) {
    case 'api-key': {
      const key = profile.keychainEntry
        ? `keychain:${profile.keychainEntry}`
        : (profile.env?.ANTHROPIC_API_KEY
          ? maskApiKey(profile.env.ANTHROPIC_API_KEY)
          : '(stored in keychain)')
      const base = profile.env?.ANTHROPIC_BASE_URL
        ? ` → ${profile.env.ANTHROPIC_BASE_URL}`
        : ''
      return `${key}${base}`
    }
    case 'oauth':
      return profile.keychainEntry ? `keychain:${profile.keychainEntry}` : '(oauth)'
    case 'bedrock': {
      const region = profile.env?.AWS_REGION ?? '?'
      const awsProfile = profile.env?.AWS_PROFILE
      return awsProfile ? `aws:${awsProfile} (${region})` : `aws:${region}`
    }
    case 'vertex': {
      const project = profile.env?.ANTHROPIC_VERTEX_PROJECT_ID ?? '?'
      const region = profile.env?.CLOUD_ML_REGION ?? '?'
      return `vertex:${project} (${region})`
    }
    default:
      return profile.keychainEntry ?? '(custom)'
  }
}

/**
 * Delete an auth profile JSON file and any associated keychain entry.
 *
 * @param name    Profile name
 * @param authDir Override for auth directory (for testing)
 */
export async function deleteAuthProfile(name: string, authDir?: string): Promise<void> {
  const dir = resolveAuthDir(authDir)
  const p = profilePath(name, dir)

  if (!fs.existsSync(p)) {
    throw new AuthError(`Auth profile "${name}" not found`)
  }

  fs.unlinkSync(p)

  // Remove keychain entry silently (it may not exist for bedrock/vertex profiles)
  await keychainDelete(keychainService(name), name)
}

// ── Env var resolution ─────────────────────────────────────────────────────────

/**
 * Resolve the auth profile to the set of environment variables required to
 * authenticate Claude Code with the given backend.
 *
 * @param profile Profile object (loaded via loadAuthProfile)
 * @param name    Profile name — used for keychain lookup
 */
export async function resolveAuthEnvVars(
  profile: AuthProfile,
  name: string
): Promise<Record<string, string>> {
  switch (profile.type) {
    case 'api-key': {
      const service = profile.keychainEntry ?? keychainService(name)
      const key = await keychainRead(service, name)
      if (!key) {
        throw new AuthError(
          `No API key found in keychain for auth profile "${name}". ` +
            'Run `cenv auth create` to recreate it.'
        )
      }
      const vars: Record<string, string> = { ANTHROPIC_API_KEY: key }
      if (profile.env?.ANTHROPIC_BASE_URL) {
        vars.ANTHROPIC_BASE_URL = profile.env.ANTHROPIC_BASE_URL
      }
      return vars
    }

    case 'oauth': {
      const service = profile.keychainEntry ?? keychainService(name)
      const raw = await keychainRead(service, name)
      if (!raw) {
        throw new AuthError(
          `No OAuth credentials found in keychain for auth profile "${name}".`
        )
      }
      let creds: { accessToken: string; refreshToken?: string }
      try {
        creds = JSON.parse(raw)
      } catch {
        throw new AuthError(
          `OAuth credentials for auth profile "${name}" are malformed.`
        )
      }
      const vars: Record<string, string> = {
        CLAUDE_CODE_OAUTH_TOKEN: creds.accessToken,
      }
      if (creds.refreshToken) {
        vars.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = creds.refreshToken
      }
      return vars
    }

    case 'bedrock': {
      const vars: Record<string, string> = {
        CLAUDE_CODE_USE_BEDROCK: '1',
        ...(profile.env ?? {}),
      }
      return vars
    }

    case 'vertex': {
      const vars: Record<string, string> = {
        CLAUDE_CODE_USE_VERTEX: '1',
        ...(profile.env ?? {}),
      }
      return vars
    }

    default: {
      // Custom / unknown type — just spread profile.env
      return profile.env ?? {}
    }
  }
}
