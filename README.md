# opencode-packman

Skill pack manager for [OpenCode](https://opencode.ai). Install, enable, disable, list, update, and uninstall named skill collections — keeping them organized in sub-folders.

## Why

OpenCode has no built-in way to enable/disable skill collections as named groups. Claude Code has `/plugin enable superpowers` and `enabledPlugins` maps. OpenCode needed the same.

Packman gives you:

- **Group-level toggles** — enable/disable whole packs, not individual skills
- **Organized sub-folders** — each pack installs into its own directory (`skill-packs/superpowers/`, `skill-packs/gsd/`)
- **Source-agnostic** — install from git repos, npm packages, or local paths
- **User-level** — one install, available across all projects

## How It Works

```
~/.config/opencode/
  opencode.json              ← skills.paths controls which packs are active
  skill-packs.json           ← registry of installed packs
  skill-packs/               ← vault with organized pack contents
    superpowers/
      skills/
        brainstorming/SKILL.md
        test-driven-development/SKILL.md
        ...
    gsd/
      skills/
        ...
```

**Enable** = add pack path to `skills.paths` in `opencode.json`.  
**Disable** = remove it. Files stay in the vault — no data loss.

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

Ask your agent to manage packs conversationally:

```
Install pack superpowers from git+https://github.com/obra/superpowers.git
Enable pack superpowers
Disable pack GSD
List packs
Update pack superpowers
Uninstall pack GSD
```

The packman skill handles the rest.

### Supported Sources

| Source | Example |
|--------|---------|
| Git repo | `git+https://github.com/obra/superpowers.git` |
| GitHub URL | `https://github.com/user/skills-repo` |
| npm package | `npm:some-skills-pack` |
| Local path | `~/my-skills` |
| Relative path | `./dev-skills` |

## Registry

Installed packs are tracked in `~/.config/opencode/skill-packs.json`:

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

## License

MIT
