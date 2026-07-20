import { z } from "zod"

// Supported image formats
const imageMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
])

// Base64 validation
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

// Max image size: 10MB (encoded base64)
const maxImageBytes = 10 * 1024 * 1024
const maxBase64Length = Math.ceil((maxImageBytes * 4) / 3)

export const imageSchema = z.object({
  data: z
    .string()
    .min(1)
    .max(maxBase64Length)
    .regex(base64Pattern, "must be valid base64")
    .refine(
      (data) => Buffer.byteLength(data, "base64") <= maxImageBytes,
      `image must be ${maxImageBytes / 1024 / 1024} MB or smaller`
    ),
  mimeType: imageMimeTypeSchema,
})

export type Image = z.infer<typeof imageSchema>

// Message content types
const textContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
})

const imageContentSchema = z.object({
  type: z.literal("image"),
  image: z.object({
    data: z.string().min(1),
    mimeType: imageMimeTypeSchema,
  }),
})

const contentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  imageContentSchema,
])

// Chat message
export const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([z.string(), z.array(contentSchema)]),
})

export type Message = z.infer<typeof messageSchema>

// Main chat completion request
export const chatRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(messageSchema).min(1).max(50),
  temperature: z.number().min(0).max(2).default(0.1),
  maxTokens: z.number().int().min(1).max(8192).optional(),
  outputSchema: z.record(z.any()).optional(), // JSON Schema for structured output
})

export type ChatRequest = z.infer<typeof chatRequestSchema>

// Chat completion response
export const chatResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  provider: z.literal("codex"),
  choices: z.array(
    z.object({
      index: z.number().int(),
      message: z.object({
        role: z.literal("assistant"),
        content: z.string(),
      }),
      finishReason: z.enum(["stop", "length", "content_filter"]),
    })
  ),
  usage: z.object({
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  }),
  created: z.number(),
  processingTimeMs: z.number().int().min(0),
})

export type ChatResponse = z.infer<typeof chatResponseSchema>

// Error response
export const errorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.string().optional(),
  }),
})

export type ErrorResponse = z.infer<typeof errorResponseSchema>
