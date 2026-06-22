#!/usr/bin/env node

/**
 * Runware MCP Server
 *
 * Exposes all Runware API capabilities as MCP tools for AI agents.
 * Uses the Runware SDK 2.0 for API communication over WebSocket.
 *
 * Uses the low-level Server class (not McpServer) because the `run` tool
 * needs `additionalProperties: true` — the high-level McpServer strips
 * unknown keys via Zod, which breaks passthrough of task parameters.
 *
 * Usage:
 *   RUNWARE_API_KEY=your-key node dist/index.js
 *
 * Or in Claude Desktop / Cursor config:
 *   {
 *     "mcpServers": {
 *       "runware": {
 *         "command": "node",
 *         "args": ["/path/to/dist/index.js"],
 *         "env": { "RUNWARE_API_KEY": "your-key" }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { isRunwareError, type ListModelsOptions } from '@runware/sdk'
import { getClient, disconnectClient } from './config.js'
import { formatResults } from './formatters.js'
import { getModelSchema } from './schema-registry.js'

type ToolResponse = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}

const formatError = (error: unknown): ToolResponse => {
  if (isRunwareError(error)) {
    const lines = [`[${error.code}] ${error.message}`]
    if (error.parameter) { lines.push(`Parameter: ${error.parameter}`) }
    if (error.taskType) { lines.push(`Task: ${error.taskType}`) }
    if (error.documentation) { lines.push(`Docs: ${error.documentation}`) }
    return { content: [{ type: 'text', text: lines.join('\n') }], isError: true }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

const log = (message: string, data?: unknown): void => {
  const timestamp = new Date().toISOString()
  const line = data !== undefined
    ? `[runware-mcp ${timestamp}] ${message} ${JSON.stringify(data)}`
    : `[runware-mcp ${timestamp}] ${message}`
  process.stderr.write(line + '\n')
}

const tools = [
  {
    name: 'run',
    description:
      'Run an AI inference task on Runware. Supports image generation, video generation, '
      + 'audio generation, 3D generation, upscaling, background removal, captioning, and more. '
      + 'Pass a model AIR identifier and task-specific parameters. '
      + 'Example: { "model": "runware:400@1", "positivePrompt": "a cat", "width": 1024, "height": 1024 }',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: {
          type: 'string',
          description: 'Model AIR identifier (e.g., "runware:400@1" for image, "google:3@3" for video, "google:gemma@4-31b" for LLM)',
        },
      },
      required: ['model'],
      additionalProperties: {
        type: [
          'string',
          'number',
          'integer',
          'boolean',
          'array',
          'object',
        ],
      },
    },
  },
  {
    name: 'model_search',
    description:
      'Search Runware\'s Civitai mirror and community-uploaded models — third-party '
      + 'fine-tunes, user uploads, style LoRAs, custom checkpoints. ONLY use this '
      + 'AFTER list_models has been checked and the user\'s named model is not in the '
      + 'curated catalog, OR when the user explicitly asks for a Civitai or community '
      + 'model. Do NOT use this for first-party models like FLUX, SDXL, Veo, Imagen, '
      + 'Gemma, Wan, Z-Image — those live in list_models.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search query (name, description, or AIR ID)' },
        category: {
          type: 'string',
          enum: [
            'checkpoint',
            'lora',
            'lycoris',
            'vae',
            'embeddings',
          ],
          description: 'Filter by model category',
        },
        type: {
          type: 'string',
          enum: ['base', 'inpainting', 'refiner'],
          description: 'Filter checkpoints by type (only when category=checkpoint)',
        },
        architecture: { type: 'string', description: 'Filter by architecture (e.g. "flux-1-dev", "sdxl")' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags',
        },
      },
      required: ['search'],
    },
  },
  {
    name: 'image_upload',
    description:
      'Upload an image to Runware for use as input in subsequent generation tasks. '
      + 'Returns an image UUID that can be used as seedImage, maskImage, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        image: {
          type: 'string',
          description: 'URL, data URI, or base64 of the image to upload',
        },
      },
      required: ['image'],
    },
  },
  {
    name: 'model_upload',
    description:
      'Upload a custom AI model to Runware (checkpoint, LoRA, VAE, embeddings, etc.). '
      + 'Returns the AIR identifier once the upload completes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: [
            'checkpoint',
            'lora',
            'lycoris',
            'vae',
            'embeddings',
          ],
          description: 'Model category',
        },
        architecture: { type: 'string', description: 'Model architecture (e.g. "flux-1-dev", "sdxl")' },
        format: {
          type: 'string',
          enum: ['safetensors'],
          description: 'Weight file format',
        },
        name: { type: 'string', description: 'Display name for the model' },
        version: { type: 'string', description: 'Model version' },
        downloadURL: { type: 'string', description: 'URL where the model weights can be downloaded from' },
        air: { type: 'string', description: 'Optional AIR identifier (format: provider:model@version)' },
      },
      required: [
        'category',
        'architecture',
        'format',
        'name',
        'version',
        'downloadURL',
      ],
    },
  },
  {
    name: 'account',
    description: 'Retrieve Runware account information including balance and usage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation: {
          type: 'string',
          enum: ['getDetails'],
          description: 'Which account operation to perform. Currently only "getDetails" is supported.',
        },
        includeCost: {
          type: 'boolean',
          description: 'Include cost information',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'get_task_details',
    description:
      'Retrieve the original request and response for a previously executed task. '
      + 'Useful for recovering results or auditing past generations.',
    inputSchema: {
      type: 'object' as const,
      properties: { taskUUID: { type: 'string', description: 'UUID of the task to retrieve' } },
      required: ['taskUUID'],
    },
  },
  {
    name: 'model_schema',
    description:
      'Get the parameter schema for a specific model. Returns the JSON Schema describing '
      + 'all accepted parameters, their types, defaults, and constraints. '
      + 'ALWAYS call this before calling run() with a model you haven\'t used before, '
      + 'so you know what parameters to pass.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: {
          type: 'string',
          description: 'Model AIR identifier (e.g., "runware:400@1", "google:3@3", "google:gemma@4-31b")',
        },
      },
      required: ['model'],
    },
  },
  {
    name: 'list_models',
    description:
      'List Runware\'s official, curated model integrations. Returns each model\'s '
      + 'name, AIR identifier, headline (one-line description), capabilities, and '
      + 'pricing — a human-readable catalog. '
      + 'Call this FIRST whenever the user names or asks about a model that could '
      + 'be first-party (e.g. "FLUX 2 dev", "SDXL", "Veo 3", "Gemma", "Wan 2.5", '
      + '"Z-Image"), and also for open-ended "what models are available?" questions. '
      + 'Match the user\'s named model against the returned names. '
      + 'Only fall through to model_search if no curated entry matches.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        capability: {
          type: 'string',
          description:
            'Optional capability filter (e.g. "io:text-to-image", "op:upscale"). '
            + 'Use list_capabilities first to discover valid ids.',
        },
        category: {
          type: 'string',
          enum: ['image',
            'video',
            'audio',
            'text',
            '3d'],
          description: 'Optional output-modality filter',
        },
        creator: { type: 'string', description: 'Optional creator id filter (e.g. "google", "alibaba")' },
        search: { type: 'string', description: 'Optional free-text search across name, AIR, creator, capabilities' },
      },
    },
  },
  {
    name: 'model_details',
    description:
      'Get the full curated metadata for a single Runware model by AIR identifier — '
      + 'name, headline, description, capabilities, creator, and cover image. Use this '
      + 'when the user wants more depth on a model already surfaced by list_models, '
      + 'or to confirm an AIR matches what the user named. For pricing, use model_pricing instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {air: { type: 'string', description: 'Model AIR identifier (e.g. "runware:400@1")' }},
      required: ['air'],
    },
  },
  {
    name: 'model_examples',
    description:
      'Get sample input/output examples for a curated Runware model. Useful when the '
      + 'user wants to see what a model produces, or to crib a working request shape '
      + 'before constructing a run() call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        air: { type: 'string', description: 'Model AIR identifier' },
        capability: {
          type: 'string',
          description: 'Optional capability filter (e.g. "io:text-to-image")',
        },
      },
      required: ['air'],
    },
  },
  {
    name: 'model_pricing',
    description:
      'Get pricing details for a curated Runware model — overview text plus example '
      + 'configurations with prices (e.g. "1024×1024 = $0.0032"). Use this when the '
      + 'user asks how much a specific model will cost.',
    inputSchema: {
      type: 'object' as const,
      properties: {air: { type: 'string', description: 'Model AIR identifier' }},
      required: ['air'],
    },
  },
  {
    name: 'list_capabilities',
    description:
      'List every model capability Runware supports, with their human-readable labels. '
      + 'Use this to discover the taxonomy (e.g. "io:text-to-image", "op:upscale") '
      + 'before filtering list_models by capability, or to answer "what can Runware do?".',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

/**
 * Recursively coerce stringified params back to their real JSON types: numeric
 * strings to numbers, "true"/"false" to booleans, and JSON-encoded arrays or
 * objects (e.g. the LLM `messages` array) back into arrays and objects.
 * The `run` tool's inputSchema declares only `model`, and every other param
 * comes via `additionalProperties`. MCP clients (Claude, Cursor) serialize
 * untyped props as strings, so "width": 1024 arrives here as "1024" and
 * "messages": [...] arrives as the JSON string "[...]", both of which the
 * Runware API rejects. Coerce at the boundary instead of enumerating every
 * param of every model in the schema. Recurses into nested objects and arrays
 * so model-specific shapes (e.g. `ipAdapters: [{ strength: "0.5" }]`) get their
 * inner values coerced too.
 */
