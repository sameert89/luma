import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ListVideo, Maximize, Minimize, Pause, PictureInPicture2, Play, Volume2, VolumeX } from 'lucide-react'
import { IconButton, QuietButton, Range, SeekRange } from '../../components/ui/Controls'

export function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

type Clock = { time: number; duration: number; loaded: number }
const clockEvents = [
  'timeupdate',
  'durationchange',
  'loadedmetadata',
  'progress',
  'seeking',
  'seeked',
  'emptied',
] as const
const stopEvents = ['pause', 'ended', 'waiting'] as const

/**
 * Playback position for the controls only. It follows animation frames while playing,
 * so the scrubber glides instead of stepping at timeupdate's ~4 Hz, and lives in the
 * small controls component so the stage itself never re-renders per frame.
 */
export function usePlaybackClock(video: RefObject<HTMLVideoElement | null>, mediaId: number): Clock {
  const [clock, setClock] = useState<Clock>({ time: 0, duration: 0, loaded: 0 })
  useEffect(() => {
    const player = video.current
    if (!player) return
    let frame = 0
    function read() {
      const duration = Number.isFinite(player!.duration) ? player!.duration : 0
      const time = player!.currentTime
      let loaded = 0
      const ranges = player!.buffered
      for (let index = 0; index < (ranges?.length ?? 0); index++)
        if (ranges.start(index) <= time + 0.5) loaded = Math.max(loaded, ranges.end(index))
      setClock(old =>
        old.time === time && old.duration === duration && old.loaded === loaded ? old : { time, duration, loaded },
      )
    }
    function tick() {
      read()
      frame = requestAnimationFrame(tick)
    }
    function start() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    }
    function stop() {
      cancelAnimationFrame(frame)
      read()
    }
    for (const name of clockEvents) player.addEventListener(name, read)
    for (const name of stopEvents) player.addEventListener(name, stop)
    player.addEventListener('playing', start)
    read()
    if (!player.paused) start()
    return () => {
      cancelAnimationFrame(frame)
      for (const name of clockEvents) player.removeEventListener(name, read)
      for (const name of stopEvents) player.removeEventListener(name, stop)
      player.removeEventListener('playing', start)
    }
  }, [video, mediaId])
  return clock
}

const scrubIntervalMs = 120

/**
 * Dragging shows the new position immediately but seeks at most every 120 ms (keyframe
 * `fastSeek` where supported), then lands precisely on release. Seeking on every input
 * event queues dozens of range requests and is what makes scrubbing feel sticky.
 */
function useScrub(video: RefObject<HTMLVideoElement | null>) {
  const [value, setValue] = useState<number | null>(null)
  const dragging = useRef(false)
  const latest = useRef<number | null>(null)
  const last = useRef(Number.NEGATIVE_INFINITY)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  function seek(position: number, precise: boolean) {
    const player = video.current
    if (!player) return
    last.current = performance.now()
    if (!precise && player.fastSeek) player.fastSeek(position)
    else player.currentTime = position
  }
  function change(position: number) {
    if (!dragging.current) {
      seek(position, true)
      return
    }
    latest.current = position
    setValue(position)
    window.clearTimeout(timer.current)
    const wait = scrubIntervalMs - (performance.now() - last.current)
    if (wait <= 0) seek(position, false)
    else timer.current = window.setTimeout(() => seek(latest.current ?? position, false), wait)
  }
  function begin() {
    dragging.current = true
  }
  function end() {
    if (!dragging.current) return
    dragging.current = false
    window.clearTimeout(timer.current)
    if (latest.current !== null) seek(latest.current, true)
    latest.current = null
    setValue(null)
  }
  return { value, change, begin, end }
}

function percent(value: number, duration: number) {
  return duration > 0 ? Math.min(100, Math.max(0, (value / duration) * 100)) : 0
}

function Scrubber({
  video,
  mediaId,
  label,
  className = '',
  interactive = true,
  onInteract,
  onFocus,
  onBlur,
  children,
}: {
  video: RefObject<HTMLVideoElement | null>
  mediaId: number
  label: string
  className?: string
  interactive?: boolean
  onInteract?: () => void
  onFocus?: () => void
  onBlur?: () => void
  children?: (clock: Clock, shown: number) => ReactNode
}) {
  const clock = usePlaybackClock(video, mediaId)
  const scrub = useScrub(video)
  const shown = scrub.value ?? clock.time
  return (
    <>
      <SeekRange
        aria-label={label}
        aria-valuetext={`${formatTime(shown)} of ${formatTime(clock.duration)}`}
        min={0}
        max={clock.duration}
        step={0.1}
        value={shown}
        played={percent(shown, clock.duration)}
        loaded={percent(clock.loaded, clock.duration)}
        disabled={clock.duration <= 0}
        className={className}
        onPointerDown={() => {
          if (interactive) scrub.begin()
        }}
        onPointerUp={scrub.end}
        onPointerCancel={scrub.end}
        onKeyUp={scrub.end}
        onFocus={onFocus}
        onBlur={() => {
          scrub.end()
          onBlur?.()
        }}
        onChange={event => {
          onInteract?.()
          if (interactive) scrub.change(Number(event.target.value))
        }}
      />
      {children?.(clock, shown)}
    </>
  )
}

