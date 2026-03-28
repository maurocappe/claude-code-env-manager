import { describe, expect, test, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadEnvConfig, writeEnvConfig } from '@/lib/config'
import { ConfigError } from '@/errors'
import { createTempEnvDir } from '../helpers/mock-env'

// ── loadEnvConfig ──────────────────────────────────────────────────────────────

describe('loadEnvConfig', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('loads a valid env.yaml with all fields', () => {
    const tmp = createTempEnvDir(`
name: my-env
description: A test environment
plugins:
  enable:
    - name: superpowers
      source: github:anthropics/claude-code-superpowers
      version: "^5.0.0"
  disable:
    - superpowers:brainstorming
skills:
  - name: my-skill
    source: github:user/repo
mcp_servers:
  sqlite:
    command: npx
    args: ["-y", "mcp-server-sqlite"]
hooks:
  UserPromptSubmit:
    - command: echo hello
settings:
  effortLevel: high
  permissions:
    allow:
      - Bash(*)
`)
    cleanup = tmp.cleanup

    const config = loadEnvConfig(tmp.envDir)

    expect(config.name).toBe('my-env')
    expect(config.description).toBe('A test environment')
    expect(config.plugins?.enable).toHaveLength(1)
    expect(config.plugins?.enable?.[0].name).toBe('superpowers')
    expect(config.plugins?.enable?.[0].version).toBe('^5.0.0')
    expect(config.plugins?.disable).toEqual(['superpowers:brainstorming'])
    expect(config.skills).toHaveLength(1)
    expect(config.mcp_servers?.sqlite.command).toBe('npx')
    expect(config.hooks?.UserPromptSubmit?.[0].command).toBe('echo hello')
    expect(config.settings?.effortLevel).toBe('high')
    expect(config.settings?.permissions?.allow).toEqual(['Bash(*)'])
  })

  test('loads a minimal env.yaml with just a name', () => {
    const tmp = createTempEnvDir('name: minimal-env\n')
    cleanup = tmp.cleanup

    const config = loadEnvConfig(tmp.envDir)

    expect(config.name).toBe('minimal-env')
    expect(config.description).toBeUndefined()
    expect(config.plugins).toBeUndefined()
  })

  test('throws ConfigError when name field is missing', () => {
    const tmp = createTempEnvDir('description: oops, forgot name\n')
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).toThrow(ConfigError)
    expect(() => loadEnvConfig(tmp.envDir)).toThrow(/name/)
  })

  test('throws ConfigError when plugin enable entry is missing name', () => {
    const tmp = createTempEnvDir(`
name: bad-env
plugins:
  enable:
    - source: github:user/repo
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).toThrow(ConfigError)
    expect(() => loadEnvConfig(tmp.envDir)).toThrow(/name/)
  })

  test('throws ConfigError when plugin enable entry is missing source', () => {
    const tmp = createTempEnvDir(`
name: bad-env
plugins:
  enable:
    - name: superpowers
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).toThrow(ConfigError)
    expect(() => loadEnvConfig(tmp.envDir)).toThrow(/source/)
  })

  test('throws ConfigError when plugin version is an invalid semver range', () => {
    const tmp = createTempEnvDir(`
name: bad-env
plugins:
  enable:
    - name: superpowers
      source: github:user/repo
      version: "not-a-version!!!"
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).toThrow(ConfigError)
    expect(() => loadEnvConfig(tmp.envDir)).toThrow(/version/)
  })

  test('accepts valid semver ranges in plugin versions', () => {
    const tmp = createTempEnvDir(`
name: good-env
plugins:
  enable:
    - name: superpowers
      source: github:user/repo
      version: "^5.0.0"
    - name: other
      source: github:user/other
      version: ">=1.0.0 <2.0.0"
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })

  test('throws when env.yaml file does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-missing-'))
    cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true })

    expect(() => loadEnvConfig(tmpDir)).toThrow()
  })
})

// ── loadEnvConfig — path validation ───────────────────────────────────────────

