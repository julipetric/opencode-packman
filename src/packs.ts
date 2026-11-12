// Pack helpers used by the plugin tools: source detection, path handling, skill discovery
// and edits to the skill path list of opencode.json. The plugin entry (`index.ts`) exports only the plugin function,
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

/**
 * Parses the text of a JSON file that must hold an object. Blank text is an empty object.
 * Throws an error naming `path` when the text is not valid JSON or is not an object.
 */
export function parseJSONObject(text: string, path: string): Record<string, unknown> {
  if (text.trim() === "") return {}
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${err instanceof Error ? err.message : String(err)}). Fix the file or restore it from a backup, then try again.`)
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${path} must contain a JSON object. Fix the file or restore it from a backup, then try again.`)
  }
  return data as Record<string, unknown>
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

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return "an array"
  if (value === null) return "null"
  return `a ${typeof value}`
}

/**
 * Returns the list of skill paths held by `config.skills`, which OpenCode accepts as either
 * a plain array of paths or an object with a `paths` array. Returns null when the config has
 * no list yet, and throws when `skills` has any other shape.
 */
function skillPathList(config: Record<string, unknown>): string[] | null {
  const skills = config.skills
  if (skills === undefined || skills === null) return null
  if (Array.isArray(skills)) return skills as string[]
  if (typeof skills !== "object") {
    throw new Error(`"skills" in opencode.json must be an array of paths or an object with a "paths" array, but it is ${describeValue(skills)}.`)
  }
  const paths = (skills as Record<string, unknown>).paths
  if (paths === undefined) return null
  if (!Array.isArray(paths)) {
    throw new Error(`"skills.paths" in opencode.json must be an array of paths, but it is ${describeValue(paths)}.`)
  }
  return paths as string[]
}

/**
 * Appends the given paths to the skill path list of `config`, keeping the shape the config
 * already has (plain `skills` array or `skills.paths`) and creating `skills.paths` when
 * there is none. Returns the paths that were not already present. Every other key of the
 * config is kept. Throws, leaving the config untouched, when `skills` has an unexpected shape.
 */
export function addSkillPaths(config: Record<string, unknown>, paths: string[]): string[] {
  let list = skillPathList(config)
  if (!list) {
    list = []
    const skills = config.skills as Record<string, unknown> | undefined | null
    if (skills && typeof skills === "object") skills.paths = list
    else config.skills = { paths: list }
  }

  const added = [...new Set(paths)].filter(p => !list.includes(p))
  list.push(...added)
  return added
}

/**
 * Removes the given paths from the skill path list of `config`, keeping its shape. Returns
 * false, leaving the config untouched, when it has no list. Throws when `skills` has an
 * unexpected shape.
 */
export function removeSkillPaths(config: Record<string, unknown>, paths: Iterable<string>): boolean {
  const list = skillPathList(config)
  if (!list) return false
  const toRemove = new Set(paths)
  const kept = list.filter(p => !toRemove.has(p))
  list.splice(0, list.length, ...kept)
  return true
}

/** Values of the skill path list that belong to a pack. */
export function packSkillPaths(packDir: string, vaultDir: string = VAULT_DIR): string[] {
  return discoverSkillPaths(packDir).map(d => getVaultSubdir(packDir, d.containerPath, vaultDir))
}
