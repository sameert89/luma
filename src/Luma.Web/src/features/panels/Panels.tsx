import { t } from '../../lib/i18n'
import { ComicFolderCard } from './ComicFolderCard'
import { ComicCard } from './ComicCard'
import { BackgroundJobsButton } from '../status/BackgroundJobs'
import { SearchHeader } from '../../components/ui/SearchHeader'
import type { components } from '../../lib/api/generated'
import { ComicLocations } from './ComicLocations'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { BookOpen, FolderPlus, FolderCog, ArrowUp, LoaderCircle } from 'lucide-react'
import { Checkbox, Input, Select, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { errorMessage, request, type Library } from '../browse/api'
import type { Comic, ComicList, ReadingStatistics } from './api'
import { ComicReader } from './ComicReader'
import { ComicDetails } from './ComicDetails'

type ComicSorting = { sort: 'title' | 'added' | 'modified'; order: 'asc' | 'desc' }
function savedSorting(): ComicSorting {
  try {
    const value = JSON.parse(localStorage.getItem('luma-panels-sort') ?? '{}')
    return {
      sort: ['title', 'added', 'modified'].includes(value?.sort) ? value.sort : 'title',
      order: value?.order === 'desc' ? 'desc' : 'asc',
    }
  } catch {
    return { sort: 'title', order: 'asc' }
  }
}

function initialParams() {
  const current = new URLSearchParams(window.location.search)
  if (['comic', 'state', 'q', 'series', 'favourite', 'libraryId', 'path', 'tag'].some(key => current.has(key)))
    return current
  try {
    return new URLSearchParams(localStorage.getItem('luma-panels-query') ?? '')
  } catch {
    return current
  }
}
export function Panels({
  logo,
  onSettings,
  showJobs = true,
}: {
  logo: ReactNode
  onSettings: () => void
  showJobs?: boolean
}) {
  const client = useQueryClient()
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal),
  })
  const favouritesId = useId()
  const [params, setParams] = useState(initialParams)
  const [sorting, setSorting] = useState(savedSorting)
  const [folderAfter, setFolderAfter] = useState<string>()
  const [cursor, setCursor] = useState<number>()
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [filtersOpen, setFiltersOpen] = useState(
    !!(params.get('state') || params.get('series') || params.get('favourite') || params.get('tag')),
  )
  useEffect(() => setSearch(params.get('q') ?? ''), [params])
  const sources = useQuery({
    queryKey: ['comic-sources'],
    queryFn: ({ signal }) => request<components['schemas']['PanelSourceConfiguration']>('/api/panels/sources', signal),
  })
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: ({ signal }) => request<components['schemas']['BackgroundTask'][]>('/api/tasks', signal),
    refetchInterval: 3000,
  })
  const discovery =
    tasks.data?.filter(task => task.kind === 'comics' && ['queued', 'running'].includes(task.state)) ?? []
  const discovering = discovery.length > 0
  const comicCheckpoint = JSON.stringify(tasks.data?.filter(task => task.kind === 'comics'))
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ['comics'] })
    void client.invalidateQueries({ queryKey: ['comic-folders'] })
    void client.invalidateQueries({ queryKey: ['comic-sources'] })
  }, [comicCheckpoint, client])
  const configured = sources.data?.configured === true && (sources.data.locations?.length ?? 0) > 0
  const [manage, setManage] = useState(false)
  const [details, setDetails] = useState<number | null>(null)
  const comicId = Number(params.get('comic'))
  const libraryId = Number(params.get('libraryId')) || undefined
  const path = params.get('path') ?? ''
  const searching = !!(
    params.get('q') ||
    params.get('series') ||
    params.get('state') ||
    params.get('favourite') ||
    params.get('tag')
  )
  const folders = useQuery({
    queryKey: ['comic-folders', libraryId, path, folderAfter, sorting.order],
    queryFn: ({ signal }) =>
      request<components['schemas']['ComicFolderPage']>(
        `/api/panels/folders?${new URLSearchParams({ libraryId: String(libraryId), path, ...(folderAfter ? { after: folderAfter } : {}), order: sorting.order })}`,
        signal,
      ),
    enabled: !!libraryId && !searching,
    refetchInterval: discovering ? 3000 : false,
  })
  useEffect(() => {
    try {
      localStorage.setItem('luma-panels-sort', JSON.stringify(sorting))
    } catch {
      /* Keep the choice for this session. */
    }
  }, [sorting])
  function changeSorting(next: ComicSorting) {
    setCursor(undefined)
    setFolderAfter(undefined)
    setSorting(next)
  }
  function visit(id?: number, nextPath = '') {
    const next = new URLSearchParams()
    if (id) {
      next.set('libraryId', String(id))
      next.set('path', nextPath)
    }
    setCursor(undefined)
    setFolderAfter(undefined)
    window.history.pushState(
      { ...window.history.state, section: 'panels' },
      '',
      `/panels${next.size ? `?${next}` : ''}`,
    )
    setParams(next)
  }
  const library = useQuery({
    queryKey: [
      'comics',
      sorting.sort,
      sorting.order,
      libraryId,
      path,
      params.get('tag'),
      params.get('q'),
      params.get('state'),
      params.get('series'),
      params.get('favourite'),
      cursor,
    ],
    queryFn: ({ signal }) =>
      request<ComicList>(
        `/api/panels/comics?${new URLSearchParams({ ...(params.get('q') ? { q: params.get('q')! } : {}), ...(params.get('state') ? { state: params.get('state')! } : {}), ...(params.get('series') ? { series: params.get('series')! } : {}), ...(params.get('favourite') === 'true' ? { favourite: 'true' } : {}), ...(libraryId ? { libraryId: String(libraryId) } : {}), ...(!searching && libraryId ? { path } : {}), ...(params.get('tag') ? { tag: params.get('tag')! } : {}), ...(cursor ? { cursor: String(cursor) } : {}), sort: sorting.sort, order: sorting.order })}`,
        signal,
      ),
    enabled: !comicId && configured && (!!libraryId || searching),
    refetchInterval: discovering ? 3000 : false,
  })
  const reading = useQuery({
    queryKey: ['comic', comicId],
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) => request<Comic>(`/api/panels/comics/${comicId}`, signal),
    enabled: Number.isSafeInteger(comicId) && comicId > 0,
  })
  const continuing = useQuery({
    queryKey: ['continue-reading'],
    queryFn: ({ signal }) => request<Comic[]>('/api/panels/continue-reading', signal),
    enabled: !comicId && configured,
  })
  const initialLoading =
    sources.isPending ||
    (comicId > 0
      ? reading.isFetching && !reading.isFetchedAfterMount
      : configured &&
        (!!libraryId || searching) &&
        ((library.data === undefined && library.isFetching) ||
          (!searching && folders.data === undefined && folders.isFetching)))
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
    for (const key of ['comics', 'comic', 'reading-statistics', 'continue-reading'])
      void client.invalidateQueries({ queryKey: [key] })
  }
  if (comicId && reading.data && reading.isFetchedAfterMount)
    return <ComicReader key={reading.data.id} comic={reading.data} onExit={exit} />
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SearchHeader
        logo={logo}
        value={search}
        onChange={setSearch}
        onSearch={() => change('q', search.trim())}
        onSuggestion={suggestion => change('comic', String(suggestion.id))}
        suggestionsUrl="/api/panels/suggestions"
        searchLabel={t('panels:panels.searchComics')}
        placeholder={t('panels:panels.searchComicTitlesOrSeries')}
        onHome={() => visit()}
        onFilters={() => setFiltersOpen(value => !value)}
        onSettings={onSettings}
        actions={showJobs ? <BackgroundJobsButton compact /> : undefined}
        searchRequested={false}
        scope={params.toString()}
      />
      <div className="flex flex-wrap items-center gap-3 p-4">
        <h1 className="flex-1 text-xl font-semibold">{t('panels:panels.comicLibrary')}</h1>
        {configured && (
          <>
            <Select
              aria-label={t('panels:panels.sortBy')}
              className="w-auto"
              value={sorting.sort}
              onChange={event => changeSorting({ ...sorting, sort: event.target.value as ComicSorting['sort'] })}
            >
              <option value="title">{t('panels:panels.title')}</option>
              <option value="added">{t('panels:panels.dateAdded')}</option>
              <option value="modified">{t('panels:panels.modifiedDate')}</option>
            </Select>
            <Select
              aria-label={t('panels:panels.sortDirection')}
              className="w-auto"
              value={sorting.order}
              onChange={event => changeSorting({ ...sorting, order: event.target.value as ComicSorting['order'] })}
            >
              <option value="asc">{t('panels:panels.ascending')}</option>
              <option value="desc">{t('panels:panels.descending')}</option>
            </Select>
          </>
        )}
        {configured && (
          <QuietButton onClick={() => setManage(true)}>
            <FolderCog className="size-4" aria-hidden="true" />
            {t('panels:panels.comicLocations')}
          </QuietButton>
        )}
      </div>
      {!configured && !sources.isPending && (
        <section aria-label={t('panels:panels.setUpComicLibrary')} className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">{t('panels:panels.chooseWhereYourComicsLive')}</h2>
          <QuietButton variant="accent" onClick={() => setManage(true)}>
            <FolderPlus className="size-4" aria-hidden="true" />
            {t('panels:panels.addComicLocation')}
          </QuietButton>
        </section>
      )}
      {filtersOpen && (
        <div className="flex flex-wrap gap-3 px-4 pb-3">
          <Select
            aria-label={t('panels:panels.readingStatus')}
            className="w-auto"
            value={params.get('state') ?? ''}
            onChange={event => change('state', event.target.value)}
          >
            <option value="">{t('panels:panels.allComics')}</option>
            <option value="reading">{t('panels:panels.continueReading')}</option>
            <option value="unread">{t('panels:panels.unread')}</option>
            <option value="completed">{t('panels:panels.completed')}</option>
          </Select>
          <Input
            aria-label={t('panels:panels.seriesFilter')}
            className="w-auto"
            placeholder={t('panels:panels.series')}
            value={params.get('series') ?? ''}
            onChange={event => change('series', event.target.value)}
          />
          <Input
            aria-label={t('panels:panels.comicTagFilter')}
            className="max-w-xs"
            placeholder={t('panels:panels.comicTag')}
            value={params.get('tag') ?? ''}
            onChange={event => change('tag', event.target.value)}
          />
          <label htmlFor={favouritesId} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={favouritesId}
              checked={params.get('favourite') === 'true'}
              onChange={event => change('favourite', event.target.checked ? 'true' : '')}
            />
            {t('panels:panels.favouritesOnly')}
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        {libraryId && (
          <QuietButton onClick={() => visit()}>
            <BookOpen className="size-4" aria-hidden="true" />
            {t('panels:panels.bookshelf')}
          </QuietButton>
        )}
        {libraryId && path && (
          <QuietButton onClick={() => visit(libraryId, path.split('/').slice(0, -1).join('/'))}>
            <ArrowUp className="size-4" aria-hidden="true" />
            {t('panels:panels.up')}
          </QuietButton>
        )}
        {libraryId && <span className="break-words text-sm text-muted">{path || t('panels:panels.libraryRoot')}</span>}
      </div>
      {stats.data && (
        <p className="px-4 pb-3 text-sm text-muted">
          {t('panels:panels.startedCompletedMinutesReading', {
            started: stats.data.started,
            completed: stats.data.completed,
            minutes: Math.floor(stats.data.readingSeconds / 60),
          })}
        </p>
      )}
      {comicId > 0 && reading.isError && <QuietButton onClick={exit}>{t('panels:panels.backToBookshelf')}</QuietButton>}
      {(library.error || reading.error || folders.error) && (
        <p role="alert" className="px-4 text-danger">
          {errorMessage(library.error || reading.error || folders.error)}
        </p>
      )}
      <div className={`min-h-0 flex-1 overflow-auto p-4 ${!configured && !sources.isPending ? 'hidden' : ''}`}>
        {initialLoading ? (
          <div role="status" className="grid h-full min-h-48 place-items-center text-muted">
            <span className="flex items-center gap-2">
              <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden="true" />
              {t('panels:panels.loadingComics')}
            </span>
          </div>
        ) : (
          <>
            {!libraryId && !searching && !!continuing.data?.length && (
              <section aria-label={t('panels:panels.continueReading')} className="mb-6">
                <h2 className="mb-3 text-lg font-semibold">{t('panels:panels.continueReading')}</h2>
                <div className="flex gap-3 overflow-x-auto pb-3">
                  {continuing.data.slice(0, 5).map(comic => (
                    <div key={comic.id} className="w-32 shrink-0 sm:w-40">
                      <ComicCard comic={comic} onOpen={() => change('comic', String(comic.id))} />
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section
              aria-label={t('panels:panels.comicFolders')}
              className="grid grid-cols-[repeat(auto-fill,minmax(9rem,24rem))] gap-3 pb-4"
            >
              {!libraryId &&
                !searching &&
                sources.data?.locations
                  ?.slice()
                  .sort((a, b) => {
                    const name = (location: typeof a) =>
                      location.relativePath ||
                      libraries.data?.find(item => item.id === location.libraryId)?.name ||
                      String(location.libraryId)
                    return (
                      name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: 'base' }) *
                      (sorting.order === 'desc' ? -1 : 1)
                    )
                  })
                  .map(location => (
                    <ComicFolderCard
                      key={`${location.libraryId}:${location.relativePath}`}
                      name={
                        location.relativePath ||
                        libraries.data?.find(item => item.id === location.libraryId)?.name ||
                        `Library ${location.libraryId}`
                      }
                      covers={location.coverUrls}
                      onOpen={() => visit(location.libraryId, location.relativePath)}
                    />
                  ))}
              {!searching &&
                folders.data?.items.map(folder => (
                  <ComicFolderCard
                    key={folder.relativePath}
                    name={folder.name}
                    covers={folder.coverUrls}
                    onOpen={() => visit(libraryId, folder.relativePath)}
                  />
                ))}
            </section>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {library.data?.items.map(comic => (
                <ComicCard
                  key={comic.id}
                  comic={comic}
                  onOpen={() => change('comic', String(comic.id))}
                  onDetails={() => setDetails(comic.id)}
                />
              ))}
            </div>
          </>
        )}
        {discovering && (
          <p role="status" className="py-4 text-center text-sm text-accent">
            {t('panels:panels.discoveringComicsProcessedFollowProgressInBackgroundJobs', {
              count: discovery.reduce((sum, task) => sum + task.processed, 0),
            })}
          </p>
        )}
        {library.data?.items.length === 0 &&
          !discovering &&
          !library.isFetching &&
          !folders.isFetching &&
          !folders.data?.items.length && (
            <p className="text-muted">{t('panels:panels.noComicsMatchAddArchivesOrExplicitlyClassifyAn')}</p>
          )}
        {folders.data?.nextCursor && (
          <QuietButton onClick={() => setFolderAfter(folders.data!.nextCursor!)}>
            {t('panels:panels.moreFolders')}
          </QuietButton>
        )}
        <div className="mt-4 flex gap-2">
          {cursor && <QuietButton onClick={() => setCursor(undefined)}>{t('panels:panels.firstPage')}</QuietButton>}
          {library.data?.nextCursor && (
            <QuietButton onClick={() => setCursor(library.data?.nextCursor ?? undefined)}>
              {t('panels:panels.moreComics')}
            </QuietButton>
          )}
        </div>
      </div>
      <Modal
        open={details !== null}
        onOpenChange={open => {
          if (!open) setDetails(null)
        }}
        title={t('panels:panels.comicDetails')}
        description={t('panels:panels.editLibraryMetadataFavouriteStatusAndCoverSelection')}
        sheet
      >
        {details !== null && <ComicDetails id={details} onSaved={() => setDetails(null)} />}
      </Modal>
      <Modal
        open={manage}
        onOpenChange={setManage}
        title={t('panels:panels.comicLocations')}
        description={t('panels:panels.saveRecursiveComicSourcesWithinYourLibrariesImageFolders')}
        sheet
      >
        {manage && (
          <ComicLocations
            onSaved={() => {
              setManage(false)
              visit()
            }}
          />
        )}
      </Modal>
    </div>
  )
}
