# subscription-llm

A local HTTP service that routes vision and structured-output requests through an authenticated Codex CLI session. It is intended for personal, local use by projects such as `wc-flight-reader`.

> Codex ChatGPT accounts select the model automatically. Supplying API model IDs such as `gpt-4.1-mini` or `gpt-4o-mini` is not supported by those accounts, so omit `model` unless your Codex account supports explicit model selection.

## Quick start

```bash
bun install
bun dev
```

The service listens on `http://127.0.0.1:8789` by default.

## API

### `POST /v1/chat/completions`

The endpoint accepts text and base64-encoded images. `outputSchema` is JSON Schema; object schemas are normalized for Codex strict structured output automatically.

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Extract the flight itinerary." },
        {
          "type": "image",
          "image": {
            "data": "<base64 image bytes>",
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
      "destination": { "type": "string" }
    },
    "required": ["origin", "destination"]
  }
}
```

The result is shaped like:

```json
{
  "choices": [{
    "message": { "role": "assistant", "content": "{...valid JSON...}" }
  }],
  "usage": {
    "promptTokens": 14363,
    "completionTokens": 200,
    "totalTokens": 14563
  }
}
```

`usage` is read from Codex's `turn.completed` event when available. It includes the true input usage reported by Codex (including image/context tokens), not a character-count estimate.

### Other endpoints

- `GET /health`
- `GET /v1/models`

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address. Keep loopback unless protected with a token. |
| `PORT` | `8789` | Bind port. |
| `SUBSCRIPTION_LLM_TOKEN` | — | Optional Bearer token. Required for non-loopback deployments. |
| `CODEX_BIN` | `codex` | Path to Codex CLI. |
| `DEFAULT_MODEL` | empty | Empty means use Codex's account default. |
| `MAX_CONCURRENT_REQUESTS` | `8` | Maximum Codex processes. |
| `REQUEST_TIMEOUT_MS` | `120000` | Per-request timeout. |

CORS is enabled because a local browser application normally runs on a different localhost port than this service. Keep the default loopback host for local-only use.

## Test result

An Emirates ARN → DXB → SIN itinerary screenshot was extracted successfully using the complete `FlightItinerary` schema. Codex reported **14,363 input tokens** and **200 output tokens** for that request. The image itself did not display a price, so consumers should treat any model-supplied price as untrusted unless it is visibly present.

## Development

```bash
bun run typecheck
bun run build
```

## License

MIT
