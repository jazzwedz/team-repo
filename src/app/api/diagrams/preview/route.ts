import { NextResponse } from "next/server"
import { getDiagram } from "@/lib/github"
import { isValidName } from "@/lib/validate"
import { getLogger } from "@/lib/log"
import { withRouteContext } from "@/lib/route-context"

export async function GET(request: Request) {
  return withRouteContext(request, () => doGet(request))
}

async function doGet(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get("name")

    if (!name || !isValidName(name)) {
      return new NextResponse("Invalid diagram name", { status: 400 })
    }

    const diagram = await getDiagram(name)
    const base64Xml = Buffer.from(diagram.content).toString("base64")

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; overflow: auto; }
    .geDiagramContainer { max-width: 100% !important; }
    .geDiagramContainer svg { max-width: 100% !important; height: auto !important; }
  </style>
</head>
<body>
  <div id="diagram"></div>
  <script>
    var xml = atob("${base64Xml}");
    var div = document.getElementById("diagram");
    div.className = "mxgraph";
    div.setAttribute("data-mxgraph", JSON.stringify({
      highlight: "#0000ff",
      nav: true,
      resize: true,
      toolbar: "zoom layers lightbox",
      edit: "_blank",
      xml: xml
    }));
  </script>
  <script src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</body>
</html>`

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, max-age=300",
      },
    })
  } catch (error) {
    getLogger().error("Diagram preview failed", { err: error instanceof Error ? error.message : "Unknown error" })
    return new NextResponse("Failed to load diagram", { status: 500 })
  }
}
