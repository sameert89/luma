import { FileImage, FolderOpen, Search, SlidersHorizontal, Tag, X } from 'lucide-react'
import { useDeferredValue, useEffect, useId, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { IconButton, Input } from './Controls'
import { tagTone } from './TagTone'
import { request } from '../../features/browse/api'
import type { components } from '../../lib/api/generated'

export type SearchSuggestion = components['schemas']['SearchSuggestion']

const kinds: Record<string, { label: string; icon: typeof Tag }> = { tag: { label: 'Tag', icon: Tag }, folder: { label: 'Folder', icon: FolderOpen }, file: { label: 'File', icon: FileImage } }

export function SearchHeader({ value, onChange, onSearch, onSuggestion, onClear, onHome, onFilters, searchRequested }: { value: string; onChange: (value: string) => void; onSearch: () => void; onSuggestion?: (suggestion: SearchSuggestion) => void; onClear: () => void; onHome: () => void; onFilters: () => void; searchRequested: boolean }) {
  const [open, setOpen] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 639px)').matches ?? false)
  // Suggestions show while the field is focused and edited; choosing, submitting or Escape hides them.
  const [listOpen, setListOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const typed = useDeferredValue(value.trim())
  const suggestions = useQuery({ queryKey: ['search-suggestions', typed], queryFn: ({ signal }) => request<SearchSuggestion[]>(`/api/search/suggestions?q=${encodeURIComponent(typed)}&limit=8`, signal),
    enabled: !!onSuggestion && listOpen && typed.length > 0, staleTime: 30_000, placeholderData: keepPreviousData })
  const items = listOpen && typed ? suggestions.data ?? [] : []
  const expanded = items.length > 0
  useEffect(() => { if (searchRequested && mobile) { setOpen(true); requestAnimationFrame(() => input.current?.focus()) } }, [searchRequested, mobile])
  useEffect(() => {
    const query = window.matchMedia?.('(max-width: 639px)')
    if (!query) return
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => setActiveIndex(-1), [typed])
  function toggle() { setOpen(!open); if (!open) requestAnimationFrame(() => input.current?.focus()) }
  function choose(suggestion: SearchSuggestion) { setListOpen(false); setActiveIndex(-1); onSuggestion?.(suggestion) }
  return <header className="relative z-30 flex shrink-0 items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
    <a href="/" className={`shrink-0 text-xl font-semibold tracking-tight ${mobile && open ? 'hidden' : ''}`} aria-label="Luma home" onClick={event => { event.preventDefault(); onHome() }}>luma<span className="text-accent">.</span></a>
    <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
      <form role="search" className="search-reveal max-w-xl" data-open={open || !mobile} inert={mobile && !open} onSubmit={event => {
        event.preventDefault()
        if (expanded && activeIndex >= 0) { choose(items[activeIndex]); return }
        setListOpen(false); onSearch()
      }}>
        <div className="relative min-w-0">
          <div className="overflow-hidden">
            {/* A combobox: typing keeps focus in the field while Up/Down pick a suggestion. */}
            <Input ref={input} shape="pill" className="focus-visible:ring-inset" aria-label="Search media" placeholder="Search names, folders and tags" value={value} maxLength={200}
              role={onSuggestion ? 'combobox' : undefined} aria-autocomplete={onSuggestion ? 'list' : undefined} aria-expanded={onSuggestion ? expanded : undefined}
              aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
              onChange={event => { onChange(event.target.value); setListOpen(true) }} onFocus={() => setListOpen(true)} onBlur={() => setListOpen(false)}
              onKeyDown={event => {
                if (event.key === 'ArrowDown' && expanded) { event.preventDefault(); setActiveIndex(index => (index + 1) % items.length) }
                else if (event.key === 'ArrowUp' && expanded) { event.preventDefault(); setActiveIndex(index => index <= 0 ? items.length - 1 : index - 1) }
                else if (event.key === 'Escape' && expanded) { event.preventDefault(); setListOpen(false) }
                else if (event.key === 'Escape' && mobile) { setOpen(false); event.currentTarget.closest('form')?.parentElement?.querySelector<HTMLButtonElement>('button:not([type="submit"])')?.focus() }
              }} />
            <button type="submit" className="sr-only" tabIndex={-1}>Submit search</button>
          </div>
          {expanded && <ul id={listId} role="listbox" aria-label="Search suggestions" className="absolute inset-x-0 top-full mt-2 overflow-hidden rounded-xl border border-line bg-canvas py-1">
            {items.map((suggestion, index) => { const kind = kinds[suggestion.kind] ?? kinds.file; const Icon = kind.icon; return <li key={`${suggestion.kind}-${suggestion.id}`} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}
              className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm ${index === activeIndex ? 'bg-surface' : 'hover:bg-surface'}`}
              // Choosing on pointer down keeps focus in the field (a click would blur it first).
              onPointerDown={event => { event.preventDefault(); choose(suggestion) }} onMouseEnter={() => setActiveIndex(index)}>
              <Icon className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className={suggestion.kind === 'tag' ? 'tag-tone inline-block max-w-full truncate rounded-full border px-2 py-1' : 'block truncate'} style={suggestion.kind === 'tag' ? tagTone(suggestion.label) : undefined}>{suggestion.label}</span>{suggestion.detail && <span className="block truncate text-xs text-muted">{suggestion.detail}</span>}</span>
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">{kind.label}</span>
            </li> })}
          </ul>}
        </div>
      </form>
      {value && (!mobile || open) && <IconButton label="Clear search" onClick={() => { onClear(); input.current?.focus() }}><X className="size-5" /></IconButton>}
      {!(mobile && open && value) && <IconButton label={mobile ? open ? 'Close search' : 'Open search' : 'Search'} aria-expanded={mobile ? open : undefined} onClick={mobile ? toggle : onSearch}>{mobile && open ? <X className="size-5" /> : <Search className="size-5" />}</IconButton>}
      <IconButton label="Filters" onClick={onFilters}><SlidersHorizontal className="size-5" /></IconButton>
    </div>
  </header>
}
