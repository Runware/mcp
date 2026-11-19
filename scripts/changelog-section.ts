import { resolve } from 'node:path'

/**
 * The body under `## <version>` in a changelog, or null when that heading is
 * absent. The release workflow feeds this to `gh release create`, and a test
 * pins package.json's version to a section here, so a bump with no entry fails
 * CI rather than publishing a release whose body is empty.
 */
export const section = (changelog: string, version: string): string | null => {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const heading = new RegExp(`^## ${escaped}\\s*$`, 'm')
  const start = heading.exec(changelog)
  if (start === null) {
    return null
  }
  const rest = changelog.slice(start.index + start[0].length)
  const following = /^## /m.exec(rest)
  return (following === null ? rest : rest.slice(0, following.index)).trim()
}

if (import.meta.main) {
  const version = Bun.argv[2]
  if (version === undefined) {
    console.error('usage: bun run scripts/changelog-section.ts <version>')
    process.exit(2)
  }
  const ROOT = resolve(import.meta.dir, '..')
  const body = section(await Bun.file(resolve(ROOT, 'CHANGELOG.md')).text(), version)
  if (body === null || body === '') {
    console.error(`CHANGELOG.md has no '## ${version}' section.`)
    process.exit(1)
  }
  console.log(body)
}
