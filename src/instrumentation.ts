// Next.js runs this once when the server starts. We overlay any
// UI-saved Application Settings (app-config.local.json) onto process.env so
// every `process.env.X` reader honours an override, while .env.local stays
// the fallback. Node runtime only — the Edge runtime has no filesystem.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { applyStoreToEnv } = await import("./lib/app-config")
    applyStoreToEnv()
  }
}
