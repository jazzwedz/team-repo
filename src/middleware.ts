import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PUBLIC_PATHS = ["/api/auth/login", "/login"]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next()
  }

  // Check auth cookie
  const token = request.cookies.get("auth_token")?.value
  const expectedToken = process.env.SITE_PASSWORD

  if (!expectedToken) {
    // No password configured — allow access (dev mode)
    return NextResponse.next()
  }

  if (token !== expectedToken) {
    // API routes return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    // Pages redirect to login
    return NextResponse.redirect(new URL("/login", request.url))
  }

  // CSRF: check Origin header on state-changing requests
  if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
    const origin = request.headers.get("origin")
    const host = request.headers.get("host")
    if (origin && host) {
      const originHost = new URL(origin).host
      if (originHost !== host) {
        return NextResponse.json(
          { error: "CSRF validation failed" },
          { status: 403 }
        )
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
