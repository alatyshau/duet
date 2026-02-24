# AI Kit

Legacy package — install.py and legacy MCP server, being replaced by AI Instructions (content) + Host (deploy logic).

## Domain

Domain concepts (modes, stances, skills, personas): see `packages/ai-instructions/spec/COMPONENT.md`.

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
3. Copy `templates/` -> output dir (preserves `settings.json`)
4. Register MCP server `ai-kit` with Claude Code
5. Create/check `~/.claude/CLAUDE.md` import
6. Update Codex config: `~/.codex/config.toml` -> `model_instructions_file = "<output>/core_instructions.md"`
7. Register MCP server `ai-kit` with Codex (if `codex` CLI is available)

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

## Edit Rule

**Always edit `templates/`, never `ai-kit/` directly.**

```
WRONG:  Edit ai-kit/personas/socrates.md -> lost on next install
RIGHT:  Edit templates/personas/socrates.md -> install.py -> ai-kit/
```

After editing templates, run `install.py` to apply changes.

## File Naming

| Type | Pattern | Example |
|------|---------|---------|
| Mode | `modes/<name>.md` | `modes/execute.md` |
| Stance | `stances/<name>.md` | `stances/dialectic.md` |
| Skill | `skills/<name>.md` | `skills/python.md` |
| Persona | `personas/<name>.md` | `personas/socrates.md` |
| Schema | `schemas/<name>.md` | `schemas/topic_file.md` |

## Navigation

| Concept | File |
|---------|------|
| Legacy installer | `install.py` |
| Legacy MCP server | `mcp-server/` |
| Templates (content) | `templates/` |
| AI Kit spec | `spec/COMPONENT.md` |
| Active content package | `packages/ai-instructions/` |
