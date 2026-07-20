import { spawn } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Config } from "../config.js"
import type { ChatRequest, ChatResponse } from "../schema.js"

const MAX_LOG_BYTES = 2 * 1024 * 1024

export class CodexExecutionError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number | null,
    readonly details?: string
  ) {
    super(message)
    this.name = "CodexExecutionError"
  }
}

function stopProcess(pid: number | undefined): void {
  if (!pid) return
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // Process already exited
    }
  }
}

async function writeImage(
  jobDirectory: string,
  imageData: string,
  mimeType: string,
  index: number
): Promise<string> {
  const imagesDirectory = join(jobDirectory, "images")
  await mkdir(imagesDirectory, { recursive: true })

  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  }

  const filename = `image-${index}.${extensions[mimeType] || "png"}`
  const path = join(imagesDirectory, filename)
  await writeFile(path, Buffer.from(imageData, "base64"))
  return path
}

async function writeOutputSchema(
  jobDirectory: string,
  schema: Record<string, unknown>
): Promise<string> {
  const schemaPath = join(jobDirectory, "output-schema.json")
  await writeFile(schemaPath, JSON.stringify(schema, null, 2))
  return schemaPath
}

function buildPrompt(messages: ChatRequest["messages"]): string {
  const parts: string[] = []

  for (const message of messages) {
    const role = message.role.toUpperCase()
    if (role === "SYSTEM") {
      parts.push(`[SYSTEM INSTRUCTIONS]\n${message.content}\n`)
    } else if (role === "USER") {
      parts.push(`[USER REQUEST]\n${message.content}\n`)
    } else {
      // ASSISTANT
      parts.push(`[ASSISTANT RESPONSE]\n${message.content}\n`)
    }
  }

  return parts.join("\n")
}

async function runCodex(
  executable: string,
  workingDirectory: string,
  model: string,
  prompt: string,
  imagePaths: string[],
  outputSchemaPath: string | undefined,
  signal: AbortSignal
): Promise<{ exitCode: number | null; output: string }> {
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--json",
    "--output-last-message", join(workingDirectory, "response.json"),
    ...(outputSchemaPath ? ["--output-schema", outputSchemaPath] : []),
    ...(imagePaths.length > 0 ? imagePaths.flatMap((p) => ["--image", p]) : []),
    ...(model ? ["-m", model] : []),
    "-C",
    workingDirectory,
    "--skip-git-repo-check",
    "--",
    prompt,
  ]

  let output = ""

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workingDirectory,
      detached: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    const append = (chunk: Buffer) => {
      if (output.length < MAX_LOG_BYTES) output += chunk.toString("utf8")
    }
    child.stdout.on("data", append)
    child.stderr.on("data", append)

    const abort = () => {
      stopProcess(child.pid)
      reject(signal.reason ?? new Error("Codex execution aborted"))
    }
    signal.addEventListener("abort", abort, { once: true })

    child.once("error", (error) => {
      signal.removeEventListener("abort", abort)
      reject(new CodexExecutionError(`Could not start Codex: ${error.message}`))
    })

    child.once("close", (code, terminationSignal) => {
      signal.removeEventListener("abort", abort)
      if (signal.aborted) return
      if (code === 0) {
        resolve()
      } else {
        reject(
          new CodexExecutionError(
            `Codex exited with ${terminationSignal ?? `code ${String(code)}`}`,
            code,
            output.slice(-8_000)
          )
        )
      }
    })
  })

  return { exitCode: 0, output }
}

export async function executeChatRequest(
  config: Config,
  request: ChatRequest,
  signal: AbortSignal
): Promise<ChatResponse> {
  const jobDirectory = await mkdtemp(join(tmpdir(), "subscription-llm-"))
  const startTime = Date.now()

  try {
    // Extract images from messages
    const imageWrites: Promise<string>[] = []
    let hasImages = false

    for (const message of request.messages) {
      if (typeof message.content === "string") continue

      for (const item of message.content) {
        if (item.type === "image") {
          hasImages = true
          imageWrites.push(
            writeImage(
              jobDirectory,
              item.image.data,
              item.image.mimeType,
              imageWrites.length
            )
          )
        }
      }
    }

    const imagePaths = await Promise.all(imageWrites)

    // Write output schema if provided
    let outputSchemaPath: string | undefined
    if (request.outputSchema) {
      outputSchemaPath = await writeOutputSchema(jobDirectory, request.outputSchema)
    }

    // Build prompt from messages
    const prompt = buildPrompt(request.messages)

    // Run Codex exec
    const model = request.model || config.DEFAULT_MODEL
    await runCodex(
      config.CODEX_BIN,
      jobDirectory,
      model,
      prompt,
      imagePaths,
      outputSchemaPath,
      signal
    )

    // Read the response
    const responsePath = join(jobDirectory, "response.json")
    let responseContent: string

    try {
      responseContent = await readFile(responsePath, "utf8")
    } catch {
      // Try to parse from JSONL output if response.json doesn't exist
      // This happens when --json is used without --output-last-message
      throw new CodexExecutionError("Codex did not create response.json")
    }

    let assistantMessage: string
    try {
      const response = JSON.parse(responseContent)

      // If Codex already returned structured output, use it directly
      if (typeof response === "object" && response !== null) {
        assistantMessage = JSON.stringify(response, null, 2)
      } else {
        assistantMessage = String(response)
      }
    } catch {
      // Not valid JSON, use as plain text
      assistantMessage = responseContent
    }

    const processingTimeMs = Date.now() - startTime

    // Estimate token usage (Codex doesn't provide this, so we approximate)
    const promptText = prompt
    const promptTokens = Math.ceil(promptText.length / 4)
    const completionTokens = Math.ceil(assistantMessage.length / 4)

    return {
      id: `chatcmpl-${Date.now()}`,
      model,
      provider: "codex",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: assistantMessage,
          },
          finishReason: "stop",
        },
      ],
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      created: Math.floor(startTime / 1000),
      processingTimeMs,
    }
  } finally {
    await rm(jobDirectory, { recursive: true, force: true }).catch((err) => {
      console.error(`Failed to clean up job directory: ${err}`)
    })
  }
}
