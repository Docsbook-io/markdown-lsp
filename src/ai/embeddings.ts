import { embedMany } from "ai"
import { getGateway, EMBEDDING_MODEL } from "./gateway.js"
import { assertAiEnabled } from "./config.js"
import { cachedEmbedding, saveEmbedding } from "./cache.js"

const BATCH_SIZE = 96
const MAX_INPUT_CHARS = 6000

export interface EmbeddingResult {
  vectors: number[][]
  tokensUsed: number
}

/**
 * Embed multiple texts with disk-cache support.
 * Checks cache per-text before hitting the API; saves results after.
 * @param texts - texts to embed
 * @param modelOverride - override the embedding model (default: EMBEDDING_MODEL env or openai/text-embedding-3-small)
 * @param useCache - whether to use disk cache (default: true)
 */
export async function embedTexts(
  texts: string[],
  modelOverride?: string,
  useCache = true,
): Promise<EmbeddingResult> {
  if (texts.length === 0) return { vectors: [], tokensUsed: 0 }
  assertAiEnabled()
  const gw = getGateway()
  const modelName = modelOverride ?? EMBEDDING_MODEL
  const model = gw.embedding(modelName)

  const out: (number[] | null)[] = new Array(texts.length).fill(null)
  let tokensUsed = 0

  // Check cache first
  const uncachedIndices: number[] = []
  const uncachedTexts: string[] = []

  if (useCache) {
    for (let i = 0; i < texts.length; i++) {
      const cached = cachedEmbedding(texts[i]!, modelName)
      if (cached !== null) {
        out[i] = cached
      } else {
        uncachedIndices.push(i)
        uncachedTexts.push(texts[i]!)
      }
    }
  } else {
    for (let i = 0; i < texts.length; i++) {
      uncachedIndices.push(i)
      uncachedTexts.push(texts[i]!)
    }
  }

  // Embed uncached texts in batches
  for (let b = 0; b < uncachedTexts.length; b += BATCH_SIZE) {
    const batchTexts = uncachedTexts.slice(b, b + BATCH_SIZE).map((t) => t.slice(0, MAX_INPUT_CHARS))
    const batchIndices = uncachedIndices.slice(b, b + BATCH_SIZE)
    const res = await embedMany({ model, values: batchTexts })
    for (let j = 0; j < res.embeddings.length; j++) {
      const vec = res.embeddings[j] as number[]
      const originalIndex = batchIndices[j]!
      out[originalIndex] = vec
      if (useCache) {
        saveEmbedding(uncachedTexts[b + j]!, modelName, vec)
      }
    }
    tokensUsed += res.usage?.tokens ?? 0
  }

  return { vectors: out as number[][], tokensUsed }
}

export async function embedOne(text: string, modelOverride?: string): Promise<number[]> {
  const { vectors } = await embedTexts([text], modelOverride)
  return vectors[0]!
}