const coerceTypes = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (/^-?\d+$/.test(value)) { return parseInt(value, 10) }
    if (/^-?\d+\.\d+$/.test(value)) { return parseFloat(value) }
    if (value === 'true') { return true }
    if (value === 'false') { return false }
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        // JSON.parse already restores inner types, so return as-is rather than
        // recursing: re-coercing would corrupt genuine string content such as an
        // LLM message whose text is "123", "true", or a JSON snippet.
        if (parsed !== null && typeof parsed === 'object') { return parsed }
      } catch { /* not JSON, treat as a plain string */ }
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => coerceTypes(item))
  }
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      output[k] = coerceTypes(v)
    }
    return output
  }
  return value
}

const handleToolCall = async (
  name: string,
  rawArgs: Record<string, unknown>,
): Promise<ToolResponse> => {
  const args = coerceTypes(rawArgs) as Record<string, unknown>
  log(`Tool called: ${name}`, args)

  try {
    const client = await getClient()

    switch (name) {
      case 'run': {
        const params = args as unknown as Parameters<typeof client.run>[0]
        const results = await client.run(params, { validate: true })
        log(`Run completed, ${(results as unknown[]).length} result(s)`)
        return { content: formatResults(results as Record<string, unknown>[]) }
      }

      case 'model_search': {
        const params = args as unknown as Parameters<typeof client.modelSearch>[0]
        const results = await client.modelSearch(params)
        const envelope = (results as Record<string, unknown>[])[0]
        const models = (envelope?.results as Record<string, unknown>[] | undefined) ?? []
        const formatted = models.map((model) => {
          const parts: string[] = []
          if (model.air) { parts.push(`AIR: ${model.air as string}`) }
          if (model.name) { parts.push(`Name: ${model.name as string}`) }
          if (model.version) { parts.push(`Version: ${model.version as string}`) }
          if (model.category) { parts.push(`Category: ${model.category as string}`) }
          if (model.architecture) { parts.push(`Architecture: ${model.architecture as string}`) }
          const tags = model.tags as string[] | undefined
          if (tags?.length) { parts.push(`Tags: ${tags.join(', ')}`) }
          return parts.join(' | ')
        })
        return {
          content: [{
            type: 'text',
            text: formatted.length > 0
              ? `Found ${formatted.length} model(s):\n\n${formatted.join('\n')}`
              : 'No models found.',
          }],
        }
      }

      case 'image_upload': {
        const params = args as unknown as Parameters<typeof client.imageUpload>[0]
        const results = await client.imageUpload(params)
        const result = (results as Record<string, unknown>[])[0]
        return { content: [{ type: 'text', text: `Image uploaded:\n\n${JSON.stringify(result, null, 2)}` }] }
      }

      case 'model_upload': {
        const params = args as unknown as Parameters<typeof client.modelUpload>[0]
        const results = await client.modelUpload(params)
        const result = (results as Record<string, unknown>[])[0]
        return { content: [{ type: 'text', text: `Model upload initiated:\n\n${JSON.stringify(result, null, 2)}` }] }
      }

      case 'account': {
        const params = args as unknown as Parameters<typeof client.accountManagement>[0]
        const results = await client.accountManagement(params)
        const result = (results as Record<string, unknown>[])[0]
        return { content: [{ type: 'text', text: `Account info:\n\n${JSON.stringify(result, null, 2)}` }] }
      }

      case 'get_task_details': {
        const params = args as unknown as Parameters<typeof client.getTaskDetails>[0]
        const results = await client.getTaskDetails(params)
        const result = (results as Record<string, unknown>[])[0]
        return { content: [{ type: 'text', text: `Task details:\n\n${JSON.stringify(result, null, 2)}` }] }
      }

      case 'model_schema': {
        const model = args.model as string
        const schema = await getModelSchema(model)
        if (!schema) {
          return {
            content: [{ type: 'text', text: `No schema found for model: ${model}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(schema, null, 2) }] }
      }

      case 'list_models': {
        // Pick only the filter fields we surface — including `paginate` from
        // ListModelsOptions confuses overload resolution between the array
        // and paginated return shapes. Conditional spread also keeps undefined
        // out of the object so exactOptionalPropertyTypes is happy.
        type Filters = Pick<ListModelsOptions, 'capability' | 'category' | 'creator' | 'search'>
        const opts: Filters = {}
        if (typeof args.capability === 'string') { opts.capability = args.capability }
        if (typeof args.category === 'string') {
          opts.category = args.category as NonNullable<ListModelsOptions['category']>
        }
        if (typeof args.creator === 'string') { opts.creator = args.creator }
        if (typeof args.search === 'string') { opts.search = args.search }
        const models = await client.content.listModels(opts)
        const formatted = models.map((model) => {
          const headline = model.headline ? ` — ${model.headline}` : ''
          const caps = model.capabilities?.length ? ` [${model.capabilities.join(', ')}]` : ''
          const pricing = model.pricingOverview ? ` — ${model.pricingOverview}` : ''
          return `${model.name} (${model.air})${headline}${caps}${pricing}`
        }).join('\n')
        return { content: [{ type: 'text', text: `Curated models (${models.length}):\n\n${formatted}` }] }
      }

      case 'model_details': {
        const air = args.air as string
        const models = await client.content.listModels()
        const model = models.find((entry) => entry.air === air)
        if (!model) {
          return {
            content: [{ type: 'text', text: `No curated model found for AIR: ${air}` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: JSON.stringify(model, null, 2) }] }
      }

      case 'model_examples': {
        const air = args.air as string
        const capability = args.capability as string | undefined
        const models = await client.content.listModels()
        const model = models.find((entry) => entry.air === air)
        if (!model) {
          return {
            content: [{ type: 'text', text: `No curated model found for AIR: ${air}` }],
            isError: true,
          }
        }
        const examples = await client.content.getModelExamples(
          model.model,
          capability ? { capability } : undefined,
        )
        if (examples.length === 0) {
          return { content: [{ type: 'text', text: `No examples found for ${model.name} (${air})` }] }
        }
        return {
          content: [{
            type: 'text',
            text: `Examples for ${model.name} (${air}):\n\n${JSON.stringify(examples, null, 2)}`,
          }],
        }
      }

      case 'model_pricing': {
        const air = args.air as string
        const models = await client.content.listModels()
        const model = models.find((entry) => entry.air === air)
        if (!model) {
          return {
            content: [{ type: 'text', text: `No curated model found for AIR: ${air}` }],
            isError: true,
          }
        }
        const pricing = await client.content.getModelPricing(model.model)
        if (!pricing) {
          return { content: [{ type: 'text', text: `No pricing info for ${model.name} (${air})` }] }
        }
        return {
          content: [{
            type: 'text',
            text: `Pricing for ${model.name} (${air}):\n\n${JSON.stringify(pricing, null, 2)}`,
          }],
        }
      }

      case 'list_capabilities': {
        const capabilities = await client.content.listCapabilities()
        const formatted = capabilities
          .map((capability) => `${capability.id.padEnd(28)} — ${capability.label}`)
          .join('\n')
        return {
          content: [{
            type: 'text',
            text: `Available capabilities (${capabilities.length}):\n\n${formatted}`,
          }],
        }
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`Tool error: ${name}`, message)
    return formatError(error)
  }
}

// Server is "soft-deprecated" in favor of McpServer, but McpServer strips
// unknown keys via Zod, which breaks the `run` tool's additionalProperties:true
// passthrough. The deprecation note itself allows Server for advanced cases.
const server = new Server(
  { name: 'runware', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  return handleToolCall(name, (args ?? {}) as Record<string, unknown>)
})

const start = async (): Promise<void> => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  log('Server started')
}

const shutdown = async (): Promise<void> => {
  log('Shutting down')
  await disconnectClient()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

start().catch((error) => {
  log('Failed to start', error)
  process.exit(1)
})
