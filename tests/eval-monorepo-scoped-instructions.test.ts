import { afterEach, expect, it } from "bun:test"
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runIsolatedChecker } from "../scripts/eval/checker.js"
import { sandboxAvailable } from "../src/utils/platform.js"

const scratch: string[] = []
const sandboxTest = it.skipIf(!sandboxAvailable())
const taskDir = join(import.meta.dir, "../scripts/eval/tasks/monorepo-scoped-instructions")

afterEach(async () => Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true }))))

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "eval-c29-checker-"))
  scratch.push(root)
  await cp(join(taskDir, "repo"), join(root, "repo"), { recursive: true })
  await cp(join(taskDir, "check"), join(root, "__eval_check__"), { recursive: true })
  await writeFile(join(root, "repo/packages/billing/src/accountId.ts"), `export function formatAccountId(value: string): string {
  if (!/^[0-9]{8}$/.test(value)) throw new Error("Invalid account ID")
  return value
}
`)
  await writeFile(join(root, "repo/packages/billing/src/invoice.ts"), `import { formatAccountId } from "./accountId.js"

export interface Invoice { accountId: string; amountCents: number }

export function buildInvoice(accountId: string, amountCents: number): Invoice {
  return { accountId: formatAccountId(accountId), amountCents }
}
`)
  await writeFile(join(root, "repo/packages/billing/src/statement.ts"), `import { formatAccountId } from "./accountId.js"

export interface Statement { accountId: string; period: string }

export function buildStatement(accountId: string, period: string): Statement {
  return { accountId: formatAccountId(accountId), period }
}
`)
  return root
}

async function runChecker(root: string) {
  return runIsolatedChecker(["test", "./__eval_check__"], root, { readOnlyPaths: ["__eval_check__"] })
}

sandboxTest("C29 checker accepts the reference and rejects hardcoded IDs, coercion, and web-package edits", async () => {
  const root = await fixture()
  const reference = await runChecker(root)
  expect(reference.exitCode).toBe(0)
  expect(reference.positiveTestEvidence).toBe(true)

  await writeFile(join(root, "repo/packages/billing/src/accountId.ts"), `export function formatAccountId(value: string): string {
  const known = new Set(["00000000", "00123456", "99999999"])
  if (!known.has(value)) throw new Error("Invalid account ID")
  return value
}
`)
  const hardcodedIds = await runChecker(root)
  expect(hardcodedIds.exitCode).not.toBe(0)

  await writeFile(join(root, "repo/packages/billing/src/accountId.ts"), `export function formatAccountId(value: string): string {
  if (!/^[0-9]{8}$/.test(value)) throw new Error("Invalid account ID")
  return value
}
`)
  await writeFile(join(root, "repo/packages/billing/src/statement.ts"), `import { formatAccountId } from "./accountId.js"

export interface Statement { accountId: string; period: string }

export function buildStatement(accountId: string, period: string): Statement {
  return { accountId: formatAccountId(Number(accountId).toString()), period }
}
`)
  const coercedCaller = await runChecker(root)
  expect(coercedCaller.exitCode).not.toBe(0)

  await writeFile(join(root, "repo/packages/billing/src/statement.ts"), `import { formatAccountId } from "./accountId.js"

export interface Statement { accountId: string; period: string }

export function buildStatement(accountId: string, period: string): Statement {
  return { accountId: formatAccountId(accountId), period }
}
`)
  await writeFile(join(root, "repo/packages/web/src/format.ts"), `export function formatForDisplay(value: number): string {
  return String(value)
}
`)
  const webMutation = await runChecker(root)
  expect(webMutation.exitCode).not.toBe(0)
})
