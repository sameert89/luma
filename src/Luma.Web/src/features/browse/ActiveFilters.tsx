import { t } from '../../lib/i18n'
import { QuietButton } from '../../components/ui/Controls'
import { tagTone } from '../../components/ui/TagTone'
import { type Filters } from './api'

export function ActiveFilters({
  filters,
  onApply,
  libraryName,
  folderName,
}: {
  libraryName?: string
  folderName?: string
  filters: Filters
  onApply: (value: Filters) => void
}) {
  const labels: Record<string, string> = {
    libraryId: t('browse:activeFilters.library'),
    folderId: t('browse:activeFilters.folder'),
    q: t('browse:activeFilters.search'),
    tag: t('browse:activeFilters.tags'),
    collectionTag: t('browse:activeFilters.tagCollection'),
    mediaType: t('browse:activeFilters.mediaType'),
    groupBy: t('browse:activeFilters.grouping'),
    tagMode: t('browse:activeFilters.tagMatching'),
    tagged: t('browse:activeFilters.tagged'),
    recursive: t('browse:activeFilters.includeSubfolders'),
    preference: t('browse:activeFilters.favouriteState'),
    sort: t('browse:activeFilters.sort'),
    order: t('browse:activeFilters.direction'),
  }
  function shown(key: string, value: unknown) {
    return key === 'libraryId'
      ? (libraryName ?? String(value))
      : key === 'folderId'
        ? (folderName ?? String(value))
        : Array.isArray(value)
          ? value.join(', ')
          : String(value)
  }
  const active = Object.entries(filters).filter(
    ([key, value]) =>
      !['cursor', 'limit'].includes(key) &&
      value !== undefined &&
      value !== '' &&
      value !== null &&
      (!Array.isArray(value) || value.length),
  )
  if (!active.length) return null
  // A band a shade lighter than the canvas holds the chips together, so neither the row nor
  // each chip needs an outline of its own. Clear all filters is the one that carries a colour.
  return (
    <nav
      aria-label={t('browse:activeFilters.activeFilters')}
      className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto bg-surface/50 px-4 py-2"
    >
      {active.flatMap(([key, value]) =>
        key === 'tag' && Array.isArray(value)
          ? value.map(name => (
              <QuietButton
                compact
                variant="plain"
                key={`${key}:${name}`}
                className="tag-tone shrink-0"
                style={tagTone(String(name))}
                aria-label={t('browse:activeFilters.clearTagFilter', { value1: name })}
                onClick={() => onApply({ ...filters, tag: value.filter(item => item !== name) })}
              >
                {name} ×
              </QuietButton>
            ))
          : [
              <QuietButton
                compact
                variant="plain"
                key={key}
                className={`shrink-0 ${key === 'collectionTag' ? 'tag-tone' : ''}`}
                style={key === 'collectionTag' ? tagTone(String(value)) : undefined}
                aria-label={t('browse:activeFilters.clearFilter', { value1: key })}
                onClick={() =>
                  onApply({ ...filters, [key]: undefined, ...(key === 'libraryId' ? { folderId: undefined } : {}) })
                }
              >
                {labels[key] ?? key}: {shown(key, value)} ×
              </QuietButton>,
            ],
      )}
      <QuietButton compact variant="accent" className="ml-1 shrink-0" onClick={() => onApply({})}>
        {t('browse:activeFilters.clearAllFilters')}
      </QuietButton>
    </nav>
  )
}
