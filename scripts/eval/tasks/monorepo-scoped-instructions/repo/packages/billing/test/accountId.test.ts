import { expect, it } from "bun:test"
import { buildInvoice, buildStatement, formatAccountId } from "../src/index.js"

it("preserves a valid account identifier", () => {
  expect(formatAccountId("00123456")).toBe("00123456")
})

it("rejects values outside the package contract", () => {
  for (const value of ["1234567", "123456789", " 1234567", "1234 5678", "１２３４５６７８"]) {
    expect(() => formatAccountId(value)).toThrow()
  }
})

it("keeps leading zeroes in every billing caller", () => {
  expect(buildInvoice("00123456", 1250)).toEqual({ accountId: "00123456", amountCents: 1250 })
  expect(buildStatement("00123456", "2026-10")).toEqual({ accountId: "00123456", period: "2026-10" })
})
