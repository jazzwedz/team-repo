// Tolerant JSON parsing for LLM output.
//
// Models occasionally return JSON with small slips — a missing comma between
// array elements, a trailing comma, a // comment, a code fence, prose around
// the object. A bare JSON.parse then fails the whole request ("Expected ','
// or ']' after array element…"). This helper extracts the object, applies
// safe local repairs, and as a last resort asks the model once to fix its
// own output. Repairs are conservative — they only touch structure outside
// of string literals, never the string contents.

type Complete = (opts: { prompt: string; maxTokens: number }) => Promise<string>

/** Pull the first {...} block out of fences/prose. */
export function extractJsonBlock(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end < 0 || end <= start) return null
  return body.slice(start, end + 1)
}

// Walk the text and rewrite structural slips, skipping string literals.
function repairStructure(src: string): string {
  let out = ""
  let inStr = false
  let esc = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      out += ch
      if (esc) esc = false
      else if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      continue
    }
    // Drop // line comments and /* */ block comments.
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++
      continue
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++
      i += 1
      continue
    }
    out += ch
  }

  // Trailing commas before a closing bracket/brace.
  out = out.replace(/,\s*([}\]])/g, "$1")
  // Missing comma between adjacent values: `} {`, `] [`, `" "`, `} "`, `" {`
  // (only across whitespace/newlines, which is how models usually slip).
  out = out.replace(/([}\]"\d]|true|false|null)(\s*\n\s*)(["{[])/g, "$1,$2$3")
  return out
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text)
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Parse an LLM response into an object. Order: extract → parse → local
 * repair → (optional) one model-assisted fix. Throws with the original
 * parser message when nothing works.
 */
export async function parseLlmJson(
  raw: string,
  complete?: Complete,
  opts: { maxTokens?: number } = {}
): Promise<Record<string, unknown>> {
  const block = extractJsonBlock(raw)
  if (!block) throw new Error("Model did not return JSON")

  const direct = tryParse(block)
  if (direct) return direct

  const repaired = tryParse(repairStructure(block))
  if (repaired) return repaired

  // Capture the real parser error for the message.
  let parseError = "invalid JSON"
  try {
    JSON.parse(block)
  } catch (e) {
    parseError = e instanceof Error ? e.message : String(e)
  }

  if (complete) {
    const fixed = await complete({
      prompt: `The following JSON is invalid (${parseError}). Return ONLY the corrected JSON — same content, same keys, strictly valid, no prose, no code fence.\n\n${block}`,
      maxTokens: opts.maxTokens ?? 4096,
    })
    const fixedBlock = extractJsonBlock(fixed)
    if (fixedBlock) {
      const v = tryParse(fixedBlock) ?? tryParse(repairStructure(fixedBlock))
      if (v) return v
    }
  }

  throw new Error(`Model returned malformed JSON (${parseError})`)
}
