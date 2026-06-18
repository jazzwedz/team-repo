// DSD generation job endpoint.
//
//   POST /api/solutions/[id]/dsd        → start a job, returns { jobId }
//   GET  /api/solutions/[id]/dsd?jobId= → poll { status, phase, markdown? }
//
// The generation is a multi-call orchestration (draft → critic → revise)
// run as a detached in-process job so it survives the gateway's request
// timeout; the client polls for progress.

import { NextResponse } from "next/server"
import { getSolution } from "@/lib/solutions"
import { listComponents } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { isLLMConfigured, LLM_DISABLED_MESSAGE } from "@/lib/llm"
import { checkRateLimit } from "@/lib/rate-limit"
import { startDsdJob, getDsdJob, type DsdOptions } from "@/lib/solution-dsd"
import { getCombinedSourceText } from "@/lib/source-docs-store"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    if (!isLLMConfigured()) {
      return NextResponse.json({ error: LLM_DISABLED_MESSAGE }, { status: 503 })
    }
    const clientIp = request.headers.get("x-forwarded-for") || "unknown"
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      )
    }
    // Agent team is the default; quick is opt-in via the body.
    let mode: "quick" | "team" = "team"
    let provided: Record<string, string> = {}
    const options: DsdOptions = {}
    try {
      const body = await request.json().catch(() => null)
      if (body && body.mode === "quick") mode = "quick"
      // Per-chapter analyst-provided text (locked, used verbatim). Team only.
      if (body && body.provided && typeof body.provided === "object") {
        for (const [k, v] of Object.entries(body.provided)) {
          if (typeof v === "string" && v.trim()) provided[k] = v
        }
      }
      if (body && ["concise", "standard", "detailed"].includes(body.depth)) options.depth = body.depth
      if (body && ["technical", "management", "mixed"].includes(body.audience)) options.audience = body.audience
      if (body && ["en", "sk"].includes(body.language)) options.language = body.language
      if (body && Array.isArray(body.includeChapters)) {
        options.includeChapters = body.includeChapters.filter((x: unknown) => typeof x === "string")
      }
      // Optional attached source requirements document (BRD), already
      // extracted to text client-side via /api/extract-doc.
      if (
        body &&
        body.sourceDoc &&
        typeof body.sourceDoc === "object" &&
        typeof body.sourceDoc.text === "string" &&
        body.sourceDoc.text.trim()
      ) {
        options.sourceDoc = {
          name: typeof body.sourceDoc.name === "string" && body.sourceDoc.name.trim() ? body.sourceDoc.name : "source document",
          text: body.sourceDoc.text,
        }
      }
    } catch {
      // no body — default team
    }
    if (mode !== "team") provided = {}
    try {
      const solution = await getSolution(id)
      const components = await listComponents()
      // Source requirements (BRD) grounding: prefer the documents stored on
      // the solution (uploaded once, reused). Only fall back to a transient
      // doc sent in the body if the solution has none stored.
      try {
        const stored = await getCombinedSourceText(id)
        if (stored) options.sourceDoc = stored
      } catch (err) {
        getLogger().warn("Failed to load stored source docs (continuing)", {
          id,
          err: err instanceof Error ? err.message : String(err),
        })
      }
      const jobId = startDsdJob(solution, components, mode, provided, options)
      return NextResponse.json({ jobId })
    } catch (error) {
      getLogger().error("Failed to start DSD job", {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return NextResponse.json(
        { error: `Failed to start DSD: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      )
    }
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    }
    const jobId = new URL(request.url).searchParams.get("jobId")
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
    }
    const job = getDsdJob(jobId)
    if (!job) {
      return NextResponse.json(
        { error: "Job not found (it may have expired). Generate again." },
        { status: 404 }
      )
    }
    return NextResponse.json({
      status: job.status,
      phase: job.phase,
      iterations: job.iterations,
      artifactId: job.artifactId,
      markdown: job.status === "done" ? job.markdown : undefined,
      error: job.error,
    })
  })
}
