# 0001 — Single-process foundation and contract ownership

Status: accepted.

Use one .NET 10 ASP.NET Core host, Dapper, Microsoft.Data.Sqlite and a React/TypeScript/Vite client. SQLite uses WAL, foreign keys, a five-second busy timeout, and short transactions. One application instance owns a data directory. Startup applies ordered, embedded SQL migrations transactionally before serving requests; unknown or altered migrations fail startup. Back up the database before upgrades; failed migrations roll back and stop startup. No generic repository or extra service is needed.

Use `docs/adr/` for decisions (the original `docs/adrs/` directory was empty). Domain tables arrive with their owning features, not in the foundation migration.

Server endpoint DTOs generate OpenAPI and frontend TypeScript. Commit generated artifacts; CI checks for drift. RFC 9457 Problem Details with a stable `code` and `traceId` is the common error contract. Only implemented endpoints appear in OpenAPI; API.md additionally specifies future staged contracts.

The client uses Tailwind tokens and shared native controls. Radix Dialog is the approved dialog primitive; use the corresponding Radix primitive as other interactions arrive. TanStack Query owns request lifecycle and TanStack Virtual bounds gallery DOM size. Lucide React supplies maintainable interface icons instead of feature-owned SVG path markup. Inter is bundled locally as the default interface typeface.

Development uses a Vite `/api` proxy. Production serves the built client from the same ASP.NET host. Authentication remains deferred for private-network use.
