# Luma Agent Instructions

Luma is a lightweight self-hosted photo and video browser designed
for extremely large media collections and low-end hardware.

## Primary goals

In priority order:

1. Performance on large libraries.
2. Simple maintainable architecture.
3. Excellent browsing UI/UX.
4. Fast tag search and editing.
5. Low CPU and memory usage.
6. Easy self-hosting.

Do not trade performance or architectural simplicity for unnecessary
features.

## Architecture

Read `ARCHITECTURE.md` before making architectural changes.

Detailed subsystem contracts live in `docs/`.

Important documents:

- `docs/PRODUCT.md`
- `docs/PERFORMANCE.md`
- `docs/API.md`
- `docs/INDEXING.md`
- `docs/TAGGING.md`
- `docs/MEDIA-CACHE.md`

Architecture decisions are recorded under `docs/adr/`.

## Hard invariants

Already-indexed browse/search requests must never:

- enumerate media directories
- stat original files
- read embedded metadata
- invoke ffmpeg or ffprobe
- decode original images

All normal browsing must operate from SQLite and generated cache files.

Do not introduce:

- PostgreSQL
- Redis
- Elasticsearch
- message brokers
- microservices
- background infrastructure services

without an explicit architecture decision.

## Backend

Backend:

- .NET 10
- ASP.NET Core
- SQLite
- Dapper

Prefer feature-oriented organization.

Do not introduce generic repository abstractions.

Keep SQL explicit and colocated with the feature using it where practical.

Async APIs must support CancellationToken.

Avoid unbounded concurrency.

Use modern C# features such as primary constructors, records, initializer lists, var etc.

## Frontend

Frontend:

- React
- TypeScript
- Vite

Organize frontend code by feature.

Do not duplicate server contracts manually when generated API types are
available.

Large collections must use virtualization.

Never render an entire result collection into the DOM.

## Styling and UI

Tailwind CSS is the primary styling system.

Do not introduce CSS modules, CSS-in-JS libraries, styled-components,
or feature-specific stylesheets unless explicitly required.

Prefer shared UI components from `src/components/ui` instead of styling
native controls independently inside features.

Do not use arbitrary Tailwind values such as:

- `w-[317px]`
- `mt-[13px]`
- `text-[#abcdef]`
- `z-[99999]`

unless there is a concrete reason that cannot be represented by the
existing design tokens or Tailwind scale.

Do not introduce new colors, spacing conventions, border radii, shadows,
or typography styles inside feature code.

Reusable visual decisions belong in the shared design system.

Avoid excessive visual effects:

- unnecessary gradients
- excessive shadows
- excessive rounded containers
- backdrop blur without a UX reason
- unnecessary animations
- animation durations above 200ms for routine controls

## Accessibility

Accessibility is a functional requirement.

Prefer semantic HTML before ARIA.

Use native elements where appropriate:

- `button` for actions
- `a` for navigation
- `input` for input
- headings in logical order

Do not make clickable `div` or `span` elements.

Interactive controls must be usable using only the keyboard.

Visible focus indicators must not be removed.

Icon-only controls must have an accessible name.

Images must use appropriate alt text. Decorative images should use an
empty alt attribute.

Dialogs, menus, popovers, tooltips and similar interactive primitives
must use the project's approved accessible primitive library rather than
being reimplemented manually.

Do not add ARIA attributes when native HTML already provides the
necessary semantics.

## API

Public HTTP endpoints are contracts.

Do not silently change endpoint semantics.

Breaking API changes require explicit approval.

Use cursor pagination for media collections.

API errors must use the common error contract.

## Database

Schema changes must use migrations.

Never perform schema modifications dynamically from feature code.

Queries operating on large tables must be checked for appropriate indexes.

Do not introduce N+1 queries.

## Media processing

Media processing must always be bounded.

Never create one task/thread per file.

Thumbnail generation must use configured concurrency limits.

Original media should not be transcoded unless explicitly required.

## Testing

Changes to domain behavior require tests.

Bug fixes should include a regression test where practical.

Before completing work:

1. build backend
2. run backend tests
3. build frontend
4. run frontend tests
5. report commands executed and failures

## Scope discipline

Implement only the requested feature.

Do not add speculative abstractions.

Do not perform unrelated refactors.

Do not add dependencies when a reasonable solution exists using the
existing stack.

If a task requires violating an architectural invariant, stop and explain
the conflict rather than silently changing the architecture.
