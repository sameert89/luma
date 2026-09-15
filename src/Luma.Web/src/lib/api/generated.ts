// Generated from the server OpenAPI document. Run npm run generate:api.
export interface paths {
    "/api/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/indexing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetIndexingStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/scans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["StartScan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/scans/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetScan"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/scans/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CancelScan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ApiProblem: {
            type?: string | null;
            title?: string | null;
            /** Format: int32 */
            status?: number | null;
            detail?: string | null;
            instance?: string | null;
            code: string;
            traceId: string;
        };
        IndexingLibrary: {
            /** Format: int64 */
            id: number;
            name: string;
            availability: string;
            /** Format: int64 */
            latestScanId: number | null;
        };
        IndexingStatus: {
            libraries: components["schemas"]["IndexingLibrary"][];
            cachePressure: boolean;
            /** Format: int64 */
            cacheBytes: number;
            /** Format: int32 */
            discoveryWorkers: number;
            /** Format: int32 */
            processingWorkers: number;
            /** Format: int32 */
            imageWorkers: number;
            /** Format: int32 */
            videoWorkers: number;
            /** Format: int32 */
            queueCapacity: number;
        };
        ScanAccepted: {
            /** Format: int64 */
            id: number;
        };
        ScanFailure: {
            /** Format: int64 */
            id: number;
            /** Format: int64 */
            mediaId: number | null;
            code: string;
            occurredAt: string;
        };
        ScanProgress: {
            /** Format: int64 */
            id: number;
            /** Format: int64 */
            libraryId: number;
            state: string;
            /** Format: int64 */
            discovered: number;
            /** Format: int64 */
            skipped: number;
            startedAt: string;
            finishedAt: string | null;
            failureCode: string | null;
            /** Format: int64 */
            pending: number;
            /** Format: int64 */
            processing: number;
            /** Format: int64 */
            ready: number;
            /** Format: int64 */
            failed: number;
            failures: components["schemas"]["ScanFailure"][];
            /** Format: int64 */
            nextFailureId: number | null;
        };
        StartScanRequest: {
            /** @default false */
            force: boolean;
            /** @default false */
            retryFailures: boolean;
        };
        StatusResponse: {
            status: string;
            /** Format: int32 */
            schemaVersion: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    GetStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusResponse"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ApiProblem"];
                };
            };
        };
    };
    GetIndexingStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IndexingStatus"];
                };
            };
        };
    };
    StartScan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StartScanRequest"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanAccepted"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ApiProblem"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ApiProblem"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ApiProblem"];
                };
            };
        };
    };
    GetScan: {
        parameters: {
            query?: {
                afterFailureId?: number;
            };
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanProgress"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ApiProblem"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ApiProblem"];
                };
            };
        };
    };
    CancelScan: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanAccepted"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["ApiProblem"];
                };
            };
        };
    };
}