describe('loadEnvConfig — path validation', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('allows skill paths under ~/.claude/', () => {
    const tmp = createTempEnvDir(`
name: path-test
skills:
  - name: my-skill
    path: ${os.homedir()}/.claude/skills/foo
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })

  test('allows relative skill paths starting with ./', () => {
    const tmp = createTempEnvDir(`
name: path-test
skills:
  - name: my-skill
    path: ./skills/foo
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })

  test('allows relative skill paths starting with ../', () => {
    const tmp = createTempEnvDir(`
name: path-test
skills:
  - name: my-skill
    path: ../shared-skills/foo
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })

  test('allows skill paths under ~/.claude-envs/', () => {
    const tmp = createTempEnvDir(`
name: path-test
skills:
  - name: my-skill
    path: ${os.homedir()}/.claude-envs/some-env/skills/foo
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })

  test('allows skill paths under ~/.agents/', () => {
    const tmp = createTempEnvDir(`
name: path-test
skills:
  - name: my-skill
    path: ${os.homedir()}/.agents/my-agent
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })

  test('rejects skill paths to system directories', () => {
    const tmp = createTempEnvDir(`
name: path-test
skills:
  - name: evil-skill
    path: /etc/passwd
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).toThrow(ConfigError)
    expect(() => loadEnvConfig(tmp.envDir)).toThrow(/skill path/)
    expect(() => loadEnvConfig(tmp.envDir)).toThrow(/not under an allowed directory/)
  })

  test('rejects command paths to system directories', () => {
    const tmp = createTempEnvDir(`
name: path-test
commands:
  - path: /etc/shadow
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).toThrow(ConfigError)
    expect(() => loadEnvConfig(tmp.envDir)).toThrow(/command path/)
    expect(() => loadEnvConfig(tmp.envDir)).toThrow(/not under an allowed directory/)
  })

  test('allows command paths under ~/.claude-envs/', () => {
    const tmp = createTempEnvDir(`
name: path-test
commands:
  - path: ${os.homedir()}/.claude-envs/some-env/commands/foo
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })

  test('allows command paths that are relative', () => {
    const tmp = createTempEnvDir(`
name: path-test
commands:
  - path: ./commands/foo
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })

  test('skills without a path field are not validated', () => {
    const tmp = createTempEnvDir(`
name: path-test
skills:
  - name: remote-skill
    source: github:user/repo
`)
    cleanup = tmp.cleanup

    expect(() => loadEnvConfig(tmp.envDir)).not.toThrow()
  })
})

// ── writeEnvConfig ─────────────────────────────────────────────────────────────

describe('writeEnvConfig', () => {
  let cleanup: () => void

  afterEach(() => cleanup?.())

  test('writes config and reads it back identically (roundtrip)', () => {
    const tmp = createTempEnvDir('name: placeholder\n')
    cleanup = tmp.cleanup

    const original = {
      name: 'roundtrip-env',
      description: 'A roundtrip test',
      plugins: {
        enable: [{ name: 'superpowers', source: 'github:anthropics/superpowers', version: '^5.0.0' }],
        disable: ['superpowers:brainstorming'],
      },
      settings: {
        effortLevel: 'high' as const,
        permissions: { allow: ['Bash(*)'] },
      },
    }

    writeEnvConfig(tmp.envDir, original)
    const loaded = loadEnvConfig(tmp.envDir)

    expect(loaded.name).toBe(original.name)
    expect(loaded.description).toBe(original.description)
    expect(loaded.plugins?.enable?.[0].name).toBe('superpowers')
    expect(loaded.plugins?.disable).toEqual(['superpowers:brainstorming'])
    expect(loaded.settings?.effortLevel).toBe('high')
  })

  test('writes valid YAML (file is readable as text)', () => {
    const tmp = createTempEnvDir('name: placeholder\n')
    cleanup = tmp.cleanup

    writeEnvConfig(tmp.envDir, { name: 'yaml-test', description: 'hello' })

    const raw = fs.readFileSync(path.join(tmp.envDir, 'env.yaml'), 'utf8')
    expect(raw).toContain('name: yaml-test')
    expect(raw).toContain('description: hello')
  })
})
