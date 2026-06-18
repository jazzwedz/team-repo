// Source-code "extractor".
//
// Unlike the PDF extractor there is no binary decoding to do — the
// text is already plain text. The job is just to normalise line
// endings, attempt a best-effort language guess from a filename
// extension, and adapt the standard ExtractedDoc shape so the rest of
// the rules-import pipeline can stay source-agnostic.

import { ExtractError, type ExtractedDoc } from "./types"

// Filename extension → language slug. Conservative and explicit so
// false positives are rare. Anything not listed becomes "auto".
const EXT_TO_LANG: Record<string, string> = {
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".groovy": "groovy",
  ".cs": "csharp",
  ".vb": "vb",
  ".fs": "fsharp",
  ".py": "python",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".jsx": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".m": "objective-c",
  ".mm": "objective-c",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".sql": "sql",
  ".pls": "plsql",
  ".plsql": "plsql",
  ".cob": "cobol",
  ".cbl": "cobol",
  ".cobol": "cobol",
  ".pli": "pli",
  ".pl1": "pli",
  ".dart": "dart",
  ".lua": "lua",
  ".r": "r",
  ".pl": "perl",
  ".sh": "bash",
  ".bash": "bash",
  ".ps1": "powershell",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".xml": "xml",
  ".html": "html",
  ".vue": "vue",
  ".svelte": "svelte",
}

export function detectLanguage(filename?: string): string {
  if (!filename) return "auto"
  const lower = filename.toLowerCase()
  for (const [ext, lang] of Object.entries(EXT_TO_LANG)) {
    if (lower.endsWith(ext)) return lang
  }
  return "auto"
}

export interface CodeExtractedDoc extends ExtractedDoc {
  kind: "code"
  language: string
}

export function extractCode(opts: {
  text: string
  filename?: string
  language?: string
}): CodeExtractedDoc {
  const text = opts.text.trim()
  if (!text) {
    throw new ExtractError("No source code provided.")
  }
  // Light-touch normalisation — collapse Windows / classic-Mac line
  // endings so the LLM sees consistent newlines regardless of how
  // the file got into the editor.
  const normalised = text.replace(/\r\n?/g, "\n")
  const language =
    opts.language && opts.language.trim()
      ? opts.language.trim().toLowerCase()
      : detectLanguage(opts.filename)
  const display = opts.filename || `Source code (${language})`
  return {
    kind: "code",
    name: display,
    text: normalised,
    language,
  }
}
