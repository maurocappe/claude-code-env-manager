// ── Environment Config (env.yaml schema) ──────────────────────────────────────

export interface EnvConfig {
  name: string
  description?: string
  plugins?: {
    enable?: PluginRef[]
    disable?: string[]
  }
  skills?: SkillRef[]
  commands?: CommandRef[]
  mcp_servers?: Record<string, McpServerConfig>
  hooks?: Record<string, HookConfig[]>
  settings?: SettingsConfig
}

export interface PluginRef {
  name: string
  source: string
  version?: string
}

export interface SkillRef {
  name?: string
  source?: string
  ref?: string
  path?: string
}

export interface CommandRef {
  path: string
}

export interface McpServerConfig {
  install?: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface HookConfig {
  command: string
}

export interface SettingsConfig {
  effortLevel?: 'low' | 'medium' | 'high'
  permissions?: PermissionsConfig
  statusLine?: Record<string, unknown>
}

export interface PermissionsConfig {
  allow?: string[]
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export interface AuthProfile {
  type: 'api-key' | 'oauth' | 'bedrock' | 'vertex'
  env?: Record<string, string>
  keychainEntry?: string
  claudeProfile?: string
}

// ── Resolution ────────────────────────────────────────────────────────────────

export interface ResolvedEnv {
  path: string
  source: 'personal' | 'project'
  config: EnvConfig
}

export interface EnvEntry {
  name: string
  path: string
  source: 'personal' | 'project'
}

// ── Scanner ───────────────────────────────────────────────────────────────────

export interface InstalledPlugin {
  name: string
  source: string
  version: string
  scope: 'user' | 'local'
  path: string
}

export interface InstalledSkill {
  name: string
  source?: string
  path: string
}

export interface PluginComponents {
  skills: string[]
  hooks: Record<string, unknown[]>
  mcpServers: string[]
  agents: string[]
}

// ── Installer ─────────────────────────────────────────────────────────────────

export interface DepResolution {
  ref: PluginRef | SkillRef
  status: 'installed' | 'cached' | 'missing' | 'version-mismatch'
  installedVersion?: string
  resolvedPath?: string
}
