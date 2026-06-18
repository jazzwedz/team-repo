// Convert Confluence storage-format XHTML to readable plain text for AI
// consumption (pull-smart, rules-import, future analyzers).
//
// Behaviour:
//   - <ac:structured-macro ac:name="code"> blocks become fenced code blocks
//   - Other ac:/ri: macros are dropped (inner text kept where applicable)
//   - Headings become `# ...` markdown-style prefixes
//   - Tables become "Field: Value" lines (best-effort, lossy on complex layouts)
//   - Lists become "- item" lines
//   - Remaining tags are stripped, entities decoded, runs of blank lines
//     collapsed
//   - Output is capped at `maxChars` (default 30000) so very long pages
//     do not blow out an LLM context window unexpectedly

function stripInlineTags(s: string): string {
  // Loop until idempotent so nested/malformed fragments like "<<b>foo>"
  // don't survive a single pass (codeql: js/incomplete-multi-character-sanitization).
  let prev: string
  let cur = s
  do {
    prev = cur
    cur = cur.replace(/<[^>]+>/g, "")
  } while (cur !== prev)
  return cur
}

function decodeEntities(s: string): string {
  // Decode `&amp;` LAST so `&amp;lt;` stays as `&lt;` instead of collapsing
  // to `<` (codeql: js/double-escaping).
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
}

export function confluenceStorageToText(
  storage: string,
  maxChars = 30000
): string {
  let s = storage

  s = s.replace(
    /<ac:structured-macro[^>]*ac:name=["']code["'][^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
    (_, inner) => {
      const langMatch = inner.match(
        /<ac:parameter[^>]*ac:name=["']language["'][^>]*>([^<]*)<\/ac:parameter>/
      )
      const bodyMatch = inner.match(
        /<ac:plain-text-body[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/
      )
      const lang = langMatch ? langMatch[1] : ""
      const body = bodyMatch ? bodyMatch[1] : ""
      return `\n\`\`\`${lang}\n${body}\n\`\`\`\n`
    }
  )
  s = s.replace(
    /<ac:structured-macro[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
    (_, inner) => inner
  )
  s = s.replace(/<ac:[^>]*\/>/g, "")
  s = s.replace(/<ri:[^>]*\/?>/g, "")
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_, lvl, inner) => {
    const hashes = "#".repeat(Number(lvl))
    return `\n${hashes} ${stripInlineTags(inner).trim()}\n`
  })
  s = s.replace(
    /<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g,
    (_, th, td) => `\n${stripInlineTags(th).trim()}: ${stripInlineTags(td).trim()}`
  )
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_, inner) => `\n- ${stripInlineTags(inner).trim()}`)
  s = s.replace(/<\/p>\s*<p[^>]*>/g, "\n\n")
  s = s.replace(/<\/?p[^>]*>/g, "\n")
  s = s.replace(/<br\s*\/?>/g, "\n")
  s = stripInlineTags(s)
  s = decodeEntities(s)
  s = s.replace(/\n{3,}/g, "\n\n").trim()
  return s.slice(0, maxChars)
}
