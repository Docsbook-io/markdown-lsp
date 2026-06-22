import { createOpenAI } from "@ai-sdk/openai"

export const DEFAULT_EMBEDDING_MODEL = "openai/text-embedding-3-small"
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL
export const EMBEDDING_DIM = 1536
export const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? "gpt-4o-mini"

let _gw: ReturnType<typeof createOpenAI> | null = null

export function getGateway() {
  if (_gw) return _gw

  // OpenRouter takes priority if OPENROUTER_API_KEY is set
  const openrouterKey = process.env.OPENROUTER_API_KEY
  const gatewayKey = process.env.AI_GATEWAY_API_KEY
  const apiKey = openrouterKey ?? gatewayKey

  if (!apiKey) {
    throw new Error(
      "Set OPENROUTER_API_KEY (OpenRouter) or AI_GATEWAY_API_KEY (Vercel AI Gateway) to use AI features.",
    )
  }

  const baseURL = openrouterKey
    ? (process.env.AI_GATEWAY_BASE_URL ?? "https://openrouter.ai/api/v1")
    : (process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1")

  _gw = createOpenAI({ apiKey, baseURL })
  return _gw
}

/** Reset the cached gateway (useful for tests or when env changes mid-process) */
export function resetGateway(): void {
  _gw = null
}
