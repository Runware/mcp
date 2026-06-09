/**
 * Schema registry — fetches model JSON Schemas live from the Runware schemas
 * service. Cached in-process for 5 minutes (matches the upstream
 * Cache-Control max-age) so repeat calls within a short window don't
 * round-trip.
 */

const SCHEMAS_BASE_URL = 'https://schemas.runware.ai'

type ModelSchema = Record<string, unknown>

type ResolvePayload = {
  requestSchema: ModelSchema
  responseSchema: ModelSchema | null
}

const INTERNAL_FIELDS = [
  'taskType',
  'taskUUID',
  'webhookURL',
  'deliveryMethod',
]

const cleanSchemaForAgent = (schema: ModelSchema): ModelSchema => {
  const clone = { ...schema }

  if (clone.properties && typeof clone.properties === 'object') {
    const props = { ...(clone.properties as Record<string, unknown>) }
    for (const field of INTERNAL_FIELDS) {
      delete props[field]
    }
    clone.properties = props
  }

  if (Array.isArray(clone.required)) {
    const isRequired = (r: string) => !['taskType', 'taskUUID'].includes(r)
    clone.required = (clone.required as string[]).filter(isRequired)
  }

  delete clone.$schema
  delete clone.$id

  return clone
}

const fetchResolve = async (id: string): Promise<ResolvePayload | null> => {
  try {
    const response = await fetch(`${SCHEMAS_BASE_URL}/resolve/${encodeURIComponent(id)}`)
    if (!response.ok) { return null }
    return await response.json() as ResolvePayload
  } catch {
    return null
  }
}

const TTL_MS = 5 * 60 * 1000
const schemaCache = new Map<string, { schema: ModelSchema, expires: number }>()

export const clearSchemaCache = (): void => {
  schemaCache.clear()
}

export const getModelSchema = async (id: string): Promise<ModelSchema | null> => {
  const cached = schemaCache.get(id)
  if (cached && Date.now() < cached.expires) {
    return cached.schema
  }

  const fresh = await fetchResolve(id)
  if (!fresh?.requestSchema) { return null }

  const schema = cleanSchemaForAgent(fresh.requestSchema)
  schemaCache.set(id, { schema, expires: Date.now() + TTL_MS })
  return schema
}
