import { SearchHeader } from '../../components/ui/SearchHeader'
import type { components } from '../../lib/api/generated'
import { ComicLocations } from './ComicLocations'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { BookOpen, Star } from 'lucide-react'
import { Checkbox, Input, Select, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request } from '../browse/api'
import type { Comic, ComicList, ReadingStatistics } from './api'
import { ComicReader } from './ComicReader'
import { ComicDetails } from './ComicDetails'

function initialParams() {
  const current = new URLSearchParams(window.location.search)
  if (['comic', 'state', 'q', 'series', 'favourite'].some(key => current.has(key))) return current
  try {
    return new URLSearchParams(localStorage.getItem('luma-panels-query') ?? '')
  } catch {
    return current
  }
}
export function Panels({ logo, onSettings }: { logo: ReactNode; onSettings: () => void }) {
  const favouritesId = useId()
  const [params, setParams] = useState(initialParams)
  const [cursor, setCursor] = useState<number>()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [filtersOpen, setFiltersOpen] = useState(
    !!(params.get('state') || params.get('series') || params.get('favourite')),
  )
  useEffect(() => setSearch(params.get('q') ?? ''), [params])
  const sources = useQuery({
    queryKey: ['comic-sources'],
    queryFn: ({ signal }) => request<components['schemas']['PanelSourceConfiguration']>('/api/panels/sources', signal),
  })
  const configured = sources.data?.configured === true && (sources.data.locations?.length ?? 0) > 0
  const [manage, setManage] = useState(false)
  const [details, setDetails] = useState<number | null>(null)
  const client = useQueryClient()
  const comicId = Number(params.get('comic'))
  const library = useQuery({
    queryKey: ['comics', params.get('q'), params.get('state'), params.get('series'), params.get('favourite'), cursor],
    queryFn: ({ signal }) =>
      request<ComicList>(
        `/api/panels/comics?${new URLSearchParams({ ...(params.get('q') ? { q: params.get('q')! } : {}), ...(params.get('state') ? { state: params.get('state')! } : {}), ...(params.get('series') ? { series: params.get('series')! } : {}), ...(params.get('favourite') === 'true' ? { favourite: 'true' } : {}), ...(cursor ? { cursor: String(cursor) } : {}) })}`,
        signal,
      ),
    enabled: !comicId && configured,
  })
  const reading = useQuery({
    queryKey: ['comic', comicId],
    queryFn: ({ signal }) => request<Comic>(`/api/panels/comics/${comicId}`, signal),
    enabled: Number.isSafeInteger(comicId) && comicId > 0,
  })
  const stats = useQuery({
    queryKey: ['reading-statistics'],
    queryFn: ({ signal }) => request<ReadingStatistics>('/api/panels/statistics', signal),
    enabled: !comicId && configured,
  })
  useEffect(() => {
    const query = params.toString()
    window.history.replaceState(
      { ...window.history.state, section: 'panels' },
      '',
      `/panels${query ? `?${query}` : ''}`,
    )
    try {
      localStorage.setItem('luma-panels-query', query)
    } catch {
      /* URL remains authoritative. */
    }
  }, [params])
  useEffect(() => {
    const back = () => {
      if (!window.history.state?.lumaModal && window.location.pathname.startsWith('/panels'))
        setParams(new URLSearchParams(window.location.search))
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  function change(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setCursor(undefined)
    window.history.pushState(
      { ...window.history.state, section: 'panels' },
      '',
      `/panels${next.size ? `?${next}` : ''}`,
    )
    setParams(next)
  }
  function exit() {
    change('comic', '')
    for (const key of ['comics', 'comic', 'reading-statistics']) void client.invalidateQueries({ queryKey: [key] })
  }
  if (comicId && reading.data) return <ComicReader key={reading.data.id} comic={reading.data} onExit={exit} />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SearchHeader
        logo={logo}
        value={search}
        onChange={setSearch}
        onSearch={() => change('q', search.trim())}
        onClear={() => {
          setSearch('')
          change('q', '')
        }}
        onSuggestion={suggestion => change('comic', String(suggestion.id))}
        suggestionsUrl="/api/panels/suggestions"
        searchLabel="Search comics"
        placeholder="Search comic titles"
        onHome={() => change('q', '')}
        onFilters={() => setFiltersOpen(value => !value)}
        onSettings={onSettings}
        searchRequested={false}
        scope={params.toString()}
      />
      <div className="flex flex-wrap items-center gap-3 p-4">
        <h1 className="flex-1 text-xl font-semibold">Comic library</h1>
        <QuietButton onClick={() => setManage(true)}>Comic locations</QuietButton>
      </div>
      {(!configured || manage) && !sources.isPending && !manage && (
        <section aria-label="Set up comic library" className="min-h-0 overflow-auto">
          <h2 className="px-5 text-lg font-semibold">Choose where your comics live</h2>
          <ComicLocations onSaved={() => void sources.refetch()} />
        </section>
      )}
      {filtersOpen && (
        <div className="flex flex-wrap gap-3 px-4 pb-3">
          <Select
            aria-label="Reading status"
            className="w-auto"
            value={params.get('state') ?? ''}
            onChange={event => change('state', event.target.value)}
          >
            <option value="">All comics</option>
            <option value="reading">Continue reading</option>
            <option value="unread">Unread</option>
            <option value="completed">Completed</option>
          </Select>
          <Input
            aria-label="Series filter"
            className="w-auto"
            placeholder="Series"
            value={params.get('series') ?? ''}
            onChange={event => change('series', event.target.value)}
          />
          <label htmlFor={favouritesId} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={favouritesId}
              checked={params.get('favourite') === 'true'}
              onChange={event => change('favourite', event.target.checked ? 'true' : '')}
            />
            Favourites only
          </label>
        </div>
      )}
      {stats.data && (
        <p className="px-4 pb-3 text-sm text-muted">
          {stats.data.started} started · {stats.data.completed} completed · {Math.floor(stats.data.readingSeconds / 60)}{' '}
          minutes reading
        </p>
      )}
      {comicId > 0 && reading.isError && <QuietButton onClick={exit}>Back to bookshelf</QuietButton>}
      {(library.error || reading.error) && (
        <p role="alert" className="px-4 text-danger">
          {errorMessage(library.error || reading.error)}
        </p>
      )}
      <div className={`min-h-0 flex-1 overflow-auto p-4 ${!configured ? 'hidden' : ''}`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {library.data?.items.map(comic => (
            <article key={comic.id} className="rounded-xl border border-line bg-surface p-3 text-left">
              <button
                type="button"
                className="w-full text-left"
                aria-label={`Read ${comic.title}`}
                onClick={() => change('comic', String(comic.id))}
              >
                <div className="aspect-book overflow-hidden rounded-lg bg-canvas">
                  {comic.coverUrl ? (
                    <img src={comic.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <BookOpen className="mx-auto my-8 size-12 text-muted" aria-hidden="true" />
                  )}
                </div>
                <h2 className="mt-2 truncate font-semibold">{comic.title}</h2>
                {comic.favourite && <Star className="size-4 text-accent" aria-label="Favourite" />}
                <p className="text-sm text-muted">
                  {comic.series || comic.format.toUpperCase()} · {comic.pageCount} pages
                </p>
                <p className="text-xs text-muted">
                  {comic.state} · page {comic.pageIndex + 1}
                </p>
              </button>
              <QuietButton
                className="mt-2"
                onClick={() => setDetails(comic.id)}
                aria-label={`Edit details for ${comic.title}`}
              >
                Details
              </QuietButton>
            </article>
          ))}
        </div>
        {library.data?.items.length === 0 && (
          <p className="text-muted">No comics match. Add archives or explicitly classify an image folder as a comic.</p>
        )}
        <div className="mt-4 flex gap-2">
          {cursor && <QuietButton onClick={() => setCursor(undefined)}>Newest comics</QuietButton>}
          {library.data?.nextCursor && (
            <QuietButton onClick={() => setCursor(library.data?.nextCursor ?? undefined)}>More comics</QuietButton>
          )}
        </div>
      </div>
      <Modal
        open={details !== null}
        onOpenChange={open => {
          if (!open) setDetails(null)
        }}
        title="Comic details"
        description="Edit library metadata, favourite status and cover selection."
        sheet
      >
        {details !== null && <ComicDetails id={details} onSaved={() => setDetails(null)} />}
      </Modal>
      <Modal
        open={manage}
        onOpenChange={setManage}
        title="Comic locations"
        description="Save recursive comic sources within your libraries. Image folders are included only with your explicit choice."
        sheet
      >
        {manage && <ComicLocations onSaved={() => setManage(false)} />}
      </Modal>
    </div>
  )
}
