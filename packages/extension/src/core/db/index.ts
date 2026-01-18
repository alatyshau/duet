import initSqlJs, { Database } from 'sql.js';
import writeFileAtomic from 'write-file-atomic';
import * as fs from 'fs/promises';
import { Paths } from '../paths';

export interface Entity {
    id?: number;
    type: 'business' | 'stream' | 'product' | 'project';
    name: string;
    icon: string;
    drivePath: string;
    parentId?: number | null;
    gitUrl?: string; // For products
}

export class DatabaseManager {
    private db: Database | null = null;

    constructor(private readonly paths: Paths) {}

    async init(options?: { wasmPath?: string }): Promise<void> {
        if (this.db) {
            return;
        }

        const loadOptions = options?.wasmPath ? { locateFile: () => options.wasmPath! } : undefined;
        const SQL = await initSqlJs(loadOptions);
        const dbPath = this.paths.dbPath;

        try {
            const data = await fs.readFile(dbPath);
            this.db = new SQL.Database(data);
        } catch {
            this.db = new SQL.Database();
            this.initSchema();
        }
    }

    async reload(options?: { wasmPath?: string }): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        await this.init(options);
    }

    private initSchema(): void {
        if (!this.db) {
             throw new Error('Database not initialized');
        }

        this.db.run(`
            CREATE TABLE IF NOT EXISTS entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT,
                name TEXT,
                icon TEXT,
                drive_path TEXT UNIQUE,
                parent_id INTEGER REFERENCES entities(id),
                git_url TEXT
            );
        `);
    }

    async save(): Promise<void> {
        if (!this.db) {
             throw new Error('Database not initialized');
        }

        const data = this.db.export();
        const buffer = Buffer.from(data);
        
        // Ensure data directory exists
        const dbPath = this.paths.dbPath;
        const dbDir = this.paths.dbDir;

        try {
            await fs.mkdir(dbDir, { recursive: true });
        } catch {
            // ignore if exists
        }

        await writeFileAtomic(dbPath, buffer);
    }

    insertEntity(entity: Entity): number {
        if (!this.db) {
             throw new Error('Database not initialized');
        }

        this.db.run(
            `INSERT OR IGNORE INTO entities (type, name, icon, drive_path, parent_id, git_url) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [entity.type, entity.name, entity.icon, entity.drivePath, entity.parentId ?? null, entity.gitUrl ?? null]
        );

        // Get the ID of the inserted (or existing) row
        const result = this.db.exec(
            `SELECT id FROM entities WHERE drive_path = ?`, 
            [entity.drivePath]
        );
        
        if (result.length > 0 && result[0].values.length > 0) {
            return result[0].values[0][0] as number;
        }
        
        throw new Error(`Failed to insert/get entity: ${entity.drivePath}`);
    }

    clear(): void {
        if (!this.db) {
             throw new Error('Database not initialized');
        }
        this.db.run('DELETE FROM entities');
    }

    getEntities(parentId: number | null = null): Entity[] {
        if (!this.db) {
             throw new Error('Database not initialized');
        }

        const query = parentId === null 
            ? 'SELECT * FROM entities WHERE parent_id IS NULL'
            : 'SELECT * FROM entities WHERE parent_id = ?';
        
        const params = parentId === null ? [] : [parentId];
        return this.queryEntities(query, params);
    }

    getAllEntities(): Entity[] {
        if (!this.db) {
             throw new Error('Database not initialized');
        }
        return this.queryEntities('SELECT * FROM entities', []);
    }

    private queryEntities(query: string, params: any[]): Entity[] {
        if (!this.db) {
            return [];
        }
        const result = this.db.exec(query, params);

        if (result.length === 0) {
            return [];
        }

        const columns = result[0].columns;
        const values = result[0].values;

        return values.map(row => {
            const rowData: any = {};
            columns.forEach((col, index) => {
                rowData[col] = row[index];
            });
            
            return {
                id: rowData.id,
                type: rowData.type,
                name: rowData.name,
                icon: rowData.icon,
                drivePath: rowData.drive_path,
                parentId: rowData.parent_id,
                gitUrl: rowData.git_url
            } as Entity;
        });
    }

    hasChildren(parentId: number): boolean {
        if (!this.db) {
             throw new Error('Database not initialized');
        }

        const result = this.db.exec(
            'SELECT 1 FROM entities WHERE parent_id = ? LIMIT 1',
            [parentId]
        );

        return result.length > 0 && result[0].values.length > 0;
    }

    getEntity(id: number): Entity | null {
        if (!this.db) {
             throw new Error('Database not initialized');
        }

        const result = this.db.exec('SELECT * FROM entities WHERE id = ?', [id]);
        if (result.length === 0 || result[0].values.length === 0) {
            return null;
        }

        return this.mapRow(result[0].columns, result[0].values[0]);
    }

    findClosestEntity(path: string): Entity | null {
        if (!this.db) {
             throw new Error('Database not initialized');
        }

        // Find entity where path starts with drive_path
        // Sort by length desc to get the deepest match
        const result = this.db.exec(
            `SELECT * FROM entities 
             WHERE ? LIKE drive_path || '%' 
             ORDER BY length(drive_path) DESC 
             LIMIT 1`,
            [path]
        );

        if (result.length === 0 || result[0].values.length === 0) {
            return null;
        }

        return this.mapRow(result[0].columns, result[0].values[0]);
    }

    private mapRow(columns: string[], row: any[]): Entity {
        const rowData: any = {};
        columns.forEach((col, index) => {
            rowData[col] = row[index];
        });
        
        return {
            id: rowData.id,
            type: rowData.type,
            name: rowData.name,
            icon: rowData.icon,
            drivePath: rowData.drive_path,
            parentId: rowData.parent_id,
            gitUrl: rowData.git_url
        } as Entity;
    }

    dump(): any[] {
        if (!this.db) {
             throw new Error('Database not initialized');
        }
        const result = this.db.exec('SELECT * FROM entities');
        if (result.length === 0) { return []; }
        
        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj: any = {};
            columns.forEach((col, idx) => obj[col] = row[idx]);
            return obj;
        });
    }
}
