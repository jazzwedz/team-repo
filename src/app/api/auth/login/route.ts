import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const { password } = await request.json()
    const sitePassword = process.env.SITE_PASSWORD

    if (!sitePassword) {
      return NextResponse.json({ error: "No password configured" }, { status: 500 })
    }

    if (password !== sitePassword) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 })
    }

    const response = NextResponse.json({ success: true })
    response.cookies.set("auth_token", sitePassword, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    return response
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
}
