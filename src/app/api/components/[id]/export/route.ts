// GET /api/components/[id]/export
//
// Returns a single component as its canonical v2 YAML document — the
// same shape written to disk. Re-importable via the Import dialog or
// POST /api/components/import. Plain text/yaml so it is also usable from
// `curl`.

import { getComponent } from "@/lib/github"
import { componentToYaml } from "@/lib/component-yaml"
import { isValidName } from "@/lib/validate"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRouteContext(request, async () => {
    const { id } = await params
    if (!isValidName(id)) {
      return new Response(`# Invalid component id\n`, {
        status: 400,
        headers: { "content-type": "application/x-yaml; charset=utf-8" },
      })
    }
    try {
      const { sha: _sha, ...component } = await getComponent(id)
      void _sha
      const yaml = componentToYaml(component)
      return new Response(yaml, {
        status: 200,
        headers: {
          "content-type": "application/x-yaml; charset=utf-8",
          "content-disposition": `attachment; filename="${id}.yaml"`,
          "cache-control": "no-store",
        },
      })
    } catch (error) {
      getLogger().error("Failed to export component YAML", {
        id,
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return new Response(`# Component not found: ${id}\n`, {
        status: 404,
        headers: { "content-type": "application/x-yaml; charset=utf-8" },
      })
    }
  })
}
