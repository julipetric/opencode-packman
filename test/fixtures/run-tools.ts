// Runs a sequence of packman tool calls and prints, for each one, the tool output plus the
// resulting opencode.json and skill-packs.json. The plugin resolves its config paths from the
// home directory when it is imported, so tests run this script in a subprocess whose home is
// a temp directory.
import { existsSync, readFileSync } from "fs"
import { PackmanPlugin } from "../../src/index"
import { CONFIG_PATH, REGISTRY_PATH } from "../../src/packs"

type Call = [tool: string, args: Record<string, unknown>]

// Unparsable files come back as their raw text so that tests can assert on them.
function readJSON(path: string): unknown {
  if (!existsSync(path)) return null
  const text = readFileSync(path, "utf8")
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const calls = JSON.parse(process.argv[2]) as Call[]
const hooks = await PackmanPlugin({} as never)

const steps: { output: string; config: unknown; registry: unknown }[] = []
for (const [name, args] of calls) {
  const output = await hooks.tool![name].execute(args as never, {} as never)
  steps.push({ output: String(output), config: readJSON(CONFIG_PATH), registry: readJSON(REGISTRY_PATH) })
}

console.log(JSON.stringify(steps))
