# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2.0.1 - 2026-11-12

### Fixed
- Plain `http://` and `https://` URLs (for example `https://github.com/user/repo`) are installed as git sources instead of being treated as local paths.
- Installing or updating from a local path works on Windows: the source folder is copied with `fs.cpSync`, since Bun's built-in `cp` rejects `-r` there and ignores the trailing `/.`.

### Changed
- Pure helpers (source detection, path resolution, skill discovery, `skills.paths` edits) moved to `src/packs.ts`. The plugin entry exports only `PackmanPlugin`.
- README installation steps load both the skill and the plugin tools; added requirements, a `list` output example and a Development section.

### Added
- `bun test` suite covering detection, path resolution, skill discovery for flat and nested layouts, registry and config editing, and the tools end to end in a temp home directory.
- `typecheck` and `test` scripts and a GitHub Actions workflow running both on Linux and Windows.

## 2.0.0

### Added
- **Skill path auto-discovery**: packs no longer assumed flat `skills/` layout — nested structures (`.opencode/skills/`, etc.) are detected and handled automatically.
- **Rich install output**: shows every discovered path with per-path skill count and names.
- **Troubleshooting guide** in SKILL.md for common issues.

### Changed
- **Smarter enable/disable**: uses discovered paths instead of blindly adding the repo root.
- **Docs clarity**: commands are documented as AI agent instructions, not shell commands.
