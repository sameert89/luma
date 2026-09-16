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
    "/api/folders/{id}/index": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["IndexFolder"];
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
    "/api/media/{id}/original": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetOriginalMedia"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetLibraries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetFolders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetMedia"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetMediaDetail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/{id}/neighbors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetMediaNeighbors"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/priority": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PrioritizeVisibleMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/{id}/cache/{revision}/{variant}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetCachedMedia"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FindTags"];
        put?: never;
        post: operations["CreateTag"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["EditMediaTags"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/media/{id}/preference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SetPreference"];
        post?: never;
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
        BulkTagsRequest: {
            mediaIds: number[];
            addTagIds: number[];
            removeTagIds: number[];
        };
        CacheRepresentation: {
            url: string;
            status: string;
            /** Format: int32 */
            width: number | null;
            /** Format: int32 */
            height: number | null;
        };
        CreateTagRequest: {
            name: string;
        };
        FolderPage: {
            current: components["schemas"]["FolderSummary"];
            ancestors: components["schemas"]["FolderSummary"][];
            items: components["schemas"]["FolderSummary"][];
            nextCursor: string | null;
            previousCursor: string | null;
        };
        FolderSummary: {
            /** Format: int64 */
            id: number;
            /** Format: int64 */
            libraryId: number;
            /** Format: int64 */
            parentId: number | null;
            name: string;
            coverUrl: string | null;
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
        LibrarySummary: {
            /** Format: int64 */
            id: number;
            name: string;
            availability: string;
            /** Format: int64 */
            rootFolderId: number | null;
            coverUrl: string | null;
        };
        MediaNeighbors: {
            previous: components["schemas"]["MediaSummary"] | null;
            next: components["schemas"]["MediaSummary"] | null;
        };
        MediaPage: {
            items: components["schemas"]["MediaSummary"][];
            nextCursor: string | null;
            previousCursor: string | null;
        };
        MediaPriorityRequest: {
            ids: number[];
        };
        MediaSummary: {
            /** Format: int64 */
            id: number;
            /** Format: int64 */
            libraryId: number;
            /** Format: int64 */
            folderId: number;
            fileName: string;
            mediaType: string;
            extension: string;
            /** Format: int64 */
            sizeBytes: number;
            /** Format: int32 */
            width: number | null;
            /** Format: int32 */
            height: number | null;
            /** Format: int64 */
            durationMs: number | null;
            modifiedAt: string;
            effectiveDate: string;
            capturedAt: string | null;
            preference: string;
            availability: string;
            thumbnail: components["schemas"]["CacheRepresentation"];
            preview: components["schemas"]["CacheRepresentation"];
            tags: components["schemas"]["TagSummary"][];
        };
        PreferenceRequest: {
            preference: string;
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
        TagSummary: {
            /** Format: int64 */
            id: number;
            name: string;
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
    IndexFolder: {
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
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    GetOriginalMedia: {
        parameters: {
            query?: {
                download?: boolean;
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
                content?: never;
            };
            /** @description Partial Content */
            206: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Range Not Satisfiable */
            416: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    GetLibraries: {
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
                    "application/json": components["schemas"]["LibrarySummary"][];
                };
            };
        };
    };
    GetFolders: {
        parameters: {
            query?: {
                libraryId?: number;
                parentId?: number;
                limit?: number;
                cursor?: string;
            };
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
                    "application/json": components["schemas"]["FolderPage"];
                };
            };
        };
    };
    GetMedia: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                libraryId?: number;
                folderId?: number;
                recursive?: boolean;
                q?: string;
                path?: string;
                startsWith?: string;
                endsWith?: string;
                tag?: string[];
                tagMode?: string;
                tagged?: boolean;
                mediaType?: string;
                extension?: string[];
                dateFrom?: string;
                dateTo?: string;
                minSizeBytes?: number;
                maxSizeBytes?: number;
                orientation?: string;
                minWidth?: number;
                width?: number;
                minHeight?: number;
                height?: number;
                minAspectRatio?: number;
                maxAspectRatio?: number;
                preference?: string;
                availability?: string;
                sort?: string;
                order?: string;
                groupBy?: string;
            };
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
                    "application/json": components["schemas"]["MediaPage"];
                };
            };
        };
    };
    GetMediaDetail: {
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
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MediaSummary"];
                };
            };
        };
    };
    GetMediaNeighbors: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                libraryId?: number;
                folderId?: number;
                recursive?: boolean;
                q?: string;
                path?: string;
                startsWith?: string;
                endsWith?: string;
                tag?: string[];
                tagMode?: string;
                tagged?: boolean;
                mediaType?: string;
                extension?: string[];
                dateFrom?: string;
                dateTo?: string;
                minSizeBytes?: number;
                maxSizeBytes?: number;
                orientation?: string;
                minWidth?: number;
                width?: number;
                minHeight?: number;
                height?: number;
                minAspectRatio?: number;
                maxAspectRatio?: number;
                preference?: string;
                availability?: string;
                sort?: string;
                order?: string;
                groupBy?: string;
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
                    "application/json": components["schemas"]["MediaNeighbors"];
                };
            };
        };
    };
    PrioritizeVisibleMedia: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MediaPriorityRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    GetCachedMedia: {
        parameters: {
            query?: {
                v?: number;
            };
            header?: never;
            path: {
                id: number;
                revision: number;
                variant: string;
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
                content?: never;
            };
            /** @description Not Modified */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    FindTags: {
        parameters: {
            query?: {
                prefix?: string;
                limit?: number;
            };
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
                    "application/json": components["schemas"]["TagSummary"][];
                };
            };
        };
    };
    CreateTag: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateTagRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagSummary"];
                };
            };
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TagSummary"];
                };
            };
        };
    };
    EditMediaTags: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkTagsRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SetPreference: {
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
                "application/json": components["schemas"]["PreferenceRequest"];
            };
        };
        responses: {
            /** @description No Content */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
