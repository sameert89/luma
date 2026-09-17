import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Download, EllipsisVertical, Heart, Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { IconButton, QuietButton, QuietLink, Range, Select } from '../../components/ui/Controls'
import { CachedImage } from '../../components/ui/CachedImage'
import { Modal } from '../../components/ui/Modal'
import { useFullscreen } from './useFullscreen'
import type { Media } from './api'

const fillKeys = { viewer: 'luma-viewer-fill', reels: 'luma-reels-fill' }

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

// Reels gestures: the strip that holds the seek control, and how long a second tap may take.
const seekStripHeight = 140
const doubleTapMs = 280

export function MediaStage({ item, reels = false, muted = false, suspended = false, direction = 'next', optionsOpen: controlledOptionsOpen, onOptionsOpenChange, onEnded, onNavigate, fullscreenRoot, onOpenViewer, onLike }: {
  item: Media; reels?: boolean; muted?: boolean; suspended?: boolean; direction?: 'next' | 'previous'; optionsOpen?: boolean; onOptionsOpenChange?: (open: boolean) => void; onEnded?: () => void; onNavigate: (direction: 'next' | 'previous') => void; fullscreenRoot?: RefObject<HTMLElement | null>; onOpenViewer?: (item: Media) => void; onLike?: () => void
}) {
  const isFullscreen = useFullscreen()
  const host = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const seekStrip = useRef<HTMLDivElement>(null)
  const resumePlayback = useRef(false)
  const playbackSuspended = useRef(suspended)
  playbackSuspended.current = suspended
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const touchStart = useRef({ x: 0, y: 0, multiple: false })
  const lastWheel = useRef(0)
  const gesture = useRef({ x: 0, y: 0, distance: 0 })
  const seekTimer = useRef(0)
  const tapTimer = useRef(0)
  const lastTap = useRef(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fill, setFill] = useState(() => {
    const stored = localStorage.getItem(reels ? fillKeys.reels : fillKeys.viewer)
    return stored === null ? reels : stored === '1'
  })
  const [originalId, setOriginalId] = useState<number | null>(null)
  const original = originalId === item.id
  const [failure, setFailure] = useState('')
  const [localOptionsOpen, setLocalOptionsOpen] = useState(false)
  const optionsOpen = controlledOptionsOpen ?? localOptionsOpen
  const setOptionsOpen = onOptionsOpenChange ?? setLocalOptionsOpen
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [viewerMuted, setViewerMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [seekVisible, setSeekVisible] = useState(false)
  const [burst, setBurst] = useState(0)
  const originalUrl = `/api/media/${item.id}/original`
  useLayoutEffect(() => {
    setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }); setOriginalId(null); setFailure('')
    setPlaying(false); setTime(0); setDuration(0); setSeekVisible(false); setBurst(0)
    pointers.current.clear(); lastTap.current = 0; lastWheel.current = 0
    window.clearTimeout(seekTimer.current); window.clearTimeout(tapTimer.current)
  }, [item.id])
  const displayFill = fill
  function scale(value: number) { setZoom(Math.max(0.1, Math.min(8, value))); if (value <= 1) setPan({ x: 0, y: 0 }) }
  function toggleFill() {
    setFill(value => {
      const next = !value
      localStorage.setItem(reels ? fillKeys.reels : fillKeys.viewer, next ? '1' : '0')
      return next
    })
    scale(1)
  }
  function actualSize() { setOriginalId(item.id); setFill(false); setPan({ x: 0, y: 0 }); const bounds = host.current?.getBoundingClientRect(); if (bounds && item.width && item.height) setZoom(Math.max(item.width / bounds.width, item.height / bounds.height)) }
  async function fullscreen() {
    const target = fullscreenRoot?.current ?? host.current
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (target?.requestFullscreen) await target.requestFullscreen()
      else setFailure('Fullscreen is unavailable in this browser.')
    } catch { setFailure('Fullscreen is unavailable in this browser.') }
  }
  function togglePlay() {
    const player = video.current
    if (!player) return
    if (player.paused) void player.play().catch(() => setFailure(current => current || 'Autoplay was blocked. Press Play to start.'))
    else player.pause()
  }
  function seek(value: number) {
    if (!video.current || !Number.isFinite(duration) || duration <= 0) return
    video.current.currentTime = value
    setTime(value)
  }
  function revealSeek() {
    setSeekVisible(true)
    window.clearTimeout(seekTimer.current)
    seekTimer.current = window.setTimeout(() => {
      if (!seekStrip.current?.contains(document.activeElement)) setSeekVisible(false)
    }, 3000)
  }
  function tap(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    // A tap on the strip holding the seek control reveals it rather than pausing.
    if (item.mediaType === 'video' && event.clientY - bounds.top > bounds.height - seekStripHeight) { revealSeek(); return }
    if (Date.now() - lastTap.current < doubleTapMs) {
      window.clearTimeout(tapTimer.current)
      lastTap.current = 0
      setBurst(value => value + 1)
      onLike?.()
      return
    }
    lastTap.current = Date.now()
    // Hold the single-tap action until a second tap can no longer arrive, so liking
    // never pauses playback on its way through.
    if (item.mediaType === 'video') tapTimer.current = window.setTimeout(togglePlay, doubleTapMs)
  }
  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    const dx = event.clientX - gesture.current.x
    const dy = event.clientY - gesture.current.y
    const along = reels ? dy : dx
    const across = reels ? dx : dy
    if (zoom === 1 && !gesture.current.distance && Math.abs(along) > 60 && Math.abs(along) > Math.abs(across)) onNavigate(along < 0 ? 'next' : 'previous')
    else if (reels && !gesture.current.distance && Math.hypot(dx, dy) < 10) tap(event)
  }
  useEffect(() => () => { window.clearTimeout(seekTimer.current); window.clearTimeout(tapTimer.current) }, [])
  useEffect(() => {
    const player = video.current
    let disposed = false
    if (player) { player.volume = volume; player.playbackRate = rate }
    if (player && !player.getAttribute('src')) player.src = originalUrl
    if (reels && player && !playbackSuspended.current) void player.play().then(() => { if (playbackSuspended.current) player.pause() }).catch(error => { if (!disposed) setFailure(current => current || (player.error || (error instanceof DOMException && error.name === 'NotSupportedError') ? 'This video could not play. Copy its stream URL and open it in an external player such as VLC.' : 'Autoplay was blocked. Press Play to start.')) })
    return () => { disposed = true; if (player) { player.pause(); player.removeAttribute('src'); player.load() } }
  }, [reels, originalUrl])
  useEffect(() => {
    const player = video.current
    if (!player) return
    if (suspended) { resumePlayback.current ||= !player.paused; player.pause() }
    else if (resumePlayback.current) {
      resumePlayback.current = false
      void player.play().catch(() => setFailure('Press Play to resume playback.'))
    }
  }, [suspended, item.id])
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const dialog = host.current?.closest('[role="dialog"]'); const dialogs = document.querySelectorAll('[role="dialog"]'); if (dialogs.length && dialogs[dialogs.length - 1] !== dialog) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,video,button,a,[contenteditable="true"]')) return
      if (event.key === '+' || event.key === '=') { event.preventDefault(); scale(zoom * 1.25) }
      if (event.key === '-') { event.preventDefault(); scale(zoom / 1.25) }
      if (event.key === '1') actualSize()
      if (event.key.toLowerCase() === 'r') setRotation(value => (value + 90) % 360)
      if (event.key.toLowerCase() === 'f') void fullscreen()
      if (event.key === ' ' && item.mediaType === 'video') { event.preventDefault(); togglePlay() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  return <div className="relative flex h-full min-h-0 w-full flex-col">
    <div ref={host} className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden bg-black"
      onWheel={event => { if (reels && Math.abs(event.deltaY) > 40 && Date.now() - lastWheel.current > 500) { lastWheel.current = Date.now(); onNavigate(event.deltaY > 0 ? 'next' : 'previous') } else if (!reels && item.mediaType === 'image') scale(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)) }}
      onTouchStart={event => { if (item.mediaType !== 'video') return; const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY, multiple: event.touches.length > 1 } }}
      onTouchEnd={event => { if (item.mediaType !== 'video' || touchStart.current.multiple) return; const touch = event.changedTouches[0]; const dx = touch.clientX - touchStart.current.x; const dy = touch.clientY - touchStart.current.y; if (Math.abs(reels ? dy : dx) > 60 && Math.abs(reels ? dy : dx) > Math.abs(reels ? dx : dy)) onNavigate((reels ? dy : dx) < 0 ? 'next' : 'previous') }}
      onPointerDown={event => { if ((event.target as HTMLElement).closest('button,a,input,select,video')) return; event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); gesture.current = { x: event.clientX, y: event.clientY, distance: 0 } }}
      onPointerMove={event => { const old = pointers.current.get(event.pointerId); if (!old) return; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); const points = [...pointers.current.values()]; if (points.length === 2) { const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y); if (gesture.current.distance) scale(zoom * distance / gesture.current.distance); gesture.current.distance = distance } else if (zoom > 1) setPan(value => ({ x: value.x + event.clientX - old.x, y: value.y + event.clientY - old.y })) }}
      onPointerUp={pointerUp}
      onPointerCancel={() => pointers.current.clear()}>
      {/* Personal source videos have no generated caption tracks; preserve native playback capabilities. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      {item.mediaType === 'video' ? <video key={item.id} data-axis={reels ? 'vertical' : 'horizontal'} data-direction={direction} aria-label={item.fileName} ref={video} src={originalUrl} poster={item.preview.status === 'ready' ? item.preview.url : undefined} playsInline muted={reels ? muted : viewerMuted || volume === 0} controls={false} disablePictureInPicture preload="metadata" onEnded={() => { setPlaying(false); onEnded?.() }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onDurationChange={event => setDuration(event.currentTarget.duration)} onPlaying={() => { if (!video.current?.error) setFailure('') }} onError={() => setFailure('This video could not play. Copy its stream URL and open it in an external player such as VLC.')} className={`motion-media pointer-events-none h-full w-full ${displayFill ? 'object-cover' : 'object-contain'}`} /> : <div key={item.id} data-axis={reels ? 'vertical' : 'horizontal'} data-direction={direction} className="motion-media flex h-full w-full items-center justify-center"><div className="flex h-full w-full items-center justify-center" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)` }}><CachedImage url={original ? originalUrl : item.preview.url} status={original ? 'ready' : item.preview.status} alt={item.fileName} preview className={`h-full w-full select-none ${displayFill ? 'object-cover' : 'object-contain'}`} /></div></div>}
      {item.mediaType === 'video' && reels && !playing && <IconButton label="Play video" className="absolute border-transparent bg-canvas/85" onClick={togglePlay}><Play className="size-6" /></IconButton>}
      {item.mediaType === 'video' && !reels && <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 bg-canvas/80 p-3">
        <IconButton label={playing ? 'Pause' : 'Play'} className="border-transparent bg-canvas" onClick={togglePlay}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</IconButton>
        <Range aria-label="Seek" min={0} max={Number.isFinite(duration) ? duration : 0} step={0.1} aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`} value={time} className="flex-1" onChange={event => seek(Number(event.target.value))} />
        <IconButton label={viewerMuted || volume === 0 ? 'Unmute' : 'Mute'} onClick={() => { setViewerMuted(!(viewerMuted || volume === 0)); if (volume === 0) { setVolume(1); if (video.current) video.current.volume = 1 } }}>{viewerMuted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</IconButton>
        <Range aria-label="Volume" aria-valuetext={`${Math.round(volume * 100)} percent`} min={0} max={1} step={0.05} value={volume} className="w-20" onChange={event => { const value = Number(event.target.value); setVolume(value); setViewerMuted(false); if (video.current) video.current.volume = value }} />
        <span className="tabular-nums text-xs text-ink">{formatTime(time)} / {formatTime(duration)}</span>
        <QuietButton className="min-h-10 px-3" aria-label="Playback speed" onClick={() => { const rates = [1, 1.5, 2, 0.5]; const current = video.current?.playbackRate ?? 1; const next = rates[(rates.indexOf(current) + 1) % rates.length]; if (video.current) video.current.playbackRate = next; setRate(next) }}>{rate}×</QuietButton>
      </div>}
      {/* Reels stay uncluttered: the seek control fades in when its strip is tapped or focused. */}
      {item.mediaType === 'video' && reels && <div ref={seekStrip} data-testid="reels-seek" data-visible={seekVisible}
        className={`absolute inset-x-0 bottom-16 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 transition-opacity duration-200 md:bottom-0 ${seekVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <Range aria-label="Seek video" aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`} min={0} max={Number.isFinite(duration) ? duration : 0} step={0.1} value={time} disabled={!Number.isFinite(duration) || duration <= 0} className={`w-full ${seekVisible ? '' : 'pointer-events-none'}`} onFocus={revealSeek} onBlur={revealSeek} onChange={event => { if (!seekVisible) { revealSeek(); return }; revealSeek(); seek(Number(event.target.value)) }} />
      </div>}
      {/* Liking is a universal, brand-independent gesture: it stays red in every theme,
          like the persistent Liked heart elsewhere would if it needed the same emphasis. */}
      {burst > 0 && <Heart key={burst} aria-hidden="true" onAnimationEnd={() => setBurst(0)} className="motion-like pointer-events-none absolute size-24 fill-red-500 text-red-500" />}
      {!isFullscreen && controlledOptionsOpen === undefined && <IconButton label="More options" className={`absolute right-3 border-transparent bg-canvas/85 sm:right-5 ${reels ? 'bottom-32 md:bottom-16' : 'top-28'}`} onClick={() => setOptionsOpen(true)}><EllipsisVertical className="size-5" /></IconButton>}
      {/* Reels has no chrome to carry a small status strip: a failed item must stay
          legible against the full-bleed black stage, not read as an unresponsive one. */}
      {failure && reels && <p role="status" className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-2xl bg-canvas/90 p-4 text-center text-sm text-ink">{failure}</p>}
    </div>
    {failure && !reels && <p role="status" className="bg-canvas px-3 py-2 text-sm text-ink">{failure}</p>}
    <Modal open={optionsOpen} onOpenChange={setOptionsOpen} title="View options" description="Fit, playback and download actions for this item." sheet>
      <div className="flex flex-wrap gap-2 p-5">
        <QuietButton onClick={() => { toggleFill() }}>{fill ? 'Fit' : 'Fill'}</QuietButton>
        {item.mediaType === 'image' && <><QuietButton aria-label="Zoom out" onClick={() => scale(zoom / 1.25)}>−</QuietButton><QuietButton aria-label="Reset zoom" onClick={() => scale(1)}>{Math.round(zoom * 100)}%</QuietButton><QuietButton aria-label="Zoom in" onClick={() => scale(zoom * 1.25)}>+</QuietButton><QuietButton onClick={actualSize}>Actual size</QuietButton><QuietButton onClick={() => setRotation(value => (value + 90) % 360)}>Rotate</QuietButton></>}
        {reels && onOpenViewer && <QuietButton onClick={() => { const player = video.current; if (player) { resumePlayback.current ||= !player.paused; player.pause() }; onOpenViewer(item); setOptionsOpen(false) }}>Open in viewer</QuietButton>}
        {item.mediaType === 'video' && <div className="w-32 shrink-0"><Select aria-label="Playback speed" value={rate} onChange={event => { const value = Number(event.target.value); setRate(value); if (video.current) video.current.playbackRate = value }}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></Select></div>}
        <QuietButton onClick={() => { void fullscreen(); setOptionsOpen(false) }}><Maximize className="size-4" />Fullscreen</QuietButton>
        <QuietLink href={`${originalUrl}?download=true`}><Download className="size-4" />Download</QuietLink>
        {item.mediaType === 'video' && <QuietButton onClick={() => { void navigator.clipboard?.writeText(new URL(originalUrl, window.location.href).href).then(() => setFailure('Stream URL copied. In VLC, choose Open Network Stream and paste it.')).catch(() => setFailure('Copy the download link and paste the stream URL into your player\'s network-stream dialog.')); setOptionsOpen(false) }}>Copy stream URL</QuietButton>}
      </div>
    </Modal>
  </div>
}
