# AI Kit — Architecture

## Entry Point

```
core_instructions.md — main file, always loaded via CLAUDE.md
```

## Folder Structure

### Package Level (not deployed)

| Folder | Purpose |
|--------|---------|
| `spec/` | Source of truth for AI Kit itself |
| `install.py` | Installer — see below |

### install.py

Copies templates to user's ai-kit directory and configures Claude Code.

```bash
python3 install.py -o ~/DuetData/ai-kit
```

Steps:
1. Check Python 3.10+
2. Create venv at `<output>/../.venv`, install `mcp`
3. Copy `templates/` → output dir (preserves `settings.json`)
4. Register MCP server `ai-kit` with Claude Code
5. Create/check `~/.claude/CLAUDE.md` import

## ⚠️ Edit Rule

**Always edit `templates/`, never `ai-kit/` directly.**

```
WRONG:  Edit ai-kit/personas/socrates.md → lost on next install
RIGHT:  Edit templates/personas/socrates.md → install.py → ai-kit/
```

After editing templates, run `install.py` to apply changes.

### Templates (deployed to users)

| Folder | Status | Purpose |
|--------|--------|---------|
| `core_instructions.md` | Current | Main instructions file |
| `modes/` | Current | Mode-specific instructions |
| `stances/` | Current | Thinking approach instructions |
| `skills/` | Current | Domain expertise |
| `personas/` | Current | Agent identities |
| `workflows/` | Current | Multi-agent coordination |
| `schemas/` | Current | File format specs (topic, index) |
| `mcp-server/` | Current | MCP tools (timestamp) |
| `_instructions/` | **Legacy** | Old modular structure — do not use |
| `old_personas/` | **Legacy** | Deprecated persona drafts — do not use |

## File Naming

| Type | Pattern | Example |
|------|---------|---------|
| Mode | `modes/<name>.md` | `modes/execute.md` |
| Stance | `stances/<name>.md` | `stances/briefing.md` |
| Skill | `skills/<name>.md` | `skills/python.md` |
| Persona | `personas/<name>.md` | `personas/socrates.md` |
| Schema | `schemas/<name>.md` | `schemas/topic_file.md` |

