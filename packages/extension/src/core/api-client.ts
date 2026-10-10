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

/** Answer of `POST /tickets/{action}`: see `core/intents/ticketService.ts`. */
export interface TicketActionResponse {
    text: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    is_error: boolean;
    tickets: { number: string; name: string; shelf: string; folder: string }[];
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

    /**
     * Run a ticket action on the server: `new_ticket`, `move_ticket`,
     * `edit_ticket` or `tickets`, with that action's arguments. A refused
     * action is not an HTTP error: it comes back with `is_error: true`.
     */
    async ticketAction(action: string, args: Record<string, unknown>): Promise<TicketActionResponse> {
        // Ticket folders lie on a cloud drive; the server itself gives up on a stalled one
        return this.postJson(`/tickets/${action}`, args, 60000);
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
