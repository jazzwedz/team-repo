import { NextResponse } from "next/server"
import { getComponentHistory } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    try {
      const { id } = await params
      if (!isValidName(id)) {
        return NextResponse.json({ error: "Invalid component ID" }, { status: 400 })
      }
      const history = await getComponentHistory(id)
      return NextResponse.json(history)
    } catch (error) {
      getLogger().error("Failed to get component history", { err: error instanceof Error ? error.message : "Unknown error" })
      return NextResponse.json(
        { error: "Failed to fetch history" },
        { status: 500 }
      )
    }
  })
}
