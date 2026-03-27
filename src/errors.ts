export class CenvError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = 'CenvError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ConfigError extends CenvError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR')
    this.name = 'ConfigError'
  }
}

export class EnvironmentNotFoundError extends CenvError {
  constructor(public readonly envName: string, suggestions?: string[]) {
    const hint = suggestions?.length
      ? `\n  Did you mean: ${suggestions.join(', ')}?`
      : ''
    super(`Environment "${envName}" not found.${hint}`, 'ENV_NOT_FOUND')
    this.name = 'EnvironmentNotFoundError'
  }
}

export class AuthError extends CenvError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR')
    this.name = 'AuthError'
  }
}

export class TrustError extends CenvError {
  constructor(public readonly envPath: string) {
    super(
      `Environment at "${envPath}" is not trusted. Run \`cenv allow\` to trust it.`,
      'TRUST_ERROR'
    )
    this.name = 'TrustError'
  }
}

export class KeychainError extends CenvError {
  constructor(message: string) {
    super(message, 'KEYCHAIN_ERROR')
    this.name = 'KeychainError'
  }
}
