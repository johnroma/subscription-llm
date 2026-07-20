import { z } from "zod"

// Lightweight models optimized for token efficiency while maintaining quality
// Note: ChatGPT accounts don't support explicit model selection - use empty string
const MODEL_DEFAULTS = {
  openai: "gpt-4.1-mini", // ~100x cheaper than GPT-4.1, excellent vision (API only)
  gemini: "gemini-2.5-flash-exp", // Fast and efficient vision (API only)
  openai_fast: "gpt-4o-mini", // Great multimodal, very efficient (API only)
  auto: "", // Use Codex's default model (works with ChatGPT accounts)
}

const configSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8789),
  SUBSCRIPTION_LLM_TOKEN: z.string().min(16).optional(),
  CODEX_BIN: z.string().default("codex"),

  // Model configuration - default to auto (Codex's default model)
  DEFAULT_MODEL: z
    .string()
    .default(MODEL_DEFAULTS.auto),
  ALLOWED_MODELS: z
    .array(z.string())
    .default([
      MODEL_DEFAULTS.auto, // Empty string = use Codex default
      MODEL_DEFAULTS.openai,
      MODEL_DEFAULTS.openai_fast,
      MODEL_DEFAULTS.gemini,
    ]),

  // Request limits
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(16).default(8),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(120_000),

  // Input limits
  MAX_PROMPT_LENGTH: z.coerce.number().int().min(1000).max(128_000).default(64_000),
  MAX_IMAGE_SIZE: z.coerce.number().int().min(1_000).max(50_000_000).default(10_000_000), // 10MB
  MAX_IMAGES_PER_REQUEST: z.coerce.number().int().min(1).max(10).default(5),

  // Feature flags
  ENABLE_CACHING: z.coerce.boolean().default(false),
  CACHE_TTL_MS: z.coerce.number().int().min(0).default(300_000), // 5 minutes
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const config = configSchema.parse(environment)

  // Validate default model is in allowed list
  if (!config.ALLOWED_MODELS.includes(config.DEFAULT_MODEL)) {
    console.warn(
      `WARNING: DEFAULT_MODEL "${config.DEFAULT_MODEL}" is not in ALLOWED_MODELS, using first allowed model instead`
    )
    config.DEFAULT_MODEL = config.ALLOWED_MODELS[0]
  }

  // Warn if using non-loopback without token
  if (
    config.HOST !== "127.0.0.1" &&
    config.HOST !== "::1" &&
    !config.SUBSCRIPTION_LLM_TOKEN
  ) {
    console.warn(
      "WARNING: SUBSCRIPTION_LLM_TOKEN is required when HOST is not loopback"
    )
  }

  console.log(`Configuration loaded (default model: ${config.DEFAULT_MODEL})`)

  return config
}

export { MODEL_DEFAULTS }
