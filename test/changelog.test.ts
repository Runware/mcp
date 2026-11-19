import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'

import { section } from '../scripts/changelog-section'

const ROOT = resolve(import.meta.dir, '..')

describe('section', () => {
  it('returns null for a version the changelog does not carry', () => {
    expect(section('# Changelog\n\n## 1.0.0\n\nfirst\n', '2.0.0')).toBeNull()
  })

  it('stops at the next version heading', () => {
    const changelog = '# Changelog\n\n## 2.0.0\n\nsecond\n\n## 1.0.0\n\nfirst\n'
    expect(section(changelog, '2.0.0')).toBe('second')
    expect(section(changelog, '1.0.0')).toBe('first')
  })

  it('does not let a version read as a regex', () => {
    expect(section('# Changelog\n\n## 1.0.0\n\nfirst\n', '1x0x0')).toBeNull()
  })
})

describe('the changelog', () => {
  it('has an entry for the version being published', async () => {
    // The release notes come from this section, so a bump without an entry has
    // to fail here rather than publish a release with an empty body.
    const pkg = JSON.parse(await Bun.file(resolve(ROOT, 'package.json')).text())
    const version = String(pkg.version)
    const body = section(await Bun.file(resolve(ROOT, 'CHANGELOG.md')).text(), version)
    expect(body, `CHANGELOG.md has no '## ${version}' section`).not.toBeNull()
    expect(body).not.toBe('')
  })
})
