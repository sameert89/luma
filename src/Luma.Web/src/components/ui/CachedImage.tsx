import { useEffect, useState } from 'react'
import { ImageOff, RefreshCw } from 'lucide-react'
import { QuietButton } from './Controls'

// placeholder: a small image painted behind the full one (letterboxed the same way) while it loads.
export function CachedImage({ url, alt, status = 'ready', className = '', preview = false, placeholder }: { url: string; alt: string; status?: string; className?: string; preview?: boolean; placeholder?: string }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!failed || attempt >= 10) return
    const timeout = window.setTimeout(() => { setAttempt(value => value + 1); setFailed(false) }, attempt < 3 ? 3000 : 30000)
    return () => window.clearTimeout(timeout)
  }, [failed, attempt])
  if (status === 'pending' || status === 'failed') return <div className={`flex items-center justify-center bg-surface text-center text-xs text-muted ${className}`}>
    {status === 'failed' ? 'Preview could not be prepared' : 'Preparing preview…'}
  </div>
  if (failed) return <div className={`flex flex-col items-center justify-center gap-3 bg-surface text-center text-muted ${className}`}>
    <ImageOff className="size-8" aria-hidden="true" />
    <span className="text-xs">Preview unavailable</span>
    {preview && <QuietButton onClick={() => { setAttempt(x => x + 1); setFailed(false) }}><RefreshCw className="size-4" />Retry preview</QuietButton>}
  </div>
  const behind = placeholder ? { backgroundImage: `url("${placeholder}")`, backgroundSize: className.includes('object-cover') ? 'cover' : 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : undefined
  return <img draggable={false} key={attempt} src={url} alt={alt} loading={preview ? 'eager' : 'lazy'} decoding="async" className={className} style={behind} onError={() => setFailed(true)} />
}
