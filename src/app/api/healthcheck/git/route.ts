import { NextResponse } from "next/server"
import { promises as fsp } from "node:fs"
import * as path from "node:path"
import { getGit, getGitProviderName, missingGitEnvVars } from "@/lib/git"
import { REQUIRED_SUBDIRS } from "@/lib/git/filesystem"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

// POST — verbose live-probe of the configured Git backend. Returns the
// sanitized self-description, a four-step probe trace, and (when the
// active backend is filesystem) an `actions` block the Settings UI uses
// to decide whether to render the "Initialize storage" button.
export async function POST(request: Request) {
  return withRouteContext(request, doPost)
}

async function doPost() {
  const provider = getGitProviderName()
  const missing = missingGitEnvVars()
  getLogger().adminAction("healthcheck.git", { provider })

  if (missing.length > 0) {
    return NextResponse.json({
      ok: false,
      configured: false,
      provider,
      missingEnv: missing,
      error: `Not configured — set: ${missing.join(", ")}.`,
    })
  }

  try {
    const git = getGit()
    const describe = git.describe()
    const trace = await git.probe()

    // Filesystem-specific: report which sub-directories the operator
    // can create with one click from Settings.
    let actions: { canInitStorage?: boolean; missingSubdirs?: string[] } | undefined
    if (provider === "filesystem") {
      const root = process.env.FS_STORAGE_PATH
      if (root) {
        const rootStat = await fsp.stat(root).catch(() => null)
        if (rootStat && rootStat.isDirectory()) {
          const missingSubdirs: string[] = []
          for (const sub of REQUIRED_SUBDIRS) {
            const stat = await fsp.stat(path.join(root, sub)).catch(() => null)
            if (!stat || !stat.isDirectory()) missingSubdirs.push(sub)
          }
          if (missingSubdirs.length > 0) {
            actions = { canInitStorage: true, missingSubdirs }
          }
        }
      }
    }

    return NextResponse.json({
      ok: trace.ok,
      configured: true,
      provider,
      branch: git.branch,
      describe,
      trace,
      elapsedMs: trace.totalMs,
      actions,
    })
  } catch (error: unknown) {
    return NextResponse.json({
      ok: false,
      configured: true,
      provider,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
