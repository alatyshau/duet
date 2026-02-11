#!/usr/bin/env python3
"""AI Kit MCP Server.

Provides tools for AI agents working with Duet instructions.
Settings are loaded from ai-kit/settings.json (parent directory).
"""

import asyncio
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from tools.timestamp import get_timestamp
from tools.instructions import get_instruction_location

# Settings stay in ai-kit/ (parent of mcp-server/)
SETTINGS_PATH = Path(__file__).parent.parent
# Instructions moved to ai-instructions/ (sibling of ai-kit/)
INSTRUCTIONS_PATH = Path(__file__).parent.parent.parent / "ai-instructions"

server = Server("ai-kit")


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools."""
    return [
        Tool(
            name="timestamp",
            description="Get current timestamp in format YYMMDD_HHMMSS<tz> (e.g., 260126_201530M). Uses timezone from ai-kit settings.",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        ),
        Tool(
            name="get_instruction_location",
            description="Get absolute path to ai-instructions directory containing instructions, modes, stances, skills, personas, etc.",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": []
            }
        )
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Handle tool calls."""
    if name == "timestamp":
        ts = get_timestamp(SETTINGS_PATH)
        return [TextContent(type="text", text=ts)]

    if name == "get_instruction_location":
        path = get_instruction_location(INSTRUCTIONS_PATH)
        return [TextContent(type="text", text=path)]

    raise ValueError(f"Unknown tool: {name}")


async def main():
    """Run the MCP server."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
