import { embedMany } from "ai"
import { getGateway, EMBEDDING_MODEL } from "./gateway.js"
import { assertAiEnabled } from "./config.js"

const BATCH_SIZE = 96
const MAX_INPUT_CHARS = 6000

export interface EmbeddingResult {
  vectors: number[][]
  tokensUsed: number
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], tokensUsed: 0 }
  assertAiEnabled()
  const gw = getGateway()
  const model = gw.embedding(EMBEDDING_MODEL)

  const out: number[][] = []
  let tokensUsed = 0

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, MAX_INPUT_CHARS))
    const res = await embedMany({ model, values: batch })
    for (const v of res.embeddings) out.push(v as number[])
    tokensUsed += res.usage?.tokens ?? 0
  }

  return { vectors: out, tokensUsed }
}

export async function embedOne(text: string): Promise<number[]> {
  const { vectors } = await embedTexts([text])
  return vectors[0]!
}
