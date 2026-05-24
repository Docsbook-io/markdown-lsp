import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { getAiConfig, assertAiEnabled } from "../src/ai/config.js"

const origEnabled = process.env.MARKDOWN_LSP_AI_ENABLED
const origKey = process.env.AI_GATEWAY_API_KEY

beforeEach(() => {
  delete process.env.MARKDOWN_LSP_AI_ENABLED
})

afterEach(() => {
  if (origEnabled === undefined) delete process.env.MARKDOWN_LSP_AI_ENABLED
  else process.env.MARKDOWN_LSP_AI_ENABLED = origEnabled
  if (origKey === undefined) delete process.env.AI_GATEWAY_API_KEY
  else process.env.AI_GATEWAY_API_KEY = origKey
})

describe("AI feature flag", () => {
  it("AI is off by default", () => {
    expect(getAiConfig().enabled).toBe(false)
  })

  it("assertAiEnabled throws when flag is off", () => {
    expect(() => assertAiEnabled()).toThrow(/disabled/)
  })

  it("assertAiEnabled throws when flag is on but no key", () => {
    process.env.MARKDOWN_LSP_AI_ENABLED = "1"
    delete process.env.AI_GATEWAY_API_KEY
    expect(() => assertAiEnabled()).toThrow(/AI_GATEWAY_API_KEY/)
  })

  it("getAiConfig reflects flag + key presence", () => {
    process.env.MARKDOWN_LSP_AI_ENABLED = "true"
    process.env.AI_GATEWAY_API_KEY = "fake"
    const cfg = getAiConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.hasGatewayKey).toBe(true)
  })

  it("embedTexts and extractSectionTerms are safe to import when AI is off", async () => {
    const { embedTexts } = await import("../src/ai/embeddings.js")
    const { extractSectionTerms } = await import("../src/ai/extract.js")
    await expect(embedTexts(["hello"])).rejects.toThrow(/disabled/)
    await expect(
      extractSectionTerms({ documentPath: "x.md", headingPath: ["A"], content: "body" }),
    ).rejects.toThrow(/disabled/)
  })
})
