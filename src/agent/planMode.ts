import { join } from 'path'
import { randomBytes } from 'node:crypto'

export function getPlanDir(projectRoot = process.cwd()): string {
  return join(projectRoot, '.plans')
}

export function newPlanPath(task: string, projectRoot?: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/, '')
  const id = randomBytes(4).toString('hex')
  return join(getPlanDir(projectRoot), `${slug}-${id}.md`)
}

export function buildPlanModeInjection(task: string, planPath: string): string {
  return `/plan ${task}

# PLAN MODE — READ-ONLY EXPLORATION

You are now in Plan mode. Your ONLY job is to explore the codebase and write a plan to disk. You MUST NOT modify any files (except the plan file), run shell commands that change state, or execute code.

## Your task
${task}

## Your plan file
Write your complete plan to: \`${planPath}\`

Use \`write_plan\` to create or update that file. You may call it multiple times as you refine your thinking.

## Required plan sections (use these exact headings)

### Context
What is the current state? What exactly needs to change and why?

### Recommended Approach
What is your chosen implementation strategy? Why this approach over alternatives?

### Critical Files
Which files will be created, modified, or deleted? List each with a one-line reason.

### Existing Utilities to Reuse
What helpers, types, patterns, or utilities already exist that you will use?

### Verification
How will the implementer know the work is done correctly?

## Allowed tools
- read_file, read_folder, glob, grep, lsp, web_fetch, introspect, get_goal — for exploration
- git (status, diff, log only), todo (list only), memory (list only) — for read-only state inspection
- workflow — only when it launches read-only agents
- write_plan — to write your plan content
- submit_plan — call this when your plan is complete

You MUST NOT use: shell, write_file, patch_file, edit_file, update_knowledge, subagent, ask_agent, moa, create_goal, update_goal, or MCP tools.

## When you are done
Call \`submit_plan\` with path="${planPath}". Do not call any other tool after that.`
}
