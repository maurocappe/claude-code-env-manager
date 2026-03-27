import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { createE2EContext, type E2EContext } from './helpers/setup'
import { ensureCenvHome, createEnvDir } from '../../src/lib/environments'
import { writeEnvConfig, loadEnvConfig } from '../../src/lib/config'
import { diffEnvConfigs, isDiffEmpty } from '../../src/lib/diff'

describe('Add + Diff', () => {
  let ctx: E2EContext

  beforeEach(async () => {
    ctx = await createE2EContext()
    ensureCenvHome(ctx.cenvHome)
  })

  afterEach(() => {
    ctx.cleanup()
  })

  test('copy team-env from project to personal envs dir → env.yaml and claude.md exist in target', () => {
    const sourceDir = path.join(ctx.projectDir, '.claude-envs', 'team-env')
    const targetDir = path.join(ctx.cenvHome, 'envs', 'team-env')

    fs.cpSync(sourceDir, targetDir, { recursive: true })

    expect(fs.existsSync(path.join(targetDir, 'env.yaml'))).toBe(true)
    expect(fs.existsSync(path.join(targetDir, 'claude.md'))).toBe(true)
  })

  test('copy with rename → target exists with correct content', () => {
    const sourceDir = path.join(ctx.projectDir, '.claude-envs', 'team-env')
    const targetDir = path.join(ctx.cenvHome, 'envs', 'renamed-env')

    fs.cpSync(sourceDir, targetDir, { recursive: true })

    expect(fs.existsSync(targetDir)).toBe(true)
    expect(fs.existsSync(path.join(targetDir, 'env.yaml'))).toBe(true)

    // Verify content was copied (not empty)
    const content = fs.readFileSync(path.join(targetDir, 'env.yaml'), 'utf8')
    expect(content).toContain('team-env')
  })

  test('diffEnvConfigs with identical configs → all diff arrays empty (isDiffEmpty)', () => {
    const envDirA = createEnvDir('env-a', ctx.cenvHome)
    writeEnvConfig(envDirA, {
      name: 'env-a',
      isolation: 'additive',
      settings: { effortLevel: 'low' },
    })

    const configA = loadEnvConfig(envDirA)
    const diff = diffEnvConfigs(configA, configA)

    expect(isDiffEmpty(diff)).toBe(true)
  })

  test('diffEnvConfigs where B has extra plugin → diff.plugins.added contains it', () => {
    const envDirA = createEnvDir('diff-a', ctx.cenvHome)
    writeEnvConfig(envDirA, {
      name: 'diff-a',
      plugins: {
        enable: [{ name: 'superpowers', source: 'claude-plugins-official', version: '^5.0.0' }],
      },
    })

    const envDirB = createEnvDir('diff-b', ctx.cenvHome)
    writeEnvConfig(envDirB, {
      name: 'diff-b',
      plugins: {
        enable: [
          { name: 'superpowers', source: 'claude-plugins-official', version: '^5.0.0' },
          { name: 'extra-plugin', source: 'claude-plugins-official', version: '^1.0.0' },
        ],
      },
    })

    const diff = diffEnvConfigs(loadEnvConfig(envDirA), loadEnvConfig(envDirB))

    expect(diff.plugins.added).toContain('extra-plugin')
    expect(diff.plugins.removed).toHaveLength(0)
  })

  test('diffEnvConfigs where B has different effortLevel → diff.settings contains the change', () => {
    const envDirA = createEnvDir('settings-a', ctx.cenvHome)
    writeEnvConfig(envDirA, { name: 'settings-a', settings: { effortLevel: 'low' } })

    const envDirB = createEnvDir('settings-b', ctx.cenvHome)
    writeEnvConfig(envDirB, { name: 'settings-b', settings: { effortLevel: 'high' } })

    const diff = diffEnvConfigs(loadEnvConfig(envDirA), loadEnvConfig(envDirB))

    const effortChange = diff.settings.find(s => s.key === 'effortLevel')
    expect(effortChange).toBeDefined()
    expect(effortChange?.from).toBe('low')
    expect(effortChange?.to).toBe('high')
  })
})
