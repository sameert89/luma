# Localization

Luma uses i18next with react-i18next. English (`en`) is currently the only
supported language. Its JSON resources are bundled synchronously, so the app,
offline startup and standalone Help do not make translation requests.

## Resources

English catalogs live in `src/Luma.Web/src/lib/i18n/locales/en/`:

| Catalog | Content |
| --- | --- |
| `common.json` | Shared state labels and counts |
| `app.json` | Navigation, Settings, appearance and client errors |
| `ui.json` | Shared components and accessibility labels |
| `browse.json` | Gallery, filters, viewer, Flick, playback and captions |
| `files.json` | File management, conflicts, recovery and recycle bin |
| `panels.json` | Comic shelves, locations and reader |
| `tags.json` | Tag editing and metadata exchange |
| `uploads.json` | Upload UI and queue messages |
| `help.json` | Help guide, gestures and shortcut descriptions |
| `api.json` | Known English API problem titles |
| `releases.json` | Release history, newest first |

Keys are grouped by component or feature. Reuse existing keys within their
context; do not use English sentences as keys or provide English fallbacks in
components. Keep technical IDs, API values, file paths, shortcuts, CSS and
configuration examples in code. Option values must stay fixed even when their
labels are translated.

## Writing messages

`src/Luma.Web/src/features/files/FileToolbar.tsx`:

```tsx
import { t } from '../../lib/i18n'

const message = t('files:fileToolbar.operationsQueued', { count: queued, skipped: '' })
```

`src/Luma.Web/src/lib/i18n/locales/en/files.json`:

```json
{
  "fileToolbar": {
    "operationsQueued_one": "{{count}} operation queued.{{skipped}} Follow progress in Background jobs.",
    "operationsQueued_other": "{{count}} operations queued.{{skipped}} Follow progress in Background jobs."
  }
}
```

Keep complete sentences in a single message. Use named `{{placeholders}}`
instead of concatenation, and pass a numeric `count` for i18next plural rules.
Use `{{count, number}}` for locale-aware number formatting. Use react-i18next
`Trans` with named components when a sentence contains styled text; translators
must be able to move the styled portion without changing JSX.

React escapes rendered text and values. Do not insert translations with
`dangerouslySetInnerHTML` or turn user-provided text into translation keys.

The API currently reuses error codes across distinct validation messages.
`apiMessage()` matches known titles through the English catalog while retaining
unknown server messages verbatim, so newer servers do not lose useful detail.
Server logs and API contracts retain their existing English diagnostics.

## Additional languages

No language chooser or automatic browser-language detection is enabled yet.
When adding a language, create its catalog directory, register its resources and
supported language in `src/lib/i18n/index.ts`, and keep English as the fallback.
Provide the plural forms required by that language, preserving placeholders and
named `Trans` components. Preserve release versions, dates and history order.

For a future in-app language switch, use `useTranslation` in components and
resolve module-level display data (themes, guide and release notes) when the
language changes. The current application initializes English once per load.

## Verification

Run frontend build, standalone Help build, lint, formatting and tests. The
catalog tests verify static translation references and reject embedded JSX
text and accessibility labels. Runtime tests cover interpolation, plural
selection, English fallback and preserving unknown server messages.

Keep older release notes to their major user-facing features. Detailed behavior,
migrations and implementation history belong in the subsystem documentation.
