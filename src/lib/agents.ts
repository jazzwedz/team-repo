// Agent definitions for the DSD agent-team.
//
// The team is a roster of specialised, trainable agents (stored as
// agents/<id>.yaml in the data repo so the coach can "train" them by
// committing improved prompts — versioned + auditable in git):
//   - one writer per DSD section group (purpose / architecture / functional
//     / data-nfr / rules-roadmap) — see WRITER_GROUPS in dsd-sections.ts,
//   - a panel of critic lenses (grounding / completeness / clarity /
//     consistency),
//   - a lead that consolidates the assembled draft,
//   - a coach that turns analyst feedback into prompt improvements.
// When a file is absent the built-in default is used, so the feature works
// before anyone has committed an agent file.

import yaml from "js-yaml"
import { getGit } from "./git"
import { getLogger } from "./log"
import {
  WRITER_GROUPS,
  CRITIC_LENSES,
  LEAD_AGENT_ID,
  COACH_AGENT_ID,
} from "./dsd-sections"

export type AgentRole = "writer" | "critic" | "coach" | "lead" | "assistant"

// Single-agent "AI assistants" behind the other AI-support moments. Each is
// one configurable prompt (the persona/lead); the route keeps the task
// scaffolding (JSON schema, grounded facts, audience/doctype modifiers).
export const ASSISTANT_AGENTS: { id: string; name: string; system_prompt: string }[] = [
  {
    id: "solution-composer",
    name: "Solution composer",
    system_prompt:
      "You are a solution architect composing a new solution by reusing components from an existing catalog. From the analyst's intent (and any source document) propose a clear, grounded skeleton — goal, description, members, flows and a starter process. Prefer reuse; never invent component ids; put anything new in newComponents.",
  },
  {
    id: "rules-locator",
    name: "Rules locator",
    system_prompt:
      "You are an architecture analyst reading a component's documentation or source code to locate the passages that express business rules, calculations or constraints. Identify the relevant blocks precisely; do not summarise or invent.",
  },
  {
    id: "rules-extractor",
    name: "Rules extractor",
    system_prompt:
      "You are an architecture analyst extracting business rules from documentation or source code into a structured catalog. Capture each rule precisely with its kind; stay strictly within what the source states — do not invent rules or values.",
  },
  {
    id: "doc-writer",
    name: "Documentation writer",
    system_prompt:
      "You are a documentation writer producing clear, professional architecture documents. Your writing must sound human and natural — never like AI-generated content. Clear, direct, no fluff; no marketing words. State facts plainly and stay within the provided data.",
  },
  {
    id: "process-drafter",
    name: "Process drafter",
    system_prompt:
      "You are a solution architect drafting ONE ordered process sequence as actor→target steps that render as a sequence diagram. Ground it in the solution's members and intent; add external actors for people/roles outside the catalog; keep it focused.",
  },
  {
    id: "catalog-enricher",
    name: "Catalog enricher",
    system_prompt:
      "You are an architecture analyst who improves the component catalog from what is learned while building a solution — primarily the source requirements (BRD) and the components' current catalog entries. For each component propose only what the evidence supports: a clearer business-focused description, additional business capabilities (with role), and business rules. Never invent; prefer concise, factual business language; do not restate technical structure. Return deltas only — the analyst reviews and approves each one.",
  },
  {
    id: "relationship-auditor",
    name: "Relationship auditor",
    system_prompt:
      "You are an enterprise architect auditing a component catalog for MISSING relationships. You are given candidate pairs of components that currently have NO link between them, each with concrete evidence (solution flows, shared data components, textual mentions, shared membership). For each pair, judge whether a link SHOULD exist; when yes, give the direction (from→to), the role, an optional protocol, a confidence 0–1, and a one-sentence rationale citing the evidence. Be conservative — propose only links the evidence clearly supports and reject weak or speculative pairs. Never invent components or evidence; use only the ids and evidence provided.",
  },
  {
    id: "catalog-curator",
    name: "Catalog curator",
    system_prompt:
      "You are an enterprise architect curating a component catalog. You read an uploaded document and decide whether it contains anything worth recording on the EXISTING components — a better or missing description, a business capability, or a business rule — and whether the document confirms, extends, or contradicts what the catalog already states. Be conservative: propose a change only when the document clearly and materially supports it, and never invent. Every proposal must quote the document verbatim and cite the page it is on. The analyst reviews and approves each proposal — you only surface them.",
  },
  {
    id: "code-rule-auditor",
    name: "Code rule auditor",
    system_prompt:
      "You are a software architect comparing a component's DOCUMENTED business rules against its ACTUAL source code. For each documented rule, find where the code implements it and derive a structured 'implemented' version (summary, and formula or given/when/then) from the code, citing the exact lines verbatim so they can be located. Judge whether the code is consistent with the documented rule or divergent (and say how), or requested-only when you cannot find it implemented. Also surface business rules clearly present in the code but missing from the catalog. Never invent — only cite code that actually appears in the provided files, copied verbatim. The analyst reviews and approves every change.",
  },
  {
    id: "source-mapper",
    name: "Source mapper",
    system_prompt:
      "You are a software architect locating where a component is implemented in a source repository. Given a component (name, purpose, capabilities) and a shortlist of candidate files (paths plus the head of the most likely ones), decide which files actually realise the component's behaviour. Prefer a small, precise set — the core implementation files, not every file that merely mentions the name. Choose only from the candidate paths given; never invent a path. Give each chosen file a confidence and a short reason. Return nothing if none clearly fit. The analyst reviews and approves the mapping.",
  },
]

