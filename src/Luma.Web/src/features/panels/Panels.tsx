import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Settings } from 'lucide-react'
import { Input, Select, Field, IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request, type Library } from '../browse/api'
import type { Comic, ComicList, ReadingStatistics } from './api'
import { ComicReader } from './ComicReader'

function initialParams() {
  const current = new URLSearchParams(window.location.search)
  if (current.has('comic') || current.has('state') || current.has('q')) return current
  try {
    return new URLSearchParams(localStorage.getItem('luma-panels-query') ?? '')
  } catch {
    return current
  }
}
export function Panels({ logo, onSettings }: { logo: ReactNode; onSettings: () => void }) {
  const [params, setParams] = useState(initialParams)
  const [cursor, setCursor] = useState<number>()
  const [manage, setManage] = useState(false)
  const client = useQueryClient()
  const comicId = Number(params.get('comic'))
  const library = useQuery({
    queryKey: ['comics', params.get('q'), params.get('state'), params.get('series'), cursor],
    queryFn: ({ signal }) =>
      request<ComicList>(
        `/api/panels/comics?${new URLSearchParams({ ...(params.get('q') ? { q: params.get('q')! } : {}), ...(params.get('state') ? { state: params.get('state')! } : {}), ...(params.get('series') ? { series: params.get('series')! } : {}), ...(cursor ? { cursor: String(cursor) } : {}) })}`,
        signal,
      ),
    enabled: !comicId,
  })
  const reading = useQuery({
    queryKey: ['comic', comicId],
    queryFn: ({ signal }) => request<Comic>(`/api/panels/comics/${comicId}`, signal),
    enabled: Number.isSafeInteger(comicId) && comicId > 0,
  })
  const stats = useQuery({
    queryKey: ['reading-statistics'],
    queryFn: ({ signal }) => request<ReadingStatistics>('/api/panels/statistics', signal),
    enabled: !comicId,
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
      <header className="flex items-center gap-3 border-b border-line p-3">
        {logo}
        <div className="ml-auto">
          <IconButton label="Settings" onClick={onSettings}>
            <Settings className="size-5" />
          </IconButton>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <h1 className="flex-1 text-xl font-semibold">Comic library</h1>
        <QuietButton onClick={() => setManage(true)}>Add / discover comics</QuietButton>
      </div>
      <div className="flex flex-wrap gap-3 px-4 pb-3">
        <Input
          aria-label="Search comics"
          className="flex-1"
          placeholder="Search title or author"
          value={params.get('q') ?? ''}
          onChange={event => change('q', event.target.value)}
        />
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
      </div>
      {stats.data && (
        <p className="px-4 pb-3 text-sm text-muted">
          {stats.data.started} started · {stats.data.completed} completed · {Math.floor(stats.data.readingSeconds / 60)}{' '}
          minutes reading
        </p>
      )}
      {(library.error || reading.error) && (
        <p role="alert" className="px-4 text-danger">
          {errorMessage(library.error || reading.error)}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {library.data?.items.map(comic => (
            <button
              key={comic.id}
              type="button"
              className="rounded-xl border border-line bg-surface p-3 text-left"
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
              <p className="text-sm text-muted">
                {comic.series || comic.format.toUpperCase()} · {comic.pageCount} pages
              </p>
              <p className="text-xs text-muted">
                {comic.state} · page {comic.pageIndex + 1}
              </p>
            </button>
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
        open={manage}
        onOpenChange={setManage}
        title="Add comics"
        description="Discover archives or explicitly classify an image folder. Photos are never classified automatically."
        sheet
      >
        {manage && <ComicDiscovery />}
      </Modal>
    </div>
  )
}
function ComicDiscovery() {
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal),
  })
  const [library, setLibrary] = useState(''),
    [path, setPath] = useState(''),
    [mode, setMode] = useState('archives'),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false)
  const client = useQueryClient()
  async function start() {
    setBusy(true)
    setMessage('')
    try {
      await request('/api/panels/discover', undefined, 'POST', {
        libraryId: Number(library),
        ...(mode === 'folder' ? { relativePath: path } : {}),
      })
      setMessage('Discovery queued. Follow it in Background jobs.')
      void client.invalidateQueries({ queryKey: ['tasks'] })
    } catch (error) {
      setMessage(`${errorMessage(error)} Unlock file management in Settings to administer comic discovery.`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 p-5">
      <Field label="Library">
        <Select value={library} onChange={event => setLibrary(event.target.value)}>
          <option value="">Choose library</option>
          {libraries.data?.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Discovery">
        <Select value={mode} onChange={event => setMode(event.target.value)}>
          <option value="archives">Find CBZ/CBR/ZIP/RAR archives</option>
          <option value="folder">Classify one image folder</option>
        </Select>
      </Field>
      {mode === 'folder' && (
        <Field label="Folder path relative to library">
          <Input value={path} onChange={event => setPath(event.target.value)} />
        </Field>
      )}
      <QuietButton disabled={!library || busy} onClick={() => void start()}>
        {busy ? 'Queuing…' : 'Start discovery'}
      </QuietButton>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  )
}
