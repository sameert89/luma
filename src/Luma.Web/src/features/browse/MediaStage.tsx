import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { ChevronsLeft, ChevronsRight, Download, EllipsisVertical, FastForward, Heart, HeartCrack, LoaderCircle, Maximize, Minimize, Pause, PictureInPicture2, Play } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Field, IconButton, QuietButton, QuietLink, Range, Select } from '../../components/ui/Controls'
import { CachedImage } from '../../components/ui/CachedImage'
import { Modal } from '../../components/ui/Modal'
import { useFullscreen } from './useFullscreen'
import { useIdle } from './useIdle'
import { useWatchProgress } from './useWatchProgress'
import { ReelsSeek, ViewerVideoControls, formatTime } from './VideoControls'
import { isGif, originalStandsIn, type Media } from './api'

const fillKeys = { viewer: 'luma-viewer-fill', reels: 'luma-reels-fill' }

// Reels gestures: the strip that holds the seek control, and how long a second tap may take.
const seekStripHeight = 140
const doubleTapMs = 280
// Pressing and holding a playing video runs it at double speed until release.
const holdMs = 450
const skipSeconds = 10
// Short stalls resolve on their own; only a real wait shows the spinner.
const bufferingDelayMs = 300

type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSetPresentationMode?: (mode: string) => void; webkitPresentationMode?: string }
const pictureInPictureAvailable = typeof document !== 'undefined' && (document.pictureInPictureEnabled === true
  || (typeof HTMLVideoElement !== 'undefined' && 'webkitSetPresentationMode' in HTMLVideoElement.prototype))

