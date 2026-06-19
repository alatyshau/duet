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

export interface ContextEntity {
    id: string;
    type: 'context';
    name: string;
    icon: string | null;
    path: string;
    absolute_path: string | null;
    parent_id: string | null;
    meta: boolean;
    description?: string | null;
    git_repos: Record<string, string> | null;
    reference_repos?: Record<string, string> | null;
}

export interface ContextsResponse {
    contexts: ContextEntity[];
}

export interface ChainItem {
    name: string;
    icon: string;
    description?: string;
}

export interface ComponentInfo {
    name: string;
    path: string;
    spec?: string;
    description?: string;
}

export interface ProductInfo {
    name: string;
    path: string;
    spec?: string;
    description?: string;
    components: ComponentInfo[];
}

export interface OrientationWorkspace {
    kind: 'context' | 'unknown';
    context_name?: string;
    context_folder?: string;
    git_folders: Record<string, string>;
}

/** Context-memory pointer (`context.json` → `memory`), resolved by backend. */
export interface OrientationMemory {
    ref: string;
    path: string;
}

export interface OrientationResponse {
    duet_paths: {
        duetDataPath: string;
        machineConfig: string;
        instructionsPath: string;
    };
    workspace: OrientationWorkspace;
    context?: {
        chain: ChainItem[];
    };
    products: ProductInfo[];
    memory?: OrientationMemory | null;
}

export interface DeployInstructionsResponse {
    status: 'ok' | 'unknown';
    reason?: string;
    deployed?: Record<string, string[]>;
    warnings?: string[];
}

export interface ScanResponse {
    status: 'completed' | 'skipped';
    reason?: string;
    entities_count?: number;
    duration_ms?: number;
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

    async orientation(workspacePaths?: string[]): Promise<OrientationResponse> {
        return this.postJson('/orientation', { workspace_paths: workspacePaths ?? [] });
    }

    async contexts(): Promise<ContextsResponse> {
        return this.get('/contexts');
    }

    async scan(): Promise<ScanResponse> {
        return this.post('/scan', 30000); // scan can take time
    }

    /**
     * Deploy the owning context's instruction components (skills / instructions)
     * into its Drive folder. Idempotent — safe to call on every workspace open.
     */
    async deployInstructions(workspacePaths: string[]): Promise<DeployInstructionsResponse> {
        return this.postJson('/deploy-instructions', { workspace_paths: workspacePaths });
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
