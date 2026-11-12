// Pack helpers used by the plugin tools: source detection, path handling, skill discovery
// and edits to `skills.paths`. The plugin entry (`index.ts`) exports only the plugin function,
// because OpenCode calls every export of an entry module as a plugin.

import { join, resolve, isAbsolute, basename, relative } from "path"
import { homedir } from "os"
import { existsSync, readdirSync } from "fs"

export const CONFIG_DIR = join(homedir(), ".config", "opencode")
export const VAULT_DIR = join(CONFIG_DIR, "skill-packs")
export const REGISTRY_PATH = join(CONFIG_DIR, "skill-packs.json")
export const CONFIG_PATH = join(CONFIG_DIR, "opencode.json")

export type PackType = "git" | "npm" | "local"

export interface PackRecord {
  source: string
  type: PackType
  enabled: boolean
  path: string
  installed_at: string
}

export interface DiscoveredSkillPath {
  containerPath: string
  skillCount: number
  skillNames: string[]
}

/**
 * Classifies a pack source. Git sources are recognised by a `git+`, `git@`, `http://` or
 * `https://` prefix or a `.git` suffix, npm sources by an `npm:` prefix; anything else is a
 * local path.
 */
export function detectType(source: string): PackType {
  if (/^(git\+|git@|https?:\/\/)/.test(source) || source.endsWith(".git")) return "git"
  if (source.startsWith("npm:")) return "npm"
  return "local"
}

/** Expands `~/`, keeps absolute paths and resolves relative ones against the working directory. */
export function resolvePath(input: string, cwd: string = process.cwd()): string {
  if (input.startsWith("~/")) return join(homedir(), input.slice(2))
  if (isAbsolute(input)) return input
  return resolve(cwd, input)
}

/**
 * Finds every directory that contains skills inside a pack. A skill is a folder holding a
 * `SKILL.md`; its parent folder is the container that goes into `skills.paths`. Containers
 * named `skills` come first, then the ones holding more skills.
 */
export function discoverSkillPaths(packDir: string): DiscoveredSkillPath[] {
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

/** Shows a container as a `~/.config/opencode/skill-packs/<pack>/...` path; the pack root itself stays absolute. */
export function formatPathForDisplay(packDir: string, containerPath: string): string {
  const rel = relative(packDir, containerPath)
  if (!rel || rel === "." || rel.startsWith("..")) return containerPath
  return `~/.config/opencode/skill-packs/${basename(packDir)}/${rel.replace(/\\/g, "/")}`
}

/** Absolute path of a container inside the vault: the value written to `skills.paths`. */
export function getVaultSubdir(packDir: string, containerPath: string, vaultDir: string = VAULT_DIR): string {
  const rel = relative(packDir, containerPath)
  if (!rel || rel === "." || rel.startsWith("..")) return containerPath
  return join(vaultDir, basename(packDir), rel)
}

/**
 * Returns the OpenCode skills directory a pack name would land in, or null when the name is
 * safe. A name such as `../skills` resolves into OpenCode's own skills directory.
 */
export function checkNameConflict(
  name: string,
  vaultDir: string = VAULT_DIR,
  builtinDirs: string[] = [join(homedir(), ".config", "opencode", "skills"), join(process.cwd(), ".opencode", "skills")],
): string | null {
  const packDir = join(vaultDir, name)
  for (const dir of builtinDirs) {
    if (packDir === dir || packDir.startsWith(dir)) {
      return dir
    }
  }
  return null
}

/**
 * Appends the given paths to `config.skills.paths`, creating the structure when missing, and
 * returns the ones that were not already present. Every other key of the config is kept.
 */
export function addSkillPaths(config: Record<string, unknown>, paths: string[]): string[] {
  if (!config.skills || typeof config.skills !== "object") config.skills = {} as Record<string, unknown>
  const skills = config.skills as Record<string, unknown>
  if (!Array.isArray(skills.paths)) skills.paths = []
  const current = skills.paths as string[]

  const added = paths.filter(p => !current.includes(p))
  current.push(...added)
  return added
}

/**
 * Removes the given paths from `config.skills.paths`. Returns false, leaving the config
 * untouched, when it has no `skills.paths` list.
 */
export function removeSkillPaths(config: Record<string, unknown>, paths: Iterable<string>): boolean {
  const skills = config.skills as Record<string, unknown> | undefined
  if (!skills || !Array.isArray(skills.paths)) return false
  const toRemove = new Set(paths)
  skills.paths = (skills.paths as string[]).filter((p: string) => !toRemove.has(p))
  return true
}

/** Values in `skills.paths` that belong to a pack. */
export function packSkillPaths(packDir: string, vaultDir: string = VAULT_DIR): string[] {
  return discoverSkillPaths(packDir).map(d => getVaultSubdir(packDir, d.containerPath, vaultDir))
}
