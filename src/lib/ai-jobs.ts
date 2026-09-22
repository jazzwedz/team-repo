// Tiny in-process job store for long-running AI calls.
//
// A single LLM request with a big prompt (e.g. the whole catalog) can take
// longer than the reverse proxy in front of the app is willing to keep an
// HTTP request open, which surfaces to the user as a 502. The fix is the
// same pattern DSD generation uses: the POST starts the work detached and
// returns a job id immediately; the client polls GET ?jobId= until the job
// is done. Jobs live in memory (the app is a single long-running node
// server) and expire after a TTL.

import { randomUUID } from "crypto"
import { getLogger } from "./log"

export interface AiJob<T> {
  status: "running" | "done" | "error"
  result?: T
  error?: string
  updatedAt: number
}

const JOB_TTL_MS = 30 * 60 * 1000
const jobs = new Map<string, AiJob<unknown>>()

function prune() {
  const now = Date.now()
  for (const [id, j] of jobs) if (now - j.updatedAt > JOB_TTL_MS) jobs.delete(id)
}

/** Start `work` detached; returns the job id to poll. */
export function startAiJob<T>(label: string, work: () => Promise<T>): string {
  prune()
  const id = randomUUID()
  jobs.set(id, { status: "running", updatedAt: Date.now() })
  work()
    .then((result) => {
      jobs.set(id, { status: "done", result, updatedAt: Date.now() })
    })
    .catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      getLogger().error(`${label} job failed`, { id, err: message })
      jobs.set(id, { status: "error", error: message, updatedAt: Date.now() })
    })
  return id
}

export function getAiJob<T>(id: string): AiJob<T> | undefined {
  return jobs.get(id) as AiJob<T> | undefined
}
