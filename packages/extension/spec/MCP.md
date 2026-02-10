# MCP Server

> Timestamp format, entity model: see [/spec/ECOSYSTEM.md](/spec/ECOSYSTEM.md)

Standalone Node.js MCP server for AI agents (Claude Code, Codex, Copilot) working with Duet/AI-Kit.

## Three MCP Servers in Duet

| # | Location | Language | Tools | Status |
|---|----------|----------|-------|--------|
| 1 | `packages/ai-kit/mcp-server/` | Python | 2 (timestamp, get_instruction_location) | **Legacy, don't touch** |
| 2 | `packages/extension/src/mcp-server/` | Node.js | 5 (superset of #1 + DB tools) | **Active** — this spec |
| 3 | `packages/backend/mcp_handler.py` | Python | 7 (REST-equivalent tools) | **Active** — Backend spec |

**#1 → #2 migration:** Extension's Node.js MCP replaced the ai-kit Python MCP. Same 2 core tools + 3 DB tools (get_duet_data_location, get_hierarchy, find_entity). The ai-kit Python MCP still exists but is legacy.

**#2 → #3 migration (future):** Backend MCP is the most complete (7 tools). Once all agents use Backend MCP, this Extension MCP (#2) becomes redundant.

## Integration Methods

| Method | Provider | How | When |
|--------|----------|-----|------|
| VS Code API | `mcpServerDefinitionProviders` | Registered in extension.ts, auto-discovered by Copilot | On activate |
| File deployment | Claude Code, Codex | Server copied to `DuetData/mcp/mcp-server.js` | On activate (if pointer set) |

## Tools

| Tool | Input | Output |
|------|-------|--------|
| `timestamp` | — | `YYMMDD_HHMMSS<tz>` (e.g., `260126_201530M`) |
| `get_instruction_location` | — | Absolute path to `ai-kit/` directory |
| `get_duet_data_location` | — | Absolute path to DuetData folder |
| `get_hierarchy` | — | Full tree of businesses/streams/products/projects (from index.db) |
| `find_entity` | `name: string` | Entity details (drive_path, git_url, etc.) |

## Runtime

| Aspect | Value |
|--------|-------|
| Process | Standalone Node.js (not in extension host) |
| Transport | stdio |
| Config source | `--data-dir` CLI arg (points to DuetData) |
| Settings file | `{dataDir}/ai-kit/settings.json` |
| Database | `{dataDir}/data/index.db` (sql.js WASM) |
| WASM file | `sql-wasm.wasm` next to `mcp-server.js` |

**Note:** This MCP server does NOT read pointer file directly. Extension passes `--data-dir` (resolved DuetData path from pointer) when deploying.

## Implementation

| Concept | File |
|---------|------|
| MCP server | `mcp-server/index.ts` |
| VS Code registration | `extension.ts` → `registerMcpServerDefinitionProvider` |
| File deployment | `extension.ts` → `deployMcpServer()` |

## Future

- Migrate to Backend MCP (backend already has equivalent tools via `mcp_handler.py`)
- This file-deployed MCP server will become redundant once all agents use Backend MCP
