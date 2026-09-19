import type { CSSProperties } from 'react'

// Pastels stay deliberately light in every theme. A stable hash makes a tag's colour
// feel random without changing between renders, browsers or places where it is shown.
const tones = [
  ['#ffe4e6', '#9f1239', '#fda4af'],
  ['#ffedd5', '#9a3412', '#fdba74'],
  ['#fef3c7', '#92400e', '#fcd34d'],
  ['#ecfccb', '#3f6212', '#bef264'],
  ['#d1fae5', '#065f46', '#6ee7b7'],
  ['#cffafe', '#155e75', '#67e8f9'],
  ['#e0f2fe', '#075985', '#7dd3fc'],
  ['#e0e7ff', '#3730a3', '#a5b4fc'],
  ['#ede9fe', '#5b21b6', '#c4b5fd'],
  ['#fae8ff', '#86198f', '#f0abfc'],
] as const

export function tagToneIndex(name: string) {
  let hash = 2166136261
  for (const character of name.trim().normalize('NFC').toUpperCase()) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % tones.length
}

export function tagTone(name: string): CSSProperties {
  const [background, foreground, border] = tones[tagToneIndex(name)]
  return { '--tag-background': background, '--tag-foreground': foreground, '--tag-border': border } as CSSProperties
}
