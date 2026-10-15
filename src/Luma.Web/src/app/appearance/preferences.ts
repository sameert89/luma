export type Appearance = {
  background: 'none' | 'aurora' | 'sunset' | 'paper' | 'solid' | 'gradient' | 'custom'
  color: string
  secondColor: string
  blur: number
  opacity: number
  darkness: number
  position: 'center' | 'top' | 'bottom' | 'left' | 'right'
  scale: 'cover' | 'contain' | 'stretch'
  motion: 'system' | 'reduced' | 'off'
  splashes: boolean
}
export const defaults: Appearance = {
  background: 'none',
  color: '#33254f',
  secondColor: '#153b51',
  blur: 0,
  opacity: 0.7,
  darkness: 0.1,
  position: 'center',
  scale: 'cover',
  motion: 'system',
  splashes: true,
}
const choice = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback
const number = (value: unknown, maximum: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(maximum, value)) : fallback
const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback
export function sanitizeAppearance(value: Partial<Appearance> | null): Appearance {
  return {
    background: choice(
      value?.background,
      ['none', 'aurora', 'sunset', 'paper', 'solid', 'gradient', 'custom'],
      defaults.background,
    ),
    color: color(value?.color, defaults.color),
    secondColor: color(value?.secondColor, defaults.secondColor),
    blur: number(value?.blur, 24, defaults.blur),
    opacity: number(value?.opacity, 1, defaults.opacity),
    darkness: number(value?.darkness, 0.8, defaults.darkness),
    position: choice(value?.position, ['center', 'top', 'bottom', 'left', 'right'], defaults.position),
    scale: choice(value?.scale, ['cover', 'contain', 'stretch'], defaults.scale),
    motion: choice(value?.motion, ['system', 'reduced', 'off'], defaults.motion),
    splashes: typeof value?.splashes === 'boolean' ? value.splashes : defaults.splashes,
  }
}
export function readAppearance(): Appearance {
  try {
    return sanitizeAppearance(JSON.parse(localStorage.getItem('luma-appearance-v2') ?? 'null'))
  } catch {
    return { ...defaults }
  }
}
export const backgrounds: Record<string, string> = {
  aurora:
    'radial-gradient(ellipse at 20% 30%, #a981cc, transparent 60%), radial-gradient(ellipse at 80% 70%, #388f95, transparent 65%), linear-gradient(135deg, #19152f, #132b3a)',
  sunset:
    'radial-gradient(ellipse at 70% 20%, #ffcc93, transparent 55%), linear-gradient(150deg, #7c4277, #d87885, #edbb8b)',
  paper: 'repeating-linear-gradient(135deg, #bcb3a0 0px, #bcb3a0 1px, #e5dfcf 1px, #e5dfcf 12px)',
}
export function backgroundImage(value: Appearance, customUrl: string | null) {
  if (value.background === 'custom') return customUrl ? `url("${customUrl}")` : undefined
  if (value.background === 'solid') return `linear-gradient(${value.color}, ${value.color})`
  if (value.background === 'gradient') return `linear-gradient(135deg, ${value.color}, ${value.secondColor})`
  return backgrounds[value.background]
}