export interface Agent {
  id: string
  name: string
  role: AgentRole
  /** Empty = use the gateway's default model. */
  model?: string
  temperature?: number
  version: number
  system_prompt: string
  /** Coach-appended rules learned from feedback. */
  lessons?: string
  /** Optional user override: an emoji shown as the agent's face. Empty =
   *  default human silhouette + deterministic colour. */
  avatar?: string
}

const STYLE =
  "Write like a knowledgeable colleague — clear, direct, no fluff. Short sentences. No marketing words (leverage, robust, seamless, synergy, holistic, empower, streamline). State facts plainly. Stay strictly within the verified facts you are given; do not invent components, flows, capabilities or values."

const DEFAULTS: Record<string, Agent> = {}

// Writer per section group.
for (const g of WRITER_GROUPS) {
  DEFAULTS[g.agentId] = {
    id: g.agentId,
    name: g.name,
    role: "writer",
    temperature: 0.4,
    version: 1,
    system_prompt: `You are a solution architect writing the part of a Detailed Solution Description focused on ${g.focus}. ${STYLE}`,
  }
}

// Critic per lens.
for (const c of CRITIC_LENSES) {
  DEFAULTS[c.agentId] = {
    id: c.agentId,
    name: c.name,
    role: "critic",
    temperature: 0.2,
    version: 1,
    system_prompt: `You are a strict reviewer of a Detailed Solution Description draft. Your lens: ${c.focus} Find ONLY real problems through this lens; do not restate problems outside it. Be specific about where and how to fix.`,
  }
}

DEFAULTS[LEAD_AGENT_ID] = {
  id: LEAD_AGENT_ID,
  name: "Lead editor",
  role: "lead",
  temperature: 0.3,
  version: 1,
  system_prompt: `You are the lead editor assembling a Detailed Solution Description from sections written by specialist writers. Stitch the sections into one coherent document: consistent terminology, no duplication across sections, smooth transitions. Fix only flow and consistency — do not add facts, and keep every section's content. ${STYLE}`,
}

DEFAULTS[COACH_AGENT_ID] = {
  id: COACH_AGENT_ID,
  name: "DSD Coach",
  role: "coach",
  temperature: 0.3,
  version: 1,
  system_prompt: `You are a coach who improves the DSD agent team — section writers, critic lenses and the lead editor — by refining their instructions. You are given each agent's current prompt plus recent analyst feedback (ratings, comments, corrections), tagged with the section it is about. Map section feedback to the agent that owns that section, and whole-document feedback to the lead or the relevant critics. Identify recurring problems and propose concrete, minimal improvements to the right agents' system prompts and "lessons". Do not rewrite prompts wholesale; suggest targeted additions grounded in the evidence.`,
}

