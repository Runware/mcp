# Runware MCP

MCP server that gives AI agents (Claude, Cursor, Codex, etc.) access to the full Runware API — image generation, video generation, audio generation, 3D, upscaling, background removal, captioning, and more.

## Install

Pick one — `npx` is simplest, global install is faster on repeat use.

```bash
# Use directly with npx (no install)
npx -y @runware/mcp

# Or install globally
npm install -g @runware/mcp
```

## Connect

Get an API key at [runware.ai](https://runware.ai). Then point your agent at the MCP.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "runware": {
      "command": "npx",
      "args": ["-y", "@runware/mcp"],
      "env": {
        "RUNWARE_API_KEY": "your-api-key"
      }
    }
  }
}
```

If you installed globally:

```json
{
  "mcpServers": {
    "runware": {
      "command": "runware-mcp",
      "env": {
        "RUNWARE_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Cursor

Settings → MCP → Add server — same config as above.

### Codex

Add to your MCP configuration with the same command and env.

## What agents can do

Once connected, the agent has eight tools:

### `run`

The main inference tool. Pass a model AIR identifier and task-specific parameters. The task type is resolved automatically from the model.

```json
{
  "model": "runware:400@1",
  "positivePrompt": "a serene mountain landscape at sunset",
  "width": 1024,
  "height": 1024
}
```

Supports all Runware task types: image, video, audio, text, 3D, upscaling, background removal, captioning, and more.

Parameters are validated against the model's schema before submission. If the agent passes an invalid value (out-of-range, wrong type, missing required field), the tool returns a structured error identifying the bad parameter — no API round-trip wasted.

### `model_schema`

Get the parameter schema for a specific model. **The agent should always call this before using a model for the first time** to discover required and optional parameters.

```json
{ "model": "runware:400@1" }
```

Returns the full JSON Schema with property types, descriptions, defaults, and constraints.

### `list_models`

List the AIR identifiers of curated models — the canonical, officially supported set. Fast and lightweight, but does not include community fine-tunes (use `model_search` for those).

### `model_search`

Search the full Runware model database — curated models plus community fine-tunes from Civitai, custom-trained models, etc. Returns names, AIRs, architecture, and capabilities. Use when looking for a specific style, fine-tune, or non-curated model.

### `image_upload`

Upload an image for use as input in subsequent generation tasks. Accepts a URL, data URI, or base64-encoded image. Returns an image UUID.

### `model_upload`

Upload a custom model to Runware. Provide the model AIR and a download URL for the weights.

### `account`

Retrieve account information including balance and usage.

### `get_task_details`

Retrieve the original request and response for a previously executed task. Useful for recovering past results.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `RUNWARE_API_KEY` | Yes | Your Runware API key |

## Development

```bash
# Run directly (no build step)
npm run dev

# Build
npm run build

# Test
npm test

# Lint
npm run lint

# Smoke-test the stdio protocol
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | RUNWARE_API_KEY=your-key node dist/index.js

# Or use the MCP Inspector for a UI
npx @modelcontextprotocol/inspector node dist/index.js
```
