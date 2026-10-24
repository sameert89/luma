import { t } from '../../lib/i18n'
import { DeleteMediaAction } from '../files/DeleteMediaAction'
import { readSetting } from '../../app/uiDefaults'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Info,
  LoaderCircle,
  Clapperboard,
  Settings2,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Tag,
  Timer,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MediaStage } from './MediaStage'
import { MediaActions, actionButton } from './MediaActions'
import { MediaInformation } from './MediaInformation'
import { MetadataExchange } from '../tags/MetadataExchange'
import { TagEditor } from '../tags/TagEditor'
import { useFullscreen } from './useFullscreen'
import { usePreviewPriority } from './usePreviewPriority'
import { usePreference } from './usePreference'
import { ApiError } from '../../lib/api/client'
import {
  errorMessage,
  imageUrl,
  queryString,
  request,
  type Filters,
  type Media,
  type MediaPage,
  type Neighbors,
} from './api'

const autoScrollSeconds = 3
const reelsStateKey = 'luma-reels-state'

function savedReelsState(query: string) {
  try {
    const saved = JSON.parse(readSetting(reelsStateKey) ?? '{}')
    return {
      muted: typeof saved?.muted === 'boolean' ? saved.muted : true,
      autoScroll: saved?.autoScroll === true,
      mediaId:
        saved?.query === query && Number.isSafeInteger(saved?.mediaId) && saved.mediaId > 0
          ? (saved.mediaId as number)
          : null,
    }
  } catch {
    return { muted: true, autoScroll: false, mediaId: null }
  }
}

