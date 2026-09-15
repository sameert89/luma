# Stages 1 and 2 delivery verification

Date: 2026-09-15. Local environment: Windows 11 x64, .NET SDK 10.0.303/runtime 10.0.11, Node 24.21.0, npm 11.19.0. This is foundation verification, not a Raspberry Pi or large-library benchmark.

## Stage 1 evidence

- API.md specifies current versus staged endpoints, common errors, limits, shared filters/sorts, cursor navigation/mutations, grouping, covers, shuffle/random selection and candidate SQL/index strategies.
- INDEXING.md defines identity, replacement/move behavior, incomplete/unavailable-root recovery, supported formats, corrupt-file handling and bounded processing.
- TAGGING.md defines versioned Unicode normalization, atomic bulk limits, preferences and explicit import/export semantics, including the full-path dislike export exception.
- MEDIA-CACHE.md defines variants, atomic publication, invalidation, regeneration, quota and pressure behavior without request-time original processing.
- PERFORMANCE.md defines numerical latency/memory/frame/resource targets and a repeatable measurement protocol. ADR 0001 records the foundation decisions; the empty `docs/adrs/` directory was removed in favor of `docs/adr/`.

## Stage 2 checks

Commands below ran successfully from the root unless a frontend working directory is specified.

| Command / check | Result |
| --- | --- |
| `dotnet restore Luma.slnx --locked-mode` | Passed |
| `dotnet build Luma.slnx -c Release --no-restore` | Passed, zero warnings/errors |
| `dotnet test Luma.slnx -c Release --no-build` | 8 passed |
| `npm ci` in `src/Luma.Web` | Passed; zero audit vulnerabilities |
| `npm run generate:api` | Passed; regeneration hashes match byte for byte for JSON and TypeScript |
| `npm run lint` | Passed, including JSX accessibility rules |
| `npm run build` | Passed; generated numeric API fields are typed as numbers |
| `npm test` | 3 passed |
| `npx playwright install chromium` and `npm run test:e2e` | 2 passed, desktop Chromium and mobile emulation |
| `npm run build:host` | Passed; one-process output in `.local/publish` |
| Published `dotnet Luma.Server.dll --urls http://127.0.0.1:5082` | HTTP smoke checks passed for ready status, root/client-route HTML, JavaScript asset, JSON API 404 and disabled production OpenAPI |

A fresh source-only copy under `.local/clean-verification` (no bin/obj/node_modules/dist) also passed locked .NET restore, backend build/eight tests, npm ci, frontend build/three tests. Explicit Tailwind source scanning produces identical CSS/JS asset hashes in the source-only copy and workspace. CI is configured for Linux and Windows, with Linux Chromium checks; hosted CI itself has not been run in this local session.

Backend tests cover fresh migration, idempotent rerun/preserved instance state, WAL/foreign keys, changed/unknown migration history rejection, transaction rollback on migration failure, cancellation, common 404/405 errors and sanitized database failure. Each test uses its own temporary database and cleans it up.

Frontend tests cover connection loading/success, error retry by keyboard, and accessible dialog open/close/focus restoration. Browser checks call the real server through the production frontend preview, verify desktop/mobile overflow, visible keyboard focus, focus trapping, Escape restoration and no browser exceptions. Screenshots were visually reviewed and are reproducible in `src/Luma.Web/test-results/` (ignored generated artifacts).

## Issues found and resolved during verification

- Initial dependency installation: ESLint 10 and TypeScript 7 conflicted with accessibility/generator peer requirements. Pinned compatible ESLint 9 and TypeScript 5.9; installs now pass. ESLint prints an upstream support/deprecation notice, retained until the accessibility plugin supports the newer major.
- Initial NuGet restore reported vulnerable transitive OpenAPI/SQLite packages. Explicit patched package versions removed those restore warnings.
- Initial backend tests: Dapper requires SQLite integer constructor fields to use Int64. Corrected the migration row type; all tests pass.
- OpenAPI initially emitted unknown numeric types under permissive JSON number handling. Strict numeric JSON serialization now generates TypeScript `number` fields.
- The source-only frontend build initially scanned unrelated files. Limited Tailwind discovery to frontend source; bundle output now matches the workspace.
- One clean verification command incorrectly passed `--locked-mode` to `dotnet build`. Corrected to locked `dotnet restore`, then `build --no-restore`.
- The first PowerShell publish smoke assertion treated a binary response body as text. Decoded the UTF-8 problem response before checking it; application behavior was correct.
- One repeat publish was blocked by the smoke-test host still holding the DLL on Windows. Stopped that owned process and reran successfully. Stop a running published host before republishing.

No unresolved stage 1/2 functional blockers. Actual ARM/Linux hardware measurements, indexing, media browsing, generated-cache recovery, collection virtualization, other themes and the remaining product endpoints are explicitly assigned to stages 3–7. The mobile check is browser emulation, not a physical-device performance result.
