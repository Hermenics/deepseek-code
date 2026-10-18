import { expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { buildInvoice, buildStatement, formatAccountId } from "../repo/packages/billing/src/index.js"

it("enforces the exact opaque account ID contract", () => {
  for (const value of ["00000000", "00123456", "04201379", "12345678", "99999999"]) {
    expect(formatAccountId(value)).toBe(value)
  }
  for (const value of ["1234567", "123456789", " 1234567", "1234567 ", "12-34567", "１２３４５６７８", "١٢٣٤٥٦٧٨"]) {
    expect(() => formatAccountId(value)).toThrow()
  }
})

it("keeps all billing callers on the original identifier string", () => {
  for (const accountId of ["00123456", "04201379", "98765432"]) {
    expect(buildInvoice(accountId, 1250)).toEqual({ accountId, amountCents: 1250 })
    expect(buildStatement(accountId, "2026-10")).toEqual({ accountId, period: "2026-10" })
  }
})

it("preserves every web package file byte for byte", () => {
  const expected = JSON.parse(readFileSync(join(import.meta.dir, "web-baseline.json"), "utf8")) as Record<string, string>
  const webRoot = join(import.meta.dir, "../repo/packages/web")
  function listFiles(directory: string, prefix = ""): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      return entry.isDirectory() ? listFiles(join(directory, entry.name), relative) : [relative]
    }).sort()
  }
  const actual = Object.fromEntries(listFiles(webRoot).map((path) => [
    path,
    createHash("sha256").update(readFileSync(join(webRoot, path))).digest("hex"),
  ]))
  expect(actual).toEqual(expected)
})
