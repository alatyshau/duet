/**
 * Duet AI Kit MCP Server
 *
 * Provides tools for AI agents working with Duet instructions and hierarchy.
 * Runs as a standalone Node.js process, communicates via stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import initSqlJs, { Database } from "sql.js";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

// Default timezone config
const DEFAULT_TZ = { id: "Z", value: "UTC" };

// Entity interface matching the database schema
interface Entity {
    id: number;
    type: "business" | "stream" | "product" | "project";
    name: string;
    icon: string;
    drive_path: string;
    parent_id: number | null;
    git_url: string | null;
}

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

/**
 * Load database and return all entities
 */
async function loadDatabase(dataDir: string): Promise<Database | null> {
    const dbPath = path.join(dataDir, "data", "index.db");

    if (!fs.existsSync(dbPath)) {
        return null;
    }

    // Locate wasm file next to the running script
    const wasmPath = path.join(path.dirname(process.argv[1]), "sql-wasm.wasm");

    const SQL = await initSqlJs({
        locateFile: () => wasmPath
    });

    const data = fs.readFileSync(dbPath);
    return new SQL.Database(data);
}

/**
 * Query all entities from database
 */
function queryEntities(db: Database): Entity[] {
    const result = db.exec("SELECT * FROM entities");
    if (result.length === 0) {
        return [];
    }

    const columns = result[0].columns;
    return result[0].values.map(row => {
        const obj: any = {};
        columns.forEach((col, idx) => obj[col] = row[idx]);
        return obj as Entity;
    });
}

/**
 * Build hierarchy tree from flat entities list
 */
function buildHierarchy(entities: Entity[]): any[] {
    const byId = new Map(entities.map(e => [e.id, { ...e, children: [] as any[] }]));
    const roots: any[] = [];

    for (const entity of entities) {
        const node = byId.get(entity.id)!;
        if (entity.parent_id === null) {
            roots.push(node);
        } else {
            const parent = byId.get(entity.parent_id);
            if (parent) {
                parent.children.push(node);
            }
        }
    }

    return roots;
}

/**
 * Find entity by name
 */
function findEntityByName(db: Database, name: string): Entity | null {
    const result = db.exec("SELECT * FROM entities WHERE name = ?", [name]);
    if (result.length === 0 || result[0].values.length === 0) {
        return null;
    }

    const columns = result[0].columns;
    const row = result[0].values[0];
    const obj: any = {};
    columns.forEach((col, idx) => obj[col] = row[idx]);
    return obj as Entity;
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

    // Register get_duet_data_location tool
    server.tool(
        "get_duet_data_location",
        "Get absolute path to DuetData folder containing ai-kit/, repos/, workspaces/, data/index.db, etc.",
        {},
        async () => {
            return {
                content: [{ type: "text", text: path.resolve(dataDir) }],
            };
        }
    );

    // Register get_hierarchy tool
    server.tool(
        "get_hierarchy",
        "Get the full hierarchy of businesses, streams, products, and projects from Duet database. Returns a tree structure.",
        {},
        async () => {
            const db = await loadDatabase(dataDir);
            if (!db) {
                return {
                    content: [{ type: "text", text: "Database not found. Run Duet refresh first." }],
                };
            }

            try {
                const entities = queryEntities(db);
                const hierarchy = buildHierarchy(entities);
                return {
                    content: [{ type: "text", text: JSON.stringify(hierarchy, null, 2) }],
                };
            } finally {
                db.close();
            }
        }
    );

    // Register find_entity tool
    server.tool(
        "find_entity",
        "Find an entity (business, stream, product, or project) by name. Returns entity details including drive_path and git_url.",
        { name: z.string().describe("The name of the entity to find") },
        async ({ name }) => {
            const db = await loadDatabase(dataDir);
            if (!db) {
                return {
                    content: [{ type: "text", text: "Database not found. Run Duet refresh first." }],
                };
            }

            try {
                const entity = findEntityByName(db, name);
                if (!entity) {
                    return {
                        content: [{ type: "text", text: `Entity "${name}" not found.` }],
                    };
                }
                return {
                    content: [{ type: "text", text: JSON.stringify(entity, null, 2) }],
                };
            } finally {
                db.close();
            }
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
