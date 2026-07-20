import { createApp } from "./app.js"
import { loadConfig, MODEL_DEFAULTS } from "./config.js"

const config = loadConfig()
const app = createApp(config)

console.log("")
console.log("=".repeat(60))
console.log("  subscription-llm")
console.log("=".repeat(60))
console.log("")
console.log(`  Server: http://${config.HOST}:${config.PORT}`)
console.log(`  Default model: ${config.DEFAULT_MODEL}`)
console.log(`  Allowed models: ${config.ALLOWED_MODELS.join(", ")}`)
console.log(`  Max concurrent: ${config.MAX_CONCURRENT_REQUESTS}`)
console.log(`  Request timeout: ${config.REQUEST_TIMEOUT_MS}ms`)
console.log("")

if (config.SUBSCRIPTION_LLM_TOKEN) {
  console.log(`  🔒 Auth: Bearer token required`)
} else {
  console.log(`  ⚠️  Auth: None (loopback only)`)
}

console.log("")
console.log("Endpoints:")
console.log(`  GET  /health            - Health check`)
console.log(`  GET  /v1/models         - List available models`)
console.log(`  POST /v1/chat/completions - Chat completion (vision + structured output)`)
console.log("")
console.log("Default models (optimized for token efficiency):")
console.log(`  ${MODEL_DEFAULTS.openai} - Best balance of vision, intelligence, and cost`)
console.log(`  ${MODEL_DEFAULTS.openai_fast} - Faster multimodal alternative`)
console.log(`  ${MODEL_DEFAULTS.gemini} - Fast and efficient vision`)
console.log("")
console.log("=".repeat(60))

const server = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch: app.fetch,
})

console.log(`\n🚀 Server running on http://${config.HOST}:${config.PORT}\n`)

// Graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}, shutting down...`)
  server.stop()
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
