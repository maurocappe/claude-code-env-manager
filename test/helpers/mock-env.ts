import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/**
 * Creates an isolated temp directory to use as CENV_HOME for tests.
 * Returns helpers to get paths within it and clean up after.
 */
export function createTempCenvHome(): {
  cenvHome: string
  envsDir: string
  authDir: string
  cacheDir: string
  cleanup: () => void
} {
  const cenvHome = fs.mkdtempSync(
    path.join(os.tmpdir(), 'cenv-test-')
  )
  return {
    cenvHome,
    envsDir: path.join(cenvHome, 'envs'),
    authDir: path.join(cenvHome, 'auth'),
    cacheDir: path.join(cenvHome, 'cache'),
    cleanup() {
      fs.rmSync(cenvHome, { recursive: true, force: true })
    },
  }
}

/**
 * Creates a temp directory with a pre-written env.yaml for config tests.
 */
export function createTempEnvDir(yaml: string): {
  envDir: string
  cleanup: () => void
} {
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenv-env-test-'))
  fs.writeFileSync(path.join(envDir, 'env.yaml'), yaml, 'utf8')
  return {
    envDir,
    cleanup() {
      fs.rmSync(envDir, { recursive: true, force: true })
    },
  }
}
