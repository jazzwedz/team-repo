// GET /api/admin/export-yaml
//
// Returns the full catalog as a single round-trippable multi-doc YAML
// bundle (`---` separated). Re-importable via the Import dialog or
// POST /api/components/import. Plain text/yaml so it is also usable from
// `curl` and any pipeline that wants the raw catalog.

import { listComponents } from "@/lib/github"
import { catalogToYaml } from "@/lib/component-yaml"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const components = await listComponents()
      const yaml = catalogToYaml(components)
      const date = new Date().toISOString().slice(0, 10)
      return new Response(yaml, {
        status: 200,
        headers: {
          "content-type": "application/x-yaml; charset=utf-8",
          "content-disposition": `attachment; filename="catalog-${date}.yaml"`,
          "cache-control": "no-store",
        },
      })
    } catch (error) {
      getLogger().error("Failed to export catalog YAML", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return new Response(
        `# Catalog YAML export failed\n# ${error instanceof Error ? error.message : "Unknown error"}\n`,
        {
          status: 500,
          headers: { "content-type": "application/x-yaml; charset=utf-8" },
        }
      )
    }
  })
}
