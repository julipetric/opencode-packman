import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

type Step = { output: string; config: any; registry: any }

let home: string

const configDir = () => join(home, ".config", "opencode")
const vault = () => join(configDir(), "skill-packs")

function writeSkill(root: string, ...segments: string[]) {
  const dir = join(root, ...segments)
  mkdirSync(dir, { recursive: true })
  const name = segments[segments.length - 1]
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n`)
}

function writeConfig(config: unknown) {
  mkdirSync(configDir(), { recursive: true })
  writeFileSync(join(configDir(), "opencode.json"), JSON.stringify(config))
}

/** Runs the tool calls in a subprocess whose home directory is the temp `home`. */
function runTools(...calls: [string, Record<string, unknown>][]): Step[] {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, join(import.meta.dir, "fixtures", "run-tools.ts"), JSON.stringify(calls)],
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  })
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString())
  return JSON.parse(proc.stdout.toString())
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "packman-home-"))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe("flat layout pack", () => {
  test("goes through install, enable, disable and uninstall", () => {
    const source = join(home, "team-skills")
    writeSkill(source, "skills", "code-review")
    writeSkill(source, "skills", "release-notes")
    writeConfig({ theme: "dark" })
    const skillsPath = join(vault(), "team", "skills")

    const [empty, installed, listed, enabled, enabledAgain, disabled, uninstalled, final] = runTools(
      ["packman_list", {}],
      ["packman_install", { name: "team", source }],
      ["packman_list", {}],
      ["packman_enable", { name: "team" }],
      ["packman_enable", { name: "team" }],
      ["packman_disable", { name: "team" }],
      ["packman_uninstall", { name: "team" }],
      ["packman_list", {}],
    )

    expect(empty.output).toStartWith("No packs installed.")

    expect(installed.output).toContain('Installed pack "team"')
    expect(installed.output).toContain("Found 2 skill(s) across 1 path(s).")
    expect(installed.output).toContain("(2 skills: code-review, release-notes)")
    expect(installed.output).toContain('ask the agent to "enable pack team" (packman_enable)')
    expect(installed.registry.team).toMatchObject({ source, type: "local", enabled: false, path: join(vault(), "team") })
    expect(installed.config).toEqual({ theme: "dark" })

    expect(listed.output).toBe(
      "Installed packs (1):\n  ○ team — 2 skills (local)\n\nUse packman_enable <name> or packman_disable <name> to toggle.",
    )

    expect(enabled.output).toStartWith('Enabled pack "team". Added 1 path(s) to skills.paths:')
    expect(enabled.config).toEqual({ theme: "dark", skills: { paths: [skillsPath] } })
    expect(enabled.registry.team.enabled).toBe(true)

    expect(enabledAgain.output).toContain("is already enabled")
    expect(enabledAgain.config).toEqual(enabled.config)

    expect(disabled.output).toStartWith('Disabled pack "team".')
    expect(disabled.config).toEqual({ theme: "dark", skills: { paths: [] } })
    expect(disabled.registry.team.enabled).toBe(false)

    expect(uninstalled.output).toBe('Uninstalled pack "team".')
    expect(uninstalled.registry).toEqual({})
    expect(existsSync(join(vault(), "team"))).toBe(false)
    expect(final.output).toStartWith("No packs installed.")
  })
})

describe("nested layout pack", () => {
  test("enable adds every discovered skills folder and disable removes only those", () => {
    const source = join(home, "mixed")
    writeSkill(source, "skills", "brainstorming")
    writeSkill(source, ".opencode", "skills", "impeccable")
    writeConfig({ skills: { paths: ["/user/own-skills"] } })
    const base = join(vault(), "mixed")

    const [, enabled, disabled] = runTools(
      ["packman_install", { name: "mixed", source }],
      ["packman_enable", { name: "mixed" }],
      ["packman_disable", { name: "mixed" }],
    )

    expect(enabled.config.skills.paths).toHaveLength(3)
    expect(enabled.config.skills.paths).toEqual(
      expect.arrayContaining(["/user/own-skills", join(base, "skills"), join(base, ".opencode", "skills")]),
    )
    expect(disabled.config).toEqual({ skills: { paths: ["/user/own-skills"] } })
  })
})

describe("config editing", () => {
  test("enable creates opencode.json when it does not exist", () => {
    const source = join(home, "team-skills")
    writeSkill(source, "skills", "code-review")

    const [, enabled] = runTools(
      ["packman_install", { name: "team", source }],
      ["packman_enable", { name: "team" }],
    )

    expect(enabled.config).toEqual({ skills: { paths: [join(vault(), "team", "skills")] } })
  })

  test("disable on a config without skills.paths leaves the file untouched", () => {
    const source = join(home, "team-skills")
    writeSkill(source, "skills", "code-review")
    writeConfig({ theme: "dark" })

    const [, disabled] = runTools(
      ["packman_install", { name: "team", source }],
      ["packman_disable", { name: "team" }],
    )

    expect(disabled.config).toEqual({ theme: "dark" })
  })
})

describe("skills given as a plain array", () => {
  test("enable and disable edit the array and keep it an array", () => {
    const source = join(home, "mixed")
    writeSkill(source, "skills", "brainstorming")
    writeSkill(source, ".opencode", "skills", "impeccable")
    const base = join(vault(), "mixed")
    writeConfig({ theme: "dark", skills: ["/user/own-skills", join(base, "skills")] })

    const [, enabled, enabledAgain, disabled] = runTools(
      ["packman_install", { name: "mixed", source }],
      ["packman_enable", { name: "mixed" }],
      ["packman_enable", { name: "mixed" }],
      ["packman_disable", { name: "mixed" }],
    )

    expect(enabled.output).toStartWith('Enabled pack "mixed". Added 1 path(s)')
    expect(enabled.config).toEqual({
      theme: "dark",
      skills: ["/user/own-skills", join(base, "skills"), join(base, ".opencode", "skills")],
    })
    expect(enabledAgain.output).toContain("is already enabled")
    expect(enabledAgain.config).toEqual(enabled.config)
    expect(disabled.config).toEqual({ theme: "dark", skills: ["/user/own-skills"] })
    expect(disabled.registry.mixed.enabled).toBe(false)
  })
})

describe("unexpected config", () => {
  const unexpected: [string, string][] = [
    ["skills is a string", JSON.stringify({ skills: "/some/path" })],
    ["skills.paths is not an array", JSON.stringify({ skills: { paths: "/some/path" } })],
    ["the file is not valid JSON", "{ \"theme\": \"dark\", }"],
    ["the file holds a JSON array", "[]"],
  ]

  test.each(unexpected)("enable, disable and uninstall report an error and keep the file when %s", (_label, content) => {
    const source = join(home, "team-skills")
    writeSkill(source, "skills", "code-review")
    const file = join(configDir(), "opencode.json")

    // The pack is registered as enabled by hand so that uninstall also reads the config.
    runTools(["packman_install", { name: "team", source }])
    writeFileSync(file, content)
    const registryPath = join(configDir(), "skill-packs.json")
    const registry = JSON.parse(readFileSync(registryPath, "utf8"))
    registry.team.enabled = true
    writeFileSync(registryPath, JSON.stringify(registry))

    const [enable, disable, uninstall] = runTools(
      ["packman_enable", { name: "team" }],
      ["packman_disable", { name: "team" }],
      ["packman_uninstall", { name: "team" }],
    )

    expect(enable.output).toStartWith('Cannot enable pack "team":')
    expect(disable.output).toStartWith('Cannot disable pack "team":')
    expect(uninstall.output).toStartWith('Cannot uninstall pack "team":')
    expect(readFileSync(file, "utf8")).toBe(content)
    expect(disable.registry.team.enabled).toBe(true)
    expect(existsSync(join(vault(), "team"))).toBe(true)
  })
})

describe("guards", () => {
  test("installing an existing pack name is refused", () => {
    const source = join(home, "team-skills")
    writeSkill(source, "skills", "code-review")

    const [, again] = runTools(
      ["packman_install", { name: "team", source }],
      ["packman_install", { name: "team", source }],
    )

    expect(again.output).toStartWith('Pack "team" is already installed')
  })

  test("a pack name that resolves into OpenCode's skills directory is refused", () => {
    const [refused] = runTools(["packman_install", { name: "../skills", source: home }])

    expect(refused.output).toContain("conflicts with OpenCode built-in path")
    expect(existsSync(join(configDir(), "skills"))).toBe(false)
  })

  test("a source without SKILL.md files installs with a notice and cannot be enabled", () => {
    const source = join(home, "empty")
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, "README.md"), "no skills here")

    const [installed, enabled] = runTools(
      ["packman_install", { name: "empty", source }],
      ["packman_enable", { name: "empty" }],
    )

    expect(installed.output).toContain("No SKILL.md files found in this pack.")
    expect(enabled.output).toStartWith('No skill paths found in pack "empty"')
  })

  test.each(["packman_enable", "packman_disable", "packman_uninstall", "packman_update", "packman_list"])(
    "%s reports an unknown pack",
    tool => {
      const [result] = runTools([tool, { name: "ghost" }])

      expect(result.output).toContain('Pack "ghost" is not installed')
    },
  )
})

describe("packman_list", () => {
  test("shows the details of a single pack", () => {
    const source = join(home, "team-skills")
    writeSkill(source, "skills", "code-review")

    const [, detail] = runTools(
      ["packman_install", { name: "team", source }],
      ["packman_list", { name: "team" }],
    )

    expect(detail.output).toStartWith("Pack: team\n  Source: " + source + "\n  Type: local\n  Status: disabled")
    expect(detail.output).toContain("~/.config/opencode/skill-packs/team/skills (1 skills: code-review)")
  })
})
