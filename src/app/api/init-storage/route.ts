// Initialize-storage endpoint — creates the sub-directories the
// filesystem provider expects. The Settings UI surfaces a button that
// calls this when the healthcheck reports a missing-subdirs state for
// a freshly-mounted storage root.
//
// No-op (and returns 400) for non-filesystem providers — they manage
// their own layout through Git operations.

import { NextResponse } from "next/server"
import { promises as fsp } from "node:fs"
import * as path from "node:path"
import { getGitProviderName } from "@/lib/git"
import { REQUIRED_SUBDIRS } from "@/lib/git/filesystem"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    return doInit()
  })
}

async function doInit() {
  if (getGitProviderName() !== "filesystem") {
    return NextResponse.json(
      {
        ok: false,
        error: "wrong-provider",
        message:
          "Initialize-storage is only valid when GIT_PROVIDER=filesystem.",
      },
      { status: 400 }
    )
  }
  const rootPath = process.env.FS_STORAGE_PATH
  if (!rootPath) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing-env",
        message: "FS_STORAGE_PATH is not set.",
      },
      { status: 400 }
    )
  }

  const created: string[] = []
  const skipped: string[] = []
  try {
    const stat = await fsp.stat(rootPath).catch(() => null)
    if (!stat) {
      return NextResponse.json(
        {
          ok: false,
          error: "root-missing",
          message: `Storage root does not exist: ${rootPath}. Create the directory first or update FS_STORAGE_PATH.`,
        },
        { status: 400 }
      )
    }
    if (!stat.isDirectory()) {
      return NextResponse.json(
        {
          ok: false,
          error: "root-not-dir",
          message: `Storage root is not a directory: ${rootPath}.`,
        },
        { status: 400 }
      )
    }
    for (const sub of REQUIRED_SUBDIRS) {
      const full = path.join(rootPath, sub)
      const existing = await fsp.stat(full).catch(() => null)
      if (existing && existing.isDirectory()) {
        skipped.push(sub)
        continue
      }
      await fsp.mkdir(full, { recursive: true })
      created.push(sub)
    }
    getLogger().adminAction("storage.init", { rootPath, created, skipped })
    return NextResponse.json({
      ok: true,
      rootPath,
      created,
      skipped,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    getLogger().error("storage.init failed", { message })
    return NextResponse.json(
      {
        ok: false,
        error: "io-failed",
        message,
        created,
      },
      { status: 500 }
    )
  }
}
