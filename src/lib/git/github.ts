import { Octokit } from "octokit"
import type {
  GitProvider,
  GitFile,
  GitTreeEntry,
  GitCommitMeta,
  GitDescribe,
} from "./types"
import { GitNotFoundError } from "./types"
import { maskSecret, runHttpProbe, type ProbeTrace } from "../diagnostics"

const GITHUB_BASE_URL = "https://api.github.com"

export class GitHubProvider implements GitProvider {
  readonly name = "github" as const
  readonly branch: string
  private octokit: Octokit
  private owner: string
  private repo: string
  private token: string

  constructor(opts: {
    token: string
    owner: string
    repo: string
    branch: string
  }) {
    this.octokit = new Octokit({ auth: opts.token })
    this.owner = opts.owner
    this.repo = opts.repo
    this.branch = opts.branch
    this.token = opts.token
  }

  async listTree(prefix: string): Promise<GitTreeEntry[]> {
    try {
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${this.branch}`,
      })
      const { data: commitData } = await this.octokit.rest.git.getCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: refData.object.sha,
      })
      const { data: treeData } = await this.octokit.rest.git.getTree({
        owner: this.owner,
        repo: this.repo,
        tree_sha: commitData.tree.sha,
        recursive: "true",
      })
      return treeData.tree
        .filter(
          (e) =>
            e.path?.startsWith(prefix) && e.type === "blob" && typeof e.sha === "string"
        )
        .map((e) => ({
          path: e.path!,
          sha: e.sha!,
          type: "blob" as const,
        }))
    } catch (error: unknown) {
      if (is404(error)) return []
      throw error
    }
  }

  async getFile(path: string): Promise<GitFile> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: this.branch,
      })
      if (
        Array.isArray(data) ||
        !("content" in data) ||
        typeof data.content !== "string"
      ) {
        throw new GitNotFoundError(`Path is not a file: ${path}`)
      }
      const content = Buffer.from(data.content, "base64").toString("utf-8")
      return { path, content, sha: data.sha }
    } catch (error: unknown) {
      if (is404(error)) {
        throw new GitNotFoundError(`File not found: ${path}`)
      }
      throw error
    }
  }

  async getBlob(sha: string): Promise<string> {
    const { data } = await this.octokit.rest.git.getBlob({
      owner: this.owner,
      repo: this.repo,
      file_sha: sha,
    })
    return Buffer.from(data.content, "base64").toString("utf-8")
  }

  async putFile(
    path: string,
    content: string,
    message: string,
    sha?: string
  ): Promise<void> {
    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      content: Buffer.from(content).toString("base64"),
      branch: this.branch,
      ...(sha ? { sha } : {}),
    })
  }

  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    await this.octokit.rest.repos.deleteFile({
      owner: this.owner,
      repo: this.repo,
      path,
      message,
      sha,
      branch: this.branch,
    })
  }

  async listFileHistory(path: string, limit: number): Promise<GitCommitMeta[]> {
    const { data } = await this.octokit.rest.repos.listCommits({
      owner: this.owner,
      repo: this.repo,
      path,
      sha: this.branch,
      per_page: limit,
    })
    return data.map((commit) => ({
      sha: commit.sha.slice(0, 7),
      message: commit.commit.message,
      author: commit.commit.author?.name || "unknown",
      date: commit.commit.author?.date || "",
    }))
  }

  describe(): GitDescribe {
    return {
      provider: "github",
      baseUrl: GITHUB_BASE_URL,
      branch: this.branch,
      repoIdentifier: `${this.owner}/${this.repo}`,
      authScheme: "Bearer (Fine-grained PAT)",
      authHint: maskSecret(this.token),
    }
  }

  async probe(): Promise<ProbeTrace> {
    // GET /repos/{owner}/{repo}/branches/{branch} — small, reliable,
    // verifies token + repo + branch in one shot.
    return runHttpProbe({
      method: "GET",
      url: `${GITHUB_BASE_URL}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/branches/${encodeURIComponent(this.branch)}`,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      providerLabel: "GitHub",
    })
  }
}

function is404(err: unknown): boolean {
  return (
    err instanceof Error &&
    "status" in err &&
    (err as { status: number }).status === 404
  )
}
