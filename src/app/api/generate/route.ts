import { NextResponse } from "next/server"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidAudience, sanitizeForPrompt } from "@/lib/validate"
import {
  getLLM,
  isLLMConfigured,
  LLM_DISABLED_MESSAGE,
} from "@/lib/llm"
import { withRouteContext } from "@/lib/route-context"
import { getAgent, agentInstruction } from "@/lib/agents"
import { getLogger } from "@/lib/log"

export async function POST(request: Request) {
 return withRouteContext(request, () => doPost(request))
}

async function doPost(request: Request) {
  try {
    if (!isLLMConfigured()) {
      return NextResponse.json({ error: LLM_DISABLED_MESSAGE }, { status: 503 })
    }
    const llm = await getLLM()
    const clientIp = request.headers.get("x-forwarded-for") || "unknown"
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before trying again." },
        { status: 429 }
      )
    }

    const body = await request.json()
    const { audience, documentType, documentTypeLabel } = body

    if (!documentType && !isValidAudience(audience)) {
      return NextResponse.json(
        { error: "Invalid audience. Must be Technical, Business, or Executive." },
        { status: 400 }
      )
    }

    const validDocTypes = ["detailed-solution", "audit-report", "security-report"]
    if (documentType && !validDocTypes.includes(documentType)) {
      return NextResponse.json(
        { error: "Invalid document type." },
        { status: 400 }
      )
    }

    const attachments = body.attachments || {}
    const attachmentContext = buildAttachmentContext(attachments)

    let prompt: string

    if (documentType === "detailed-solution") {
      // Detailed Solution Description — same as audience-based Technical but with custom title
      if (body.componentId) {
        prompt = buildComponentPrompt(sanitizeForPrompt(body.yamlContent), "Technical", attachmentContext, "Detailed Solution Description")
      } else if (body.diagramName) {
        prompt = buildDiagramPrompt(
          sanitizeForPrompt(body.diagramName),
          sanitizeForPrompt(body.componentsYaml),
          "Technical",
          attachmentContext,
          "Detailed Solution Description"
        )
      } else {
        return NextResponse.json(
          { error: "No component or diagram selected" },
          { status: 400 }
        )
      }
    } else if (documentType) {
      // Audit Report or Security Report
      if (body.componentId) {
        prompt = buildDocTypeComponentPrompt(sanitizeForPrompt(body.yamlContent), documentType, documentTypeLabel || documentType, attachmentContext)
      } else if (body.diagramName) {
        prompt = buildDocTypeDiagramPrompt(
          sanitizeForPrompt(body.diagramName),
          sanitizeForPrompt(body.componentsYaml),
          documentType,
          documentTypeLabel || documentType,
          attachmentContext
        )
      } else {
        return NextResponse.json(
          { error: "No component or diagram selected" },
          { status: 400 }
        )
      }
    } else if (body.componentId) {
      prompt = buildComponentPrompt(sanitizeForPrompt(body.yamlContent), audience, attachmentContext)
    } else if (body.diagramName) {
      prompt = buildDiagramPrompt(
        sanitizeForPrompt(body.diagramName),
        sanitizeForPrompt(body.componentsYaml),
        audience,
        attachmentContext
      )
    } else {
      return NextResponse.json(
        { error: "No component or diagram selected" },
        { status: 400 }
      )
    }

    // Swap the hardcoded persona opener for the configurable doc-writer
    // agent prompt (+ its lessons); the task scaffolding stays intact.
    const docWriterLead = agentInstruction(await getAgent("doc-writer"))
    const PERSONA =
      "You are a documentation writer producing clear, professional architecture documents. Your writing must sound human and natural — never like AI-generated content."
    prompt = prompt.startsWith(PERSONA)
      ? docWriterLead + prompt.slice(PERSONA.length)
      : docWriterLead + "\n\n" + prompt

    const generatedText = await llm.complete({ prompt, maxTokens: 4096 })

    return NextResponse.json({ generated: generatedText })
  } catch (error) {
    getLogger().error("Failed to generate doc", { err: error instanceof Error ? error.message : "Unknown error" })
    return NextResponse.json(
      { error: "Failed to generate documentation" },
      { status: 500 }
    )
  }
}

