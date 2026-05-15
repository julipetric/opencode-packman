import { type Plugin, tool } from "@opencode-ai/plugin"
import { join, resolve, isAbsolute, basename, relative } from "path"
import { homedir } from "os"
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, statSync } from "fs"

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const VAULT_DIR = join(CONFIG_DIR, "skill-packs")
const REGISTRY_PATH = join(CONFIG_DIR, "skill-packs.json")
const CONFIG_PATH = join(CONFIG_DIR, "opencode.json")

type PackType = "git" | "npm" | "local"

interface PackRecord {
  source: string
  type: PackType
  enabled: boolean
  path: string
  installed_at: string
}

interface DiscoveredSkillPath {
  containerPath: string
  skillCount: number
  skillNames: string[]
}

async function readJSON(path: string): Promise<Record<string, unknown> | null> {
  try {
    const f = Bun.file(path)
    if (await f.exists()) return (await f.json()) as Record<string, unknown>
  } catch {}
  return null
}

async function writeJSON(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n")
}

function detectType(source: string): PackType {
  if (source.startsWith("git+") || source.startsWith("git@") || source.endsWith(".git")) return "git"
  if (source.startsWith("npm:")) return "npm"
  return "local"
}

function resolvePath(input: string): string {
  if (input.startsWith("~/")) return join(homedir(), input.slice(2))
  if (isAbsolute(input)) return input
  return resolve(process.cwd(), input)
}

function countSkills(dir: string): number {
  if (!existsSync(dir)) return 0
  let count = 0
  function walk(d: string) {
    const entries = readdirSync(d, { withFileTypes: true })
    for (const entry of entries) {
      const p = join(d, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name === "SKILL.md") count++
    }
  }
  walk(dir)
  return count
}

function discoverSkillPaths(packDir: string): DiscoveredSkillPath[] {
  if (!existsSync(packDir)) return []

  const containers = new Map<string, string[]>()

  function walk(dir: string) {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name === "SKILL.md") {
        const skillDir = resolve(p, "..")
        const skillName = basename(skillDir)
        const containerPath = resolve(skillDir, "..")
        const existing = containers.get(containerPath) || []
        existing.push(skillName)
        containers.set(containerPath, existing)
      }
    }
  }
  walk(packDir)

  const results: DiscoveredSkillPath[] = []
  for (const [containerPath, skillNames] of containers.entries()) {
    results.push({
      containerPath,
      skillCount: skillNames.length,
      skillNames: [...new Set(skillNames)].sort(),
    })
  }

  results.sort((a, b) => {
    const aSkills = a.containerPath.endsWith("skills") || a.containerPath.endsWith("skills\\") ? 0 : 1
    const bSkills = b.containerPath.endsWith("skills") || b.containerPath.endsWith("skills\\") ? 0 : 1
    if (aSkills !== bSkills) return aSkills - bSkills
    return b.skillCount - a.skillCount
  })

  return results
}

function formatPathForDisplay(packDir: string, containerPath: string): string {
  const rel = relative(packDir, containerPath)
  if (!rel || rel === "." || rel.startsWith("..")) return containerPath
  return `~/.config/opencode/skill-packs/${basename(packDir)}/${rel.replace(/\\/g, "/")}`
}

function getVaultSubdir(packDir: string, containerPath: string): string {
  const rel = relative(packDir, containerPath)
  if (!rel || rel === "." || rel.startsWith("..")) return containerPath
  return join(VAULT_DIR, basename(packDir), rel)
}

async function readRegistry(): Promise<Record<string, PackRecord>> {
  const data = await readJSON(REGISTRY_PATH)
  if (data && typeof data === "object") return data as Record<string, PackRecord>
  return {}
}

async function writeRegistry(data: Record<string, PackRecord>): Promise<void> {
  if (existsSync(REGISTRY_PATH)) {
    copyFileSync(REGISTRY_PATH, REGISTRY_PATH + ".bak")
  }
  await writeJSON(REGISTRY_PATH, data)
  const bak = REGISTRY_PATH + ".bak"
  if (existsSync(bak)) rmSync(bak, { force: true })
}

function checkNameConflict(name: string): string | null {
  const packDir = join(VAULT_DIR, name)
  const builtinDirs = [
    join(homedir(), ".config", "opencode", "skills"),
    join(process.cwd(), ".opencode", "skills"),
  ]
  for (const dir of builtinDirs) {
    if (packDir === dir || packDir.startsWith(dir)) {
      return dir
    }
  }
  return null
}

