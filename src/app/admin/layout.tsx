"use client"

// Admin console layout — shared chrome (page header + tab nav) around
// the three tabs. Gating is permissive per current policy: every
// logged-in user is admin. Tighten later by reading X-Forwarded-User
// against an env-configured allow-list.

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Shield, MessageSquare, ScrollText, History } from "lucide-react"

const TABS = [
  { href: "/admin/llm-calls", label: "LLM calls", icon: MessageSquare },
  { href: "/admin/logs", label: "Operational logs", icon: ScrollText },
  { href: "/admin/audit", label: "Admin audit", icon: History },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-indigo-600" />
        <h1 className="text-2xl font-bold">Admin console</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Inspect what arch-tool is doing on the server — LLM calls (with
        full prompt and response, for fine-tuning analysis), operational
        logs, and the audit trail of admin actions. Every logged-in user
        currently has access.
      </p>
      <nav className="border-b flex gap-1 -mb-px">
        {TABS.map((t) => {
          const active = pathname?.startsWith(t.href)
          const Icon = t.icon
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`px-4 py-2 text-sm font-medium border-b-2 inline-flex items-center gap-1.5 transition-colors ${
                active
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          )
        })}
      </nav>
      <div>{children}</div>
    </div>
  )
}