function buildComponentPrompt(yamlContent: string, audience: string, attachmentContext: string, docTitle?: string): string {
  const titleInstruction = docTitle
    ? `# [Component Name] — ${docTitle}`
    : `# [Component Name]`

  return `You are a documentation writer producing clear, professional architecture documents. Your writing must sound human and natural — never like AI-generated content.

${writingStyleRules()}

Audience: ${audience}
${audienceGuidance(audience)}

Component definition (YAML):
\`\`\`yaml
${yamlContent}
\`\`\`
${attachmentContext}

Generate a well-structured document in Markdown format with these chapters in this exact order:

${titleInstruction}

## Table of Contents
(list all chapters below as a numbered list)

## 1. Version History
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | [today's date] | Auto-generated | Initial version |

## 2. Document Purpose
Explain why this document exists and who should read it.

## 3. What This Component Does
Focus on what it does for the business — what problems it solves, what it enables. Not what it "is" technically.

## 4. Key Capabilities
What can people do with it? What does it make possible?

## 5. How It Connects to Other Systems
Describe the connections in plain language — what goes in, what comes out, who depends on it.

Include a mermaid diagram showing the connections. Use a \`\`\`mermaid code block with a flowchart (graph LR or graph TD). Use short, readable node labels. Keep it simple — only show real connections from the data. Example format:
\`\`\`mermaid
graph LR
  A[Component A] -->|sends data| B[Component B]
  B -->|returns result| C[Component C]
\`\`\`

## 6. Data Perspective
Based on the component's interfaces, relationships, and descriptions, describe what data this component works with. What data comes in? What data goes out? What does it store or transform?

Include a mermaid ER diagram showing the key data entities this component likely deals with. Extrapolate from the interface names, relationship names, and descriptions. Use a \`\`\`mermaid code block with erDiagram syntax. Keep it practical — show 3-8 entities with their relationships. Example format:
\`\`\`mermaid
erDiagram
  ORDER ||--o{ ORDER_LINE : contains
  ORDER {
    string orderId
    date createdAt
    string status
  }
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string customerId
    string name
  }
\`\`\`

Mark this section clearly as an **informed estimate** based on available data, not a verified data model.

## 7. Current State
Status, who is responsible, any known risks.

Focus on accurately describing what is defined in the data. Do not invent information that is not present. The Data Perspective chapter is the only exception — there you may reasonably extrapolate from interface names, types, and descriptions, but clearly label it as an estimate.`
}

function buildDiagramPrompt(
  diagramName: string,
  componentsYaml: string,
  audience: string,
  attachmentContext: string,
  docTitle?: string
): string {
  const titleText = docTitle
    ? `# ${diagramName} — ${docTitle}`
    : `# ${diagramName} — System Overview`

  return `You are a documentation writer producing clear, professional architecture documents. Your writing must sound human and natural — never like AI-generated content.

${writingStyleRules()}

Diagram: ${diagramName}
Audience: ${audience}
${audienceGuidance(audience)}

The diagram contains the following components from the architecture catalog:

\`\`\`yaml
${componentsYaml}
\`\`\`
${attachmentContext}

Generate a well-structured document in Markdown format with these chapters in this exact order:

${titleText}

## Table of Contents
(list all chapters below as a numbered list)

## 1. Version History
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | [today's date] | Auto-generated | Initial version |

## 2. Document Purpose
Explain why this document exists and who should read it.

## 3. What This System Does
Describe the overall purpose — what business problems this system solves, what it enables. Focus on outcomes, not on the technology itself.

## 4. How It Works (High Level)
Walk through the main flow — what happens when the system is used. Describe it as a story: data comes in here, gets processed there, results go here. Keep it accessible.

## 5. Building Blocks
Describe each component in the system — not technically, but by what role it plays and what it does.

## 6. How the Parts Connect
Describe how data and requests flow between the building blocks. What talks to what, and why.

Include a mermaid diagram showing the connections between components. Use a \`\`\`mermaid code block with a flowchart (graph LR or graph TD). Use short, readable node labels. Keep it simple — only show real connections from the data. Example format:
\`\`\`mermaid
graph LR
  A[Component A] -->|sends data| B[Component B]
  B -->|returns result| C[Component C]
\`\`\`

## 7. Data Perspective
Based on the components' interfaces, relationships, and descriptions, describe what data flows through this system. What are the key data entities? What gets created, read, updated, or passed between components?

Include a mermaid ER diagram showing the key data entities across the system. Extrapolate from interface names, relationship types, component descriptions, and connector labels. Use a \`\`\`mermaid code block with erDiagram syntax. Keep it practical — show 5-12 entities with their relationships. Example format:
\`\`\`mermaid
erDiagram
  ORDER ||--o{ ORDER_LINE : contains
  ORDER {
    string orderId
    date createdAt
    string status
  }
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string customerId
    string name
  }
\`\`\`

Mark this section clearly as an **informed estimate** based on available data, not a verified data model.

## 8. Current State
Overall maturity, ownership, any known risks or limitations.

Focus on accurately describing what is defined in the data. Use the interfaces, relationships, types, and descriptions to explain the system. Do not invent information that is not present. The Data Perspective chapter is the only exception — there you may reasonably extrapolate from interface names, types, and descriptions, but clearly label it as an estimate.`
}

