// Shared input validation for API routes

const SAFE_NAME_RE = /^[a-zA-Z0-9_\-. ]+$/

export function isValidName(name: string): boolean {
  return !!name && SAFE_NAME_RE.test(name) && !name.includes("..")
}

const VALID_AUDIENCES = ["Technical", "Business", "Executive"]

export function isValidAudience(audience: string): boolean {
  return VALID_AUDIENCES.includes(audience)
}

export function sanitizeForPrompt(input: string): string {
  // Truncate excessively long inputs
  return input.slice(0, 50000)
}
