/**
 * HTTP client for Duet Python backend.
 *
 * All methods throw on network/HTTP errors.
 * Caller is responsible for error handling.
 */

export interface HealthResponse {
    status: 'ok';
    version: string;
    uptime_seconds: number;
}

export interface StopResponse {
    status: 'stopping';
}

export interface TimestampResponse {
    timestamp: string;
}

export interface DuetDataPathResponse {
    path: string;
}

export interface StreamEntity {
    id: string;
    type: 'business' | 'stream' | 'product' | 'project';
    name: string;
    icon: string | null;
    path: string;
    absolute_path: string | null;
    parent_id: string | null;
    git_url: string | null;
    status: string | null;
}

export interface ProjectEntity {
    id: string;
    type: 'project';
    name: string;
    icon: string | null;
    path: string;
    absolute_path: string | null;
    parent_id: string;
    git_url: string | null;
    status: string | null;
}

export interface StreamsResponse {
    streams: StreamEntity[];
}

export interface ProjectsResponse {
    projects: ProjectEntity[];
}

export interface ChainItem {
    id: string;
    type: string;
    name: string;
    path: string;
}

export interface ComponentInfo {
    name: string;
    path: string;
    hasSpec: boolean;
}

export interface WorkspaceInfoResponse {
    duetDataPath: string;
    instructionsPath: string;
    chain: ChainItem[];
    components: ComponentInfo[];
}

export interface ScanResponse {
    status: 'completed' | 'skipped';
    reason?: string;
    entities_count?: number;
    duration_ms?: number;
}

export interface AddBusinessResponse {
    status: 'added' | 'exists';
    business_folders: string[];
    scan?: ScanResponse;
}

export interface ApiError {
    error: string;
    code: string;
}

export class DuetApiClient {
    constructor(private readonly baseUrl: string) {}

    async health(timeoutMs: number = 2000): Promise<HealthResponse> {
        return this.get('/health', timeoutMs);
    }

    /**
     * Safely parse error response. Handles non-JSON responses (HTML, plain text).
     */
    private async parseErrorResponse(response: Response): Promise<string> {
        const text = await response.text();

        // Try to parse as JSON
        try {
            const json = JSON.parse(text) as ApiError;
            if (json.error) {
                return `${json.error} (${json.code || 'UNKNOWN'})`;
            }
        } catch {
            // Not JSON, use text
        }

        // Fallback: use raw text (truncated) + status
        const truncated = text.length > 200 ? text.substring(0, 200) + '...' : text;
        return `${response.status} ${response.statusText}: ${truncated}`;
    }

    async stop(): Promise<StopResponse> {
        return this.post('/stop');
    }

    async timestamp(): Promise<TimestampResponse> {
        return this.get('/timestamp');
    }

    async duetDataPath(): Promise<DuetDataPathResponse> {
        return this.get('/duet-data-path');
    }

    async workspaceInfo(workspacePaths?: string[]): Promise<WorkspaceInfoResponse> {
        const params = workspacePaths?.length
            ? '?' + workspacePaths.map(p => `workspace_paths=${encodeURIComponent(p)}`).join('&')
            : '';
        return this.get(`/workspace-info${params}`);
    }

    async streams(): Promise<StreamsResponse> {
        return this.get('/streams');
    }

    async projects(streamId: number): Promise<ProjectsResponse> {
        return this.get(`/projects/${streamId}`);
    }

    async scan(): Promise<ScanResponse> {
        return this.post('/scan', 30000); // scan can take time
    }

    async addBusiness(absolutePath: string): Promise<AddBusinessResponse> {
        return this.postJson('/add-business', { path: absolutePath }, 30000);
    }

    private async get<T>(path: string, timeoutMs: number = 10000): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'GET',
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorMsg = await this.parseErrorResponse(response);
                throw new Error(`API error: ${errorMsg}`);
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async post<T>(path: string, timeoutMs: number = 10000): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'POST',
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorMsg = await this.parseErrorResponse(response);
                throw new Error(`API error: ${errorMsg}`);
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private async postJson<T>(path: string, body: unknown, timeoutMs: number = 10000): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'POST',
                // eslint-disable-next-line @typescript-eslint/naming-convention
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorMsg = await this.parseErrorResponse(response);
                throw new Error(`API error: ${errorMsg}`);
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
