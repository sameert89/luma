import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Heart,
  Info,
  Pause,
  Presentation,
  Settings2,
  Tag,
  HeartCrack,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { MediaInformation } from './MediaInformation'
import { MediaStage } from './MediaStage'
import { MediaActions, actionButton } from './MediaActions'
import { IconButton, QuietButton } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import { MetadataExchange } from '../tags/MetadataExchange'
import { TagEditor } from '../tags/TagEditor'
import { usePreviewPriority } from './usePreviewPriority'
import { usePreference } from './usePreference'
import { useIdle } from './useIdle'
import {
  errorMessage,
  imageUrl,
  isGif,
  queryString,
  request,
  type Filters,
  type Media,
  type Neighbors,
  type Library,
} from './api'

const slideSecondsKey = 'luma-slideshow-seconds'
const slideChoices = [3, 5, 10, 20]
function storedSlideSeconds() {
  try {
    const value = Number(localStorage.getItem(slideSecondsKey))
    return slideChoices.includes(value) ? value : 5
  } catch {
    return 5
  }
}
// Viewer only: Reels has its own auto-scroll.
const autoplayKey = 'luma-video-autoplay'
function storedAutoplay() {
  try {
    return localStorage.getItem(autoplayKey) === '1'
  } catch {
    return false
  }
}

