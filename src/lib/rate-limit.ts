const requests = new Map<string, { count: number; resetTime: number }>()

const WINDOW_MS = 60 * 1000 // 1 minute
const MAX_REQUESTS = 5 // 5 requests per minute

export function checkRateLimit(identifier: string): boolean {
  const now = Date.now()
  const entry = requests.get(identifier)

  if (!entry || now > entry.resetTime) {
    requests.set(identifier, { count: 1, resetTime: now + WINDOW_MS })
    return true
  }

  if (entry.count >= MAX_REQUESTS) {
    return false
  }

  entry.count++
  return true
}
