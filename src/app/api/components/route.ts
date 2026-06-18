import { NextResponse } from "next/server"
import { listComponents, saveComponent } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const components = await listComponents()
      return NextResponse.json(components)
    } catch (error) {
      getLogger().error("Failed to list components", { err: error instanceof Error ? error.message : "Unknown error" })
      return NextResponse.json(
        { error: "Failed to fetch components" },
        { status: 500 }
      )
    }
  })
}

export async function POST(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const component = await request.json()
      if (!component.id || !isValidName(component.id)) {
        return NextResponse.json({ error: "Invalid component ID" }, { status: 400 })
      }
      if (!component.name || !component.type) {
        return NextResponse.json({ error: "Missing required fields: name, type" }, { status: 400 })
      }
      await saveComponent(component)
      return NextResponse.json({ success: true })
    } catch (error) {
      getLogger().error("Failed to save component", { err: error instanceof Error ? error.message : "Unknown error" })
      return NextResponse.json(
        { error: "Failed to save component" },
        { status: 500 }
      )
    }
  })
}
