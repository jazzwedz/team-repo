import { redirect } from "next/navigation"

// Landing — push to LLM calls because that is the tab analysts use most
// when they are debugging the AI features.
export default function AdminLandingPage() {
  redirect("/admin/llm-calls")
}
