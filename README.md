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

## How to use it

Once connected, just talk to your agent. It picks the right tool, picks the right model, and fills in the parameters.

- *"Generate an image of a cat in a forest"*
- *"What models do you have for video generation?"*
- *"Upscale https://example.com/photo.jpg by 4x"*
- *"Show me my account balance"*
- *"Find me a Civitai LoRA for anime style"*

The agent figures out which model fits, what parameters to pass, and how to interpret the response. Parameters are validated against each model's schema before submission, so the agent gets fast feedback when it picks wrong values.

## Tools the agent has access to

You don't call these directly — the agent does, based on what you ask for.

- `run` — execute any Runware inference task (image, video, audio, 3D, upscaling, captioning, etc.) on a given model
- `model_schema` — fetch the parameter schema for a specific model
- `list_models` — list Runware's official, curated model integrations (supports `capability`, `category`, `creator`, `search` filters)
- `model_details` — get full metadata for a curated model by AIR
- `model_examples` — get sample input/output pairs for a curated model
- `model_pricing` — get pricing overview + per-configuration examples for a curated model
- `list_capabilities` — list every model capability (e.g. `io:text-to-image`, `op:upscale`) with labels
- `model_search` — search the community model catalog (Civitai fine-tunes, custom uploads)
- `image_upload` — upload an image to use as input
- `model_upload` — upload a custom model
- `account` — retrieve account information including balance and usage
- `get_task_details` — retrieve the original request and response for a previous task

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
