import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { homedir, tmpdir } from "os"
import { join } from "path"
import {
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
} from "../src/packs"

function writeSkill(root: string, ...segments: string[]) {
  const dir = join(root, ...segments)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "SKILL.md"), "---\nname: test\ndescription: test skill\n---\n")
}

describe("detectType", () => {
  test.each([
    ["git+https://github.com/obra/superpowers.git", "git"],
    ["git@github.com:user/skills.git", "git"],
    ["https://github.com/user/skills.git", "git"],
    ["https://github.com/user/skills-repo", "git"],
    ["http://example.com/skills-repo", "git"],
    ["npm:some-skills-pack", "npm"],
    ["./dev-skills", "local"],
    ["~/my-skills", "local"],
    ["/opt/skills", "local"],
    ["C:\\skills\\team", "local"],
  ])("%s is a %s source", (source, type) => {
    expect(detectType(source)).toBe(type as ReturnType<typeof detectType>)
  })
})

describe("resolvePath", () => {
  test("expands ~/ to the home directory", () => {
    expect(resolvePath("~/my-skills")).toBe(join(homedir(), "my-skills"))
  })

  test("keeps absolute paths as written", () => {
    const abs = join(tmpdir(), "skills")
    expect(resolvePath(abs)).toBe(abs)
  })

  test("resolves relative paths against the working directory", () => {
    const cwd = join(tmpdir(), "project")
    expect(resolvePath("./dev-skills", cwd)).toBe(join(cwd, "dev-skills"))
  })
})

describe("skill discovery", () => {
  let vault: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "packman-"))
  })

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true })
  })

  test("a flat layout yields its skills/ folder with every skill name", () => {
    const pack = join(vault, "superpowers")
    writeSkill(pack, "skills", "brainstorming")
    writeSkill(pack, "skills", "test-driven-development")

    expect(discoverSkillPaths(pack)).toEqual([
      {
        containerPath: join(pack, "skills"),
        skillCount: 2,
        skillNames: ["brainstorming", "test-driven-development"],
      },
    ])
  })

  test("a nested layout yields the inner skills/ folder", () => {
    const pack = join(vault, "impeccable")
    writeSkill(pack, ".opencode", "skills", "impeccable")

    const [found] = discoverSkillPaths(pack)
    expect(found.containerPath).toBe(join(pack, ".opencode", "skills"))
    expect(found.skillNames).toEqual(["impeccable"])
  })

  test("containers named skills come first, then larger containers", () => {
    const pack = join(vault, "mixed")
    writeSkill(pack, "extras", "one")
    writeSkill(pack, "extras", "two")
    writeSkill(pack, "extras", "three")
    writeSkill(pack, "skills", "core")

    expect(discoverSkillPaths(pack).map(d => d.containerPath)).toEqual([
      join(pack, "skills"),
      join(pack, "extras"),
    ])
  })

  test("a SKILL.md one level below the pack root makes the pack root a container", () => {
    const pack = join(vault, "flat-root")
    writeSkill(pack, "skill")

    expect(discoverSkillPaths(pack)).toEqual([
      { containerPath: pack, skillCount: 1, skillNames: ["skill"] },
    ])
  })

  test("a missing pack directory yields no paths", () => {
    expect(discoverSkillPaths(join(vault, "missing"))).toEqual([])
  })

  test("packSkillPaths returns the skills.paths values of a pack", () => {
    const pack = join(vault, "superpowers")
    writeSkill(pack, "skills", "brainstorming")
    writeSkill(pack, ".opencode", "skills", "impeccable")

    expect(packSkillPaths(pack, vault).sort()).toEqual(
      [join(vault, "superpowers", "skills"), join(vault, "superpowers", ".opencode", "skills")].sort(),
    )
  })
})

describe("path formatting", () => {
  const vault = join(tmpdir(), "vault")
  const pack = join(vault, "impeccable")

  test("formatPathForDisplay shows containers under ~/.config/opencode/skill-packs with forward slashes", () => {
    expect(formatPathForDisplay(pack, join(pack, ".opencode", "skills"))).toBe(
      "~/.config/opencode/skill-packs/impeccable/.opencode/skills",
    )
  })

  test("formatPathForDisplay keeps the pack root absolute", () => {
    expect(formatPathForDisplay(pack, pack)).toBe(pack)
  })

  test("getVaultSubdir places the container under the vault", () => {
    expect(getVaultSubdir(pack, join(pack, "skills"), vault)).toBe(join(vault, "impeccable", "skills"))
  })

  test("getVaultSubdir keeps the pack root and paths outside the pack as given", () => {
    const outside = join(tmpdir(), "elsewhere")
    expect(getVaultSubdir(pack, pack, vault)).toBe(pack)
    expect(getVaultSubdir(pack, outside, vault)).toBe(outside)
  })
})

