import {
  describe, it, expect, beforeEach, afterEach,
} from 'bun:test'

import { getModelSchema, clearSchemaCache } from '../src/schema-registry'

const originalFetch = globalThis.fetch

describe('schema-registry live-fetch behavior', () => {
  beforeEach(() => {
    clearSchemaCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('getModelSchema', () => {
    it('returns the cleaned schema from /resolve/{id}', async () => {
      const fakeSchema = {
        type: 'object',
        properties: {
          taskType: { const: 'imageInference' },
          taskUUID: { type: 'string' },
          positivePrompt: { type: 'string' },
          width: { type: 'integer' },
        },
        required: ['taskType', 'taskUUID', 'positivePrompt'],
      }

      globalThis.fetch = (async (url: string) => {
        if (url.includes('/resolve/')) {
          return new Response(JSON.stringify({
            requestSchema: fakeSchema,
            responseSchema: null,
          }))
        }
        return new Response('not found', { status: 404 })
      }) as any

      const schema = await getModelSchema('runware:101@1')
      expect(schema).not.toBeNull()
      // Internal fields stripped
      expect((schema as any).properties.taskType).toBeUndefined()
      expect((schema as any).properties.taskUUID).toBeUndefined()
      // User-facing fields preserved
      expect((schema as any).properties.positivePrompt).toBeDefined()
      // Required list filters out taskType/taskUUID
      expect((schema as any).required).not.toContain('taskType')
      expect((schema as any).required).not.toContain('taskUUID')
      expect((schema as any).required).toContain('positivePrompt')
    })

    it('returns null when fetch throws', async () => {
      globalThis.fetch = (async () => { throw new Error('network down') }) as any
      const schema = await getModelSchema('runware:101@1')
      expect(schema).toBeNull()
    })

    it('returns null when /resolve returns 404', async () => {
      globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any
      const schema = await getModelSchema('definitely-not-a-real-model-id')
      expect(schema).toBeNull()
    })
  })
})