function writingStyleRules(): string {
  return `CRITICAL WRITING RULES:
- Write like a knowledgeable colleague explaining things over coffee — clear, direct, no fluff.
- NEVER use words like: leverage, utilize, robust, seamless, cutting-edge, comprehensive, streamline, facilitate, holistic, synergy, ecosystem, paradigm, empower, innovative, scalable, optimize, orchestrate, harness, drive (as in "drives value"), enable (overused), ensure (overused), foster.
- NEVER start sentences with "This component..." or "This system..." repeatedly. Vary your sentence structure.
- Use short sentences. If a sentence has more than 20 words, split it.
- Do not use marketing language or hype. State facts plainly.
- Prefer everyday words: "uses" not "utilizes", "connects to" not "interfaces with", "handles" not "facilitates", "runs" not "orchestrates".
- Do not pad with filler phrases like "It is worth noting that" or "It is important to understand that". Just say the thing.
- No bullet points that just restate the heading in different words.`
}

function audienceGuidance(audience: string): string {
  switch (audience) {
    case "Technical":
      return "Write for software engineers and architects. You may use technical terms, mention protocols and patterns. But still keep it readable — no walls of jargon."
    case "Business":
      return "Write for business stakeholders and product managers. Explain what things do and why they matter — not how they work internally. Zero IT jargon. If you must reference a technical concept, explain it in one plain sentence."
    case "Executive":
      return "Write for C-level executives. Be brief and direct. Focus on what this does for the business, what risks exist, and what the current state is. Maximum clarity, minimum words. No technical terms at all."
    default:
      return ""
  }
}

function docTypeGuidance(docType: string): string {
  switch (docType) {
    case "audit-report":
      return `You are writing an Audit Report — a structured assessment document that evaluates the component/system against best practices. Focus on: compliance with standards, identified gaps, risk areas, recommendations for improvement, and overall maturity assessment. Write in a formal, objective tone suitable for auditors and compliance officers.`
    case "security-report":
      return `You are writing a Security Report — a focused security assessment document. Analyze: attack surface, authentication/authorization mechanisms, data protection, known vulnerabilities or risks, security controls in place, and recommendations. Write for security engineers and CISOs. Be specific about threats and mitigations.`
    default:
      return ""
  }
}

function docTypeChapters(docType: string, name: string, isComponent: boolean): string {
  const entityWord = isComponent ? "Component" : "System"

  switch (docType) {
    case "audit-report":
      return `# ${name} — Audit Report

## Table of Contents
(list all chapters below as a numbered list)

## 1. Audit Metadata
| Field | Value |
|-------|-------|
| Audit Date | [today's date] |
| Scope | ${name} |
| Generated By | Auto-generated |

## 2. Executive Summary
Brief overview of findings — what's good, what needs attention, overall risk level.

## 3. ${entityWord} Overview
Factual summary of what this ${entityWord.toLowerCase()} does and its role in the architecture.

## 4. Architecture Assessment
Evaluate the architecture against best practices. Are patterns appropriate? Is the design maintainable? Are there single points of failure?

## 5. Interface & Integration Review
Assess all external connections. Are protocols appropriate? Is error handling in place? Are there undocumented dependencies?

## 6. Data Governance
How is data handled? Is there proper classification? Are there data quality concerns? Privacy implications?

## 7. Operational Readiness
Is monitoring in place? Are there runbooks? Disaster recovery? SLAs defined?

## 8. Risk Register
| Risk | Severity | Likelihood | Impact | Recommendation |
|------|----------|-----------|--------|----------------|
(list identified risks as table rows)

## 9. Findings & Recommendations
Numbered list of specific findings with priority (Critical / High / Medium / Low) and concrete recommendations.

## 10. Overall Assessment
Summary maturity rating and key next steps.`

    case "security-report":
      return `# ${name} — Security Assessment Report

## Table of Contents
(list all chapters below as a numbered list)

## 1. Assessment Metadata
| Field | Value |
|-------|-------|
| Assessment Date | [today's date] |
| Scope | ${name} |
| Generated By | Auto-generated |

## 2. Executive Summary
Brief security posture overview — key risks, overall threat level, most urgent recommendations.

## 3. ${entityWord} Overview
Factual summary focused on security-relevant aspects — what it does, what data it handles, who accesses it.

## 4. Attack Surface Analysis
What is exposed? External APIs, user interfaces, admin interfaces, message queues, file endpoints. For each: what could an attacker target?

## 5. Authentication & Authorization
How are users and systems authenticated? What authorization model is used? Are there privilege escalation risks?

## 6. Data Protection
What sensitive data is handled? Is it encrypted at rest and in transit? Are there data leakage risks? PII/GDPR considerations?

## 7. Integration Security
Are external connections secured? TLS everywhere? API key management? Input validation on external data?

## 8. Vulnerability Assessment
Based on the architecture and interfaces, what are the likely vulnerability categories? (e.g., injection, broken access control, SSRF, etc.)

## 9. Threat Matrix
| Threat | Category | Severity | Current Mitigation | Gap |
|--------|----------|----------|-------------------|-----|
(list identified threats as table rows)

## 10. Recommendations
Prioritized list of security improvements. For each: what to do, why it matters, effort estimate (Low/Medium/High).

## 11. Overall Security Posture
Summary rating and key next steps.`

    default:
      return ""
  }
}

