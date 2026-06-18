import { NextResponse } from "next/server"
import yaml from "js-yaml"
import { getGit, GitNotFoundError, isGitConfigured } from "@/lib/git"
import { clearConfigCache } from "@/lib/config"
import type { RuntimeConfig } from "@/lib/config"
import type { UIBlocksConfig } from "@/lib/ui-blocks"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

// GET — returns the public runtime config (UI block visibility, model name).
// Secrets and provider names live in env and are not exposed here.
export async function GET() {
  if (!isGitConfigured()) {
    return NextResponse.json({ ui: { blocks: {} }, llm: {} })
  }

  try {
    const file = await getGit().getFile("config.yaml")
    const parsed = yaml.load(file.content)
    const value: RuntimeConfig =
      parsed && typeof parsed === "object" ? (parsed as RuntimeConfig) : {}
    return NextResponse.json({
      ui: { blocks: value.ui?.blocks || {} },
      llm: { model: value.llm?.model },
    })
  } catch (error: unknown) {
    if (error instanceof GitNotFoundError) {
      return NextResponse.json({ ui: { blocks: {} }, llm: {} })
    }
    getLogger().error("Failed to load config.yaml", { err: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: "Failed to load config" },
      { status: 500 }
    )
  }
}

// POST — updates ui.blocks in config.yaml. Other sections (llm.*) are
// preserved untouched. Body: { blocks: UIBlocksConfig }.
export async function POST(request: Request) {
  return withRouteContext(request, () => doPost(request))
}

async function doPost(request: Request) {
  if (!isGitConfigured()) {
    return NextResponse.json(
      { error: "Git backend not configured." },
      { status: 503 }
    )
  }

  let body: { blocks?: UIBlocksConfig }
  try {
    body = (await request.json()) as { blocks?: UIBlocksConfig }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.blocks || typeof body.blocks !== "object") {
    return NextResponse.json(
      { error: "Missing 'blocks' object in body" },
      { status: 400 }
    )
  }

  const git = getGit()

  // Read current config.yaml (if any) to preserve unrelated sections.
  let sha: string | undefined
  let existing: RuntimeConfig = {}
  try {
    const file = await git.getFile("config.yaml")
    sha = file.sha
    const parsed = yaml.load(file.content)
    if (parsed && typeof parsed === "object") {
      existing = parsed as RuntimeConfig
    }
  } catch (error: unknown) {
    if (!(error instanceof GitNotFoundError)) {
      getLogger().error("Failed to read config.yaml before update", { err: error instanceof Error ? error.message : String(error) })
      return NextResponse.json(
        { error: "Failed to read existing config" },
        { status: 500 }
      )
    }
  }

  const merged: RuntimeConfig = {
    ...existing,
    ui: { ...(existing.ui || {}), blocks: body.blocks },
  }
  const content = yaml.dump(merged, { sortKeys: false, lineWidth: -1 })

  try {
    await git.putFile(
      "config.yaml",
      content,
      sha ? "chore: update UI block visibility" : "chore: add config.yaml",
      sha
    )
  } catch (error: unknown) {
    getLogger().error("Failed to write config.yaml", { err: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: "Failed to write config" },
      { status: 500 }
    )
  }

  clearConfigCache()
  getLogger().adminAction("config.save", {
    blockKeys: Object.keys(body.blocks),
    falseCount: Object.values(body.blocks).reduce<number>((acc, group) => {
      if (!group || typeof group !== "object") return acc
      return (
        acc +
        Object.values(group as Record<string, unknown>).filter((v) => v === false).length
      )
    }, 0),
  })
  return NextResponse.json({ ok: true })
}
