export interface AiConfig {
  enabled: boolean
  embeddingModel: string
  extractModel: string
  hasGatewayKey: boolean
}

export function getAiConfig(): AiConfig {
  const enabled = process.env.MARKDOWN_LSP_AI_ENABLED === "1" || process.env.MARKDOWN_LSP_AI_ENABLED === "true"
  return {
    enabled,
    embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    extractModel: process.env.EXTRACT_MODEL ?? "gpt-4o-mini",
    hasGatewayKey: Boolean(process.env.AI_GATEWAY_API_KEY),
  }
}

export function assertAiEnabled(): void {
  const cfg = getAiConfig()
  if (!cfg.enabled) {
    throw new Error(
      "AI features are disabled. Set MARKDOWN_LSP_AI_ENABLED=1 to enable embeddings + semantic extraction.",
    )
  }
  if (!cfg.hasGatewayKey) {
    throw new Error(
      "AI features require AI_GATEWAY_API_KEY (Vercel AI Gateway) — or fork the gateway module to use a different provider.",
    )
  }
}