describe("checkNameConflict", () => {
  const vault = join(tmpdir(), "opencode", "skill-packs")
  const builtin = join(tmpdir(), "opencode", "skills")

  test("a plain pack name is safe", () => {
    expect(checkNameConflict("superpowers", vault, [builtin])).toBeNull()
  })

  test("a name that resolves into OpenCode's skills directory is reported", () => {
    expect(checkNameConflict("../skills", vault, [builtin])).toBe(builtin)
  })
})

describe("skill path list edits", () => {
  test("addSkillPaths creates skills.paths and keeps the rest of the config", () => {
    const config: Record<string, unknown> = { theme: "dark" }
    const added = addSkillPaths(config, ["/vault/a/skills"])

    expect(added).toEqual(["/vault/a/skills"])
    expect(config).toEqual({ theme: "dark", skills: { paths: ["/vault/a/skills"] } })
  })

  test("addSkillPaths adds skills.paths to a skills object that lacks it", () => {
    const config: Record<string, unknown> = { skills: { urls: ["https://example.com/skills/"] } }
    addSkillPaths(config, ["/vault/a/skills"])

    expect(config.skills).toEqual({ urls: ["https://example.com/skills/"], paths: ["/vault/a/skills"] })
  })

  test("addSkillPaths returns only the paths that were missing", () => {
    const config: Record<string, unknown> = { skills: { paths: ["/vault/a/skills"] } }
    const added = addSkillPaths(config, ["/vault/a/skills", "/vault/a/.opencode/skills"])

    expect(added).toEqual(["/vault/a/.opencode/skills"])
    expect(config.skills).toEqual({ paths: ["/vault/a/skills", "/vault/a/.opencode/skills"] })
  })

  test("addSkillPaths appends to a plain skills array and keeps it an array", () => {
    const config: Record<string, unknown> = { skills: ["/mine", "/vault/a/skills"] }
    const added = addSkillPaths(config, ["/vault/a/skills", "/vault/a/.opencode/skills", "/vault/a/.opencode/skills"])

    expect(added).toEqual(["/vault/a/.opencode/skills"])
    expect(config.skills).toEqual(["/mine", "/vault/a/skills", "/vault/a/.opencode/skills"])
  })

  test("removeSkillPaths drops the given paths and keeps the others", () => {
    const config: Record<string, unknown> = { skills: { paths: ["/mine", "/vault/a/skills"] } }

    expect(removeSkillPaths(config, ["/vault/a/skills"])).toBe(true)
    expect(config.skills).toEqual({ paths: ["/mine"] })
  })

  test("removeSkillPaths drops the given paths from a plain skills array", () => {
    const config: Record<string, unknown> = { theme: "dark", skills: ["/mine", "/vault/a/skills"] }

    expect(removeSkillPaths(config, ["/vault/a/skills"])).toBe(true)
    expect(config).toEqual({ theme: "dark", skills: ["/mine"] })
  })

  test.each([
    ["without skills", { theme: "dark" }],
    ["with a skills object that has no paths", { skills: { urls: [] } }],
  ])("removeSkillPaths leaves a config %s untouched", (_label, config) => {
    const before = structuredClone(config)

    expect(removeSkillPaths(config as Record<string, unknown>, ["/vault/a/skills"])).toBe(false)
    expect(config).toEqual(before)
  })

  test.each([
    ["a string", { skills: "/vault/a/skills" }],
    ["a number", { skills: 3 }],
    ["a boolean", { skills: true }],
    ["an object whose paths is a string", { skills: { paths: "/vault/a/skills" } }],
    ["an object whose paths is an object", { skills: { paths: {} } }],
  ])("both edits throw and leave the config untouched when skills is %s", (_label, config) => {
    const before = structuredClone(config)

    expect(() => addSkillPaths(config as Record<string, unknown>, ["/vault/a/skills"])).toThrow(/must be an array/)
    expect(() => removeSkillPaths(config as Record<string, unknown>, ["/vault/a/skills"])).toThrow(/must be an array/)
    expect(config).toEqual(before)
  })
})

describe("parseJSONObject", () => {
  const file = "/home/user/.config/opencode/skill-packs.json"

  test("parses a JSON object", () => {
    expect(parseJSONObject('{ "a": { "b": 1 } }', file)).toEqual({ a: { b: 1 } })
  })

  test.each(["", "   "])("blank text %j is an empty object", text => {
    expect(parseJSONObject(text, file)).toEqual({})
  })

  test("invalid JSON throws an error naming the file", () => {
    expect(() => parseJSONObject('{ "a": ', file)).toThrow(`${file} is not valid JSON`)
  })

  test.each(["[]", "null", '"text"', "42", "true"])("%s is not an object and throws", text => {
    expect(() => parseJSONObject(text, file)).toThrow(`${file} must contain a JSON object`)
  })
})
