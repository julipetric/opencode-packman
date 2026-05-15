---
name: packman
description: Manage skill packs (collections) — install, enable, disable, list, update, and uninstall named skill pack bundles from git, npm, or local sources. Use when the user asks to install superpowers, install GSD, enable/disable a skill pack, list installed packs, update a pack, or manage skill collections. Use whenever the user mentions "packman" or "skill pack".
license: MIT
compatibility: opencode
metadata:
  source: https://github.com/julipetric/opencode-packman
  version: 2.0.0
---

# Packman — Skill Pack Manager

Packman manages skill packs: named collections of skills installed into organized sub-folders. It works at the user level (`~/.config/opencode/`) and is available across all projects.

## Key Concepts

- **Pack**: A named collection of skills, organized under its own subdirectory (e.g., `superpowers/`, `gsd/`)
- **Vault**: `~/.config/opencode/skill-packs/<name>/` — where pack contents are stored
- **Registry**: `~/.config/opencode/skill-packs.json` — auto-created on first install, tracks installed packs, sources, and status
- **Enable**: Add the pack's skill path(s) to `skills.paths` in `opencode.json` so OpenCode scans it for skills
- **Disable**: Remove the path from `skills.paths` — files stay in vault, just not loaded

## Source Format

Packman detects source type automatically:

| Pattern | Type | Behavior |
|---------|------|----------|
| `git+https://...` or `git@github.com:...` | Git | `git clone --depth 1` |
| `https://github.com/...` or `https://...git` | Git | `git clone --depth 1` |
| `npm:<package>` | npm | `npm pack && tar -xz` |
| Absolute local path (`/home/...` or `C:\...`) | Local | `cp -r` |
| Relative local path (`./...`) | Local | Resolve relative to cwd, `cp -r` |

## How To Invoke

These are **AI agent instructions** (not shell commands). Tell the agent what to do in plain language:

| You say | What the agent does |
|---------|-------------------|
| "Install pack superbikes from https://github.com/user/superbikes" | `packman_install` — clones repo, discovers skill paths, registers pack |
| "Enable pack impeccable" | `packman_enable` — auto-detects skill paths, adds them to `opencode.json` |
| "Disable pack GSD" | `packman_disable` — removes skill paths from `opencode.json` |
| "List packs" | `packman_list` — reads registry, shows status and skill counts |
| "Update pack superpowers" | `packman_update` — pulls latest from source |
| "Uninstall pack GSD" | `packman_uninstall` — disables, deletes files, removes registry entry |

Alternatively, trigger the plugin tool directly:

- `packman_install(name="superpowers", source="git+https://github.com/obra/superpowers.git")`
- `packman_enable(name="impeccable")`
- `packman_disable(name="gsd")`
- `packman_list(name="superpowers")` — or `packman_list()` for all
- `packman_update(name="superpowers")`
- `packman_uninstall(name="gsd")`

## Skill Path Auto-Discovery

When a pack is installed or enabled, Packman scans the repo for `SKILL.md` files and computes the correct path(s) to add to `skills.paths`. This handles nested skill structures automatically:

**Standard layout** (superpowers-style):
```
skill-packs/superpowers/
  skills/
    brainstorming/SKILL.md      → adds: skill-packs/superpowers/skills
    test-driven-development/SKILL.md
```

**Nested layout** (impeccable-style):
```
skill-packs/impeccable/
  .opencode/
    skills/
      impeccable/SKILL.md       → adds: skill-packs/impeccable/.opencode/skills
  skill/
    SKILL.md                    ← skipped (no skill-name subdirectory)
```

Enable adds all discovered paths. Disable removes all of them.

## Operations

### Install a pack

Ask: "Install pack <name> from <source>"

1. Creates `~/.config/opencode/skill-packs/<name>/`
2. Clones/copies source contents into it
3. Scans for `SKILL.md` files and discovers skill paths
4. Adds entry to `~/.config/opencode/skill-packs.json` with `enabled: false`
5. Reports all discovered skill paths and suggests enabling

**Important**: Install to a sub-folder so packs stay organized. Never flatten pack contents into the root skills directory.

### Enable a pack

Ask: "Enable pack <name>"

1. Reads `~/.config/opencode/opencode.json`
2. Auto-discovers skill paths in the pack directory
3. Adds each discovered path to `skills.paths` (if not already present)
4. Write back, preserving all other config
5. Updates registry: set `enabled: true`
6. Informs the user to restart OpenCode for the change to take effect

### Disable a pack

Ask: "Disable pack <name>"

1. Reads `~/.config/opencode/opencode.json`
2. Auto-discovers skill paths for the pack
3. Removes those paths from `skills.paths`
4. Write back, preserving all other config
5. Updates registry: set `enabled: false`
6. Informs the user to restart OpenCode for the change to take effect

### List installed packs

Ask: "List packs" or "List pack <name>"

1. Reads `~/.config/opencode/skill-packs.json`
2. For each pack (or specific one), displays:
   - Name
   - Source URL
   - Status (enabled/disabled)
   - Discovered skill paths with per-path skill count and names
3. If no packs installed, suggests installing superpowers

### Update a pack

Ask: "Update pack <name>"

1. If source is git: `git -C ~/.config/opencode/skill-packs/<name> pull`
2. If source is npm: re-download and extract
3. If source is local: `rsync` or `cp -r` from source

### Uninstall a pack

Ask: "Uninstall pack <name>"

1. If enabled, disable first (remove discovered paths from `skills.paths`)
2. Delete `~/.config/opencode/skill-packs/<name>/`
3. Remove entry from `~/.config/opencode/skill-packs.json`
4. Report success

## Registry File Format

`~/.config/opencode/skill-packs.json` — auto-created on first install:

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

## Filesystem Layout

```
~/.config/opencode/
  opencode.json              ← skills.paths controls which packs are active
  skill-packs.json           ← registry of installed packs (auto-created)
  skill-packs/               ← vault of installed pack contents
    superpowers/
      skills/
        brainstorming/SKILL.md
        test-driven-development/SKILL.md
        ...
    impeccable/
      .opencode/skills/
        impeccable/SKILL.md  ← auto-discovered: nested skills work
    gsd/
      skills/
        ...
```

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `install-pack` not found as a command | It's an AI instruction, not a shell command | Tell the agent "install pack X from Y" |
| Skill not showing up after enable | Wrong path in `skills.paths` | Use `packman_enable` which auto-discovers paths. If still broken, run `list-packs <name>` to see discovered paths |
| Nested skill not detected | SKILL.md not in a named subdirectory | Skills should be at `<container>/<skill-name>/SKILL.md`, not `<container>/SKILL.md` |
| Registry file missing | Auto-created on first install | Run install again |
| "already installed" error | Pack directory exists | Use `update-pack` or `uninstall-pack` first |

## Installation

To install packman itself:

```bash
# Clone the repo
git clone https://github.com/julipetric/opencode-packman.git ~/.config/opencode/skill-packs/opencode-packman

# Add to opencode.json skills.paths
# Edit ~/.config/opencode/opencode.json:
{
  "skills": {
    "paths": ["~/.config/opencode/skill-packs/opencode-packman/skills"]
  }
}

# Restart OpenCode
```

The packman skill will now be available in your OpenCode sessions.
