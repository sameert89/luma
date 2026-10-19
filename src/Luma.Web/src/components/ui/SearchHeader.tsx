import { BookOpen, FileImage, FolderOpen, Search, SlidersHorizontal, Settings, Tag, X } from 'lucide-react'
import { useDeferredValue, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { IconButton, Input } from './Controls'
import { tagTone } from './TagTone'
import { swallowNextClick } from './dismiss'
import { request } from '../../features/browse/api'
import type { components } from '../../lib/api/generated'

export type SearchSuggestion = components['schemas']['SearchSuggestion']

const kinds: Record<string, { label: string; icon: typeof Tag }> = {
  comic: { label: 'Comic', icon: BookOpen },
  tag: { label: 'Tag', icon: Tag },
  folder: { label: 'Folder', icon: FolderOpen },
  file: { label: 'File', icon: FileImage },
}

export function SearchHeader({
  value,
  onChange,
  onSearch,
  onSuggestion,
  onClear,
  onHome,
  onFilters,
  searchRequested,
  scope = '',
  logo,
  onSettings,
  hideSearch = false,
  suggestionsUrl = '/api/search/suggestions',
  searchLabel = 'Search media',
  placeholder = 'Search names, folders and tags',
  actions,
}: {
  value: string
  onChange: (value: string) => void
  onSearch: () => void
  onSuggestion?: (suggestion: SearchSuggestion) => void
  onClear: () => void
  onHome: () => void
  onFilters?: () => void
  searchRequested: boolean
  scope?: string
  logo?: ReactNode
  onSettings?: () => void
  hideSearch?: boolean
  suggestionsUrl?: string
  searchLabel?: string
  placeholder?: string
  actions?: ReactNode
}) {
  // Suggestions show while the field is focused and edited; choosing, submitting or Escape hides them.
  const [listOpen, setListOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const typed = useDeferredValue(value.trim())
  const suggestions = useQuery({
    queryKey: ['search-suggestions', suggestionsUrl, typed],
    queryFn: ({ signal }) =>
      request<SearchSuggestion[]>(
        `${suggestionsUrl}${suggestionsUrl.includes('?') ? '&' : '?'}q=${encodeURIComponent(typed)}&limit=8`,
        signal,
      ),
    enabled: !!onSuggestion && listOpen && typed.length > 0,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
  const items = listOpen && typed ? (suggestions.data ?? []) : []
  const expanded = items.length > 0
  useEffect(() => {
    if (searchRequested && !hideSearch) requestAnimationFrame(() => input.current?.focus())
  }, [searchRequested, hideSearch])
  useEffect(() => {
    setActiveIndex(-1)
  }, [typed])
  useEffect(() => {
    setListOpen(false)
  }, [scope])
  function choose(suggestion: SearchSuggestion) {
    setListOpen(false)
    setActiveIndex(-1)
    onSuggestion?.(suggestion)
  }
  return (
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-canvas px-4 py-3 sm:px-6">
      {logo ?? (
        <a
          href="/"
          className="shrink-0 text-xl font-semibold tracking-tight"
          aria-label="Luma home"
          onClick={event => {
            event.preventDefault()
            onHome()
          }}
        >
          luma<span className="text-accent">.</span>
        </a>
      )}
      {!hideSearch && (
        <form
          role="search"
          className="contents sm:ml-auto"
          onSubmit={event => {
            event.preventDefault()
            if (expanded && activeIndex >= 0) {
              choose(items[activeIndex])
              return
            }
            setListOpen(false)
            onSearch()
          }}
        >
          <div className="relative order-last w-full min-w-0 sm:order-none sm:ml-auto sm:w-auto sm:max-w-xl sm:flex-1">
            <div className="overflow-hidden">
              {/* A combobox: typing keeps focus in the field while Up/Down pick a suggestion. */}
              <Input
                ref={input}
                shape="pill"
                className="focus-visible:ring-inset"
                aria-label={searchLabel}
                placeholder={placeholder}
                value={value}
                maxLength={200}
                role={onSuggestion ? 'combobox' : undefined}
                aria-autocomplete={onSuggestion ? 'list' : undefined}
                aria-expanded={onSuggestion ? expanded : undefined}
                aria-controls={expanded ? listId : undefined}
                aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
                onChange={event => {
                  onChange(event.target.value)
                  setListOpen(true)
                }}
                onFocus={() => setListOpen(true)}
                onBlur={() => setListOpen(false)}
                onKeyDown={event => {
                  if (event.key === 'ArrowDown' && expanded) {
                    event.preventDefault()
                    setActiveIndex(index => (index + 1) % items.length)
                  } else if (event.key === 'ArrowUp' && expanded) {
                    event.preventDefault()
                    setActiveIndex(index => (index <= 0 ? items.length - 1 : index - 1))
                  } else if (event.key === 'Escape' && expanded) {
                    event.preventDefault()
                    setListOpen(false)
                  }
                }}
              />
              <button type="submit" className="sr-only" tabIndex={-1}>
                Submit search
              </button>
            </div>
            {expanded && (
              <ul
                id={listId}
                role="listbox"
                aria-label="Search suggestions"
                className="absolute inset-x-0 top-full mt-2 overflow-hidden rounded-xl border border-line bg-canvas py-1"
              >
                {items.map((suggestion, index) => {
                  const kind = kinds[suggestion.kind] ?? kinds.file
                  const Icon = kind.icon
                  return (
                    <li
                      key={`${suggestion.kind}-${suggestion.id}`}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm ${index === activeIndex ? 'bg-surface' : 'hover:bg-surface'}`}
                      // Choosing on pointer down keeps focus in the field (a click would blur it
                      // first). The list is gone by the time the click arrives, so that click has
                      // to be swallowed: it would otherwise land on whatever the list was
                      // covering, which is Clear all filters often enough to make a suggestion
                      // under it impossible to pick.
                      onPointerDown={event => {
                        event.preventDefault()
                        swallowNextClick()
                        choose(suggestion)
                      }}
                    >
                      <Icon className="size-4 shrink-0 text-accent" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span
                          className={
                            suggestion.kind === 'tag'
                              ? 'tag-tone inline-block max-w-full truncate rounded-full border px-2 py-1'
                              : 'block truncate'
                          }
                          style={suggestion.kind === 'tag' ? tagTone(suggestion.label) : undefined}
                        >
                          {suggestion.label}
                        </span>
                        {suggestion.detail && (
                          <span className="block truncate text-xs text-muted">{suggestion.detail}</span>
                        )}
                      </span>
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                        {kind.label}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {value && (
            <IconButton
              label="Clear search"
              onClick={() => {
                onClear()
                input.current?.focus()
              }}
            >
              <X className="size-5" />
            </IconButton>
          )}
          <IconButton label="Search" type="submit">
            <Search className="size-5" />
          </IconButton>
        </form>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {!hideSearch && onFilters && (
          <IconButton label="Filters" onClick={onFilters}>
            <SlidersHorizontal className="size-5" />
          </IconButton>
        )}
        {onSettings && (
          <IconButton label="Settings" onClick={onSettings}>
            <Settings className="size-5" />
          </IconButton>
        )}
        {actions}
      </div>
    </header>
  )
}
