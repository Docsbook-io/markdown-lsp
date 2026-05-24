import { createOpenAI } from "@ai-sdk/openai"

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"
export const EMBEDDING_DIM = 1536
export const EXTRACT_MODEL = process.env.EXTRACT_MODEL ?? "gpt-4o-mini"

let _gw: ReturnType<typeof createOpenAI> | null = null

export function getGateway() {
  if (_gw) return _gw
  const apiKey = process.env.AI_GATEWAY_API_KEY
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not set")
  _gw = createOpenAI({
    apiKey,
    baseURL: process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1",
  })
  return _gw
}
