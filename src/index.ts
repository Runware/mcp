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
import { isRunwareError } from '@runware/sdk'
import { getClient, disconnectClient } from './config.js'
import { formatResults } from './formatters.js'
import { getModelSchema, getAvailableModels } from './schema-registry.js'

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
      'Search the full Runware model database — including community fine-tunes from Civitai, '
      + 'custom-trained models, and curated models. Returns model names, AIR identifiers, '
      + 'architecture, and capabilities. Use this when looking for a specific style, fine-tune, '
      + 'or non-curated model. For just the curated set, list_models is faster.',
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
      'List the AIR identifiers of curated models — the canonical, officially supported '
      + 'set that Runware maintains schemas for. Fast and lightweight, but does NOT include '
      + 'community fine-tunes. For broader discovery (Civitai uploads, custom-trained models, '
      + 'specific architectures like Pony or anime variants), use model_search instead.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

/**
 * Recursively coerce numeric strings to numbers and "true"/"false" to booleans.
 * The `run` tool's inputSchema declares only `model` with a type; everything
 * else comes via `additionalProperties: true`. MCP clients (Claude, Cursor)
 * serialize untyped props as strings, so "width": 1024 arrives here as "1024"
 * and the Runware API rejects it. Coerce at the boundary instead of enumerating
 * every param of every model in the schema. Recurses into nested objects and
 * arrays so model-specific shapes (e.g. `ipAdapters: [{ strength: "0.5" }]`)
 * get their inner values coerced too.
 */
const coerceTypes = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (/^-?\d+$/.test(value)) { return parseInt(value, 10) }
    if (/^-?\d+\.\d+$/.test(value)) { return parseFloat(value) }
    if (value === 'true') { return true }
    if (value === 'false') { return false }
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
        const models = results as Record<string, unknown>[]
        const formatted = models.map((m) => {
          const parts: string[] = []
          if (m.modelName) { parts.push(`Name: ${m.modelName}`) }
          if (m.air) { parts.push(`AIR: ${m.air}`) }
          if (m.architecture) { parts.push(`Architecture: ${m.architecture}`) }
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
        const models = await getAvailableModels()
        return { content: [{ type: 'text', text: `Available models (${models.length}):\n\n${models.join('\n')}` }] }
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
