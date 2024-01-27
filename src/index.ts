import fs from "node:fs"
import { makeScope, renderScope, LambScope } from "./scope"

// test

const testscope = await makeScope(
  {},
  "./testscope",
  undefined as unknown as LambScope
)

fs.rmSync("./out", { recursive: true, force: true })
fs.mkdirSync("./out")
await renderScope({}, testscope, "./out")
