// GET /api/admin/export-catalog
//
// Returns the full catalog rendered as the LLM-friendly markdown
// produced by src/lib/catalog-export.ts. Plain text/markdown response
// so the endpoint is also usable from `curl` and from any pipeline
// that wants to feed the catalog to a model without going through the
// UI dialog.

import { listComponents } from "@/lib/github"
import { buildCatalogMarkdown } from "@/lib/catalog-export"
import { withRouteContext } from "@/lib/route-context"
import { getLogger } from "@/lib/log"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withRouteContext(request, async () => {
    try {
      const components = await listComponents()
      const generatedAt = new Date().toISOString()
      const markdown = buildCatalogMarkdown(components, { generatedAt })
      return new Response(markdown, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": "no-store",
        },
      })
    } catch (error) {
      getLogger().error("Failed to export catalog", {
        err: error instanceof Error ? error.message : "Unknown error",
      })
      return new Response(
        `# Catalog export failed\n\n${error instanceof Error ? error.message : "Unknown error"}\n`,
        {
          status: 500,
          headers: { "content-type": "text/markdown; charset=utf-8" },
        }
      )
    }
  })
}
