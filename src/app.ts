import { timingSafeEqual } from "node:crypto"
import { Hono } from "hono"
import type { Config } from "./config.js"
import { CapacityError, ConcurrencyGate } from "./concurrency.js"
import { executeChatRequest, CodexExecutionError } from "./providers/codex.js"
import {
  chatRequestSchema,
  chatResponseSchema,
  errorResponseSchema,
  type ChatRequest,
  type ChatResponse,
} from "./schema.js"

export function createApp(config: Config) {
  const app = new Hono()
  const gate = new ConcurrencyGate(config.MAX_CONCURRENT_REQUESTS)

  // Health check
  app.get("/health", (c) =>
    c.json({ status: "ok", activeRequests: gate.inUse })
  )

  // Model info
  app.get("/v1/models", (c) =>
    c.json({
      object: "list",
      data: config.ALLOWED_MODELS.map((id, index) => ({
        id,
        object: "model",
        created: 0,
        owned_by: "codex-subscription",
      })),
    })
  )

  // Chat completion endpoint (OpenAI-compatible)
  app.post("/v1/chat/completions", async (c) => {
    // Auth check
    if (!authorized(c.req.header("authorization"), config.SUBSCRIPTION_LLM_TOKEN)) {
      return c.json({ error: { message: "unauthorized" } }, 401)
    }

    // Parse request
    let payload: unknown
    try {
      payload = await c.req.json()
    } catch {
      return c.json({ error: { message: "invalid JSON" } }, 400)
    }

    const parsed = chatRequestSchema.safeParse(payload)
    if (!parsed.success) {
      return c.json(
        {
          error: {
            message: "invalid request",
            type: "invalid_request_error",
            code: "invalid_request",
            issues: parsed.error.issues,
          },
        },
        400
      )
    }

    const request: ChatRequest = parsed.data

    // Validate model
    const model = request.model || config.DEFAULT_MODEL
    if (!config.ALLOWED_MODELS.includes(model)) {
      return c.json(
        {
          error: {
            message: `model '${model}' is not allowed. Allowed models: ${config.ALLOWED_MODELS.join(", ")}`,
            type: "invalid_request_error",
            code: "model_not_allowed",
          },
        },
        400
      )
    }

    // Validate message count
    const imageCount = request.messages.reduce((count, msg) => {
      if (typeof msg.content === "string") return count
      return count + msg.content.filter((c) => c.type === "image").length
    }, 0)

    if (imageCount > config.MAX_IMAGES_PER_REQUEST) {
      return c.json(
        {
          error: {
            message: `too many images (max ${config.MAX_IMAGES_PER_REQUEST})`,
            type: "invalid_request_error",
            code: "too_many_images",
          },
        },
        400
      )
    }

    try {
      const signal = AbortSignal.any([
        c.req.raw.signal,
        AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      ])

      const response = await gate.run(() =>
        executeChatRequest(config, request, signal)
      )

      return c.json(response)
    } catch (error) {
      const status = error instanceof CapacityError ? 429 : 502
      const message = error instanceof Error ? error.message : "request failed"

      console.error("[subscription-llm]", message)

      if (error instanceof CodexExecutionError && error.details) {
        console.error("[subscription-llm] Codex details:", error.details)
      }

      return c.json(
        {
          error: {
            message,
            type: error instanceof CapacityError ? "capacity_error" : "server_error",
            code: error instanceof CapacityError ? "capacity_exceeded" : "internal_error",
          },
        },
        status
      )
    }
  })

  // Root info
  app.get("/", (c) =>
    c.json({
      name: "subscription-llm",
      version: "0.1.0",
      description: "Codex subscription-based chat/vision service with structured output",
      endpoints: {
        health: "GET /health",
        models: "GET /v1/models",
        chat: "POST /v1/chat/completions",
      },
      defaultModel: config.DEFAULT_MODEL,
      allowedModels: config.ALLOWED_MODELS,
    })
  )

  app.notFound((c) => c.json({ error: { message: "not found" } }, 404))

  return app
}

function authorized(
  header: string | undefined,
  token: string | undefined
): boolean {
  if (!token) return true
  if (!header?.startsWith("Bearer ")) return false
  const supplied = Buffer.from(header.slice(7))
  const expected = Buffer.from(token)
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  )
}
