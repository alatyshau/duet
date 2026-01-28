# AI Kit — Architecture

## Entry Point

```
core_instructions.md — main file, loaded by clients:
- Claude Code: via `~/.claude/CLAUDE.md`
- Codex: via `~/.codex/config.toml` → `model_instructions_file`
```

## Folder Structure

### Package Level (not deployed)

| Folder | Purpose |
|--------|---------|
| `spec/` | Source of truth for AI Kit itself |
| `install.py` | Installer — see below |

### install.py

Copies templates to user's ai-kit directory and configures Claude Code and Codex.

```bash
python3 install.py -o ~/DuetData/ai-kit
```

Steps:
1. Check Python 3.10+
2. Create venv at `<output>/../.venv`, install `mcp`
3. Copy `templates/` → output dir (preserves `settings.json`)
4. Register MCP server `ai-kit` with Claude Code
5. Create/check `~/.claude/CLAUDE.md` import
6. Update Codex config: `~/.codex/config.toml` → `model_instructions_file = "<output>/core_instructions.md"`
7. Register MCP server `ai-kit` with Codex (if `codex` CLI is available)

## ⚠️ Edit Rule

**Always edit `templates/`, never `ai-kit/` directly.**

```
WRONG:  Edit ai-kit/personas/socrates.md → lost on next install
RIGHT:  Edit templates/personas/socrates.md → install.py → ai-kit/
```

After editing templates, run `install.py` to apply changes.

### Templates (deployed to users)

| Folder | Purpose |
|--------|---------|
| `core_instructions.md` | Main instructions file |
| `modes/` | Mode-specific instructions |
| `stances/` | Thinking approach instructions |
| `skills/` | Domain expertise |
| `personas/` | Agent identities |
| `workflows/` | Multi-agent coordination |
| `schemas/` | File format specs (topic, index) |

### Legacy (do not use)

| Location | Note |
|----------|------|
| `templates/_legacy/` | Old jinja2 templates, will be deleted |
| `.ai/` (repo root) | Generated from legacy, will be deleted |

Regenerate legacy (if needed): `python3 build_legacy.py`

## File Naming

| Type | Pattern | Example |
|------|---------|---------|
| Mode | `modes/<name>.md` | `modes/execute.md` |
| Stance | `stances/<name>.md` | `stances/briefing.md` |
| Skill | `skills/<name>.md` | `skills/python.md` |
| Persona | `personas/<name>.md` | `personas/socrates.md` |
| Schema | `schemas/<name>.md` | `schemas/topic_file.md` |