for (const a of ASSISTANT_AGENTS) {
  DEFAULTS[a.id] = {
    id: a.id,
    name: a.name,
    role: "assistant",
    temperature: 0.4,
    version: 1,
    system_prompt: a.system_prompt,
  }
}

export const AGENT_IDS: string[] = Object.keys(DEFAULTS)
/** Loose alias kept for call sites that pass a known id. */
export type AgentId = string

export function isAgentId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULTS, id)
}

export function defaultAgent(id: string): Agent | undefined {
  return DEFAULTS[id]
}

function pathFor(id: string): string {
  return `agents/${id}.yaml`
}

export async function getAgent(id: AgentId): Promise<Agent> {
  const def = DEFAULTS[id]
  const git = getGit()
  try {
    const file = await git.getFile(pathFor(id))
    const parsed = yaml.load(file.content, { schema: yaml.JSON_SCHEMA }) as Partial<Agent>
    if (parsed && typeof parsed.system_prompt === "string") {
      return { ...def, ...parsed, id, role: def?.role || (parsed.role as AgentRole) } as Agent
    }
  } catch {
    // not committed yet — fall back to the built-in default
  }
  if (!def) throw new Error(`Unknown agent: ${id}`)
  return def
}

export interface AgentWithSha extends Agent {
  sha?: string
}

export async function getAgentWithSha(id: AgentId): Promise<AgentWithSha> {
  const def = DEFAULTS[id]
  const git = getGit()
  try {
    const file = await git.getFile(pathFor(id))
    const parsed = yaml.load(file.content, { schema: yaml.JSON_SCHEMA }) as Partial<Agent>
    if (parsed && typeof parsed.system_prompt === "string") {
      return { ...def, ...parsed, id, role: def?.role || (parsed.role as AgentRole), sha: file.sha }
    }
  } catch {
    // fall through
  }
  if (!def) throw new Error(`Unknown agent: ${id}`)
  return { ...def }
}

export async function listAgents(): Promise<Agent[]> {
  return Promise.all(AGENT_IDS.map((id) => getAgent(id)))
}

export async function saveAgent(agent: Agent, sha?: string): Promise<void> {
  const git = getGit()
  const body: Agent = { ...agent, version: (agent.version || 0) + 1 }
  const content = yaml.dump(body, { lineWidth: -1, noRefs: true, sortKeys: false })
  await git.putFile(pathFor(agent.id), content, `chore(agents): update ${agent.id} (v${body.version})`, sha)
  getLogger().info("Agent updated", { id: agent.id, version: body.version })
}

/** Compose the per-call instruction block: system prompt + learned lessons. */
export function agentInstruction(a: Agent): string {
  const lessons = a.lessons?.trim()
  return lessons ? `${a.system_prompt}\n\nLessons learned (apply these):\n${lessons}` : a.system_prompt
}

// ----- coach watermark -----
// A single timestamp: feedback at or before it has already been used by a
// training round, so the coach only ever considers strictly newer feedback.

const COACH_STATE_PATH = "agents/_coach-state.yaml"

export async function getCoachWatermark(): Promise<string> {
  try {
    const file = await getGit().getFile(COACH_STATE_PATH)
    const o = yaml.load(file.content, { schema: yaml.JSON_SCHEMA }) as { lastTrainedAt?: string } | null
    return typeof o?.lastTrainedAt === "string" ? o.lastTrainedAt : ""
  } catch {
    return ""
  }
}

export async function setCoachWatermark(at: string): Promise<void> {
  const git = getGit()
  let sha: string | undefined
  try {
    sha = (await git.getFile(COACH_STATE_PATH)).sha
  } catch {
    // file doesn't exist yet
  }
  await git.putFile(
    COACH_STATE_PATH,
    yaml.dump({ lastTrainedAt: at }, { lineWidth: -1 }),
    "chore(agents): advance coach training watermark",
    sha
  )
}