export function Viewer({
  active,
  filters,
  startSlideshow = false,
  onChange,
  onClose,
  onWatchReels,
  restoreFocus,
}: {
  active: Media
  filters: Filters
  startSlideshow?: boolean
  onChange: (item: Media) => void
  onClose: () => void
  onWatchReels?: (item: Media) => void
  restoreFocus: () => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [slideshow, setSlideshow] = useState(startSlideshow)
  const [menuOpen, setMenuOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [slideSeconds, setSlideSeconds] = useState(storedSlideSeconds)
  const [autoplayNext, setAutoplayNext] = useState(storedAutoplay)
  // True when autoplay (not the person) moved to this item, so it starts playing by itself.
  const [continued, setContinued] = useState(false)
  // A running slideshow clears its chrome once the pointer rests, like a presentation.
  const chromeHidden = useIdle(slideshow && !detailsOpen)
  const chrome = `transition-opacity duration-200 ${chromeHidden ? 'pointer-events-none opacity-0' : ''}`
  const [open, setOpen] = useState(true)
  const [direction, setDirection] = useState<'next' | 'previous'>('next')
  const navigate = useCallback(
    (media: Media, direction: 'next' | 'previous') => {
      setDirection(direction)
      setContinued(false)
      onChange(media)
    },
    [onChange],
  )
  const client = useQueryClient()
  const detail = useQuery({
    queryKey: ['detail', active.id],
    queryFn: ({ signal }) => request<Media>(`/api/media/${active.id}`, signal),
    gcTime: 0,
    refetchInterval: query => (query.state.data?.preview.status === 'ready' ? false : 3000),
  })
  const item = detail.data ?? active
  const neighbors = useQuery({
    queryKey: ['neighbors', filters, active.id],
    queryFn: ({ signal }) => request<Neighbors>(`/api/media/${active.id}/neighbors?${queryString(filters)}`, signal),
    gcTime: 0,
  })
  const previous = neighbors.data?.previous
  const next = neighbors.data?.next
  usePreviewPriority([item, next, previous], true)
  const motion = item.mediaType === 'video' || isGif(item)
  useEffect(() => {
    try {
      localStorage.setItem(slideSecondsKey, String(slideSeconds))
    } catch {
      /* the choice still applies to this visit */
    }
  }, [slideSeconds])
  useEffect(() => {
    try {
      localStorage.setItem(autoplayKey, autoplayNext ? '1' : '0')
    } catch {
      /* the choice still applies to this visit */
    }
  }, [autoplayNext])
  function videoEnded() {
    if (slideshow) {
      if (next) navigate(next, 'next')
      else setSlideshow(false)
    } else if (autoplayNext && next?.mediaType === 'video') {
      navigate(next, 'next')
      setContinued(true)
    }
  }
  // Photos and GIFs advance on a timer; videos advance when they end (see onEnded).
  // The last item ends the slideshow rather than wrapping to a different place.
  useEffect(() => {
    if (!slideshow || detailsOpen || item.mediaType === 'video' || !neighbors.isSuccess) return
    const timer = window.setTimeout(() => {
      if (next) navigate(next, 'next')
      else setSlideshow(false)
    }, slideSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [slideshow, detailsOpen, item.id, item.mediaType, next, neighbors.isSuccess, slideSeconds, navigate])
  // Decode the next slide ahead of time so each advance is instant.
  const nextSlide = slideshow && next && next.mediaType !== 'video' ? imageUrl(next) : null
  useEffect(() => {
    if (!nextSlide) return
    const preload = new Image()
    preload.src = nextSlide
    return () => preload.removeAttribute('src')
  }, [nextSlide])
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: ({ signal }) => request<Library[]>('/api/libraries', signal),
  })
  const rootFolder = libraries.data?.find(library => library.id === item.libraryId)?.rootFolderId
  const coverFolder = filters.folderId ?? item.folderId
  const cover = useMutation({
    mutationFn: ({ folder, mediaId }: { folder: number; mediaId: number }) =>
      request(`/api/folders/${folder}/cover`, undefined, 'PUT', { mediaId }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['libraries'] }),
        client.invalidateQueries({ queryKey: ['folders'] }),
      ])
    },
  })
  const preference = usePreference()
  const prefer = (value: 'liked' | 'disliked' | 'neutral') => preference.mutate({ id: item.id, value })
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!open || detailsOpen) return
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest('input,select,textarea,video,[contenteditable="true"]') ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey)
      )
        return
      if (event.key === 'ArrowLeft' && previous) {
        event.preventDefault()
        navigate(previous, 'previous')
      }
      if (event.key === 'ArrowRight' && next) {
        event.preventDefault()
        navigate(next, 'next')
      }
      if (event.key.toLowerCase() === 'i') {
        event.preventDefault()
        setDetailsOpen(true)
      }
      if (event.key.toLowerCase() === 't') {
        event.preventDefault()
        setDetailsOpen(true)
        requestAnimationFrame(() =>
          document.querySelector<HTMLInputElement>('[role="dialog"] input[name="tag"]')?.focus(),
        )
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        setSlideshow(value => !value)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [previous, next, navigate, open, detailsOpen])
  return (
    <>
      <Modal
        open={open}
        onOpenChange={setOpen}
        onClosed={onClose}
        title={item.fileName}
        description="Media viewer. Use Left and Right arrows to navigate, I for details, and Escape to close."
        wide
        hideHeader
        restoreFocus={restoreFocus}
      >
        <section
          className="relative flex min-h-0 flex-1 items-center justify-center bg-black"
          aria-label="Media preview"
        >
          <div className="flex h-full w-full items-center justify-center overflow-hidden">
            <MediaStage
              item={item}
              direction={direction}
              autoPlay={slideshow || continued}
              autoplayNext={autoplayNext}
              onAutoplayNextChange={setAutoplayNext}
              optionsOpen={optionsOpen}
              onOptionsOpenChange={setOptionsOpen}
              onEnded={videoEnded}
              onNavigate={direction => {
                const target = direction === 'next' ? next : previous
                if (target) navigate(target, direction)
              }}
            />
          </div>
          <header
            className={`absolute inset-x-0 top-0 flex items-center justify-between p-3 sm:p-5 ${chrome}`}
            data-chrome
          >
            <div className="min-w-0 flex-1 space-y-2 pr-3">
              <div className="w-fit rounded-full bg-canvas/85 px-4 py-2 text-sm font-medium text-ink">
                <span className="block max-w-52 truncate sm:max-w-md">{item.fileName}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {slideshow && (
                <QuietButton
                  className="border-transparent bg-canvas/85 tabular-nums"
                  aria-label={`Slide duration, ${slideSeconds} seconds`}
                  onClick={() =>
                    setSlideSeconds(value => slideChoices[(slideChoices.indexOf(value) + 1) % slideChoices.length])
                  }
                >
                  {slideSeconds} s
                </QuietButton>
              )}
              <IconButton
                label="Slideshow"
                aria-pressed={slideshow}
                className="border-transparent bg-canvas/85"
                onClick={() => setSlideshow(value => !value)}
              >
                {slideshow ? <Pause className="size-5" /> : <Presentation className="size-5" />}
              </IconButton>
              <IconButton
                label="Close viewer"
                className="border-transparent bg-canvas/85"
                onClick={() => setOpen(false)}
              >
                <X className="size-5" />
              </IconButton>
            </div>
          </header>
          {/* Same row, same height for photos and videos, with a clear gap (visual and touch)
            above the video player bar, which is taller on upright phones. */}
          <MediaActions
            preference={item.preference}
            onPreference={prefer}
            faded={chromeHidden}
            menuOpen={menuOpen}
            onMenuOpenChange={setMenuOpen}
            menuLabel="Viewer menu"
            className="bottom-24 phone-portrait:bottom-32"
          >
            <IconButton label="View options" className={actionButton} onClick={() => setOptionsOpen(true)}>
              <Settings2 className="size-4" />
            </IconButton>
            <IconButton label="Media details" className={actionButton} onClick={() => setDetailsOpen(true)}>
              <Info className="size-4" />
            </IconButton>
            {motion && onWatchReels && (
              <IconButton label="Watch on Reels" className={actionButton} onClick={() => onWatchReels(item)}>
                <Clapperboard className="size-4" />
              </IconButton>
            )}
            <IconButton
              label="Previous item"
              className={actionButton}
              disabled={!previous}
              onClick={() => previous && navigate(previous, 'previous')}
            >
              <ChevronLeft className="size-4" />
            </IconButton>
            <IconButton
              label="Next item"
              className={actionButton}
              disabled={!next}
              onClick={() => next && navigate(next, 'next')}
            >
              <ChevronRight className="size-4" />
            </IconButton>
          </MediaActions>
          {neighbors.isError && (
            <p role="alert" className="absolute bottom-24 rounded-full bg-canvas px-4 py-2 text-sm text-danger">
              {errorMessage(neighbors.error)}
            </p>
          )}
        </section>
      </Modal>
      <Modal
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        title="Media details"
        description="Tags and file information."
        sheet
      >
        <div className="space-y-6 overflow-auto p-5">
          <div className="flex gap-2">
            <QuietButton
              aria-pressed={item.preference === 'liked'}
              onClick={() => prefer(item.preference === 'liked' ? 'neutral' : 'liked')}
            >
              <Heart className={`size-4 ${item.preference === 'liked' ? 'fill-accent text-accent' : ''}`} />
              Like
            </QuietButton>
            <QuietButton
              aria-pressed={item.preference === 'disliked'}
              onClick={() => prefer(item.preference === 'disliked' ? 'neutral' : 'disliked')}
            >
              <HeartCrack className={`size-4 ${item.preference === 'disliked' ? 'text-danger' : ''}`} />
              Dislike
            </QuietButton>
          </div>
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Tag className="size-4 text-accent" />
              Tags
            </h2>
            <TagEditor key={item.id} mediaIds={[item.id]} tags={item.tags} />
          </div>
          <section aria-label="Gallery covers" className="flex flex-wrap items-center gap-2">
            <QuietButton
              disabled={cover.isPending || item.availability === 'missing'}
              onClick={() => cover.mutate({ folder: coverFolder, mediaId: item.id })}
            >
              Use as folder cover
            </QuietButton>
            {rootFolder && (
              <QuietButton
                disabled={cover.isPending || item.availability === 'missing'}
                onClick={() => cover.mutate({ folder: rootFolder, mediaId: item.id })}
              >
                Use as library cover
              </QuietButton>
            )}
            {cover.isSuccess && (
              <p role="status" className="text-sm text-ink">
                Cover saved.
              </p>
            )}
            {cover.isError && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(cover.error)}
              </p>
            )}
          </section>
          <MetadataExchange key={item.id} mediaIds={[item.id]} />
          <MediaInformation item={item} />
          {preference.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(preference.error)}
            </p>
          )}
          {detail.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(detail.error)}
            </p>
          )}
        </div>
      </Modal>
    </>
  )
}
