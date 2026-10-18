import { useEffect, useRef, useState } from 'react'
import { Captions, Settings2 } from 'lucide-react'
import { Field, IconButton, Select } from '../../components/ui/Controls'
import { Modal } from '../../components/ui/Modal'
import type { components } from '../../lib/api/generated'
import { request, errorMessage } from './api'

type CaptionList = components['schemas']['CaptionList']
export function useCaptions(mediaId: number, isVideo: boolean) {
  const [activation, setActivation] = useState({ mediaId, enabled: false })
  const [choice, setChoice] = useState<{ mediaId: number; id: string } | null>(null)
  const [failedSrc, setFailedSrc] = useState('')
  const [loadedSrc, setLoadedSrc] = useState('')
  const [result, setResult] = useState<{
    mediaId: number
    data: CaptionList | null
    loading: boolean
    error: string
  } | null>(null)
  const pending = useRef<AbortController | null>(null)
  // Reset per visit without creating even a disabled query for every skipped Flick item.
  if (activation.mediaId !== mediaId) setActivation({ mediaId, enabled: false })
  const enabled = isVideo && activation.mediaId === mediaId && activation.enabled
  const data = result?.mediaId === mediaId ? result.data : null
  const loading = result?.mediaId === mediaId && result.loading
  const error = result?.mediaId === mediaId ? result.error : ''
  const tracks = data?.tracks ?? []
  useEffect(() => () => pending.current?.abort(), [mediaId])
  const selected = tracks.find(track => choice?.mediaId === mediaId && choice.id === track.id) ?? tracks[0]
  const src =
    enabled && !loading && !error && selected && data
      ? `/api/media/${mediaId}/captions/${encodeURIComponent(selected.id)}?key=${encodeURIComponent(data.sourceKey)}`
      : ''
  const trackRef = useRef<HTMLTrackElement>(null)
  useEffect(() => {
    const element = trackRef.current
    if (!src || !element) return
    function loaded() {
      const track = element!.track
      if (track) {
        // Keep plain browser captions above the custom playback bar, including fullscreen.
        for (const cue of Array.from(track.cues ?? [])) if ('line' in cue) (cue as VTTCue).line = -4
        track.mode = 'showing'
      }
      setLoadedSrc(src)
    }
    function failed() {
      setFailedSrc(src)
    }
    element.addEventListener('load', loaded)
    element.addEventListener('error', failed)
    if (element.track) element.track.mode = 'showing'
    if (element.readyState === 2) loaded()
    else if (element.readyState === 3) failed()
    return () => {
      element.removeEventListener('load', loaded)
      element.removeEventListener('error', failed)
      if (element.track) element.track.mode = 'disabled'
    }
  }, [src])
  function toggle() {
    pending.current?.abort()
    setFailedSrc('')
    setLoadedSrc('')
    setActivation({ mediaId, enabled: !enabled })
    if (enabled) return
    const controller = new AbortController()
    pending.current = controller
    setResult({ mediaId, data: null, loading: true, error: '' })
    void request<CaptionList>(`/api/media/${mediaId}/captions`, controller.signal, 'POST')
      .then(data => {
        if (!controller.signal.aborted && pending.current === controller)
          setResult({ mediaId, data, loading: false, error: '' })
      })
      .catch(error => {
        if (!controller.signal.aborted && pending.current === controller)
          setResult({ mediaId, data: null, loading: false, error: errorMessage(error) })
      })
  }
  let message = ''
  if (enabled) {
    if (error) message = `Captions unavailable: ${error} Playback can continue.`
    else if (loading) message = 'Finding SRT captions…'
    else if (!selected) message = data?.warning ?? 'No supported SRT captions found.'
    else if (src && failedSrc === src)
      message = 'Captions could not be loaded. Playback can continue; turn captions off and on to retry.'
    else if (src && loadedSrc !== src) message = 'Preparing captions…'
  }
  const track =
    src && selected ? (
      <track
        key={src}
        ref={trackRef}
        kind="subtitles"
        label={selected.label}
        srcLang={selected.language}
        src={src}
        default
      />
    ) : null
  return {
    enabled,
    toggle,
    track,
    tracks,
    selected,
    message,
    warning: data?.warning,
    choose: (id: string) => setChoice({ mediaId, id }),
  }
}

export function CaptionControls({ captions }: { captions: ReturnType<typeof useCaptions> }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton
        label="Captions"
        title={captions.enabled ? 'Turn captions off' : 'Turn captions on (SRT only)'}
        aria-pressed={captions.enabled}
        className="order-1 border-transparent"
        onClick={captions.toggle}
      >
        <Captions className={`size-4 ${captions.enabled ? 'text-accent' : ''}`} />
      </IconButton>
      {captions.enabled && (
        <IconButton label="Caption settings" className="order-1 border-transparent" onClick={() => setOpen(true)}>
          <Settings2 className="size-4" />
        </IconButton>
      )}
      <Modal
        open={open && captions.enabled}
        onOpenChange={setOpen}
        title="Caption settings"
        portalContainer={document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined}
        description="Plain SRT captions only. Author fonts, colors, positioning and effects are not supported."
        sheet
      >
        <div className="space-y-3 p-5">
          {captions.tracks.length > 0 && (
            <Field label="Caption track">
              <Select value={captions.selected?.id ?? ''} onChange={event => captions.choose(event.target.value)}>
                {captions.tracks.map(track => (
                  <option key={track.id} value={track.id}>
                    {track.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {captions.message && (
            <p role="status" className="text-sm text-muted">
              {captions.message}
            </p>
          )}
          {captions.warning && <p className="text-sm text-muted">{captions.warning}</p>}
          <p className="text-sm text-muted">
            Supports embedded SubRip/SRT or a same-folder, same-basename .srt file. Other subtitle formats and styled
            subtitles are not supported. Converted and extracted files stay in Luma’s cache.
          </p>
        </div>
      </Modal>
    </>
  )
}
