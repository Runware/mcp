/**
 * Schema registry — model AIRs and their JSON Schemas, fetched live from the
 * Runware schemas service. Cached in-process for 5 minutes (matches the
 * upstream Cache-Control max-age) so repeat calls within a short window don't
 * round-trip.
 *
 * Curated model listings (`getAvailableModels`) come from the Runware content
 * service, which carries the metadata agents need to pick a model
 * (name, headline, capabilities, pricing).
 */

const SCHEMAS_BASE_URL = 'https://schemas.runware.ai'
const CONTENT_BASE_URL = 'https://content.runware.ai'

type ModelSchema = Record<string, unknown>

type CuratedModel = {
  air: string
  name: string
  headline?: string
  capabilities?: string[]
  pricingOverview?: string
}

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

const fetchCuratedModels = async (): Promise<CuratedModel[] | null> => {
  try {
    const response = await fetch(`${CONTENT_BASE_URL}/models`)
    if (!response.ok) { return null }
    const items = await response.json() as Array<Record<string, unknown>>
    return items
      .map((model): CuratedModel => {
        const headline = model.headline as string | undefined
        const capabilities = model.capabilities as string[] | undefined
        const pricingOverview = model.pricingOverview as string | undefined
        return {
          air: model.air as string,
          name: model.name as string,
          ...(headline ? { headline } : {}),
          ...(capabilities ? { capabilities } : {}),
          ...(pricingOverview ? { pricingOverview } : {}),
        }
      })
      .filter((m) => (m.air && m.name))
  } catch {
    return null
  }
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
let curatedCache: { models: CuratedModel[], expires: number } | null = null
const schemaCache = new Map<string, { schema: ModelSchema, expires: number }>()

export const clearSchemaCache = (): void => {
  curatedCache = null
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

export const getAvailableModels = async (): Promise<CuratedModel[]> => {
  if (curatedCache && Date.now() < curatedCache.expires) {
    return curatedCache.models
  }

  const models = await fetchCuratedModels()
  if (!models) { return [] }

  const sorted = [...models].sort((a, b) => a.name.localeCompare(b.name))
  curatedCache = { models: sorted, expires: Date.now() + TTL_MS }
  return sorted
}
