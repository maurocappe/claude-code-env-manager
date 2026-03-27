import { text, select, log, outro, cancel, isCancel } from '@clack/prompts'
import pc from 'picocolors'
import { AUTH_DIR } from '../../constants'
import type { AuthProfile } from '../../types'
import { createAuthProfile } from '../../lib/auth'

type AuthType = 'api-key' | 'openrouter' | 'oauth' | 'bedrock' | 'vertex' | 'custom'

/**
 * Interactive wizard to create an auth profile.
 *
 * @param authDir Override for auth directory (for testing / composition)
 */
export async function runAuthCreate(authDir: string = AUTH_DIR): Promise<void> {
  // 1. Prompt for name
  const name = await text({
    message: 'Profile name',
    placeholder: 'e.g. work, personal, openrouter',
    validate: (v) => {
      if (!v.trim()) return 'Profile name is required'
      if (!/^[a-zA-Z0-9_-]+$/.test(v.trim()))
        return 'Profile name may only contain letters, digits, hyphens, and underscores'
    },
  })
  if (isCancel(name)) { cancel('Cancelled'); return }

  // 2. Select type
  const type = await select<AuthType>({
    message: 'Auth type',
    options: [
      { value: 'api-key', label: 'API key (Anthropic direct)' },
      { value: 'openrouter', label: 'OpenRouter (API key)' },
      { value: 'oauth', label: 'OAuth / subscription' },
      { value: 'bedrock', label: 'AWS Bedrock' },
      { value: 'vertex', label: 'Google Vertex AI' },
      { value: 'custom', label: 'Custom base URL + API key' },
    ],
  })
  if (isCancel(type)) { cancel('Cancelled'); return }

  switch (type) {
    case 'api-key':
      await handleApiKey(String(name), authDir)
      break
    case 'openrouter':
      await handleOpenRouter(String(name), authDir)
      break
    case 'oauth':
      await handleOAuth()
      break
    case 'bedrock':
      await handleBedrock(String(name), authDir)
      break
    case 'vertex':
      await handleVertex(String(name), authDir)
      break
    case 'custom':
      await handleCustom(String(name), authDir)
      break
  }
}

// ── Per-type handlers ──────────────────────────────────────────────────────────

async function handleApiKey(name: string, authDir: string): Promise<void> {
  const key = await text({
    message: 'Anthropic API key',
    placeholder: 'sk-ant-...',
    validate: (v) => (!v.trim() ? 'API key is required' : undefined),
  })
  if (isCancel(key)) { cancel('Cancelled'); return }

  const baseUrl = await text({
    message: 'Base URL (leave empty for default)',
    placeholder: 'https://api.anthropic.com',
  })
  if (isCancel(baseUrl)) { cancel('Cancelled'); return }

  const profile: AuthProfile = {
    type: 'api-key',
    ...(String(baseUrl).trim() ? { env: { ANTHROPIC_BASE_URL: String(baseUrl).trim() } } : {}),
  }

  await createAuthProfile(name, profile, String(key).trim(), authDir)
  outro(`${pc.green('✓')} Auth profile ${pc.cyan(pc.bold(name))} created (API key stored in keychain)`)
}

async function handleOpenRouter(name: string, authDir: string): Promise<void> {
  const key = await text({
    message: 'OpenRouter API key',
    placeholder: 'sk-or-...',
    validate: (v) => (!v.trim() ? 'API key is required' : undefined),
  })
  if (isCancel(key)) { cancel('Cancelled'); return }

  const profile: AuthProfile = {
    type: 'api-key',
    env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1' },
  }

  await createAuthProfile(name, profile, String(key).trim(), authDir)
  outro(`${pc.green('✓')} Auth profile ${pc.cyan(pc.bold(name))} created (OpenRouter via keychain)`)
}

async function handleOAuth(): Promise<void> {
  log.info(
    `Use ${pc.cyan('cenv auth snapshot')} to capture your current Claude Code session.\n` +
    'This flow will be added in a future release.'
  )
}

async function handleBedrock(name: string, authDir: string): Promise<void> {
  const awsProfile = await text({
    message: 'AWS profile name (leave empty for default credentials)',
    placeholder: 'default',
  })
  if (isCancel(awsProfile)) { cancel('Cancelled'); return }

  const region = await text({
    message: 'AWS region',
    placeholder: 'us-east-1',
    validate: (v) => (!v.trim() ? 'Region is required' : undefined),
  })
  if (isCancel(region)) { cancel('Cancelled'); return }

  const env: Record<string, string> = { AWS_REGION: String(region).trim() }
  if (String(awsProfile).trim()) {
    env.AWS_PROFILE = String(awsProfile).trim()
  }

  const profile: AuthProfile = { type: 'bedrock', env }

  await createAuthProfile(name, profile, undefined, authDir)
  outro(`${pc.green('✓')} Auth profile ${pc.cyan(pc.bold(name))} created (Bedrock)`)
}

async function handleVertex(name: string, authDir: string): Promise<void> {
  const projectId = await text({
    message: 'Google Cloud project ID',
    validate: (v) => (!v.trim() ? 'Project ID is required' : undefined),
  })
  if (isCancel(projectId)) { cancel('Cancelled'); return }

  const region = await text({
    message: 'Region',
    placeholder: 'us-east5',
    validate: (v) => (!v.trim() ? 'Region is required' : undefined),
  })
  if (isCancel(region)) { cancel('Cancelled'); return }

  const profile: AuthProfile = {
    type: 'vertex',
    env: {
      ANTHROPIC_VERTEX_PROJECT_ID: String(projectId).trim(),
      CLOUD_ML_REGION: String(region).trim(),
    },
  }

  await createAuthProfile(name, profile, undefined, authDir)
  outro(`${pc.green('✓')} Auth profile ${pc.cyan(pc.bold(name))} created (Vertex AI)`)
}

async function handleCustom(name: string, authDir: string): Promise<void> {
  const key = await text({
    message: 'API key',
    validate: (v) => (!v.trim() ? 'API key is required' : undefined),
  })
  if (isCancel(key)) { cancel('Cancelled'); return }

  const baseUrl = await text({
    message: 'Base URL',
    validate: (v) => (!v.trim() ? 'Base URL is required' : undefined),
  })
  if (isCancel(baseUrl)) { cancel('Cancelled'); return }

  const profile: AuthProfile = {
    type: 'api-key',
    env: { ANTHROPIC_BASE_URL: String(baseUrl).trim() },
  }

  await createAuthProfile(name, profile, String(key).trim(), authDir)
  outro(`${pc.green('✓')} Auth profile ${pc.cyan(pc.bold(name))} created (custom endpoint)`)
}
