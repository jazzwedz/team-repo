// Legacy URL — the editor now lives at /doc-structure/[kind].
import { redirect } from "next/navigation"

export default function DsdStructureRedirect() {
  redirect("/doc-structure/dsd")
}
