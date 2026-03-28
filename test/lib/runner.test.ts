import { describe, test, expect } from 'bun:test'
import { findClaudeBinary } from '../../src/lib/runner'

describe('findClaudeBinary', () => {
  test('returns a string', () => {
    const result = findClaudeBinary()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  test('accepts realHome parameter', () => {
    const result = findClaudeBinary('/nonexistent')
    // Should still return something (falls back to which/PATH)
    expect(typeof result).toBe('string')
  })

  test('finds claude in .local/bin when it exists', () => {
    const home = process.env.HOME ?? ''
    const result = findClaudeBinary(home)
    // On this machine claude should be found
    expect(result).toContain('claude')
  })
})
