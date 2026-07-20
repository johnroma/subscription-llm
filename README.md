# subscription-llm

Local HTTP service for Codex subscription-based chat/vision with structured output. Optimized for lightweight models to minimize OpenAI subscription token usage.

## Features

- **Vision + Structured Output**: Send images and get back structured JSON using Codex's `--output-schema`
- **Token-Optimized Models**: Defaults to `gpt-4.1-mini` (~100x cheaper than GPT-4.1) for flight data extraction
- **OpenAI-Compatible**: `/v1/chat/completions` endpoint matches OpenAI's API contract
- **Concurrent Request Management**: Configurable concurrency limits for subscription budget control
- **Multiple Model Support**: Works with GPT-4.1-mini, GPT-4o-mini, Gemini 2.5 Flash, etc.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start the service
pnpm dev

# Production build
pnpm build && pnpm start
```

The server starts on `http://127.0.0.1:8789` by default.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `127.0.0.1` | Server host (use loopback for no auth) |
| `PORT` | `8789` | Server port |
| `SUBSCRIPTION_LLM_TOKEN` | - | Optional Bearer token for non-loopback hosts |
| `CODEX_BIN` | `codex` | Path to Codex CLI executable |
| `DEFAULT_MODEL` | `gpt-4.1-mini` | Default model to use |
| `ALLOWED_MODELS` | `gpt-4.1-mini,gpt-4o-mini,gemini-2.5-flash-exp` | Allowed models |
| `MAX_CONCURRENT_REQUESTS` | `8` | Max concurrent requests |
| `REQUEST_TIMEOUT_MS` | `120000` | Request timeout (2 minutes) |

## Usage

### Chat Completion with Vision and Structured Output

```bash
curl -X POST http://127.0.0.1:8789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      {
        "role": "system",
        "content": "Extract structured flight data from this screenshot. Return only JSON."
      },
      {
        "role": "user",
        "content": [
          { "type": "text", "text": "Analyze this flight booking:" },
          {
            "type": "image",
            "image": {
              "data": "<base64-encoded-image>",
              "mimeType": "image/png"
            }
          }
        ]
      }
    ],
    "outputSchema": {
      "type": "object",
      "properties": {
        "origin": { "type": "string" },
        "destination": { "type": "string" },
        "date": { "type": "string" },
        "price": { "type": "number" }
      },
      "required": ["origin", "destination", "date", "price"]
    }
  }'
```

### Response

```json
{
  "id": "chatcmpl-1234567890",
  "model": "gpt-4.1-mini",
  "provider": "codex",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\n  \"origin\": \"JFK\",\n  \"destination\": \"LAX\",\n  \"date\": \"2026-01-15\",\n  \"price\": 450\n}"
      },
      "finishReason": "stop"
    }
  ],
  "usage": {
    "promptTokens": 1250,
    "completionTokens": 45,
    "totalTokens": 1295
  },
  "created": 1737321600,
  "processingTimeMs": 3240
}
```

## Model Recommendations

### For Flight Screenshot Extraction

| Model | Vision Quality | Token Cost | Recommended? |
|-------|---------------|-------------|---------------|
| `gpt-4.1-mini` | Excellent | ~100x cheaper than GPT-4.1 | ✅ **Default** |
| `gpt-4o-mini` | Very Good | ~100x cheaper than GPT-4o | ✅ Faster alternative |
| `gemini-2.5-flash-exp` | Good | Competitive | ⚠️ May need prompt adjustments |

### General Guidelines

- Use `gpt-4.1-mini` for best accuracy/cost balance
- Use `gpt-4o-mini` if you need faster responses
- Keep prompts concise to save tokens
- Use `outputSchema` for structured output (Codex handles this via `--output-schema`)

## Integration with wc-flight-reader

```html
<flight-reader 
  provider="openai"
  proxy-url="http://127.0.0.1:8789/v1/chat/completions"
></flight-reader>
```

Set `apiKey` on the component (can be a dummy value when using proxy mode).

## Development

```bash
# Type check
pnpm typecheck

# Development with hot reload
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

## Architecture

```
wc-flight-reader (or any client)
  → HTTP POST /v1/chat/completions
  → subscription-llm (this service)
    → codex exec --json --output-schema schema.json --image ...
      → Codex CLI (subscription)
      → OpenAI/Gemini API (via subscription)
    → Parse response and return structured JSON
```

## Why This Service?

1. **Subscription Budget Control**: Centralize all Codex subscription usage with concurrency limits
2. **Token Optimization**: Default to lightweight models (gpt-4.1-mini) instead of full models
3. **Structured Output**: Use Codex's `--output-schema` for reliable JSON responses
4. **Multi-Project Use**: Any project can use this service for vision + structured output
5. **OpenAI Compatibility**: Drop-in replacement for OpenAI's chat completions API

## License

MIT
