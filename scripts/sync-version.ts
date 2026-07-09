import { resolve } from 'node:path'

/** Contents of `src/version.ts` for a given package version. */
export const versionTsContent = (version: string): string => `/**
 * MCP package version, generated from package.json by scripts/sync-version.ts.
 *
 * Do not edit by hand — it is regenerated on \`build\`. Used to identify this
 * server in the User-Agent sent to the Runware API.
 */
export const MCP_VERSION = '${version}'
`

/**
 * Rewrite every `"version"` field in server.json (top-level + each package) to
 * `version`. The MCP Registry requires server.json's version to match the
 * published npm version, so this keeps them in lockstep on every build.
 */
export const bumpServerJsonVersion = (text: string, version: string): string =>
  text.replace(/"version":\s*"[^"]*"/g, `"version": "${version}"`)

if (import.meta.main) {
  const ROOT = resolve(import.meta.dir, '..')
  const pkg = JSON.parse(await Bun.file(resolve(ROOT, 'package.json')).text())
  const version = String(pkg.version)

  // src/version.ts — fully generated, baked into the build for the User-Agent.
  const versionTs = resolve(ROOT, 'src/version.ts')
  const generated = versionTsContent(version)
  const currentTs = await Bun.file(versionTs).text().catch(() => '')
  if (currentTs === generated) {
    console.log(`MCP_VERSION already ${version} (src/version.ts up to date)`)
  } else {
    await Bun.write(versionTs, generated)
    console.log(`Synced MCP_VERSION = ${version} → src/version.ts`)
  }

  // server.json — MCP Registry metadata; only the version fields are touched.
  const serverJson = resolve(ROOT, 'server.json')
  const currentServer = await Bun.file(serverJson).text().catch(() => '')
  if (!currentServer) {
    console.log('server.json not found — skipping registry version sync')
  } else {
    const updated = bumpServerJsonVersion(currentServer, version)
    if (updated === currentServer) {
      console.log(`server.json already at ${version}`)
    } else {
      await Bun.write(serverJson, updated)
      console.log(`Synced version ${version} → server.json`)
    }
  }
}