function buildDocTypeComponentPrompt(yamlContent: string, docType: string, docTypeLabel: string, attachmentContext: string): string {
  const name = yamlContent.match(/^id:\s*(.+)$/m)?.[1]?.trim() || "Component"
  return `You are a documentation writer producing clear, professional architecture documents. Your writing must sound human and natural — never like AI-generated content.

${writingStyleRules()}

${docTypeGuidance(docType)}

Component definition (YAML):
\`\`\`yaml
${yamlContent}
\`\`\`
${attachmentContext}

Generate a well-structured document in Markdown format with these chapters in this exact order:

${docTypeChapters(docType, name, true)}

For mermaid diagrams: use \`\`\`mermaid code blocks. Use short, readable labels. Only show real connections from the data.

Focus on accurately describing what is defined in the data. Do not invent information that is not present. Where you extrapolate (especially data models), clearly label it as an estimate.`
}

function buildDocTypeDiagramPrompt(diagramName: string, componentsYaml: string, docType: string, docTypeLabel: string, attachmentContext: string): string {
  return `You are a documentation writer producing clear, professional architecture documents. Your writing must sound human and natural — never like AI-generated content.

${writingStyleRules()}

${docTypeGuidance(docType)}

Diagram: ${diagramName}

The diagram contains the following components from the architecture catalog:

\`\`\`yaml
${componentsYaml}
\`\`\`
${attachmentContext}

Generate a well-structured document in Markdown format with these chapters in this exact order:

${docTypeChapters(docType, diagramName, false)}

For mermaid diagrams: use \`\`\`mermaid code blocks. Use short, readable labels. Only show real connections from the data.

Focus on accurately describing what is defined in the data. Do not invent information that is not present. Where you extrapolate (especially data models), clearly label it as an estimate.`
}

function buildAttachmentContext(attachments: Record<string, string>): string {
  const sections: string[] = []

  if (attachments.businessRequirement) {
    sections.push(`
ADDITIONAL CONTEXT — Business Requirement Document (PDF text):
The following is extracted text from a business requirement document. Use it to enrich the document with business context, requirements, and goals. Reference specific requirements where relevant.
\`\`\`
${sanitizeForPrompt(attachments.businessRequirement)}
\`\`\``)
  }

  if (attachments.dataModel) {
    sections.push(`
ADDITIONAL CONTEXT — Data Model (ERD):
The following is an ERD (Entity Relationship Diagram) definition. Use it to make the Data Perspective chapter more accurate. Base the mermaid erDiagram on this real data model instead of extrapolating.
\`\`\`
${sanitizeForPrompt(attachments.dataModel)}
\`\`\``)
  }

  if (attachments.processModel) {
    sections.push(`
ADDITIONAL CONTEXT — Process Model (BPMN):
The following is a BPMN (Business Process Model) definition. Use it to describe the business processes and workflows in the document. You may reference specific process steps, gateways, and flows.
\`\`\`
${sanitizeForPrompt(attachments.processModel)}
\`\`\``)
  }

  return sections.join("\n")
}
