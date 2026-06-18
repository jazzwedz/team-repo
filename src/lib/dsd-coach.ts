// DSD coach — proposes improvements to the agent-team prompts from
// accumulated analyst feedback across all DSDs. Pure proposal, no write:
// the analyst approves and the apply endpoint commits (propose → approve →
// commit). Feedback is tagged with the section it is about, so the coach
// trains the exact agent that owns that section.

import { getLLM } from "./llm"
import {
  listAgents,
  getCoachWatermark,
  setCoachWatermark,
  type Agent,
} from "./agents"
import { WRITER_GROUPS, COACH_AGENT_ID } from "./dsd-sections"
import { listSolutions } from "./solutions"
import { listDsd, type DsdFeedback } from "./dsd-store"
import { getLogger } from "./log"

export interface AgentDelta {
  system_prompt?: string
  lessons?: string
}

export interface CoachProposal {
  /** Proposed change per agent id. */
  deltas: Record<string, AgentDelta>
  rationale: string
  feedbackConsidered: number
  feedbackIds: string[]
}

interface FeedbackEntry extends DsdFeedback {
  solutionId: string
  mode: string
}

async function gatherRecentFeedback(limit: number, since: string): Promise<FeedbackEntry[]> {
  const out: FeedbackEntry[] = []
  let solutions
  try {
    solutions = await listSolutions()
  } catch {
    return []
  }
  for (const s of solutions) {
    let arts
    try {
      arts = await listDsd(s.id)
    } catch {
      continue
    }
    for (const a of arts) {
      for (const f of a.feedback || []) {
        if (!f.at) continue
        if (since && f.at <= since) continue
        out.push({ ...f, solutionId: s.id, mode: a.mode })
      }
    }
  }
  out.sort((a, b) => (b.at || "").localeCompare(a.at || ""))
  return out.slice(0, limit)
}

export async function proposeCoaching(): Promise<CoachProposal> {
  const agents = await listAgents()
  const coach = agents.find((a) => a.id === COACH_AGENT_ID)
  const trainable = agents.filter((a) => a.id !== COACH_AGENT_ID)

  const since = await getCoachWatermark()
  const feedback = await gatherRecentFeedback(40, since)
  if (feedback.length === 0) {
    return {
      deltas: {},
      rationale: "No new analyst feedback since the last training round — rate some DSDs first.",
      feedbackConsidered: 0,
      feedbackIds: [],
    }
  }

  const llm = await getLLM()
  const raw = await llm.complete({
    prompt: coachPrompt(coach?.system_prompt || "", trainable, feedback),
    maxTokens: 3000,
  })
  const proposal = parseProposal(raw, new Set(trainable.map((a) => a.id)))
  proposal.feedbackConsidered = feedback.length
  proposal.feedbackIds = feedback.map((f) => f.id).filter((x): x is string => !!x)

  // Advance the watermark past everything this round considered.
  const newest = feedback.reduce((mx, f) => (f.at && f.at > mx ? f.at : mx), since)
  try {
    await setCoachWatermark(newest)
  } catch (e) {
    getLogger().error("Failed to advance coach watermark", {
      err: e instanceof Error ? e.message : String(e),
    })
  }

  getLogger().info("Coach proposal", {
    feedback: feedback.length,
    since,
    newWatermark: newest,
    agentsChanged: Object.keys(proposal.deltas).length,
  })
  return proposal
}

const SECTION_NAME = new Map(WRITER_GROUPS.map((g) => [g.agentId, g.name]))

function coachPrompt(coachPromptText: string, agents: Agent[], feedback: FeedbackEntry[]): string {
  const roster = agents
    .map(
      (a) =>
        `### ${a.id} (${a.role}) — ${a.name}\nPROMPT: ${a.system_prompt}\nLESSONS: ${a.lessons || "(none)"}`
    )
    .join("\n\n")

  const digest = feedback
    .map((f, i) => {
      const where = f.section ? `section ${SECTION_NAME.get(f.section) || f.section}` : "whole document"
      const parts = [`${i + 1}. [${f.rating}] (${where})`]
      if (f.comment) parts.push(`comment: ${f.comment}`)
      if (f.correctedText) parts.push(`correction: ${f.correctedText}`)
      return parts.join(" · ")
    })
    .join("\n")

  return `${coachPromptText}

THE AGENT TEAM (train these — use the exact id as the key):
${roster}

RECENT ANALYST FEEDBACK (newest first; "section" tells you which agent owns it — section feedback trains that writer, whole-document feedback trains the lead or the relevant critic):
${digest}

Based on recurring problems, propose targeted improvements to the agents that need them. Prefer adding to "lessons" (concrete rules) over rewriting the system prompt; only change a system_prompt for a fundamental issue. Only include agents that need a change.

Return ONLY JSON, no prose:
{
  "rationale": "1-3 sentences on what the feedback shows and what you changed",
  "deltas": {
    "<agent id>": { "lessons": "full new lessons text", "system_prompt": "only if changing it" }
  }
}`
}

function parseProposal(text: string, validIds: Set<string>): CoachProposal {
  const empty: CoachProposal = { deltas: {}, rationale: "", feedbackConsidered: 0, feedbackIds: [] }
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    const body = fenced ? fenced[1] : text
    const start = body.indexOf("{")
    const end = body.lastIndexOf("}")
    if (start < 0 || end < 0) return { ...empty, rationale: "Coach did not return a usable proposal." }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = JSON.parse(body.slice(start, end + 1)) as any
    const clean = (d: unknown): AgentDelta | undefined => {
      if (!d || typeof d !== "object") return undefined
      const o = d as Record<string, unknown>
      const out: AgentDelta = {}
      if (typeof o.system_prompt === "string" && o.system_prompt.trim()) out.system_prompt = o.system_prompt.trim()
      if (typeof o.lessons === "string" && o.lessons.trim()) out.lessons = o.lessons.trim()
      return out.system_prompt || out.lessons ? out : undefined
    }
    const deltas: Record<string, AgentDelta> = {}
    const rawDeltas = p.deltas && typeof p.deltas === "object" ? (p.deltas as Record<string, unknown>) : {}
    for (const [id, d] of Object.entries(rawDeltas)) {
      if (!validIds.has(id)) continue
      const c = clean(d)
      if (c) deltas[id] = c
    }
    return {
      deltas,
      rationale: typeof p.rationale === "string" ? p.rationale : "",
      feedbackConsidered: 0,
      feedbackIds: [],
    }
  } catch {
    return { ...empty, rationale: "Coach output could not be parsed." }
  }
}
