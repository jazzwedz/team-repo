// Coding brief of a generated document (FS only today).
//
//   GET  …/brief            → { markdown, createdAt } (404 when none)
//   GET  …/brief?download=1 → the file itself (text/markdown attachment)
//   POST …/brief            → (re)generate the brief from the stored FS,
//                              returns { markdown } — for documents made
//                              before briefs existed, or after an FS edit.

import { NextResponse } from "next/server"
import { getDsd, getCodingBrief, saveCodingBrief } from "@/lib/dsd-store"
import { isDocKind } from "@/lib/doc-kinds"
import { isValidName } from "@/lib/validate"
import { getSolution } from "@/lib/solutions"
import { listComponents } from "@/lib/github"
import { getLLM, isLLMConfigured } from "@/lib/llm"
import { buildGroundedFacts } from "@/lib/solution-dsd"
import { generateCodingBrief } from "@/lib/coding-brief"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"
export const maxDuration = 300

type P = { params: Promise<{ id: string; kind: string; artifactId: string }> }

const safeFile = (s: string) => s.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "solution"

export async function GET(request: Request, { params }: P) {
  return withRouteContext(request, async () => {
    const { id, kind, artifactId } = await params
    if (!isValidName(id)) return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    let brief: { markdown: string } | null
    try {
      brief = await getCodingBrief(id, artifactId, kind)
    } catch {
      brief = null
    }
    if (!brief) return NextResponse.json({ error: "No coding brief for this document yet" }, { status: 404 })
    const download = new URL(request.url).searchParams.get("download")
    if (download) {
      return new Response(brief.markdown, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeFile(id)}-coding-brief.md"`,
        },
      })
    }
    return NextResponse.json(brief)
  })
}

export async function POST(request: Request, { params }: P) {
  return withRouteContext(request, async () => {
    const { id, kind, artifactId } = await params
    if (!isValidName(id)) return NextResponse.json({ error: "Invalid solution id" }, { status: 400 })
    if (!isDocKind(kind)) return NextResponse.json({ error: "Unknown document kind" }, { status: 404 })
    if (kind !== "fs") return NextResponse.json({ error: "Coding briefs are produced for Functional Specifications" }, { status: 400 })
    try {
      const [artifact, solution, components] = await Promise.all([getDsd(id, artifactId, kind), getSolution(id), listComponents()])
      const facts = buildGroundedFacts(solution, components, kind)
      const llm = isLLMConfigured() ? await getLLM() : undefined
      const markdown = await generateCodingBrief({
        solution,
        components,
        facts,
        fsMarkdown: artifact.markdown,
        fsTitle: artifact.title,
        llm,
      })
      await saveCodingBrief(id, artifactId, markdown, kind, llm?.model)
      return NextResponse.json({ markdown })
    } catch (error) {
      getLogger().error("Failed to generate coding brief", {
        id,
        artifactId,
        err: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json({ error: "Failed to generate the coding brief" }, { status: 500 })
    }
  })
}
