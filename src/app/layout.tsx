import type { Metadata } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { Layers, FileText, FileImage, Settings, Shield, Workflow, Boxes, Compass, Bot } from "lucide-react"
import { ClientErrorReporter } from "@/components/ClientErrorReporter"
import { Providers } from "@/components/Providers"

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
  weight: "100 900",
})
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
  weight: "100 900",
})

export const metadata: Metadata = {
  title: "Team Repository",
  description: "IT Component Catalog & Architecture Documentation",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={cn(
          geistSans.variable,
          geistMono.variable,
          "font-sans antialiased min-h-screen bg-background"
        )}
      >
        <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
          <div className="container mx-auto px-4 h-14 flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg">
              <Layers className="h-5 w-5" />
              Team Repository
            </Link>
            <nav className="flex items-center gap-4 text-sm flex-1">
              <Link
                href="/guide"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Compass className="h-3.5 w-3.5" />
                Guide
              </Link>
              <Link
                href="/"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Catalog
              </Link>
              <Link
                href="/solutions"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Boxes className="h-3.5 w-3.5" />
                Solutions
              </Link>
              <Link
                href="/processes"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Workflow className="h-3.5 w-3.5" />
                Processes
              </Link>
              <Link
                href="/diagrams"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <FileImage className="h-3.5 w-3.5" />
                Diagrams
              </Link>
              <Link
                href="/generate"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <FileText className="h-3.5 w-3.5" />
                Generate
              </Link>
              <Link
                href="/agents"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Bot className="h-3.5 w-3.5" />
                Agents
              </Link>
              <Link
                href="/admin"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 ml-auto"
              >
                <Shield className="h-3.5 w-3.5" />
                Admin
              </Link>
              <Link
                href="/settings"
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <Providers>
          <ClientErrorReporter />
          <main className="container mx-auto px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
