/**
 * SDK client factory.
 *
 * Reads RUNWARE_API_KEY from the environment and exposes a lazily-connected
 * Runware client.  The connection is established on the first tool call,
 * not at MCP server startup — so startup stays fast and a missing key is
 * surfaced only when actually needed.
 */

import { createClient, type RunwareClient } from '@runware/sdk'

import { MCP_VERSION } from './version'

let client: RunwareClient | null = null

export const getClient = async (): Promise<RunwareClient> => {
  if (client) { return client }

  const apiKey = process.env.RUNWARE_API_KEY
  if (!apiKey) {
    const msg = 'RUNWARE_API_KEY environment variable is required. '
      + 'Set it before starting the MCP server.'
    throw new Error(msg)
  }

  client = await createClient({ apiKey, userAgentPrefix: `runware-mcp/${MCP_VERSION}` })
  await client.connect()
  return client
}

export const disconnectClient = async (): Promise<void> => {
  if (client) {
    await client.disconnect()
    client = null
  }
}
