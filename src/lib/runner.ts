import fs from 'node:fs'
import path from 'node:path'
import type { EnvConfig, SessionFiles } from '../types'

/**
 * Assemble the claude CLI arguments from session files and env config.
 */
export function assembleClaudeArgs(
  session: SessionFiles,
  config: EnvConfig,
  passThroughArgs: string[] = []
): string[] {
  const args: string[] = []

  // Isolation mode
  if (config.isolation === 'bare') {
    args.push('--bare')
  }

  // Settings
  args.push('--settings', session.settingsPath)

  // Plugin directories
  for (const dir of session.pluginDirs) {
    args.push('--plugin-dir', dir)
  }

  // MCP config — use strict in bare mode for full isolation
  if (config.isolation === 'bare') {
    args.push('--strict-mcp-config')
  }
  args.push('--mcp-config', session.mcpConfigPath)

  // Claude.md — append to system prompt
  if (session.claudeMdPath) {
    args.push('--append-system-prompt-file', session.claudeMdPath)
  }

  // Pass-through args (everything after --)
  if (passThroughArgs.length > 0) {
    args.push(...passThroughArgs)
  }

  return args
}

/**
 * Find the claude binary path.
 */
export function findClaudeBinary(): string {
  // Try known absolute paths first
  const absoluteCandidates = [
    path.join(process.env.HOME ?? '', '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
  ]

  for (const candidate of absoluteCandidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  // Fall back to PATH lookup
  try {
    const proc = Bun.spawnSync(['which', 'claude'])
    if (proc.exitCode === 0) {
      const resolved = new TextDecoder().decode(proc.stdout).trim()
      if (resolved) return resolved
    }
  } catch {
    // continue
  }

  return 'claude' // let the OS resolve it
}