export function Reels({
  filters,
  startId,
  viewerOpen = false,
  onFilters,
  onOpenViewer,
  onItemChange,
  filtersVisible = true,
  onToggleFilters,
}: {
  filters: Filters
  filtersVisible?: boolean
  onToggleFilters?: () => void
  startId?: number | null
  viewerOpen?: boolean
  onFilters: () => void
  onItemChange?: (id: number | null) => void
  onOpenViewer: (item: Media) => void
}) {
  const isFullscreen = useFullscreen()
  const root = useRef<HTMLElement>(null)
  const queryFilters: Filters = filters
  const positionQuery = new URLSearchParams(queryString(queryFilters))
  positionQuery.sort()
  const positionKey = positionQuery.toString()
  const [saved] = useState(() => savedReelsState(positionKey))
  const [restoredId, setRestoredId] = useState<number | null>(startId ?? saved.mediaId)
  const [active, setActive] = useState<Media | null>(null)
  const [pending, setPending] = useState<Media | null>(null)
  const pendingRef = useRef<Media | null>(null)
  const [outgoing, setOutgoing] = useState<Media | null>(null)
  const [startedId, setStartedId] = useState<number | null>(null)
  const [playbackSettings, setPlaybackSettings] = useState({ volume: 1, rate: 1 })
  const [direction, setDirection] = useState<'next' | 'previous'>('next')
  const [muted, setMuted] = useState(saved.muted)
  const [autoScroll, setAutoScroll] = useState(saved.autoScroll)
  const [tags, setTags] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const removed = useRef(new Map<number, { previous: Media | null; next: Media | null }>())
  const suspended = viewerOpen || tags || optionsOpen || infoOpen || deleteOpen
  const first = useQuery({
    queryKey: ['reels-first', queryFilters],
    queryFn: ({ signal }) => request<MediaPage>(`/api/media?${queryString({ ...queryFilters, limit: 1 })}`, signal),
    enabled: !restoredId && !exhausted,
    gcTime: 0,
  })
  const base = active ?? first.data?.items[0]
  const baseId = active?.id ?? restoredId ?? base?.id
  const detail = useQuery({
    queryKey: ['detail', baseId],
    queryFn: ({ signal }) => request<Media>(`/api/media/${baseId}`, signal),
    enabled: !!baseId && !exhausted,
    gcTime: 0,
    refetchInterval: query => (query.state.data?.preview.status === 'ready' ? false : 3000),
  })
  const availableItem = detail.data ?? (base?.id === baseId ? base : undefined)
  const item = exhausted ? undefined : availableItem
  useEffect(() => {
    if (item || exhausted) onItemChange?.(item?.id ?? null)
  }, [item?.id, exhausted, onItemChange])
  useEffect(() => {
    if (
      restoredId &&
      !active &&
      (detail.data?.availability === 'missing' || (detail.error instanceof ApiError && detail.error.status === 404))
    )
      setRestoredId(null)
  }, [restoredId, active, detail.data?.availability, detail.error])
  useEffect(() => {
    try {
      localStorage.setItem(
        reelsStateKey,
        JSON.stringify({ muted, autoScroll, query: positionKey, mediaId: item?.id ?? restoredId }),
      )
    } catch {
      /* Storage may be unavailable; current controls still work. */
    }
  }, [muted, autoScroll, positionKey, item?.id, restoredId])
  const neighbors = useQuery({
    queryKey: ['reels-neighbors', queryFilters, item?.id],
    queryFn: ({ signal }) =>
      request<Neighbors>(`/api/media/${item!.id}/neighbors?${queryString(queryFilters)}`, signal),
    enabled: !!item,
    gcTime: 0,
  })
  function remaining(candidate: Media | null | undefined, side: 'previous' | 'next') {
    const seen = new Set<number>()
    while (candidate && removed.current.has(candidate.id)) {
      if (seen.has(candidate.id)) return null
      seen.add(candidate.id)
      candidate = removed.current.get(candidate.id)?.[side]
    }
    return candidate ?? null
  }
  const previous = remaining(neighbors.data?.previous, 'previous')
  const next = remaining(neighbors.data?.next, 'next')
  const preference = usePreference()
  usePreviewPriority([item, next, previous], true)
  useEffect(() => {
    if (!outgoing) return
    const timer = window.setTimeout(() => setOutgoing(null), 200)
    return () => window.clearTimeout(timer)
  }, [outgoing?.id])
  useEffect(() => {
    if (suspended) {
      pendingRef.current = null
      setPending(null)
    }
  }, [suspended])
  // Video entry uses its own first frame, never a generated still from another timestamp.
  const nextStill = next && next.mediaType !== 'video' ? imageUrl(next) : null
  useEffect(() => {
    if (!nextStill) return
    const preload = new Image()
    preload.src = nextStill
    return () => preload.removeAttribute('src')
  }, [nextStill])
  function show(target: Media, nextDirection: 'next' | 'previous') {
    if (pendingRef.current || target.id === item?.id) return
    setDirection(nextDirection)
    if (target.mediaType !== 'video') {
      setOutgoing(null)
      setActive(target)
    } else {
      pendingRef.current = target
      setPending(target)
    }
  }
  function navigate(direction: 'next' | 'previous') {
    if (suspended) return
    const target = direction === 'next' ? next : previous
    if (target) show(target, direction)
  }
  function beganPlaying(target: Media, started = true) {
    if (started && target.id === item?.id) setStartedId(target.id)
    if (pendingRef.current?.id !== target.id) return
    pendingRef.current = null
    setOutgoing(item ?? null)
    setStartedId(started ? target.id : null)
    setActive(target)
    setPending(null)
  }
  // Videos advance through MediaStage's onEnded; a photo has no such event, so it gets its
  // own timer here. Depending on the item's id/type rather than the query objects keeps an
  // unrelated refetch (a new object with the same id) from silently restarting the count.
  useEffect(() => {
    if (suspended || !autoScroll || !item || item.mediaType === 'video' || !next) return
    const timer = window.setTimeout(() => {
      show(next, 'next')
    }, autoScrollSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [suspended, autoScroll, item?.id, item?.mediaType, next])
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        suspended ||
        document.querySelector('[role="dialog"]') ||
        (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,video,button'))
      )
        return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const move = event.key === 'ArrowDown' ? 'next' : 'previous'
        const target = move === 'next' ? next : previous
        if (target) {
          show(target, move)
        }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [next, previous, suspended])
  if (!exhausted && first.isError)
    return (
      <p role="alert" className="p-5 text-danger">
        {errorMessage(first.error)}
      </p>
    )
  if (!exhausted && !item && detail.isError && !(detail.error instanceof ApiError && detail.error.status === 404))
    return (
      <p role="alert" className="p-5 text-danger">
        {errorMessage(detail.error)}
      </p>
    )
  if (!item) {
    const loading = !exhausted && (first.isPending || (detail.isPending && !!baseId))
    return (
      <section
        aria-labelledby="reels-state-title"
        className="flex min-h-0 flex-1 items-center justify-center bg-canvas px-6 text-center text-ink"
      >
        <div role={loading ? 'status' : undefined} className="flex max-w-sm flex-col items-center gap-4">
          {loading ? (
            <LoaderCircle className="size-10 text-white/60 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <span className="flex size-16 items-center justify-center rounded-full border border-white/15 bg-white/10">
              <Clapperboard className="size-7 text-white/70" aria-hidden="true" />
            </span>
          )}
          <h1 id="reels-state-title" className="text-xl font-semibold">
            {loading ? t('browse:reels.loadingReels') : t('browse:reels.noReelsToShow')}
          </h1>
          {!loading && (
            <>
              <p className="text-sm leading-relaxed text-white/60">
                {t('browse:reels.noPhotosOrVideosMatchThisViewAdjustThe')}
              </p>
              <QuietButton className="border-white/20 text-white hover:bg-white/10" onClick={onFilters}>
                <SlidersHorizontal className="size-4" />
                {t('browse:reels.adjustFilters')}
              </QuietButton>
            </>
          )}
        </div>
      </section>
    )
  }
  // Two keyed players: the visible clip plus one prepared/entering clip.
  // Promotion keeps the actual video element and its decoded frames intact.
  const prepared = !suspended && startedId === item.id && next?.mediaType === 'video' ? next : null
  const other = pending ?? outgoing ?? prepared
  const stages = other && other.id !== item.id ? (outgoing && !pending ? [other, item] : [item, other]) : [item]
  const liked = item.preference === 'liked'
  return (
    <section
      ref={root}
      aria-label={t('browse:reels.flick')}
      className="relative flex min-h-0 flex-1 flex-col bg-canvas"
    >
      {/* Reels loop until the person moves on; auto-scroll advances at the end instead. */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {stages.map(clip => {
          const current = clip.id === item.id
          const entering = clip.id === pending?.id
          const retained = clip.id === outgoing?.id && !pending
          return (
            <div
              key={clip.id}
              data-reel-state={current ? 'current' : entering ? 'entering' : retained ? 'outgoing' : 'prepared'}
              aria-hidden={!current}
              inert={!current}
              className={`absolute inset-0 flex ${current || retained ? '' : 'invisible pointer-events-none'}`}
            >
              <MediaStage
                item={clip}
                direction={direction}
                reels
                preparing={!current && !entering}
                presented={current}
                playbackSettings={playbackSettings}
                onPlaybackSettingsChange={setPlaybackSettings}
                onPlaybackStarted={() => beganPlaying(clip)}
                onPlaybackFailed={() => beganPlaying(clip, false)}
                optionsOpen={current && optionsOpen}
                onOptionsOpenChange={setOptionsOpen}
                muted={!current && !entering ? true : muted}
                onMutedChange={current ? setMuted : undefined}
                suspended={suspended || (current && !!pending) || (!current && !entering)}
                loop={!(autoScroll && next)}
                fullscreenRoot={root}
                onOpenViewer={onOpenViewer}
                onNavigate={navigate}
                onLike={() => {
                  if (current && !liked) preference.mutate({ id: item.id, value: 'liked' })
                }}
                onDislike={() => {
                  if (current && item.preference !== 'disliked') preference.mutate({ id: item.id, value: 'disliked' })
                }}
                onEnded={() => {
                  if (current && !suspended && autoScroll && next) show(next, 'next')
                }}
              />
            </div>
          )
        })}
      </div>
      {/* The shared action row sits just above the seek strip; see MediaActions. */}
      <div hidden={isFullscreen}>
        <MediaActions
          preference={item.preference}
          onPreference={value => preference.mutate({ id: item.id, value })}
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          menuLabel={t('browse:reels.menu')}
          className="bottom-16"
        >
          {onToggleFilters && (
            <IconButton
              label={filtersVisible ? t('browse:reels.hideFilters') : t('browse:reels.showFilters')}
              className={actionButton}
              onClick={onToggleFilters}
            >
              {filtersVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
          )}
          <IconButton
            label={muted ? t('browse:reels.unmute') : t('browse:reels.mute')}
            className={actionButton}
            aria-pressed={muted}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </IconButton>
          <IconButton
            label={t('browse:reels.autoScroll')}
            className={actionButton}
            aria-pressed={autoScroll}
            onClick={() => setAutoScroll(value => !value)}
          >
            <Timer className={`size-4 ${autoScroll ? 'text-accent' : ''}`} />
          </IconButton>
          <IconButton
            label={t('browse:reels.tags')}
            className={actionButton}
            aria-pressed={tags}
            onClick={() => setTags(!tags)}
          >
            <Tag className="size-4" />
          </IconButton>
          <IconButton
            label={t('browse:reels.viewOptions')}
            className={actionButton}
            onClick={() => setOptionsOpen(true)}
          >
            <Settings2 className="size-4" />
          </IconButton>
          <DeleteMediaAction
            item={item}
            className={actionButton}
            disabled={neighbors.isPending}
            onOpenChange={setDeleteOpen}
            onQueued={() => {
              setOutgoing(null)
              removed.current.set(item.id, { previous, next })
              const target = next ?? previous
              if (target) {
                setDirection(next ? 'next' : 'previous')
                setActive(target)
              } else {
                setActive(null)
                setRestoredId(null)
                setExhausted(true)
              }
            }}
          />
          <IconButton
            label={t('browse:reels.mediaInformation')}
            className={actionButton}
            onClick={() => setInfoOpen(true)}
          >
            <Info className="size-4" />
          </IconButton>
          <IconButton
            label={t('browse:reels.previous')}
            className={actionButton}
            disabled={!previous}
            onClick={() => navigate('previous')}
          >
            <ChevronUp className="size-4" />
          </IconButton>
          <IconButton
            label={t('browse:reels.next')}
            className={actionButton}
            disabled={!next}
            onClick={() => navigate('next')}
          >
            <ChevronDown className="size-4" />
          </IconButton>
        </MediaActions>
      </div>
      <Modal
        open={tags}
        onOpenChange={setTags}
        title={t('browse:reels.tags')}
        description={t('browse:reels.addOrRemoveTagsForThisItem')}
        sheet
      >
        <div className="overflow-auto p-5">
          <TagEditor key={item.id} mediaIds={[item.id]} tags={item.tags} />
        </div>
      </Modal>
      <Modal
        open={infoOpen}
        onOpenChange={setInfoOpen}
        title={t('browse:reels.mediaInformation')}
        description={t('browse:reels.fileInformationForThisReel')}
        sheet
      >
        <div className="overflow-auto p-5">
          <MediaInformation item={item} />
          <div className="mt-6">
            <MetadataExchange mediaIds={[item.id]} />
          </div>
        </div>
      </Modal>
      {preference.isError && (
        <p role="alert" className="absolute bottom-28 z-10 rounded-full bg-canvas px-4 py-2 text-sm text-danger">
          {errorMessage(preference.error)}
        </p>
      )}
      {neighbors.isError && (
        <p role="alert" className="absolute bottom-20 z-10 rounded-full bg-canvas px-4 py-2 text-sm text-danger">
          {errorMessage(neighbors.error)}
        </p>
      )}
    </section>
  )
}
