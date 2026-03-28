import fs from 'node:fs'
import path from 'node:path'

/**
 * Find the claude binary path.
 */
export function findClaudeBinary(realHome?: string): string {
  const home = realHome ?? process.env.HOME ?? ''

  // Try known absolute paths first
  const absoluteCandidates = [
    path.join(home, '.local', 'bin', 'claude'),
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
