/**
 * Duet AI Kit MCP Server
 *
 * Provides tools for AI agents working with Duet instructions.
 * Runs as a standalone Node.js process, communicates via stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "fs";
import * as path from "path";

// Default timezone config
const DEFAULT_TZ = { id: "Z", value: "UTC" };

interface TimestampTZConfig {
    id: string;
    value: string;
}

interface Settings {
    timestampTZ?: TimestampTZConfig;
}

/**
 * Parse command line arguments to get data directory
 */
function parseArgs(): string {
    const args = process.argv.slice(2);
    const dataDirIndex = args.indexOf("--data-dir");

    if (dataDirIndex === -1 || dataDirIndex + 1 >= args.length) {
        console.error("Usage: node mcp-server.js --data-dir <path>");
        process.exit(1);
    }

    return args[dataDirIndex + 1];
}

/**
 * Load settings from ai-kit/settings.json
 */
function getSettings(dataDir: string): Settings {
    const settingsPath = path.join(dataDir, "ai-kit", "settings.json");

    if (fs.existsSync(settingsPath)) {
        try {
            const content = fs.readFileSync(settingsPath, "utf-8");
            return JSON.parse(content);
        } catch {
            return { timestampTZ: DEFAULT_TZ };
        }
    }

    return { timestampTZ: DEFAULT_TZ };
}

/**
 * Get formatted timestamp using settings from dataDir
 * Format: YYMMDD_HHMMSS<tz_id> (e.g., 260126_201530M)
 */
function getTimestamp(dataDir: string): string {
    const settings = getSettings(dataDir);
    const tzConfig = settings.timestampTZ ?? DEFAULT_TZ;

    // Get current time in specified timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: tzConfig.value,
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";

    const yy = get("year");
    const mm = get("month");
    const dd = get("day");
    const hh = get("hour");
    const min = get("minute");
    const ss = get("second");

    return `${yy}${mm}${dd}_${hh}${min}${ss}${tzConfig.id}`;
}

/**
 * Get absolute path to ai-kit directory
 */
function getInstructionLocation(dataDir: string): string {
    return path.resolve(dataDir, "ai-kit");
}

// Main entry point
async function main() {
    const dataDir = parseArgs();

    // Create MCP server
    const server = new McpServer({
        name: "duet-ai-kit",
        version: "1.0.0",
    });

    // Register timestamp tool
    server.tool(
        "timestamp",
        "Get current timestamp in format YYMMDD_HHMMSS<tz> (e.g., 260126_201530M). Uses timezone from ai-kit settings.",
        {},
        async () => {
            const ts = getTimestamp(dataDir);
            return {
                content: [{ type: "text", text: ts }],
            };
        }
    );

    // Register get_instruction_location tool
    server.tool(
        "get_instruction_location",
        "Get absolute path to ai-kit directory containing instructions, modes, stances, skills, personas, etc.",
        {},
        async () => {
            const location = getInstructionLocation(dataDir);
            return {
                content: [{ type: "text", text: location }],
            };
        }
    );

    // Connect to stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error("MCP Server error:", error);
    process.exit(1);
});
