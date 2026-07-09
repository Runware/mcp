import { describe, it, expect } from 'bun:test'

import { versionTsContent, bumpServerJsonVersion } from '../scripts/sync-version'

describe('versionTsContent', () => {
  it('emits the MCP_VERSION constant for the given version', () => {
    expect(versionTsContent('9.9.9')).toContain('export const MCP_VERSION = \'9.9.9\'')
  })
})

describe('bumpServerJsonVersion', () => {
  const server = JSON.stringify({
    name: 'io.github.Runware/mcp',
    description: 'x',
    version: '1.2.3',
    packages: [{ registryType: 'npm', identifier: '@runware/mcp', version: '1.2.3' }],
  }, null, 2)

  it('rewrites both the top-level and package version fields', () => {
    const parsed = JSON.parse(bumpServerJsonVersion(server, '1.2.4'))
    expect(parsed.version).toBe('1.2.4')
    expect(parsed.packages[0].version).toBe('1.2.4')
  })

  it('leaves every non-version field untouched', () => {
    const parsed = JSON.parse(bumpServerJsonVersion(server, '1.2.4'))
    expect(parsed.name).toBe('io.github.Runware/mcp')
    expect(parsed.packages[0].identifier).toBe('@runware/mcp')
    expect(parsed.packages[0].registryType).toBe('npm')
  })

  it('is a no-op when the version already matches (idempotent)', () => {
    const already = bumpServerJsonVersion(server, '1.2.3')
    expect(already).toBe(server)
  })
})
