# opencode-packman

Skill pack manager for [OpenCode](https://opencode.ai). Install, enable, disable, list, update, and uninstall named skill collections — keeping them organized in sub-folders.

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

## Installation

```bash
git clone https://github.com/julipetric/opencode-packman.git ~/.config/opencode/skill-packs/opencode-packman
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "skills": {
    "paths": ["~/.config/opencode/skill-packs/opencode-packman/skills"]
  }
}
```

Restart OpenCode. The `packman` skill is now available.

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

## Registry

Installed packs are tracked in `~/.config/opencode/skill-packs.json` (auto-created on first install):

```json
{
  "superpowers": {
    "source": "git+https://github.com/obra/superpowers.git",
    "type": "git",
    "enabled": true,
    "path": "~/.config/opencode/skill-packs/superpowers",
    "installed_at": "2026-05-15T10:00:00Z"
  }
}
```

## Changelog

### 2.0.0
- **Skill path auto-discovery**: packs no longer assumed flat `skills/` layout — nested structures (`.opencode/skills/`, etc.) are detected and handled automatically
- **Smarter enable/disable**: uses discovered paths instead of blindly adding the repo root
- **Rich install output**: shows every discovered path with per-path skill count and names
- **Troubleshooting guide**: added in SKILL.md for common issues
- **Docs clarity**: commands are now clearly documented as AI agent instructions, not shell commands

## License

MIT
