# opencode-packman

[![CI](https://github.com/julipetric/opencode-packman/actions/workflows/ci.yml/badge.svg)](https://github.com/julipetric/opencode-packman/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Skill pack manager for [OpenCode](https://opencode.ai). Install, enable, disable, list, update, and uninstall named skill collections — keeping them organized in sub-folders.

**Requirements:** OpenCode 1.x (verified with 1.19.5) and `git` on your `PATH` for git sources (`npm` for npm sources). Packman targets the OpenCode 1.x plugin API (`@opencode-ai/plugin` 1.x); the OpenCode 2 plugin API is not supported. [Bun](https://bun.sh) 1.3 or newer is needed only to [develop](#development) the plugin.

## Why

OpenCode has no built-in way to enable/disable skill collections as named groups. Claude Code has `/plugin enable superpowers` and `enabledPlugins` maps. OpenCode needed the same.

Packman gives you:

- **Group-level toggles** — enable/disable whole packs, not individual skills
- **Organized sub-folders** — each pack installs into its own directory (`skill-packs/superpowers/`, `skill-packs/gsd/`)
- **Source-agnostic** — install from git repos, npm packages, or local paths
- **User-level** — one install, available across all projects
- **Auto-discovery** — scans repos for SKILL.md files and computes the correct path(s) to add to `skills.paths`, handling both flat and nested skill layouts

## How It Works

```
~/.config/opencode/
  opencode.json              ← skills.paths controls which packs are active
  skill-packs.json           ← registry of installed packs (auto-created)
  skill-packs/               ← vault with organized pack contents
    superpowers/
      skills/
        brainstorming/SKILL.md
        test-driven-development/SKILL.md
        ...
    impeccable/
      .opencode/skills/
        impeccable/SKILL.md  ← auto-discovered: nested skills work
```

**Enable** = auto-discover skill paths and add them to `skills.paths` in `opencode.json`.  
**Disable** = remove discovered paths. Files stay in the vault — no data loss.

Packman has two parts: a **plugin** that registers the `packman_*` tools, and a **skill** that tells the agent when and how to call them. Install both.

## Installation

1. Clone the repo into the vault:

   ```bash
   git clone https://github.com/julipetric/opencode-packman.git ~/.config/opencode/skill-packs/opencode-packman
   ```

2. Load the **skill**. Add its folder to `skills.paths` in `~/.config/opencode/opencode.json` (merge with any paths you already have):

   ```json
   {
     "skills": {
       "paths": ["~/.config/opencode/skill-packs/opencode-packman/skills"]
     }
   }
   ```

3. Load the **plugin** (the six `packman_*` tools). OpenCode loads every `.ts` or `.js` file in `~/.config/opencode/plugins/` at startup, so create `~/.config/opencode/plugins/packman.ts` with a single line:

   ```ts
   export { PackmanPlugin } from "../skill-packs/opencode-packman/src/index"
   ```

   or from a shell:

   ```bash
   mkdir -p ~/.config/opencode/plugins
   echo 'export { PackmanPlugin } from "../skill-packs/opencode-packman/src/index"' > ~/.config/opencode/plugins/packman.ts
   ```

4. Restart OpenCode. The `packman` skill is listed and the `packman_install`, `packman_enable`, `packman_disable`, `packman_list`, `packman_uninstall` and `packman_update` tools are available. OpenCode installs the plugin's `@opencode-ai/plugin` dependency itself on first start.

On Windows, `~` is your user folder (`C:\Users\<you>`); Packman always uses `<user folder>\.config\opencode`.

The skill alone only gives the agent instructions, and the plugin alone gives it tools without guidance, so enable both.

## Usage

Tell your agent what to do in plain language:

| You say | What happens |
|---------|-------------|
| "Install pack superpowers from git+https://github.com/obra/superpowers.git" | Clones repo, discovers skill paths, registers pack |
| "Enable pack superpowers" | Auto-detects skill paths, adds to `opencode.json` |
| "Disable pack GSD" | Removes skill paths from `opencode.json` |
| "List packs" | Shows installed packs with status and skill counts |
| "Update pack superpowers" | Pulls latest changes |
| "Uninstall pack GSD" | Disables, deletes files, removes registry entry |

`List packs` returns one line per pack — `✓` enabled, `○` disabled:

```
Installed packs (2):
  ✓ superpowers — 14 skills (git)
  ○ impeccable — 1 skills (git)

Use packman_enable <name> or packman_disable <name> to toggle.
```

Ask for a single pack ("List pack superpowers") to see its source, status, install path and every discovered skill path with the skill names.

### Supported Sources

| Source | Example |
|--------|---------|
| Git repo | `git+https://github.com/obra/superpowers.git` |
| GitHub URL | `https://github.com/user/skills-repo` |
| npm package | `npm:some-skills-pack` |
| Local path | `~/my-skills` |
| Relative path | `./dev-skills` |

## Skill Path Auto-Discovery

Packs can have different directory layouts. Packman handles both:

**Standard** (superpowers-style):
```
skill-packs/superpowers/skills/brainstorming/SKILL.md
```
→ Adds `skills/` to `skills.paths`

**Nested** (impeccable-style):
```
skill-packs/impeccable/.opencode/skills/impeccable/SKILL.md
```
→ Adds `.opencode/skills/` to `skills.paths`

Enable adds all discovered paths. Disable removes all of them. No manual path hunting needed.

Enable and disable work with either form of the `skills` option in `opencode.json` — a plain array of paths or an object with a `paths` array — and keep whichever one you use. If `skills` or the file itself has an unexpected shape (or is not valid JSON), the tool reports an error and leaves the file untouched.

## Registry

Installed packs are tracked in `~/.config/opencode/skill-packs.json` (auto-created on first install). If the file exists but is not a valid JSON object, every tool reports an error and changes nothing, so the record of installed packs is never overwritten:

```json
{
  "superpowers": {
    "source": "git+https://github.com/obra/superpowers.git",
    "type": "git",
    "enabled": true,
    "path": "/home/you/.config/opencode/skill-packs/superpowers",
    "installed_at": "2026-05-15T10:00:00.000Z"
  }
}
```

## Development

```bash
git clone https://github.com/julipetric/opencode-packman.git
cd opencode-packman
bun install
bun test             # unit tests plus tool-level tests that run in a temp home directory
bun run typecheck    # tsc --noEmit
```

- `src/index.ts` is the plugin entry. It exports only `PackmanPlugin`, because OpenCode treats every export of a plugin entry as a plugin.
- `src/packs.ts` holds the pure helpers: source detection, path resolution, skill discovery and `skills.paths` edits.
- `test/` covers the helpers with temp directories for both layouts, and runs the plugin tools in a subprocess whose home directory is a temp folder, so nothing touches your real `~/.config/opencode`.

CI runs the typecheck and the tests on Linux and Windows for every push and pull request.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
