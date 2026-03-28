import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()

// ── cenv home ─────────────────────────────────────────────────────────────────

export const CENV_HOME = path.join(HOME, '.claude-envs')
export const ENVS_DIR = path.join(CENV_HOME, 'envs')
export const AUTH_DIR = path.join(CENV_HOME, 'auth')
export const CACHE_DIR = path.join(CENV_HOME, 'cache')
export const SESSIONS_DIR = path.join(CENV_HOME, 'sessions')

// ── Claude Code home ──────────────────────────────────────────────────────────

export const CLAUDE_HOME = path.join(HOME, '.claude')
export const CLAUDE_PLUGINS_DIR = path.join(CLAUDE_HOME, 'plugins')
export const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_HOME, 'settings.json')
export const CLAUDE_MD_PATH = path.join(CLAUDE_HOME, 'CLAUDE.md')
export const CLAUDE_INSTALLED_PLUGINS_PATH = path.join(
  CLAUDE_PLUGINS_DIR,
  'installed_plugins.json'
)

// ── Keychain ──────────────────────────────────────────────────────────────────

export const KEYCHAIN_SERVICE_PREFIX = 'cenv-auth:'
export const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

// ── Dotfile symlinks ─────────────────────────────────────────────────────────

export const DOTFILE_SYMLINKS = [
  '.gitconfig', '.ssh', '.config', '.local',
  '.npmrc', '.bunfig.toml',
] as const

// ── Session temp dir ──────────────────────────────────────────────────────────

export const SESSIONS_TMP_DIR = '/tmp/cenv-sessions'
