# AI Kit

Instructions, modes, stances, skills, and workflows for AI agents.

## Installation

```bash
python3 packages/ai-kit/install.py -o ~/DuetData/ai-kit
```

This will:
1. Create venv and install dependencies
2. Copy AI Kit files to output directory
3. Configure Claude Code (MCP server + CLAUDE.md)
4. Configure Codex (model_instructions_file + MCP)

## Structure

```
packages/ai-kit/
├── install.py           # Installer script
├── mcp-server/          # MCP server (timestamp tool)
├── spec/                # Domain model (DOMAIN.md, ARCHITECTURE.md)
├── docs/                # User documentation (settings.md)
│
└── templates/           # Source files (copied by install.py)
    ├── core_instructions.md   # Main entrypoint
    ├── modes/           # Work modes (EXECUTE, PLANNING, etc.)
    ├── stances/         # Thinking approaches (dialectic, pragmatic, etc.)
    ├── skills/          # Domain expertise (python, typescript, etc.)
    ├── personas/        # Agent identities (Socrates, Hephaestus, etc.)
    ├── workflows/       # Collaboration patterns (solo, pair, sddg)
    └── schemas/         # File format specifications
```

## Output Structure

After installation (`~/DuetData/ai-kit/`):

```
ai-kit/
├── core_instructions.md   # Entrypoint (referenced by CLAUDE.md)
├── settings.json          # User settings (timezone)
├── mcp-server/            # MCP server
│
├── modes/                 # ...copied from templates
├── stances/
├── skills/
├── personas/
├── workflows/
└── schemas/
```

## Configuration

See [docs/settings.md](docs/settings.md) for settings.json options.

## Client Integration

### Claude Code

`~/.claude/CLAUDE.md` should contain:
```
@~/DuetData/ai-kit/core_instructions.md
```

MCP server `ai-kit` provides the `timestamp` tool.

### Codex

`~/.codex/config.toml` should contain:
```toml
model_instructions_file = "/Users/<you>/DuetData/ai-kit/core_instructions.md"
```

MCP server `ai-kit` provides the `timestamp` tool.

## Development

Legacy files (jinja2 templates) are preserved in `templates/_legacy/` for reference but are not deployed.
