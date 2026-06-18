"use client"

import { useState } from "react"
import { ComponentForm } from "@/components/ComponentForm"
import { ArrowLeft, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { useRouter } from "next/navigation"

export default function NewComponentPage() {
  const router = useRouter()
  const [formSaving, setFormSaving] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold flex-1">New Component</h1>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/")}
        >
          Cancel
        </Button>
        <Button type="submit" form="component-form" disabled={formSaving}>
          {formSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Create Component
        </Button>
      </div>
      <ComponentForm
        formId="component-form"
        onSavingChange={setFormSaving}
      />
    </div>
  )
}
