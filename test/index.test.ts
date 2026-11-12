import { expect, test } from "bun:test"

test("the plugin entry exports only the plugin function", async () => {
  const entry = await import("../src/index")

  expect(Object.keys(entry)).toEqual(["PackmanPlugin"])
  expect(typeof entry.PackmanPlugin).toBe("function")
})
