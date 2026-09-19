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
    "/api/settings/source-verification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetSourceVerificationSetting"];
        put: operations["SetSourceVerificationSetting"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/refresh-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetLibraryRefreshSettings"];
        put: operations["SetLibraryRefreshSettings"];
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
    "/api/libraries/{id}/metadata-mode": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SetLibraryMetadataMode"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/libraries/{id}/root": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["PrepareLibraryRoot"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/folders/{id}/scans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["RescanFolder"];
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
    "/api/imports/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ImportTags"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exports/xmp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ExportXmp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/exports/dislikes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ExportDislikes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetMetadataJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/jobs/{id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DownloadMetadataJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/collections/tag-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetTagGroups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/random": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetRandomImage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/folders/{id}/cover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SetFolderCover"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/folders/{id}/hidden": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["SetFolderHidden"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/folders/hidden": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetHiddenFolders"];
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
    "/api/collections/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetCollectionTags"];
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
    "/api/tags/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["RenameTag"];
        post?: never;
        delete: operations["DeleteTag"];
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
    "/api/media/{id}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetWatchProgress"];
        put: operations["SetWatchProgress"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/clear-finished": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ClearFinishedBackgroundTasks"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/clear": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ClearBackgroundTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CancelBackgroundTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks/{id}/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["QueueBackgroundTaskAgain"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetBackgroundTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/search/suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["GetSearchSuggestions"];
        put?: never;
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
        BackgroundTask: {
            id: string;
            kind: string;
            state: string;
            createdAt: string;
            /** Format: int64 */
            processed: number;
            /** Format: int64 */
            failed: number;
            /** Format: int64 */
            pending: number;
            scope?: string | null;
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
        CollectionTagPage: {
            items: components["schemas"]["TagSummary"][];
            nextCursor: string | null;
            previousCursor: string | null;
        };
        CoverImage: {
            url: string;
            /** Format: int32 */
            width: number;
            /** Format: int32 */
            height: number;
        };
        CoverRequest: {
            /** Format: int64 */
            mediaId: number | null;
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
            /** @default false */
            coverOverride: boolean;
            coverImages?: components["schemas"]["CoverImage"][] | null;
        };
        FolderVisibilityRequest: {
            hidden: boolean;
        };
        HiddenFolderSummary: {
            /** Format: int64 */
            id: number;
            /** Format: int64 */
            libraryId: number;
            libraryName: string;
            path: string;
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
        JobAccepted: {
            /** Format: int64 */
            id: number;
        };
        JobItem: {
            /** Format: int64 */
            mediaId: number;
            code: string;
        };
        LibraryMetadataMode: {
            metadataMode: string;
        };
        LibraryRefreshSettings: {
            /** @default watcher */
            mode: string;
            /** @default true */
            refreshOnOpen: boolean;
            /** Format: int32
             * @default 60
             */
            periodicIntervalMinutes: number;
            /** Format: int32
             * @default 5
             */
            watcherDebounceSeconds: number;
            /** Format: int32
             * @default 10
             */
            fileStabilitySeconds: number;
        };
        LibraryRoot: {
            /** Format: int64 */
            folderId: number;
        };
        LibrarySummary: {
            /** Format: int64 */
            id: number;
            name: string;
            availability: string;
            /** Format: int64 */
            rootFolderId: number | null;
            coverUrl: string | null;
            /** @default false */
            coverOverride: boolean;
            coverImages?: components["schemas"]["CoverImage"][] | null;
            /** @default embedded */
            metadataMode: string;
        };
        MediaNeighbors: {
            previous: components["schemas"]["MediaSummary"] | null;
            next: components["schemas"]["MediaSummary"] | null;
        };
        MediaPage: {
            items: components["schemas"]["MediaSummary"][];
            nextCursor: string | null;
            previousCursor: string | null;
            seed?: string | null;
        };
        MediaPriorityRequest: {
            ids: number[];
            /** @default false */
            previews: boolean;
        };
        MediaQuery: {
            /** Format: int32 */
            limit?: number | null;
            cursor?: string | null;
            /** Format: int64 */
            libraryId?: number | null;
            /** Format: int64 */
            folderId?: number | null;
            recursive?: boolean | null;
            q?: string | null;
            path?: string | null;
            startsWith?: string | null;
            endsWith?: string | null;
            tag?: string[] | null;
            collectionTag?: string | null;
            tagMode?: string | null;
            tagged?: boolean | null;
            mediaType?: string | null;
            extension?: string[] | null;
            dateFrom?: string | null;
            dateTo?: string | null;
            /** Format: int64 */
            minSizeBytes?: number | null;
            /** Format: int64 */
            maxSizeBytes?: number | null;
            orientation?: string | null;
            /** Format: int32 */
            minWidth?: number | null;
            /** Format: int32 */
            width?: number | null;
            /** Format: int32 */
            minHeight?: number | null;
            /** Format: int32 */
            height?: number | null;
            /** Format: double */
            minAspectRatio?: number | null;
            /** Format: double */
            maxAspectRatio?: number | null;
            preference?: string | null;
            availability?: string | null;
            sort?: string | null;
            order?: string | null;
            seed?: string | null;
            groupBy?: string | null;
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
            groupKey?: string | null;
            groupLabel?: string | null;
            watchProgress?: components["schemas"]["WatchState"] | null;
        };
        MetadataJobRequest: {
            mediaIds?: number[] | null;
            query?: components["schemas"]["MediaQuery"] | null;
            /** @default false */
            includeSidecars: boolean;
            /** @default false */
            automatic: boolean;
            /** Format: int64 */
            scanId?: number | null;
        };
        MetadataJobStatus: {
            /** Format: int64 */
            id: number;
            kind: string;
            state: string;
            createdAt: string;
            snapshotAt: string | null;
            finishedAt: string | null;
            /** Format: int32 */
            processed: number;
            /** Format: int32 */
            failed: number;
            failureCode: string | null;
            items: components["schemas"]["JobItem"][];
            /** Format: int64 */
            nextMediaId: number | null;
            contentUrl: string | null;
            /**
             * Format: int32
             * @default 0
             */
            found: number;
            /**
             * Format: int32
             * @default 0
             */
            updated: number;
            /**
             * Format: int32
             * @default 0
             */
            skipped: number;
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
        SearchSuggestion: {
            kind: string;
            label: string;
            /** Format: int64 */
            id: number;
            detail?: string | null;
            /** Format: int64 */
            libraryId?: number | null;
        };
        SourceVerificationSetting: {
            enabled: boolean;
        };
        StartScanRequest: {
            /** @default false */
            force: boolean;
            /** @default false */
            retryFailures: boolean;
            /** @default embedded */
            metadataMode: string;
        };
        StatusResponse: {
            status: string;
            /** Format: int32 */
            schemaVersion: number;
        };
        TagGroupPage: {
            items: components["schemas"]["TagSummary"][];
            /** Format: int64 */
            nextId: number | null;
        };
        TagSummary: {
            /** Format: int64 */
            id: number;
            name: string;
        };
        WatchState: {
            /** Format: int64 */
            mediaId: number;
            /** Format: double */
            positionSeconds: number;
            /** Format: double */
            durationSeconds: number;
            /** Format: double */
            watchedSeconds: number;
            state: string;
            updatedAt: string;
        };
        WatchUpdate: {
            /** Format: double */
            positionSeconds: number;
            /** Format: double */
            durationSeconds: number;
            /** Format: double */
            watchedSeconds: number;
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
    GetSourceVerificationSetting: {
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
                    "application/json": components["schemas"]["SourceVerificationSetting"];
                };
            };
        };
    };
    SetSourceVerificationSetting: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SourceVerificationSetting"];
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
    GetLibraryRefreshSettings: {
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
                    "application/json": components["schemas"]["LibraryRefreshSettings"];
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
    SetLibraryRefreshSettings: {
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
                "application/json": components["schemas"]["LibraryRefreshSettings"];
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
    SetLibraryMetadataMode: {
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
                "application/json": components["schemas"]["LibraryMetadataMode"];
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
    PrepareLibraryRoot: {
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
                    "application/json": components["schemas"]["LibraryRoot"];
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
    RescanFolder: {
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
            /** @description Not Modified */
            304: {
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
    ImportTags: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MetadataJobRequest"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobAccepted"];
                };
            };
        };
    };
    ExportXmp: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MetadataJobRequest"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobAccepted"];
                };
            };
        };
    };
    ExportDislikes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MetadataJobRequest"];
            };
        };
        responses: {
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobAccepted"];
                };
            };
        };
    };
    GetMetadataJob: {
        parameters: {
            query?: {
                afterMediaId?: number;
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
                    "application/json": components["schemas"]["MetadataJobStatus"];
                };
            };
        };
    };
    DownloadMetadataJob: {
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
                content?: never;
            };
        };
    };
    GetTagGroups: {
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
                collectionTag?: string;
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
                seed?: string;
                groupBy?: string;
                afterId?: number;
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
                    "application/json": components["schemas"]["TagGroupPage"];
                };
            };
        };
    };
    GetRandomImage: {
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
                collectionTag?: string;
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
                seed?: string;
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
                content?: never;
            };
        };
    };
    SetFolderCover: {
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
                "application/json": components["schemas"]["CoverRequest"];
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
    SetFolderHidden: {
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
                "application/json": components["schemas"]["FolderVisibilityRequest"];
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
    GetHiddenFolders: {
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
                    "application/json": components["schemas"]["HiddenFolderSummary"][];
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
                sort?: string;
                order?: string;
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
                collectionTag?: string;
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
                seed?: string;
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
                collectionTag?: string;
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
                seed?: string;
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
    GetCollectionTags: {
        parameters: {
            query?: {
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
                    "application/json": components["schemas"]["CollectionTagPage"];
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
    RenameTag: {
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
    DeleteTag: {
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
    GetWatchProgress: {
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
                    "application/json": components["schemas"]["WatchState"];
                };
            };
        };
    };
    SetWatchProgress: {
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
                "application/json": components["schemas"]["WatchUpdate"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WatchState"];
                };
            };
        };
    };
    ClearFinishedBackgroundTasks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
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
    ClearBackgroundTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
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
    CancelBackgroundTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
        };
    };
    QueueBackgroundTaskAgain: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
        };
    };
    GetBackgroundTasks: {
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
                    "application/json": components["schemas"]["BackgroundTask"][];
                };
            };
        };
    };
    GetSearchSuggestions: {
        parameters: {
            query?: {
                q?: string;
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
                    "application/json": components["schemas"]["SearchSuggestion"][];
                };
            };
        };
    };
}
