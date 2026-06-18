// Solution store — list / get / save / delete solution YAML files at
// solutions/<id>.yaml. Mirrors the component store in github.ts, routing
// through the same GitProvider (getGit).

import yaml from "js-yaml"
import { getGit } from "./git"
import { solutionToYaml } from "./solution-yaml"
import type { Solution, SolutionWithSha } from "./types"
import { getLogger } from "./log"

export async function listSolutions(): Promise<Solution[]> {
  const git = getGit()
  let entries: { path: string; sha: string }[]
  try {
    entries = await git.listTree("solutions/")
  } catch {
    // solutions/ may not exist yet — treat as empty catalog.
    return []
  }
  const yamlFiles = entries.filter((e) => e.path.endsWith(".yaml"))

  const solutions = await Promise.all(
    yamlFiles.map(async (file) => {
      try {
        const content = await git.getBlob(file.sha)
        return yaml.load(content, { schema: yaml.JSON_SCHEMA }) as Solution
      } catch (err) {
        getLogger().error(`Failed to fetch solution ${file.path}`, {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      }
    })
  )

  return solutions.filter(Boolean) as Solution[]
}

export async function getSolution(id: string): Promise<SolutionWithSha> {
  const git = getGit()
  const file = await git.getFile(`solutions/${id}.yaml`)
  const solution = yaml.load(file.content, { schema: yaml.JSON_SCHEMA }) as Solution
  return { ...solution, sha: file.sha }
}

export async function saveSolution(solution: Solution, sha?: string): Promise<void> {
  const git = getGit()
  const path = `solutions/${solution.id}.yaml`
  const content = solutionToYaml(solution)
  const message = sha
    ? `feat: update solution ${solution.id}`
    : `feat: add solution ${solution.id}`
  await git.putFile(path, content, message, sha)
}

export async function deleteSolution(id: string, sha: string): Promise<void> {
  const git = getGit()
  await git.deleteFile(`solutions/${id}.yaml`, sha, `feat: remove solution ${id}`)
}
