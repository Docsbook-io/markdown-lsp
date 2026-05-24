import { generateObject } from "ai"
import { z } from "zod"
import { getGateway, EXTRACT_MODEL } from "./gateway.js"
import { assertAiEnabled } from "./config.js"

export const ExtractedTermSchema = z.object({
  surface: z.string().describe("The exact term as it appears in text"),
  canonical: z.string().describe("Normalized kebab-case canonical id (lowercase, no spaces)"),
  kind: z.enum(["definition", "mention", "example"]).describe(
    "'definition' when the section explains the term; 'mention' when the term is used in passing; 'example' inside an example/code block",
  ),
})

export const SectionExtractionSchema = z.object({
  terms: z.array(ExtractedTermSchema),
  summary: z.string().nullable().describe("One-sentence summary of the section; null if section is trivial"),
})

export type ExtractedTerm = z.infer<typeof ExtractedTermSchema>
export type SectionExtraction = z.infer<typeof SectionExtractionSchema>

export interface ExtractInput {
  documentPath: string
  headingPath: string[]
  content: string
  existingCanonicals?: string[]
}

export interface ExtractResult extends SectionExtraction {
  tokensIn: number
  tokensOut: number
}

const SYSTEM_PROMPT = `You extract canonical concepts from technical documentation sections.

For each meaningful term in the section, return:
- surface: the exact word/phrase as written
- canonical: a normalized kebab-case id (e.g. "oauth", "authentication", "session-storage")
- kind: "definition" if the section defines/explains the concept; "mention" if used in passing; "example" if shown inside an example or code block

Rules:
- Extract concepts, not generic words ("user", "page", "function" are too generic)
- Multiple surface forms of the same concept must share the same canonical id (auth/authentication/log-in → "authentication")
- Prefer an existing canonical id from the provided list when applicable
- Stay focused: 0-12 terms per section, only what a docs reader would search for
- The summary must be one sentence, present tense, no marketing fluff. Return null if the section is just a heading or trivial.`

export async function extractSectionTerms(input: ExtractInput): Promise<ExtractResult> {
  assertAiEnabled()
  const gw = getGateway()
  const model = gw(EXTRACT_MODEL)

  const userPrompt = [
    `Document: ${input.documentPath}`,
    `Heading path: ${input.headingPath.join(" > ") || "(root)"}`,
    input.existingCanonicals?.length
      ? `Existing canonicals in this workspace (reuse when applicable): ${input.existingCanonicals.slice(0, 100).join(", ")}`
      : "",
    "",
    "Section content:",
    "---",
    input.content.slice(0, 8000),
    "---",
  ]
    .filter(Boolean)
    .join("\n")

  const res = await generateObject({
    model,
    schema: SectionExtractionSchema,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0,
  })

  return {
    ...res.object,
    tokensIn: res.usage?.inputTokens ?? 0,
    tokensOut: res.usage?.outputTokens ?? 0,
  }
}
