import { useEffect, useRef, useState } from 'react'
import { BookOpen, Clapperboard, Images, X } from 'lucide-react'
import { Checkbox, Field, IconButton, Input, QuietButton, Range, Select } from '../../components/ui/Controls'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { backgroundImage, readAppearance, sanitizeAppearance, type Appearance } from './preferences'
import { loadBackground, removeBackground, saveBackground } from './backgroundStore'
import type { Experience } from '../navigation/AppSwitcher'

export function useAppearance() {
  const [value, setValue] = useState(readAppearance),
    [blob, setBlob] = useState<Blob | null>(null),
    [customUrl, setCustomUrl] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const revision = useRef(0)
  useEffect(() => {
    let active = true
    const generation = revision.current
    void loadBackground()
      .then(value => {
        if (active && generation === revision.current) setBlob(value)
      })
      .catch(() => {
        if (active) setError('Could not load the saved background.')
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!blob) {
      setCustomUrl(null)
      return
    }
    const url = URL.createObjectURL(blob)
    setCustomUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [blob])
  useEffect(() => {
    document.documentElement.dataset.animation = value.motion
    try {
      localStorage.setItem('luma-appearance-v2', JSON.stringify(value))
    } catch {
      setError('Appearance changes could not be saved on this device.')
    }
  }, [value])
  function update(patch: Partial<Appearance>) {
    setValue(previous => sanitizeAppearance({ ...previous, ...patch }))
  }
  async function image(file?: File) {
    setBusy(true)
    setError('')
    revision.current++
    try {
      if (file) {
        setBlob(await saveBackground(file))
        update({ background: 'custom' })
      } else {
        await removeBackground()
        setBlob(null)
        if (value.background === 'custom') update({ background: 'none' })
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save the background.')
    } finally {
      setBusy(false)
    }
  }
  return { value, update, customUrl, image, busy, error }
}
export type AppearanceControl = ReturnType<typeof useAppearance>
export function AppearanceBackdrop({ appearance }: { appearance: AppearanceControl }) {
  const image = backgroundImage(appearance.value, appearance.customUrl)
  if (!image) return null
  return (
    <div className="appearance-backdrop" aria-hidden="true">
      <div
        className={
          ['aurora', 'sunset'].includes(appearance.value.background)
            ? 'appearance-image appearance-atmosphere'
            : 'appearance-image'
        }
        style={{
          backgroundImage: image,
          backgroundSize: appearance.value.scale === 'stretch' ? '100% 100%' : appearance.value.scale,
          backgroundPosition: appearance.value.position,
          filter: `blur(${appearance.value.blur}px)`,
          opacity: appearance.value.opacity,
        }}
      />
      <div className="absolute inset-0 bg-black" style={{ opacity: appearance.value.darkness }} />
      <div className="appearance-wash" />
    </div>
  )
}
export function AppearanceSettings({ appearance }: { appearance: AppearanceControl }) {
  const { value, update, busy, error } = appearance
  const backgroundInput = useRef<HTMLInputElement>(null)
  return (
    <SettingsSection
      title="Background & motion"
      description="Backgrounds and presentation preferences are saved on this device. Controls retain a theme-colored backing for readability."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Background">
          <Select
            value={value.background}
            onChange={event => update({ background: event.target.value as Appearance['background'] })}
          >
            <option value="none">Theme canvas</option>
            <option value="aurora">Aurora</option>
            <option value="sunset">Sakura sunset</option>
            <option value="paper">Manga paper</option>
            <option value="solid">Solid color</option>
            <option value="gradient">Custom gradient</option>
            <option value="custom" disabled={!appearance.customUrl}>
              Custom image
            </option>
          </Select>
        </Field>
        <div className="flex min-w-0 flex-col gap-2 text-sm font-medium text-muted">
          <span>Custom background image</span>
          <QuietButton className="min-h-11 w-full" disabled={busy} onClick={() => backgroundInput.current?.click()}>
            Upload background image
          </QuietButton>
          <input
            ref={backgroundInput}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp"
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void appearance.image(file)
            }}
          />
        </div>
        {['solid', 'gradient'].includes(value.background) && (
          <Field label="Background color">
            <Input type="color" value={value.color} onChange={event => update({ color: event.target.value })} />
          </Field>
        )}
        {value.background === 'gradient' && (
          <Field label="Second gradient color">
            <Input
              type="color"
              value={value.secondColor}
              onChange={event => update({ secondColor: event.target.value })}
            />
          </Field>
        )}
        <Field label={`Background blur: ${value.blur}px`}>
          <Range min={0} max={24} value={value.blur} onChange={event => update({ blur: Number(event.target.value) })} />
        </Field>
        <Field label={`Background opacity: ${Math.round(value.opacity * 100)}%`}>
          <Range
            min={0}
            max={100}
            value={value.opacity * 100}
            onChange={event => update({ opacity: Number(event.target.value) / 100 })}
          />
        </Field>
        <Field label={`Dark overlay: ${Math.round(value.darkness * 100)}%`}>
          <Range
            min={0}
            max={80}
            value={value.darkness * 100}
            onChange={event => update({ darkness: Number(event.target.value) / 100 })}
          />
        </Field>
        <Field label="Background position">
          <Select
            value={value.position}
            onChange={event => update({ position: event.target.value as Appearance['position'] })}
          >
            {['center', 'top', 'bottom', 'left', 'right'].map(position => (
              <option key={position} value={position}>
                {position}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Background scaling">
          <Select value={value.scale} onChange={event => update({ scale: event.target.value as Appearance['scale'] })}>
            <option value="cover">Cover screen</option>
            <option value="contain">Fit image</option>
            <option value="stretch">Stretch</option>
          </Select>
        </Field>
        <Field label="Animations">
          <Select
            value={value.motion}
            onChange={event => update({ motion: event.target.value as Appearance['motion'] })}
          >
            <option value="system">Follow device preference</option>
            <option value="reduced">Reduced</option>
            <option value="off">Off</option>
          </Select>
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox
            id="luma-splashes"
            checked={value.splashes}
            onChange={event => update({ splashes: event.target.checked })}
          />
          <label htmlFor="luma-splashes" className="text-sm">
            Show app introductions once per session
          </label>
        </div>
      </div>
      {appearance.customUrl && (
        <QuietButton disabled={busy} onClick={() => void appearance.image()}>
          Remove custom background
        </QuietButton>
      )}
      {busy && (
        <p role="status" className="text-sm">
          Preparing background…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </SettingsSection>
  )
}
export function AppIntroduction({ experience, appearance }: { experience: Experience; appearance: Appearance }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(false)
    if (
      !appearance.splashes ||
      appearance.motion !== 'system' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return
    const key = `luma-introduction-${experience}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      return
    }
    setVisible(true)
    const timeout = setTimeout(() => setVisible(false), 900)
    return () => clearTimeout(timeout)
  }, [experience, appearance.splashes, appearance.motion])
  if (!visible) return null
  const Icon = experience === 'gallery' ? Images : experience === 'flick' ? Clapperboard : BookOpen
  const name = experience === 'gallery' ? 'Gallery' : experience === 'flick' ? 'Flick' : 'Panels'
  return (
    <div className={`app-introduction app-introduction-${experience}`} role="status">
      <Icon className="size-7 text-accent" aria-hidden="true" />
      <span className="font-semibold">Luma {name}</span>
      <IconButton label="Dismiss introduction" onClick={() => setVisible(false)}>
        <X className="size-4" />
      </IconButton>
    </div>
  )
}
