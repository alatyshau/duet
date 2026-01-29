# MCP Server

Provides tools for AI agents (Claude Code, Codex, Copilot) working with Duet/AI-Kit.

## Integration Methods

| Method | Provider | How | When |
|--------|----------|-----|------|
| VS Code API | `mcpServerDefinitionProviders` | Registered in extension.ts, auto-discovered by Copilot | On activate |
| File deployment | Claude Code, Codex | Server copied to `DuetData/mcp/mcp-server.js` | On activate (if data_folder set) |

## Tools

| Tool | Input | Output |
|------|-------|--------|
| `timestamp` | — | `YYMMDD_HHMMSS<tz>` (e.g., `260126_201530M`) |
| `get_instruction_location` | — | Absolute path to `ai-kit/` directory |

## Runtime

| Aspect | Value |
|--------|-------|
| Process | Standalone Node.js (not in extension host) |
| Transport | stdio |
| Config source | `--data-dir` CLI arg |
| Settings file | `{dataDir}/ai-kit/settings.json` |

## Timestamp Format

Format: `YYMMDD_HHMMSS<tz_id>`

| Part | Source |
|------|--------|
| `YYMMDD_HHMMSS` | Current time in configured timezone |
| `<tz_id>` | From `settings.json → timestampTZ.id` (e.g., "M" for Moscow) |

Timezone config example:
```json
{ "timestampTZ": { "id": "M", "value": "Europe/Moscow" } }
```

## Implementation

| Concept | File |
|---------|------|
| MCP server | `mcp-server/index.ts` |
| VS Code registration | `extension.ts` → `registerMcpServerDefinitionProvider` |
| File deployment | `extension.ts` → `deployMcpServer()` |
