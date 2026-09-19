import { QuietButton } from '../../components/ui/Controls'
import { type Filters } from './api'

export function ActiveFilters({ filters, onApply, libraryName, folderName }: { libraryName?: string; folderName?: string; filters: Filters; onApply: (value: Filters) => void }) {
  const labels: Record<string, string> = { libraryId: 'Library', folderId: 'Folder', q: 'Search', tag: 'Tags', collectionTag: 'Tag collection', mediaType: 'Media type', groupBy: 'Grouping', tagMode: 'Tag matching', tagged: 'Tagged', recursive: 'Include subfolders', preference: 'Favourite state', sort: 'Sort', order: 'Direction' }
  function shown(key: string, value: unknown) { return key === 'libraryId' ? libraryName ?? String(value) : key === 'folderId' ? folderName ?? String(value) : Array.isArray(value) ? value.join(', ') : String(value) }
  const active = Object.entries(filters).filter(([key, value]) => !['cursor', 'limit'].includes(key) && value !== undefined && value !== '' && value !== null && (!Array.isArray(value) || value.length))
  if (!active.length) return null
  return <nav aria-label="Active filters" className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto border-b border-line bg-canvas px-4 py-1">
    {active.map(([key, value]) => <QuietButton compact key={key} className="shrink-0" aria-label={`Clear ${key} filter`} onClick={() => onApply({ ...filters, [key]: undefined, ...(key === 'libraryId' ? { folderId: undefined } : {}) })}>{labels[key] ?? key}: {shown(key, value)} ×</QuietButton>)}
    <QuietButton compact className="shrink-0" onClick={() => onApply({})}>Clear all filters</QuietButton>
  </nav>
}
