import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, stringify } from 'yaml'
import { validRange } from 'semver'
import type { EnvConfig, PluginRef } from '../types'
import { ConfigError } from '../errors'

/**
 * Read and validate env.yaml from the given environment directory.
 *
 * Validation rules:
 * - `name` is required
 * - Each entry in `plugins.enable` must have `name` and `source`
 * - If a plugin entry has `version`, it must be a valid semver range
 *
 * @throws ConfigError on validation failure
 * @throws Error if env.yaml cannot be read
 */
export function loadEnvConfig(envDir: string): EnvConfig {
  const yamlPath = path.join(envDir, 'env.yaml')
  const raw = fs.readFileSync(yamlPath, 'utf8')
  const data = parse(raw) as EnvConfig

  // Required field
  if (!data?.name || typeof data.name !== 'string') {
    throw new ConfigError('env.yaml: required field "name" is missing or invalid')
  }

  // Validate plugins.enable entries
  if (data.plugins?.enable) {
    for (const plugin of data.plugins.enable) {
      validatePluginRef(plugin)
    }
  }

  // Validate skill and command paths
  validatePaths(data)

  return data
}

function validatePluginRef(plugin: PluginRef): void {
  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new ConfigError(
      `env.yaml: plugin entry is missing required field "name" (got: ${JSON.stringify(plugin)})`
    )
  }
  if (!plugin.source || typeof plugin.source !== 'string') {
    throw new ConfigError(
      `env.yaml: plugin "${plugin.name}" is missing required field "source"`
    )
  }
  if (plugin.version !== undefined) {
    if (validRange(plugin.version) === null) {
      throw new ConfigError(
        `env.yaml: plugin "${plugin.name}" has an invalid semver version range: "${plugin.version}"`
      )
    }
  }
}

function validatePaths(config: EnvConfig): void {
  const home = os.homedir()
  const allowedPrefixes = [
    home + '/.claude/',      // user claude dir
    home + '/.claude-envs/', // cenv dir
    home + '/.agents/',      // agents dir (skills often symlinked here)
  ]

  function isAllowedPath(p: string): boolean {
    // Relative paths starting with ./ or ../ are always allowed (project-local)
    if (p.startsWith('./') || p.startsWith('../')) return true
    // Absolute paths must be under allowed prefixes
    for (const prefix of allowedPrefixes) {
      if (p.startsWith(prefix)) return true
    }
    return false
  }

  if (config.skills) {
    for (const skill of config.skills) {
      if (skill.path && !isAllowedPath(skill.path)) {
        throw new ConfigError(
          `env.yaml: skill path "${skill.path}" is not under an allowed directory. ` +
          `Paths must be relative (./) or under ~/.claude/, ~/.claude-envs/, or ~/.agents/`
        )
      }
    }
  }

  if (config.commands) {
    for (const cmd of config.commands) {
      if (cmd.path && !isAllowedPath(cmd.path)) {
        throw new ConfigError(
          `env.yaml: command path "${cmd.path}" is not under an allowed directory. ` +
          `Paths must be relative (./) or under ~/.claude/, ~/.claude-envs/, or ~/.agents/`
        )
      }
    }
  }

  if (config.rules) {
    for (const rule of config.rules) {
      if (rule.path && !isAllowedPath(rule.path)) {
        throw new ConfigError(
          `env.yaml: rule path "${rule.path}" is not under an allowed directory. ` +
          `Paths must be relative (./) or under ~/.claude/, ~/.claude-envs/, or ~/.agents/`
        )
      }
    }
  }
}

/**
 * Write an EnvConfig as YAML to env.yaml in the given environment directory.
 */
export function writeEnvConfig(envDir: string, config: EnvConfig): void {
  const yamlPath = path.join(envDir, 'env.yaml')
  const raw = stringify(config)
  fs.writeFileSync(yamlPath, raw, 'utf8')
}
