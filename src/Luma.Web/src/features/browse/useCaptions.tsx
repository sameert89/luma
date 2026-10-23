import { t } from '../../lib/i18n'
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
    if (error) message = t('browse:useCaptions.captionsUnavailablePlaybackCanContinue', { value1: error })
    else if (loading) message = t('browse:useCaptions.findingSRTCaptions')
    else if (!selected) message = data?.warning ?? t('browse:useCaptions.noSupportedSRTCaptionsFound')
    else if (src && failedSrc === src) message = t('browse:useCaptions.captionsCouldNotBeLoadedPlaybackCanContinueTurn')
    else if (src && loadedSrc !== src) message = t('browse:useCaptions.preparingCaptions')
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
        label={t('browse:useCaptions.captions')}
        title={
          captions.enabled ? t('browse:useCaptions.turnCaptionsOff') : t('browse:useCaptions.turnCaptionsOnSRTOnly')
        }
        aria-pressed={captions.enabled}
        className="order-1 border-transparent"
        onClick={captions.toggle}
      >
        <Captions className={`size-4 ${captions.enabled ? 'text-accent' : ''}`} />
      </IconButton>
      {captions.enabled && (
        <IconButton
          label={t('browse:useCaptions.captionSettings')}
          className="order-1 border-transparent"
          onClick={() => setOpen(true)}
        >
          <Settings2 className="size-4" />
        </IconButton>
      )}
      <Modal
        open={open && captions.enabled}
        onOpenChange={setOpen}
        title={t('browse:useCaptions.captionSettings')}
        portalContainer={document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined}
        description={t('browse:useCaptions.plainSRTCaptionsOnlyAuthorFontsColorsPositioningAnd')}
        sheet
      >
        <div className="space-y-3 p-5">
          {captions.tracks.length > 0 && (
            <Field label={t('browse:useCaptions.captionTrack')}>
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
          <p className="text-sm text-muted">{t('browse:useCaptions.supportsEmbeddedSubRipSRTOrASameFolderSame')}</p>
        </div>
      </Modal>
    </>
  )
}
