import { defineConfig } from "vitest/config"
import { config as loadEnv } from "dotenv"
import { resolve } from "node:path"

loadEnv({ path: resolve(__dirname, ".env.local") })
loadEnv({ path: resolve(__dirname, ".env") })

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
})
