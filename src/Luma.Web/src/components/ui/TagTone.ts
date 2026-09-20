import type { CSSProperties } from 'react'

// A translucent wash preserves the surrounding theme while a stable hash gives each
// tag a distinct accent that does not change between renders, browsers or locations.
const tones = [
  '#fb7185',
  '#fb923c',
  '#fbbf24',
  '#a3e635',
  '#34d399',
  '#22d3ee',
  '#38bdf8',
  '#818cf8',
  '#a78bfa',
  '#e879f9',
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
  return { '--tag-accent': tones[tagToneIndex(name)] } as CSSProperties
}