export function ViewerVideoControls({
  video,
  mediaId,
  playing,
  muted,
  volume,
  rate,
  hidden,
  fullscreen,
  pictureInPicture,
  autoplay,
  onTogglePlay,
  onToggleMute,
  onVolume,
  onRate,
  onFullscreen,
  onPictureInPicture,
  onAutoplay,
}: {
  video: RefObject<HTMLVideoElement | null>
  mediaId: number
  playing: boolean
  muted: boolean
  volume: number
  rate: number
  hidden: boolean
  fullscreen: boolean
  pictureInPicture: boolean
  autoplay?: boolean
  onTogglePlay: () => void
  onToggleMute: () => void
  onVolume: (value: number) => void
  onRate: () => void
  onFullscreen: () => void
  onPictureInPicture: () => void
  onAutoplay?: () => void
}) {
  // Upright phones stack the scrubber on its own full-width row; every other layout keeps
  // the single row. Speed and picture in picture stay in View options there, so the second
  // row fits a phone's width and the bar keeps a predictable two-row height.
  return (
    <div
      data-chrome
      className={`absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-canvas/80 p-3 transition-opacity duration-200 phone-portrait:gap-x-1 phone-portrait:gap-y-0 phone-portrait:px-2 phone-portrait:pb-2 phone-portrait:pt-0 ${hidden ? 'pointer-events-none opacity-0' : ''}`}
    >
      <IconButton label={playing ? 'Pause' : 'Play'} className="border-transparent bg-canvas" onClick={onTogglePlay}>
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </IconButton>
      <Scrubber
        video={video}
        mediaId={mediaId}
        label="Seek"
        className="flex-1 phone-portrait:order-first phone-portrait:basis-full"
      >
        {(clock, shown) => (
          <span className="order-1 tabular-nums text-xs text-ink phone-portrait:order-none phone-portrait:mr-auto phone-portrait:pl-1">
            {formatTime(shown)} / {formatTime(clock.duration)}
          </span>
        )}
      </Scrubber>
      <IconButton
        label={muted ? 'Unmute' : 'Mute'}
        className="phone-portrait:border-transparent"
        onClick={onToggleMute}
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </IconButton>
      <Range
        aria-label="Volume"
        aria-valuetext={`${Math.round(volume * 100)} percent`}
        min={0}
        max={1}
        step={0.05}
        value={volume}
        className="w-20"
        onChange={event => onVolume(Number(event.target.value))}
      />
      <QuietButton className="order-1 min-h-10 px-3 phone-portrait:hidden" aria-label="Playback speed" onClick={onRate}>
        {rate}×
      </QuietButton>
      {/* Whether the next video starts when this one ends; lives in the bar so it is there in fullscreen too. */}
      {onAutoplay && (
        <IconButton
          label="Autoplay next video"
          title={autoplay ? 'Autoplay is on' : 'Autoplay is off'}
          aria-pressed={autoplay}
          className="order-1 border-transparent"
          onClick={onAutoplay}
        >
          <ListVideo className={`size-4 ${autoplay ? 'text-accent' : ''}`} />
        </IconButton>
      )}
      {pictureInPicture && (
        <IconButton
          label="Picture in picture"
          className="order-1 border-transparent phone-portrait:hidden"
          onClick={onPictureInPicture}
        >
          <PictureInPicture2 className="size-4" />
        </IconButton>
      )}
      <IconButton
        label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        className="order-1 border-transparent"
        onClick={onFullscreen}
      >
        {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
      </IconButton>
    </div>
  )
}

// Reels stay uncluttered: the seek control fades in when its strip is tapped or focused.
export function ReelsSeek({
  video,
  mediaId,
  visible,
  stripRef,
  onReveal,
}: {
  video: RefObject<HTMLVideoElement | null>
  mediaId: number
  visible: boolean
  stripRef: RefObject<HTMLDivElement | null>
  onReveal: () => void
}) {
  return (
    <div
      ref={stripRef}
      data-testid="reels-seek"
      data-visible={visible}
      className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 transition-opacity duration-200 ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      {/* A hidden strip's first change only reveals it, so a stray touch never jumps playback. */}
      <Scrubber
        video={video}
        mediaId={mediaId}
        label="Seek video"
        interactive={visible}
        className={`w-full ${visible ? '' : 'pointer-events-none'}`}
        onInteract={onReveal}
        onFocus={onReveal}
        onBlur={onReveal}
      />
    </div>
  )
}
