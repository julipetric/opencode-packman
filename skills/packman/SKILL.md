---
name: packman
description: Manage skill packs (collections) — install, enable, disable, list, update, and uninstall named skill pack bundles from git, npm, or local sources. Use when the user asks to install superpowers, install GSD, enable/disable a skill pack, list installed packs, update a pack, or manage skill collections. Use whenever the user mentions "packman" or "skill pack".
license: MIT
compatibility: opencode
metadata:
  source: https://github.com/julipetric/opencode-packman
  version: 1.0.0
---

# Packman — Skill Pack Manager

Packman manages skill packs: named collections of skills installed into organized sub-folders. It works at the user level (`~/.config/opencode/`) and is available across all projects.

## Key Concepts

- **Pack**: A named collection of skills, organized under its own subdirectory (e.g., `superpowers/`, `gsd/`)
- **Vault**: `~/.config/opencode/skill-packs/<name>/` — where pack contents are stored
- **Registry**: `~/.config/opencode/skill-packs.json` — tracks installed packs, sources, and status
- **Enable**: Add the pack's path to `skills.paths` in `opencode.json` so OpenCode scans it for skills
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

## Operations

### Install a pack

```
install-pack <name> <source>
```

1. Create `~/.config/opencode/skill-packs/<name>/`
2. Clone/copy source contents into it
3. Add entry to `~/.config/opencode/skill-packs.json` with `enabled: false`
4. Report success and suggest enabling

**Important**: Install to a sub-folder so packs stay organized. Never flatten pack contents into the root skills directory.

### Enable a pack

```
enable-pack <name>
```

1. Read `~/.config/opencode/opencode.json`
2. Ensure `skills.paths` exists (create if missing)
3. Append `~/.config/opencode/skill-packs/<name>` if not already present
4. Write back, preserving all other config
5. Update registry: set `enabled: true`
6. Inform the user to restart OpenCode for the change to take effect

### Disable a pack

```
disable-pack <name>
```

1. Read `~/.config/opencode/opencode.json`
2. Remove the pack's path from `skills.paths`
3. Write back, preserving all other config
4. Update registry: set `enabled: false`
5. Inform the user to restart OpenCode for the change to take effect

### List installed packs

```
list-packs
```

1. Read `~/.config/opencode/skill-packs.json`
2. For each pack, display:
   - Name
   - Source URL
   - Status (enabled/disabled)
   - Skill count (number of SKILL.md files found in the pack directory)
3. If no packs installed, suggest installing superpowers

### Update a pack

```
update-pack <name>
```

1. If source is git: `git -C ~/.config/opencode/skill-packs/<name> pull`
2. If source is npm: re-download and extract
3. If source is local: `rsync` or `cp -r` from source

### Uninstall a pack

```
uninstall-pack <name>
```

1. If enabled, disable first (remove from `skills.paths`)
2. Delete `~/.config/opencode/skill-packs/<name>/`
3. Remove entry from `~/.config/opencode/skill-packs.json`
4. Report success

## Registry File Format

`~/.config/opencode/skill-packs.json`:

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
  skill-packs.json           ← registry of installed packs
  skill-packs/               ← vault of installed pack contents
    superpowers/
      skills/
        brainstorming/SKILL.md
        test-driven-development/SKILL.md
        ...
    gsd/
      skills/
        ...
```

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
