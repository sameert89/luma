import { useState } from 'react'
import { ImageOff, RefreshCw } from 'lucide-react'
import { QuietButton } from './Controls'

export function CachedImage({ url, alt, className = '', preview = false }: { url: string; alt: string; className?: string; preview?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  if (failed) return <div className={`flex flex-col items-center justify-center gap-3 bg-surface text-center text-muted ${className}`}>
    <ImageOff className="size-8" aria-hidden="true" />
    <span className="text-xs">Preview unavailable</span>
    {preview && <QuietButton onClick={() => { setAttempt(x => x + 1); setFailed(false) }}><RefreshCw className="size-4" />Retry preview</QuietButton>}
  </div>
  return <img key={attempt} src={url} alt={alt} loading={preview ? 'eager' : 'lazy'} decoding="async" className={className} onError={() => setFailed(true)} />
}
