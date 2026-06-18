import { NextResponse } from "next/server"
import { listComponents } from "@/lib/github"
import { generateMxLibrary } from "@/lib/drawio"
import { getLogger } from "@/lib/log"
import { withRouteContext } from "@/lib/route-context"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const components = await listComponents()
      const xml = generateMxLibrary(components)

      return new NextResponse(xml, {
        headers: {
          "Content-Type": "application/xml",
          "Content-Disposition": 'attachment; filename="arch-components.xml"',
        },
      })
    } catch (error) {
      getLogger().error("Draw.io export error", { err: error instanceof Error ? error.message : String(error) })
      return NextResponse.json(
        { error: "Failed to generate Draw.io library" },
        { status: 500 }
      )
    }
  })
}