export const PackmanPlugin: Plugin = async () => {
  if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true })

  return {
    tool: {
      packman_install: tool({
        description: "Install a skill pack from git, npm, or local source. Stores it in ~/.config/opencode/skill-packs/<name>/ in its own sub-folder. Automatically discovers skill directories.",
        args: {
          name: tool.schema.string().describe("Name for the pack (e.g. superpowers, gsd)"),
          source: tool.schema.string().describe("Source URL or path. Examples: git+https://github.com/obra/superpowers.git, npm:some-pack, /local/path"),
        },
        async execute(args) {
          const { name, source } = args
          const packDir = join(VAULT_DIR, name)

          if (existsSync(packDir)) {
            return `Pack "${name}" is already installed at ${packDir}. Use packman_update to update or packman_uninstall to remove it first.`
          }

          const conflict = checkNameConflict(name)
          if (conflict) {
            return `Warning: pack name "${name}" conflicts with OpenCode built-in path at ${conflict}. Install anyway? Use a different name to avoid ambiguity.`
          }

          const type = detectType(source)
          mkdirSync(packDir, { recursive: true })

          try {
            const $ = Bun.$
            if (type === "git") {
              const url = source.replace(/^git\+/, "")
              await $`git clone --depth 1 ${url} ${packDir}`.quiet()
            } else if (type === "npm") {
              const pkg = source.replace(/^npm:/, "")
              const tmp = join(VAULT_DIR, `.tmp-${name}`)
              mkdirSync(tmp, { recursive: true })
              await $`npm pack ${pkg} --pack-destination ${tmp}`.quiet()
              const tarballs = readdirSync(tmp).filter((f: string) => f.endsWith(".tgz"))
              if (tarballs.length === 0) throw new Error(`npm pack failed for ${pkg}`)
              await $`tar -xzf ${join(tmp, tarballs[0])} -C ${packDir}`.quiet()
              rmSync(tmp, { recursive: true, force: true })
            } else {
              const src = resolvePath(source)
              await $`cp -r ${src}/. ${packDir}`.quiet()
            }

            const registry = await readRegistry()
            registry[name] = {
              source,
              type,
              enabled: false,
              path: packDir,
              installed_at: new Date().toISOString(),
            }
            await writeRegistry(registry)

            const discovered = discoverSkillPaths(packDir)
            const totalSkillCount = discovered.reduce((sum, d) => sum + d.skillCount, 0)

            let msg = `Installed pack "${name}" from ${source} to ${packDir}. Found ${totalSkillCount} skill(s) across ${discovered.length} path(s).\n`
            if (discovered.length > 0) {
              msg += "\nDiscovered skill paths:\n"
              for (const d of discovered) {
                const pathDisplay = formatPathForDisplay(packDir, d.containerPath)
                msg += `  ${pathDisplay} (${d.skillCount} skills: ${d.skillNames.join(", ")})\n`
              }
              msg += `\nActivate: use "enable-pack ${name}" to add the path(s) to skills.paths.`
            } else {
              msg += "\nNo SKILL.md files found in this pack. Verify the source contains compatible skills."
            }
            return msg
          } catch (err) {
            if (existsSync(packDir)) rmSync(packDir, { recursive: true, force: true })
            return `Failed to install pack "${name}": ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),

      packman_enable: tool({
        description: "Enable an installed pack by auto-discovering its skill paths and adding them to skills.paths in opencode.json.",
        args: {
          name: tool.schema.string().describe("Name of installed pack to enable"),
        },
        async execute(args) {
          const registry = await readRegistry()
          const pack = registry[args.name]
          if (!pack) return `Pack "${args.name}" is not installed. Use packman_install first.`

          const config = (await readJSON(CONFIG_PATH)) || {}
          if (!config.skills || typeof config.skills !== "object") config.skills = {} as Record<string, unknown>
          const skills = config.skills as Record<string, unknown>
          if (!Array.isArray(skills.paths)) skills.paths = []

          const discovered = discoverSkillPaths(pack.path)
          if (discovered.length === 0) {
            return `No skill paths found in pack "${args.name}". Verify the pack contains valid skills.`
          }

          const pathsToAdd: string[] = []
          for (const d of discovered) {
            const vaultSubdir = getVaultSubdir(pack.path, d.containerPath)
            if (!(skills.paths as string[]).includes(vaultSubdir)) {
              pathsToAdd.push(vaultSubdir)
            }
          }

          if (pathsToAdd.length === 0) {
            return `Pack "${args.name}" is already enabled (all skill paths are already in skills.paths).`
          }

          ;(skills.paths as string[]).push(...pathsToAdd)
          await writeJSON(CONFIG_PATH, config)

          pack.enabled = true
          registry[args.name] = pack
          await writeRegistry(registry)

          const pathDetails = pathsToAdd.map(p => {
            const rel = relative(pack.path, p)
            if (!rel || rel === "." || rel.startsWith("..")) return `  ${p}`
            return `  ${basename(pack.path)}/${rel.replace(/\\/g, "/")}`
          })

          return [
            `Enabled pack "${args.name}". Added ${pathsToAdd.length} path(s) to skills.paths:`,
            ...pathDetails,
            "Restart OpenCode for the change to take effect.",
          ].join("\n")
        },
      }),

      packman_disable: tool({
        description: "Disable an installed pack by removing its skill paths from skills.paths in opencode.json.",
        args: {
          name: tool.schema.string().describe("Name of installed pack to disable"),
        },
        async execute(args) {
          const registry = await readRegistry()
          const pack = registry[args.name]
          if (!pack) return `Pack "${args.name}" is not installed.`

          const config = (await readJSON(CONFIG_PATH)) || {}
          const skills = config.skills as Record<string, unknown> | undefined
          if (skills && Array.isArray(skills.paths)) {
            const discovered = discoverSkillPaths(pack.path)
            const pathsToRemove = new Set(
              discovered.map(d => getVaultSubdir(pack.path, d.containerPath))
            )
            skills.paths = (skills.paths as string[]).filter((p: string) => !pathsToRemove.has(p))
            await writeJSON(CONFIG_PATH, config)
          }

          pack.enabled = false
          registry[args.name] = pack
          await writeRegistry(registry)

          return `Disabled pack "${args.name}". Restart OpenCode for the change to take effect.`
        },
      }),

      packman_list: tool({
        description: "List all installed skill packs with their status, skill counts, and discovered paths.",
        args: {
          name: tool.schema.string().optional().describe("Optional: show details for a specific pack only"),
        },
        async execute(args) {
          const registry = await readRegistry()
          const names = Object.keys(registry)

          if (args.name) {
            const pack = registry[args.name]
            if (!pack) return `Pack "${args.name}" is not installed.`
            const discovered = discoverSkillPaths(pack.path)
            const lines = [
              `Pack: ${args.name}`,
              `  Source: ${pack.source}`,
              `  Type: ${pack.type}`,
              `  Status: ${pack.enabled ? "enabled" : "disabled"}`,
              `  Path: ${pack.path}`,
              `  Installed: ${pack.installed_at}`,
            ]
            if (discovered.length > 0) {
              lines.push(`  Skill paths:`)
              for (const d of discovered) {
                lines.push(`    ${formatPathForDisplay(pack.path, d.containerPath)} (${d.skillCount} skills: ${d.skillNames.join(", ")})`)
              }
            } else {
              lines.push(`  Skills: none found`)
            }
            return lines.join("\n")
          }

          if (names.length === 0) {
            return "No packs installed. Use packman_install to add one.\n\nExample: install superpowers from git+https://github.com/obra/superpowers.git"
          }

          const lines = names.map(n => {
            const p = registry[n]
            const discovered = discoverSkillPaths(p.path)
            const total = discovered.reduce((s, d) => s + d.skillCount, 0)
            return `  ${p.enabled ? "✓" : "○"} ${n} — ${total} skills (${p.type})`
          })
          return `Installed packs (${names.length}):\n${lines.join("\n")}\n\nUse packman_enable <name> or packman_disable <name> to toggle.`
        },
      }),

      packman_uninstall: tool({
        description: "Uninstall a pack: disable it, remove files, and delete registry entry.",
        args: {
          name: tool.schema.string().describe("Name of pack to uninstall"),
        },
        async execute(args) {
          const registry = await readRegistry()
          const pack = registry[args.name]
          if (!pack) return `Pack "${args.name}" is not installed.`

          if (pack.enabled) {
            const config = (await readJSON(CONFIG_PATH)) || {}
            const skills = config.skills as Record<string, unknown> | undefined
            if (skills && Array.isArray(skills.paths)) {
              const discovered = discoverSkillPaths(pack.path)
              const pathsToRemove = new Set(
                discovered.map(d => getVaultSubdir(pack.path, d.containerPath))
              )
              skills.paths = (skills.paths as string[]).filter((p: string) => !pathsToRemove.has(p))
              await writeJSON(CONFIG_PATH, config)
            }
          }

          rmSync(pack.path, { recursive: true, force: true })
          delete registry[args.name]
          await writeRegistry(registry)

          return `Uninstalled pack "${args.name}".`
        },
      }),

      packman_update: tool({
        description: "Update an installed pack to the latest version from its source.",
        args: {
          name: tool.schema.string().describe("Name of pack to update"),
        },
        async execute(args) {
          const registry = await readRegistry()
          const pack = registry[args.name]
          if (!pack) return `Pack "${args.name}" is not installed.`

          try {
            const $ = Bun.$
            if (pack.type === "git") {
              await $`git -C ${pack.path} pull`.quiet()
            } else if (pack.type === "npm") {
              const pkg = pack.source.replace(/^npm:/, "")
              rmSync(pack.path, { recursive: true, force: true })
              mkdirSync(pack.path, { recursive: true })
              const tmp = join(VAULT_DIR, `.tmp-${args.name}`)
              mkdirSync(tmp, { recursive: true })
              await $`npm pack ${pkg} --pack-destination ${tmp}`.quiet()
              const tarballs = readdirSync(tmp).filter((f: string) => f.endsWith(".tgz"))
              if (tarballs.length > 0) {
                await $`tar -xzf ${join(tmp, tarballs[0])} -C ${pack.path}`.quiet()
              }
              rmSync(tmp, { recursive: true, force: true })
            } else {
              const src = resolvePath(pack.source)
              await $`cp -r ${src}/. ${pack.path}`.quiet()
            }

            const discovered = discoverSkillPaths(pack.path)
            const total = discovered.reduce((s, d) => s + d.skillCount, 0)
            return `Updated pack "${args.name}". Found ${total} skill(s).`
          } catch (err) {
            return `Failed to update pack "${args.name}": ${err instanceof Error ? err.message : String(err)}`
          }
        },
      }),
    },
  }
}
