import { NextResponse } from "next/server"
import { listDiagrams, saveDiagram } from "@/lib/github"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const diagrams = await listDiagrams()
      return NextResponse.json(diagrams)
    } catch (error) {
      getLogger().error("Failed to list diagrams", { err: error instanceof Error ? error.message : "Unknown error" })
      return NextResponse.json(
        { error: "Failed to fetch diagrams" },
        { status: 500 }
      )
    }
  })
}

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const { name, content, sha } = await request.json()
      if (!name || /[^a-zA-Z0-9_\-. ]/.test(name)) {
        return NextResponse.json(
          { error: "Invalid diagram name" },
          { status: 400 }
        )
      }
      await saveDiagram(name, content, sha)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to save diagram", { err: error instanceof Error ? error.message : "Unknown error" })
      return NextResponse.json(
        { error: "Failed to save diagram" },
        { status: 500 }
      )
    }
  })
}
