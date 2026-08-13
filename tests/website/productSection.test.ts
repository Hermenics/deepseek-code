import { expect, test } from "bun:test"
import { currentProduct } from "../../website/src/lib/productSection.js"

test("keeps the active product on its own section", () => {
  expect(currentProduct("/")).toBe("code")
  expect(currentProduct("/docs")).toBe("docs")
  expect(currentProduct("/docs/quickstart")).toBe("docs")
})
