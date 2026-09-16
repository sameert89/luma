import { useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/Button'
import { Checkbox, Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { request, type Filters, type Tag } from './api'

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return <fieldset className="space-y-3"><legend className="pb-2 text-sm font-semibold text-ink">{title}</legend>{children}</fieldset>
}

export function FilterForm({ value, onApply }: { value: Filters; onApply: (filters: Filters) => void }) {
  const [draft, setDraft] = useState<Filters>(value)
  const [tag, setTag] = useState('')
  const recursiveId = useId()
  const suggestions = useQuery({ queryKey: ['tags', 'filter', tag], queryFn: ({ signal }) => request<Tag[]>(`/api/tags?prefix=${encodeURIComponent(tag)}`, signal), enabled: !!tag.trim(), gcTime: 0 })
  function set(key: keyof Filters, val: string | number | boolean | undefined) { setDraft(old => ({ ...old, [key]: val })) }
  const number = (key: keyof Filters, label: string, min = 0, step = '1') => <Field key={key} label={label}><Input type="number" min={min} step={step} value={String(draft[key] ?? '')} onChange={event => set(key, event.target.value === '' ? undefined : Number(event.target.value))} /></Field>
  const text = (key: keyof Filters, label: string, placeholder?: string) => <Field key={key} label={label}><Input maxLength={200} placeholder={placeholder} value={String(draft[key] ?? '')} onChange={event => set(key, event.target.value || undefined)} /></Field>
  const twoColumns = 'grid grid-cols-1 gap-3 sm:grid-cols-2'
  return <form className="flex min-h-0 min-w-0 flex-col" onSubmit={event => { event.preventDefault(); onApply(draft) }}><div className="min-w-0 space-y-6 p-5">
    <FilterSection title="Media"><div className={twoColumns}>
      <Field label="Media type"><Select value={draft.mediaType ?? ''} onChange={event => set('mediaType', event.target.value || undefined)}><option value="">Photos and videos</option><option value="image">Photos</option><option value="video">Videos</option></Select></Field>
      <Field label="Orientation"><Select value={draft.orientation ?? ''} onChange={event => set('orientation', event.target.value || undefined)}><option value="">Any orientation</option><option>landscape</option><option>portrait</option><option>square</option></Select></Field>
      <Field label="Favourite state"><Select value={draft.preference ?? ''} onChange={event => set('preference', event.target.value || undefined)}><option value="">Any item</option><option value="liked">Favourites</option><option value="disliked">Hidden</option><option value="neutral">Unrated</option></Select></Field>
      <Field label="Tag state"><Select value={draft.tagged === undefined ? '' : String(draft.tagged)} onChange={event => set('tagged', event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">Any item</option><option value="true">Tagged</option><option value="false">Untagged</option></Select></Field>
    </div></FilterSection>
    <FilterSection title="Location and name"><div className={twoColumns}>{text('path', 'Path contains')}{text('startsWith', 'Name starts with')}{text('endsWith', 'Name ends with')}<Field label="Extensions"><Input value={draft.extension?.join(', ') ?? ''} placeholder="jpg, png, mp4" onChange={event => setDraft(old => ({ ...old, extension: event.target.value.split(',').map(x => x.trim()).filter(Boolean) }))} /></Field></div>
      <label htmlFor={recursiveId} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-muted"><Checkbox id={recursiveId} checked={draft.recursive ?? false} onChange={event => set('recursive', event.target.checked)} />Include subfolders</label>
    </FilterSection>
    <FilterSection title="Date"><div className={twoColumns}><Field label="From (UTC)"><Input type="datetime-local" value={draft.dateFrom?.slice(0, 16) ?? ''} onChange={event => set('dateFrom', event.target.value ? `${event.target.value}:00Z` : undefined)} /></Field><Field label="Before (UTC)"><Input type="datetime-local" value={draft.dateTo?.slice(0, 16) ?? ''} onChange={event => set('dateTo', event.target.value ? `${event.target.value}:00Z` : undefined)} /></Field></div></FilterSection>
    <details className="rounded-2xl bg-surface p-4"><summary className="cursor-pointer text-sm font-semibold">Size and dimensions</summary><div className={`mt-4 ${twoColumns}`}>{number('minSizeBytes', 'Minimum size (bytes)')}{number('maxSizeBytes', 'Maximum size (bytes)')}{number('minWidth', 'Minimum width', 1)}{number('minHeight', 'Minimum height', 1)}{number('width', 'Exact width', 1)}{number('height', 'Exact height', 1)}{number('minAspectRatio', 'Minimum aspect ratio', 0.01, 'any')}{number('maxAspectRatio', 'Maximum aspect ratio', 0.01, 'any')}</div></details>
    <FilterSection title="Tags"><Field label="Find a tag"><Input value={tag} onChange={event => setTag(event.target.value)} placeholder="Search existing tags" /></Field>{tag && <ul className="mt-3 flex flex-wrap gap-2" aria-label="Matching tags">{suggestions.data?.map(item => <li key={item.id}><QuietButton className="min-h-9" onClick={() => { setDraft(old => ({ ...old, tagged: undefined, tag: [...new Set([...(old.tag ?? []), item.name])] })); setTag('') }}>{item.name}</QuietButton></li>)}</ul>}<div className="flex flex-wrap gap-2">{draft.tag?.map(name => <QuietButton key={name} className="min-h-9" aria-label={`Remove filter tag ${name}`} onClick={() => setDraft(old => ({ ...old, tag: old.tag?.filter(x => x !== name) }))}>{name} ×</QuietButton>)}</div></FilterSection>
    </div><div className="flex shrink-0 gap-3 border-t border-line bg-canvas px-5 py-4"><Button type="submit">Apply filters</Button><QuietButton onClick={() => onApply({ libraryId: value.libraryId, folderId: value.folderId })}>Reset</QuietButton></div>
  </form>
}
