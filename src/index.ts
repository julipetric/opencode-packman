import { type Plugin, tool } from "@opencode-ai/plugin"
import { join, basename, relative } from "path"
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from "fs"
import {
  CONFIG_PATH,
  REGISTRY_PATH,
  VAULT_DIR,
  addSkillPaths,
  checkNameConflict,
  detectType,
  discoverSkillPaths,
  formatPathForDisplay,
  getVaultSubdir,
  packSkillPaths,
  parseJSONObject,
  removeSkillPaths,
  resolvePath,
  type PackRecord,
} from "./packs"

/**
 * Reads a JSON file that holds an object. A missing or empty file is an empty object; a file
 * that is not a JSON object throws, so that the tools never overwrite a file they could not
 * read.
 */
async function readJSONObject(path: string): Promise<Record<string, unknown>> {
  const file = Bun.file(path)
  if (!(await file.exists())) return {}
  return parseJSONObject(await file.text(), path)
}

const readConfig = () => readJSONObject(CONFIG_PATH)

async function writeJSON(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n")
}

async function readRegistry(): Promise<Record<string, PackRecord>> {
  return (await readJSONObject(REGISTRY_PATH)) as Record<string, PackRecord>
}

/** Tool reply for a registry that could not be read; no tool writes the registry in that case. */
function registryError(err: unknown): string {
  return `Cannot read the pack registry: ${err instanceof Error ? err.message : String(err)}`
}

async function writeRegistry(data: Record<string, PackRecord>): Promise<void> {
  if (existsSync(REGISTRY_PATH)) {
    copyFileSync(REGISTRY_PATH, REGISTRY_PATH + ".bak")
  }
  await writeJSON(REGISTRY_PATH, data)
  const bak = REGISTRY_PATH + ".bak"
  if (existsSync(bak)) rmSync(bak, { force: true })
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
            return `Warning: pack name "${name}" conflicts with OpenCode built-in path at ${conflict}. Use a different name.`
          }

          try {
            await readRegistry()
          } catch (err) {
            return registryError(err)
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
              cpSync(src, packDir, { recursive: true })
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
              msg += `\nActivate: ask the agent to "enable pack ${name}" (packman_enable) to add the path(s) to skills.paths.`
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
          let registry: Record<string, PackRecord>
          try {
            registry = await readRegistry()
          } catch (err) {
            return registryError(err)
          }
          const pack = registry[args.name]
          if (!pack) return `Pack "${args.name}" is not installed. Use packman_install first.`

          let config: Record<string, unknown>
          try {
            config = await readConfig()
          } catch (err) {
            return `Cannot enable pack "${args.name}": ${err instanceof Error ? err.message : String(err)}`
          }

          const discovered = discoverSkillPaths(pack.path)
          if (discovered.length === 0) {
            return `No skill paths found in pack "${args.name}". Verify the pack contains valid skills.`
          }

          let pathsToAdd: string[]
          try {
            pathsToAdd = addSkillPaths(
              config,
              discovered.map(d => getVaultSubdir(pack.path, d.containerPath)),
            )
          } catch (err) {
            return `Cannot enable pack "${args.name}": ${err instanceof Error ? err.message : String(err)}`
          }

          if (pathsToAdd.length === 0) {
            return `Pack "${args.name}" is already enabled (all skill paths are already in skills.paths).`
          }

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
          let registry: Record<string, PackRecord>
          try {
            registry = await readRegistry()
          } catch (err) {
            return registryError(err)
          }
          const pack = registry[args.name]
          if (!pack) return `Pack "${args.name}" is not installed.`

          try {
            const config = await readConfig()
            if (removeSkillPaths(config, packSkillPaths(pack.path))) {
              await writeJSON(CONFIG_PATH, config)
            }
          } catch (err) {
            return `Cannot disable pack "${args.name}": ${err instanceof Error ? err.message : String(err)}`
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
          let registry: Record<string, PackRecord>
          try {
            registry = await readRegistry()
          } catch (err) {
            return registryError(err)
          }
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
          let registry: Record<string, PackRecord>
          try {
            registry = await readRegistry()
          } catch (err) {
            return registryError(err)
          }
          const pack = registry[args.name]
          if (!pack) return `Pack "${args.name}" is not installed.`

          if (pack.enabled) {
            try {
              const config = await readConfig()
              if (removeSkillPaths(config, packSkillPaths(pack.path))) {
                await writeJSON(CONFIG_PATH, config)
              }
            } catch (err) {
              return `Cannot uninstall pack "${args.name}": ${err instanceof Error ? err.message : String(err)} The pack was not removed.`
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
          let registry: Record<string, PackRecord>
          try {
            registry = await readRegistry()
          } catch (err) {
            return registryError(err)
          }
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
              cpSync(src, pack.path, { recursive: true })
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