export function MediaStage({ item, reels = false, muted = false, suspended = false, loop = false, autoPlay = false, autoplayNext, direction = 'next', optionsOpen: controlledOptionsOpen, onOptionsOpenChange, onEnded, onNavigate, fullscreenRoot, onOpenViewer, onLike, onDislike, onMutedChange, onAutoplayNextChange }: {
  item: Media; reels?: boolean; muted?: boolean; suspended?: boolean; loop?: boolean; autoPlay?: boolean; autoplayNext?: boolean; direction?: 'next' | 'previous'; optionsOpen?: boolean; onOptionsOpenChange?: (open: boolean) => void; onEnded?: () => void; onNavigate: (direction: 'next' | 'previous') => void; fullscreenRoot?: RefObject<HTMLElement | null>; onOpenViewer?: (item: Media) => void; onLike?: () => void; onDislike?: () => void; onMutedChange?: (value: boolean) => void; onAutoplayNextChange?: (value: boolean) => void
}) {
  const isFullscreen = useFullscreen()
  const host = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const watch = useWatchProgress(item, video, reels || autoPlay)
  const volumeSwipe = useRef<{ y: number; volume: number; active: boolean } | null>(null)
  const [volumeOverlay, setVolumeOverlay] = useState(false)
  const volumeTimer = useRef(0)
  const pinch = useRef<{ distance: number; zoom: number; x: number; y: number; pan: { x: number; y: number } } | null>(null)
  const photoTap = useRef(0)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const seekStrip = useRef<HTMLDivElement>(null)
  const resumePlayback = useRef(false)
  const playbackSuspended = useRef(suspended)
  playbackSuspended.current = suspended
  const autoPlayRef = useRef(autoPlay)
  autoPlayRef.current = autoPlay
  const navigateRef = useRef(onNavigate)
  navigateRef.current = onNavigate
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {})
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const lastWheel = useRef(0)
  const gesture = useRef({ x: 0, y: 0, distance: 0 })
  const seekTimer = useRef(0)
  const tapTimer = useRef(0)
  const lastTap = useRef(0)
  const centreTaps = useRef(0)
  // A double-tap like is sent once a third tap can no longer turn it into a dislike.
  const pendingLike = useRef<{ timer: number; commit: () => void } | null>(null)
  const holdTimer = useRef(0)
  const holding = useRef(false)
  const holdArmed = useRef(false)
  const heldGesture = useRef(false)
  const chromeWasHidden = useRef(false)
  const bufferTimer = useRef(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fill, setFill] = useState(() => {
    const stored = localStorage.getItem(reels ? fillKeys.reels : fillKeys.viewer)
    return stored === null ? reels : stored === '1'
  })
  const [originalId, setOriginalId] = useState<number | null>(null)
  const original = originalId === item.id
  const animated = isGif(item)
  // Until its preview is prepared a photo shows its original, and keeps it for this visit even
  // once the preview arrives, so the picture never swaps (or re-decodes) under the viewer.
  const [standInId, setStandInId] = useState<number | null>(null)
  if (standInId !== item.id && originalStandsIn(item)) setStandInId(item.id)
  const standIn = standInId === item.id
  const showOriginal = original || animated || standIn
  const [failure, setFailure] = useState('')
  const [localOptionsOpen, setLocalOptionsOpen] = useState(false)
  const optionsOpen = controlledOptionsOpen ?? localOptionsOpen
  const setOptionsOpen = onOptionsOpenChange ?? setLocalOptionsOpen
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(1)
  const [viewerMuted, setViewerMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [seekVisible, setSeekVisible] = useState(false)
  const [burst, setBurst] = useState<{ dislike: boolean; key: number } | null>(null)
  const [buffering, setBuffering] = useState(false)
  const [boosted, setBoosted] = useState(false)
  const [skip, setSkip] = useState<{ forward: boolean; key: number } | null>(null)
  const [flash, setFlash] = useState<{ playing: boolean; key: number } | null>(null)
  const isVideo = item.mediaType === 'video'
  // Zoom, pan and rotate belong to the viewer. In Reels a photo or GIF keeps Reels' own
  // gestures (double tap likes, swipes move on) instead of picture controls.
  const zoomable = !isVideo && !reels
  // Fullscreen chrome steps aside while media plays; a paused video keeps its controls.
  const chromeHidden = useIdle(isFullscreen) && !(isVideo && !playing)
  const originalUrl = `/api/media/${item.id}/original`
  useLayoutEffect(() => {
    setZoom(1); setRotation(0); setPan({ x: 0, y: 0 }); setOriginalId(null); setFailure('')
    setPlaying(false); setSeekVisible(false); setBurst(null); setBuffering(false); setBoosted(false); setSkip(null); setFlash(null)
    pointers.current.clear(); pinch.current = null; volumeSwipe.current = null; photoTap.current = 0; zoomRef.current = 1; panRef.current = { x: 0, y: 0 }; lastTap.current = 0; centreTaps.current = 0; lastWheel.current = 0; holding.current = false
    flushLike()
    window.clearTimeout(seekTimer.current); window.clearTimeout(tapTimer.current); window.clearTimeout(holdTimer.current); window.clearTimeout(bufferTimer.current)
  }, [item.id])
  const displayFill = fill
  zoomRef.current = zoom
  panRef.current = pan
  function boundedPan(value: { x: number; y: number }, level: number) {
    const bounds = host.current?.getBoundingClientRect()
    if (!bounds) return
    const next = { x: Math.max(-bounds.width * (level - 1) / 2, Math.min(bounds.width * (level - 1) / 2, value.x)), y: Math.max(-bounds.height * (level - 1) / 2, Math.min(bounds.height * (level - 1) / 2, value.y)) }
    panRef.current = next; setPan(next)
  }
  function scale(value: number) { setZoom(Math.max(1, Math.min(8, value))); if (value <= 1) setPan({ x: 0, y: 0 }) }
  function toggleFill() {
    setFill(value => {
      const next = !value
      localStorage.setItem(reels ? fillKeys.reels : fillKeys.viewer, next ? '1' : '0')
      return next
    })
    scale(1)
  }
  function actualSize() { setOriginalId(item.id); setFill(false); setPan({ x: 0, y: 0 }); const bounds = host.current?.getBoundingClientRect(); if (bounds && item.width && item.height) scale(Math.max(item.width / bounds.width, item.height / bounds.height)) }
  async function fullscreen() {
    const target = fullscreenRoot?.current ?? host.current
    const player = video.current as WebkitVideo | null
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (target?.requestFullscreen) await target.requestFullscreen()
      // iPhone Safari only offers fullscreen through its native video presentation.
      else if (player?.webkitEnterFullscreen) player.webkitEnterFullscreen()
      else setFailure('Fullscreen is unavailable in this browser.')
    } catch { setFailure('Fullscreen is unavailable in this browser.') }
  }
  async function pictureInPicture() {
    const player = video.current as WebkitVideo | null
    if (!player) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else if (document.pictureInPictureEnabled) await player.requestPictureInPicture()
      else if (player.webkitSetPresentationMode) player.webkitSetPresentationMode(player.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture')
      else setFailure('Picture in picture is unavailable in this browser.')
    } catch { setFailure('Picture in picture is unavailable for this video.') }
  }
  function togglePlay() {
    const player = video.current
    if (!player) return
    const starting = player.paused
    if (starting) void player.play().catch(() => setFailure(current => current || 'Autoplay was blocked. Press Play to start.'))
    else player.pause()
    return starting
  }
  function skipBy(seconds: number) {
    const player = video.current
    if (!player) return
    const end = Number.isFinite(player.duration) ? player.duration : Infinity
    player.currentTime = Math.max(0, Math.min(end, player.currentTime + seconds))
    setSkip({ forward: seconds > 0, key: Date.now() })
  }
  function changeVolume(value: number) { value = Math.max(0, Math.min(1, value)); setVolume(value); setViewerMuted(false); if (reels) onMutedChange?.(value === 0); if (video.current) video.current.volume = value }
  function toggleMute() { setViewerMuted(!(viewerMuted || volume === 0)); if (volume === 0) changeVolume(1) }
  function cycleRate() { const rates = [1, 1.5, 2, 0.5]; const next = rates[(rates.indexOf(rate) + 1) % rates.length]; if (video.current) video.current.playbackRate = next; setRate(next) }
  function revealSeek() {
    setSeekVisible(true)
    window.clearTimeout(seekTimer.current)
    seekTimer.current = window.setTimeout(() => {
      if (!seekStrip.current?.contains(document.activeElement)) setSeekVisible(false)
    }, 3000)
  }
  function waiting() { window.clearTimeout(bufferTimer.current); bufferTimer.current = window.setTimeout(() => setBuffering(true), bufferingDelayMs) }
  function ready() { window.clearTimeout(bufferTimer.current); setBuffering(false) }
  function endHold() {
    window.clearTimeout(holdTimer.current)
    holdArmed.current = false
    if (!holding.current) return
    holding.current = false
    if (video.current) video.current.playbackRate = rate
    setBoosted(false)
  }
  function flushLike() {
    const pending = pendingLike.current
    if (!pending) return
    pendingLike.current = null
    window.clearTimeout(pending.timer)
    pending.commit()
  }
  function tap(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    // A tap on the strip holding the seek control reveals it rather than pausing.
    if (isVideo && reels && event.clientY - bounds.top > bounds.height - seekStripHeight) { revealSeek(); return }
    // Double taps on the outer thirds of a video skip, like streaming players. In Reels
    // the centre likes on a double tap and dislikes on a triple tap.
    const x = (event.clientX - bounds.left) / bounds.width
    const side = !isVideo ? 0 : x < 1 / 3 ? -1 : x > 2 / 3 ? 1 : 0
    const now = Date.now()
    if (now - lastTap.current < doubleTapMs) {
      window.clearTimeout(tapTimer.current)
      if (side) { skipBy(side * skipSeconds); lastTap.current = now; return }
      centreTaps.current += 1
      if (!reels) { lastTap.current = 0; return }
      if (centreTaps.current === 2) {
        lastTap.current = now
        setBurst({ dislike: false, key: now })
        const commit = () => onLike?.()
        pendingLike.current = { commit, timer: window.setTimeout(() => { pendingLike.current = null; commit() }, doubleTapMs) }
        return
      }
      lastTap.current = 0; centreTaps.current = 0
      if (pendingLike.current) { window.clearTimeout(pendingLike.current.timer); pendingLike.current = null }
      setBurst({ dislike: true, key: now })
      onDislike?.()
      return
    }
    lastTap.current = now
    centreTaps.current = side ? 0 : 1
    // Hold the single-tap action until a second tap can no longer arrive, so liking or
    // skipping never pauses playback on its way through. When fullscreen controls were
    // hidden, the first tap only brings them back.
    const hidden = chromeWasHidden.current
    if (isVideo) tapTimer.current = window.setTimeout(() => {
      if (reels) togglePlay()
      else if (!hidden) setFlash({ playing: togglePlay() ?? false, key: Date.now() })
    }, doubleTapMs)
  }
  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    const swiping = volumeSwipe.current?.active
    volumeSwipe.current = null
    if (swiping) { heldGesture.current = true; endHold(); return }
    if (pinch.current) { if (!pointers.current.size) pinch.current = null; return }
    if (holding.current) { endHold(); return }
    endHold()
    const dx = event.clientX - gesture.current.x
    const dy = event.clientY - gesture.current.y
    const along = reels ? dy : dx
    const across = reels ? dx : dy
    if (zoom === 1 && !gesture.current.distance && Math.abs(along) > 60 && Math.abs(along) > Math.abs(across)) onNavigate(along < 0 ? 'next' : 'previous')
    else if (!gesture.current.distance && zoomable && Math.hypot(dx, dy) < 10) {
      const now = Date.now()
      if (now - photoTap.current < doubleTapMs) {
        if (zoomRef.current > 1) { scale(1); zoomRef.current = 1; panRef.current = { x: 0, y: 0 } }
        else { const bounds = event.currentTarget.getBoundingClientRect(); const value = 2.5; scale(value); zoomRef.current = value; const next = { x: -(event.clientX - bounds.left - bounds.width / 2) * (value - 1), y: -(event.clientY - bounds.top - bounds.height / 2) * (value - 1) }; setPan(next); panRef.current = next }
        photoTap.current = 0
      } else photoTap.current = now
    }
    else if ((reels || isVideo) && !gesture.current.distance && Math.hypot(dx, dy) < 10) tap(event)
  }
  useEffect(() => () => { flushLike(); window.clearTimeout(seekTimer.current); window.clearTimeout(tapTimer.current); window.clearTimeout(holdTimer.current); window.clearTimeout(bufferTimer.current); window.clearTimeout(volumeTimer.current) }, [])
  useEffect(() => {
    if (!skip && !flash) return
    const timer = window.setTimeout(() => { setSkip(null); setFlash(null) }, 600)
    return () => window.clearTimeout(timer)
  }, [skip, flash])
  useEffect(() => {
    const player = video.current
    let disposed = false
    if (player) { player.volume = volume; player.playbackRate = rate }
    if (player && !player.getAttribute('src')) player.src = originalUrl
    if ((reels || autoPlayRef.current) && player && !playbackSuspended.current) void player.play().then(() => { if (playbackSuspended.current) player.pause() }).catch(error => { if (!disposed) setFailure(current => current || (player.error || (error instanceof DOMException && error.name === 'NotSupportedError') ? 'This video could not play. Copy its stream URL and open it in an external player such as VLC.' : 'Autoplay was blocked. Press Play to start.')) })
    return () => { disposed = true; if (player) { player.pause(); player.removeAttribute('src'); player.load() } }
  }, [reels, originalUrl])
  useEffect(() => {
    // Starting a slideshow on a paused video starts it; later items autoplay on load.
    if (autoPlay && video.current?.paused && !playbackSuspended.current) void video.current.play().catch(() => {})
  }, [autoPlay])
  useEffect(() => {
    const player = video.current
    if (!player) return
    if (suspended) { resumePlayback.current ||= !player.paused; player.pause() }
    else if (resumePlayback.current) {
      resumePlayback.current = false
      void player.play().catch(() => setFailure('Press Play to resume playback.'))
    }
  }, [suspended, item.id])
  // Lock-screen, headset and notification controls, and background playback metadata.
  useEffect(() => {
    if (!isVideo || suspended || typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
    const session = navigator.mediaSession
    session.metadata = new MediaMetadata({ title: item.fileName, artist: 'Luma',
      artwork: item.preview.status === 'ready' ? [{ src: new URL(item.preview.url, window.location.href).href }] : [] })
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void video.current?.play().catch(() => {})],
      ['pause', () => video.current?.pause()],
      ['seekbackward', details => skipBy(-(details.seekOffset ?? skipSeconds))],
      ['seekforward', details => skipBy(details.seekOffset ?? skipSeconds)],
      ['seekto', details => { if (video.current && details.seekTime !== undefined) video.current.currentTime = details.seekTime }],
      ['previoustrack', () => navigateRef.current('previous')],
      ['nexttrack', () => navigateRef.current('next')],
    ]
    for (const [action, handler] of handlers) { try { session.setActionHandler(action, handler) } catch { /* action unsupported here */ } }
    return () => {
      for (const [action] of handlers) { try { session.setActionHandler(action, null) } catch { /* action unsupported here */ } }
      session.metadata = null
    }
    // skipBy only reads the video ref; handlers need rebinding when the item changes.
  }, [item.id, isVideo, suspended, item.fileName, item.preview.status, item.preview.url])
  function syncSession() {
    const player = video.current
    if (!player || suspended || !('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = player.paused ? 'paused' : 'playing'
    try {
      if (Number.isFinite(player.duration) && player.duration > 0)
        navigator.mediaSession.setPositionState({ duration: player.duration, playbackRate: player.playbackRate, position: Math.min(player.currentTime, player.duration) })
    } catch { /* position state is best effort */ }
  }
  // The listener is added once and reads the latest handler, which closes over this render's state.
  keyRef.current = key
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  function key(event: KeyboardEvent) {
    const dialog = host.current?.closest('[role="dialog"]'); const dialogs = document.querySelectorAll('[role="dialog"]'); if (dialogs.length && dialogs[dialogs.length - 1] !== dialog) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,video,button,a,[contenteditable="true"]')) return
    if (!reels) {
      if (event.key === '+' || event.key === '=') { event.preventDefault(); scale(zoom * 1.25) }
      if (event.key === '-') { event.preventDefault(); scale(zoom / 1.25) }
      if (event.key === '1') actualSize()
      if (event.key.toLowerCase() === 'r') setRotation(value => (value + 90) % 360)
    }
    if (event.key.toLowerCase() === 'f') void fullscreen()
    if (!isVideo) return
    if (event.key === ' ' || event.key.toLowerCase() === 'k') { event.preventDefault(); togglePlay() }
    if (event.key.toLowerCase() === 'j') skipBy(-skipSeconds)
    if (event.key.toLowerCase() === 'l') skipBy(skipSeconds)
    if (event.key.toLowerCase() === 'm' && !reels) toggleMute()
    // Reels move between items vertically, which leaves Left and Right for seeking.
    if (reels && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); skipBy(event.key === 'ArrowLeft' ? -5 : 5) }
  }
  const exitVisible = isFullscreen && !(isVideo && !reels)
  return <div className="relative flex h-full min-h-0 w-full flex-col">
    <div ref={host} className={`relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden bg-black ${chromeHidden ? 'cursor-none' : ''}`}
      onWheel={event => { if (reels && Math.abs(event.deltaY) > 40 && Date.now() - lastWheel.current > 500) { lastWheel.current = Date.now(); onNavigate(event.deltaY > 0 ? 'next' : 'previous') } else if (!reels && item.mediaType === 'image') scale(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)) }}
      onContextMenu={event => { if (holding.current || holdArmed.current) event.preventDefault() }}
      onPointerDown={event => {
        if ((event.target as HTMLElement).closest('button,a,input,select,video')) return
        chromeWasHidden.current = chromeHidden
        event.currentTarget.setPointerCapture(event.pointerId); pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); gesture.current = { x: event.clientX, y: event.clientY, distance: 0 }
        const bounds = event.currentTarget.getBoundingClientRect()
        // The right quarter is the volume lane in both players. Reels keeps vertical
        // previous/next swipes everywhere else, so the gestures remain unambiguous.
        if (isVideo && pointers.current.size === 1 && event.clientX > bounds.left + bounds.width * 0.75 && event.clientY < bounds.bottom - seekStripHeight) volumeSwipe.current = { y: event.clientY, volume, active: false }
        if (zoomable && pointers.current.size === 2) {
          const points = [...pointers.current.values()]
          pinch.current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), zoom: zoomRef.current, x: (points[0].x + points[1].x) / 2 - bounds.left - bounds.width / 2, y: (points[0].y + points[1].y) / 2 - bounds.top - bounds.height / 2, pan: panRef.current }
          gesture.current.distance = pinch.current.distance
        }
        window.clearTimeout(holdTimer.current)
        if (isVideo && event.button === 0 && pointers.current.size === 1) {
          heldGesture.current = false; holdArmed.current = true
          holdTimer.current = window.setTimeout(() => {
            const player = video.current
            if (!player || player.paused || pointers.current.size !== 1) return
            holding.current = true; heldGesture.current = true
            player.playbackRate = 2; setBoosted(true)
          }, holdMs)
        }
      }}
      onPointerMove={event => {
        const old = pointers.current.get(event.pointerId); if (!old) return
        const dx = event.clientX - gesture.current.x; const dy = event.clientY - gesture.current.y
        if (Math.hypot(dx, dy) > 10) { window.clearTimeout(holdTimer.current); endHold() }
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) && !volumeSwipe.current?.active) volumeSwipe.current = null
        if (Math.hypot(dx, dy) > 10) photoTap.current = 0
        const swipe = volumeSwipe.current
        if (isVideo && swipe && (swipe.active || Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx))) {
          swipe.active = true; heldGesture.current = true
          changeVolume(swipe.volume + (swipe.y - event.clientY) / Math.max(160, event.currentTarget.clientHeight * 0.6))
          if (video.current) video.current.muted = false
          setVolumeOverlay(true); window.clearTimeout(volumeTimer.current); volumeTimer.current = window.setTimeout(() => setVolumeOverlay(false), 1000)
          return
        }
        const points = [...pointers.current.values()]
        const start = pinch.current
        if (zoomable && points.length === 2 && start) {
          const bounds = event.currentTarget.getBoundingClientRect()
          const nextZoom = Math.max(1, Math.min(8, start.zoom * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / Math.max(1, start.distance)))
          const ratio = nextZoom / start.zoom
          const next = { x: (points[0].x + points[1].x) / 2 - bounds.left - bounds.width / 2 - (start.x - start.pan.x) * ratio, y: (points[0].y + points[1].y) / 2 - bounds.top - bounds.height / 2 - (start.y - start.pan.y) * ratio }
          setZoom(nextZoom); zoomRef.current = nextZoom
          boundedPan(next, nextZoom)
        } else if (zoomable && zoomRef.current > 1) boundedPan({ x: panRef.current.x + event.clientX - old.x, y: panRef.current.y + event.clientY - old.y }, zoomRef.current)
      }}
      onPointerUp={pointerUp}
      onPointerCancel={() => { pointers.current.clear(); pinch.current = null; volumeSwipe.current = null; endHold() }}>
      {/* Personal source videos have no generated caption tracks; preserve native playback capabilities. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      {isVideo ? <video key={item.id} data-axis={reels ? 'vertical' : 'horizontal'} data-direction={direction} aria-label={item.fileName} ref={video} src={originalUrl} poster={item.preview.status === 'ready' ? item.preview.url : undefined} playsInline loop={loop} muted={reels ? muted : viewerMuted || volume === 0} controls={false} preload="auto"
        onEnded={() => { setPlaying(false); syncSession(); onEnded?.() }} onPlay={() => { setPlaying(true); syncSession() }} onPause={() => { setPlaying(false); endHold(); syncSession() }}
        onWaiting={waiting} onSeeking={waiting} onSeeked={() => { ready(); syncSession() }} onCanPlay={ready} onDurationChange={syncSession} onRateChange={syncSession}
        onPlaying={() => { ready(); if (!video.current?.error) setFailure('') }} onError={() => { ready(); setFailure('This video could not play. Copy its stream URL and open it in an external player such as VLC.') }}
        className={`motion-media pointer-events-none h-full w-full ${displayFill ? 'object-cover' : 'object-contain'}`} /> : <div key={item.id} data-axis={reels ? 'vertical' : 'horizontal'} data-direction={direction} className="motion-media flex h-full w-full items-center justify-center"><div className="flex h-full w-full items-center justify-center" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)` }}><CachedImage url={showOriginal ? originalUrl : item.preview.url} status={showOriginal ? 'ready' : item.preview.status === 'failed' ? 'failed' : item.preview.status === 'ready' ? 'ready' : 'pending'} placeholder={standIn && item.thumbnail.status === 'ready' ? item.thumbnail.url : undefined} alt={item.fileName} preview className={`h-full w-full select-none ${displayFill ? 'object-cover' : 'object-contain'}`} /></div></div>}
      {isVideo && volumeOverlay && <span role="status" className="pointer-events-none absolute right-8 top-1/2 rounded-lg bg-canvas/85 px-4 py-3 text-ink">Volume {Math.round(volume * 100)}%</span>}
      {/* Two buttons on the video itself: continuing is the accented one, starting over carries
          the same frosted backing as every other control that sits on media. */}
      {isVideo && watch.resume !== null && <div data-chrome className="absolute top-16 flex flex-wrap gap-3"><Button onClick={() => watch.choose(false)}>Resume from {formatTime(watch.resume)}</Button><QuietButton variant="overlay" className="min-h-11" onClick={() => watch.choose(true)}>Start from beginning</QuietButton></div>}
      {isVideo && buffering && <div className="pointer-events-none absolute flex size-16 items-center justify-center rounded-full bg-canvas/60" data-testid="buffering"><LoaderCircle aria-hidden="true" className="size-8 text-ink motion-safe:animate-spin" /><span className="sr-only">Buffering</span></div>}
      {isVideo && reels && !playing && !buffering && <IconButton label="Play video" className="absolute border-transparent bg-canvas/85" onClick={togglePlay}><Play className="size-6" /></IconButton>}
      {flash && <span key={flash.key} aria-hidden="true" className="motion-flash pointer-events-none absolute flex size-16 items-center justify-center rounded-full bg-canvas/60 text-ink">{flash.playing ? <Play className="size-7" /> : <Pause className="size-7" />}</span>}
      {skip && <span key={skip.key} aria-hidden="true" className={`motion-flash pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-canvas/60 px-4 py-3 text-xs font-semibold text-ink ${skip.forward ? 'right-8' : 'left-8'}`}>{skip.forward ? <ChevronsRight className="size-6" /> : <ChevronsLeft className="size-6" />}{skipSeconds} s</span>}
      {boosted && <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1 rounded-full bg-canvas/80 px-3 py-1 text-sm font-semibold text-ink sm:top-6"><FastForward className="size-4" />2×</span>}
      {isVideo && !reels && <ViewerVideoControls video={video} mediaId={item.id} playing={playing} muted={viewerMuted || volume === 0} volume={volume} rate={rate} hidden={chromeHidden} fullscreen={isFullscreen} pictureInPicture={pictureInPictureAvailable}
        autoplay={autoplayNext} onAutoplay={onAutoplayNextChange && (() => onAutoplayNextChange(!autoplayNext))}
        onTogglePlay={togglePlay} onToggleMute={toggleMute} onVolume={changeVolume} onRate={cycleRate} onFullscreen={() => void fullscreen()} onPictureInPicture={() => void pictureInPicture()} />}
      {isVideo && reels && <ReelsSeek video={video} mediaId={item.id} visible={seekVisible} stripRef={seekStrip} onReveal={revealSeek} />}
      {/* Liking is a universal, brand-independent gesture: it stays red in every theme,
          like the persistent Liked heart elsewhere would if it needed the same emphasis. */}
      {burst && !burst.dislike && <Heart key={burst.key} aria-hidden="true" onAnimationEnd={() => setBurst(null)} className="motion-like pointer-events-none absolute size-24 fill-red-500 text-red-500" />}
      {burst?.dislike && <HeartCrack key={burst.key} aria-hidden="true" onAnimationEnd={() => setBurst(null)} className="motion-like pointer-events-none absolute size-24 text-red-500" />}
      {!isFullscreen && controlledOptionsOpen === undefined && <IconButton label="More options" className={`absolute right-3 border-transparent bg-canvas/85 sm:right-5 ${reels ? 'bottom-16' : 'top-28'}`} onClick={() => setOptionsOpen(true)}><EllipsisVertical className="size-5" /></IconButton>}
      {/* Fullscreen hides the page chrome, including Back; a visible exit is always offered. */}
      {exitVisible && <IconButton data-chrome label="Exit fullscreen" className={`absolute right-3 top-3 z-10 border-transparent bg-canvas/85 transition-opacity duration-200 sm:right-5 sm:top-5 ${chromeHidden ? 'pointer-events-none opacity-0' : ''}`} onClick={() => void fullscreen()}><Minimize className="size-5" /></IconButton>}
      {/* Reels has no chrome to carry a small status strip: a failed item must stay
          legible against the full-bleed black stage, not read as an unresponsive one. */}
      {failure && reels && <p role="status" className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-2xl bg-canvas/90 p-4 text-center text-sm text-ink">{failure}</p>}
    </div>
    {failure && !reels && <p role="status" className="bg-canvas px-3 py-2 text-sm text-ink">{failure}</p>}
    <Modal open={optionsOpen} onOpenChange={setOptionsOpen} title="View options" description="Fit, playback and download actions for this item." sheet>
      {/* Labeled settings sit in their own row: mixed into the button row, their taller
          label + control stack stretched every pill beside them to the same height. */}
      {isVideo && <div className="grid gap-4 px-5 pt-5 sm:grid-cols-2">
        {reels && <Field label="Volume"><Range min={0} max={1} step={0.05} value={volume} className="w-full" onChange={event => changeVolume(Number(event.target.value))} /></Field>}
        <Field label="Playback speed"><Select value={rate} onChange={event => { const value = Number(event.target.value); setRate(value); if (video.current) video.current.playbackRate = value }}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></Select></Field>
      </div>}
      <div className="flex flex-wrap items-center gap-2 p-5">
        <QuietButton onClick={() => { toggleFill() }}>{fill ? 'Fit' : 'Fill'}</QuietButton>
        {zoomable && <><QuietButton aria-label="Zoom out" onClick={() => scale(zoom / 1.25)}>−</QuietButton><QuietButton aria-label="Reset zoom" onClick={() => scale(1)}>{Math.round(zoom * 100)}%</QuietButton><QuietButton aria-label="Zoom in" onClick={() => scale(zoom * 1.25)}>+</QuietButton><QuietButton onClick={actualSize}>Actual size</QuietButton><QuietButton onClick={() => setRotation(value => (value + 90) % 360)}>Rotate</QuietButton></>}
        {reels && onOpenViewer && <QuietButton onClick={() => { const player = video.current; if (player) { resumePlayback.current ||= !player.paused; player.pause() }; onOpenViewer(item); setOptionsOpen(false) }}>Open in viewer</QuietButton>}
        {isVideo && pictureInPictureAvailable && <QuietButton onClick={() => { void pictureInPicture(); setOptionsOpen(false) }}><PictureInPicture2 className="size-4" />Picture in picture</QuietButton>}
        <QuietButton onClick={() => { void fullscreen(); setOptionsOpen(false) }}><Maximize className="size-4" />Fullscreen</QuietButton>
        <QuietLink href={`${originalUrl}?download=true`}><Download className="size-4" />Download</QuietLink>
        {isVideo && <QuietButton onClick={() => { void navigator.clipboard?.writeText(new URL(originalUrl, window.location.href).href).then(() => setFailure('Stream URL copied. In VLC, choose Open Network Stream and paste it.')).catch(() => setFailure('Copy the download link and paste the stream URL into your player\'s network-stream dialog.')); setOptionsOpen(false) }}>Copy stream URL</QuietButton>}
      </div>
    </Modal>
  </div>
}
