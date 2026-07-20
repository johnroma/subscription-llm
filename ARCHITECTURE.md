# subscription-llm - Architecture & Integration

## Overview

`subscription-llm` is a lightweight HTTP service that proxies requests to the Codex CLI, providing:
- Chat completion with vision support
- Structured output via JSON Schema
- Token-optimized model defaults (gpt-4.1-mini)
- OpenAI-compatible API contract

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    wc-flight-reader                         │
│  (or any other client needing vision + structured output)   │
└───────────────────┬─────────────────────────────────────────┘
                    │ HTTP POST /v1/chat/completions
                    │ { messages, outputSchema, model }
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  subscription-llm (Port 8789)               │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  - Validates request & auth                        │  │
│  │  - Converts messages to Codex prompt               │  │
│  │  - Writes images to temp dir                       │  │
│  │  - Writes outputSchema to JSON file                │  │
│  └─────────────────┬───────────────────────────────────┘  │
│                    │                                      │
│                    │ codex exec --json --output-schema ...  │
│                    ▼                                      │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              Codex CLI Process                      │  │
│  │  - Runs with --ephemeral --ignore-user-config      │  │
│  │  - Uses configured model (default: gpt-4.1-mini)  │  │
│  │  - Calls OpenAI/Gemini via subscription            │  │
│  └─────────────────┬───────────────────────────────────┘  │
│                    │                                      │
│                    │ OpenAI/Gemini API (subscription)      │
│                    ▼                                      │
│  ┌─────────────────────────────────────────────────────┐  │
│  │         OpenAI GPT-4.1-mini (or configured)       │  │
│  │  - Analyzes image with vision                     │  │
│  │  - Extracts structured data                       │  │
│  │  - Returns JSON matching outputSchema             │  │
│  └─────────────────┬───────────────────────────────────┘  │
└────────────────────┼──────────────────────────────────────┘
                     │
                     │ JSON response
                     ▼
            ┌─────────────────┐
            │   wc-flight-   │
            │    reader       │
            └─────────────────┘
```

## Token Optimization

### Model Selection Strategy

| Use Case | Model | Reason |
|----------|-------|--------|
| **Default** | `gpt-4.1-mini` | ~100x cheaper than GPT-4.1, excellent vision |
| **Speed** | `gpt-4o-mini` | Faster multimodal, similar cost |
| **Alternative** | `gemini-2.5-flash-exp` | Competitive pricing, fast vision |

### Cost Comparison (Approximate)

| Model | Input Tokens/1K | Output Tokens/1K | Flight Screenshot (typical) |
|-------|------------------|-------------------|---------------------------|
| GPT-4.1 | $2.50 | $10.00 | ~$0.75-1.50 |
| **GPT-4.1-mini** | **$0.15** | **$0.60** | **~$0.05-0.10** |
| GPT-4o | $2.50 | $10.00 | ~$0.75-1.50 |
| **GPT-4o-mini** | **$0.15** | **$0.60** | **~$0.05-0.10** |

**Result:** Using `gpt-4.1-mini` saves ~90-95% on token costs for flight screenshot analysis.

## wc-flight-reader Integration

### Configuration

```html
<!-- In your HTML -->
<flight-reader 
  id="flightReader"
  provider="openai"
  proxy-url="http://127.0.0.1:8789/v1/chat/completions"
></flight-reader>

<script>
  const reader = document.getElementById('flightReader')
  // API key can be dummy when using proxy mode
  reader.apiKey = 'proxy'
</script>
```

### What Happens Under the Hood

1. **User drops flight screenshot** into `<flight-reader>`
2. **wc-flight-reader** converts image to base64
3. **wc-flight-reader** calls its `_buildAdapter()` which returns TanStack AI adapter
4. **TanStack AI adapter** makes HTTP POST to `proxy-url`:
   ```json
   {
     "model": "gpt-4.1-mini",
     "messages": [
       {
         "role": "user",
         "content": [
           { "type": "text", "text": "...prompt..." },
           { "type": "image", "image": { "data": "...base64...", "mimeType": "image/png" } }
         ]
       }
     ],
     "outputSchema": { ...FLIGHT_DATA_SCHEMA... }
   }
   ```
5. **subscription-llm** receives request, validates auth, calls `codex exec`
6. **Codex CLI** calls OpenAI GPT-4.1-mini with vision + structured output
7. **subscription-llm** parses response and returns structured JSON
8. **wc-flight-reader** dispatches `flight-data` event with itineraries

### Why This Works

- **TanStack AI** uses standard OpenAI chat completion API
- **subscription-llm** implements `/v1/chat/completions` with same contract
- **Codex** supports `--output-schema` for structured output
- Everything is compatible without changes to wc-flight-reader

## Deployment

### Development

```bash
cd ~/projects/subscription-llm.workspace/subscription-llm
pnpm install
pnpm dev
```

### Production

```bash
pnpm build
pnpm start
```

### Systemd Service (Optional)

```ini
# /etc/systemd/system/subscription-llm.service
[Unit]
Description=Subscription LLM Service
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/home/john/projects/subscription-llm.workspace/subscription-llm
Environment="NODE_ENV=production"
Environment="HOST=127.0.0.1"
Environment="PORT=8789"
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable subscription-llm
sudo systemctl start subscription-llm
sudo systemctl status subscription-llm
```

## Testing

### Health Check

```bash
curl http://127.0.0.1:8789/health
```

### List Models

```bash
curl http://127.0.0.1:8789/v1/models
```

### Test with Flight Screenshot

```bash
# Convert image to base64
BASE64=$(base64 -i flight-screenshot.png | tr -d '\n')

# Request structured extraction
curl -X POST http://127.0.0.1:8789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d "{
    \"model\": \"gpt-4.1-mini\",
    \"messages\": [
      {
        \"role\": \"system\",
        \"content\": \"Extract structured flight data. Return JSON only.\"
      },
      {
        \"role\": \"user\",
        \"content\": [
          { \"type\": \"text\", \"text\": \"Analyze this flight:\" },
          {
            \"type\": \"image\",
            \"image\": {
              \"data\": \"$BASE64\",
              \"mimeType\": \"image/png\"
            }
          }
        ]
      }
    ],
    \"outputSchema\": {
      \"type\": \"object\",
      \"properties\": {
        \"origin\": { \"type\": \"string\" },
        \"destination\": { \"type\": \"string\" }
      },
      \"required\": [\"origin\", \"destination\"]
    }
  }"
```

## Benefits

1. **Token Savings**: 90-95% cost reduction with `gpt-4.1-mini`
2. **Subscription Management**: Centralize Codex usage, control concurrency
3. **Structured Output**: Reliable JSON via `--output-schema`
4. **Multi-Project**: Other projects can use this service too
5. **Simple Integration**: Drop-in for OpenAI chat completions API
6. **No API Keys Exposed**: All handled via Codex subscription
