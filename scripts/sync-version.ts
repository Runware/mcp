import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..')
const pkg = JSON.parse(await Bun.file(resolve(ROOT, 'package.json')).text())
const target = resolve(ROOT, 'src/version.ts')

const content = `/**
 * MCP package version, generated from package.json by scripts/sync-version.ts.
 *
 * Do not edit by hand — it is regenerated on \`build\`. Used to identify this
 * server in the User-Agent sent to the Runware API.
 */
export const MCP_VERSION = '${pkg.version}'
`

const current = await Bun.file(target).text().catch(() => '')
if (current === content) {
  console.log(`MCP_VERSION already ${pkg.version} (src/version.ts up to date)`)
} else {
  await Bun.write(target, content)
  console.log(`Synced MCP_VERSION = ${pkg.version} → src/version.ts`)
}
