import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/Button'
import { Field, Input, QuietButton, Select } from '../../components/ui/Controls'
import { request, type Filters, type Tag } from './api'

export function FilterForm({ value, onApply }: { value: Filters; onApply: (filters: Filters) => void }) {
  const [draft, setDraft] = useState<Filters>(value)
  const [tag, setTag] = useState('')
  const suggestions = useQuery({ queryKey: ['tags', 'filter', tag], queryFn: ({ signal }) => request<Tag[]>(`/api/tags?prefix=${encodeURIComponent(tag)}`, signal), enabled: !!tag.trim(), gcTime: 0 })
  function set(key: keyof Filters, val: string | number | boolean | undefined) { setDraft(old => ({ ...old, [key]: val })) }
  const number = (key: keyof Filters, label: string, min = 0, step = '1') => <Field key={key} label={label}><Input type="number" min={min} step={step} value={String(draft[key] ?? '')} onChange={event => set(key, event.target.value === '' ? undefined : Number(event.target.value))} /></Field>
  const text = (key: keyof Filters, label: string, placeholder?: string) => <Field key={key} label={label}><Input maxLength={200} placeholder={placeholder} value={String(draft[key] ?? '')} onChange={event => set(key, event.target.value || undefined)} /></Field>
  return <form className="space-y-5 overflow-auto p-5" onSubmit={event => { event.preventDefault(); onApply(draft) }}>
    <div className="grid grid-cols-2 gap-4">
      <Field label="Media type"><Select value={draft.mediaType ?? ''} onChange={event => set('mediaType', event.target.value || undefined)}><option value="">Photos and videos</option><option value="image">Photos</option><option value="video">Videos</option></Select></Field>
      <Field label="Preference"><Select value={draft.preference ?? ''} onChange={event => set('preference', event.target.value || undefined)}><option value="">Any preference</option><option value="liked">Liked</option><option value="disliked">Disliked</option><option value="neutral">Neutral</option></Select></Field>
      <Field label="Orientation"><Select value={draft.orientation ?? ''} onChange={event => set('orientation', event.target.value || undefined)}><option value="">Any orientation</option><option>landscape</option><option>portrait</option><option>square</option></Select></Field>
      <Field label="Availability"><Select value={draft.availability ?? 'present'} onChange={event => set('availability', event.target.value)}><option value="present">Present</option><option value="missing">Missing</option><option value="all">All records</option></Select></Field>
      {text('path', 'Path contains')}{text('startsWith', 'Name starts with')}{text('endsWith', 'Name ends with')}
      <Field label="Extensions"><Input value={draft.extension?.join(', ') ?? ''} placeholder="jpg, png, mp4" onChange={event => setDraft(old => ({ ...old, extension: event.target.value.split(',').map(x => x.trim()).filter(Boolean) }))} /></Field>
      <Field label="Captured/modified from"><Input type="datetime-local" value={draft.dateFrom?.slice(0, 16) ?? ''} onChange={event => set('dateFrom', event.target.value ? `${event.target.value}:00Z` : undefined)} /></Field>
      <Field label="Before (exclusive, UTC)"><Input type="datetime-local" value={draft.dateTo?.slice(0, 16) ?? ''} onChange={event => set('dateTo', event.target.value ? `${event.target.value}:00Z` : undefined)} /></Field>
      {number('minSizeBytes', 'Minimum size (bytes)')}{number('maxSizeBytes', 'Maximum size (bytes)')}
      {number('minWidth', 'Minimum width', 1)}{number('minHeight', 'Minimum height', 1)}{number('width', 'Exact width', 1)}{number('height', 'Exact height', 1)}
      {number('minAspectRatio', 'Minimum aspect ratio', 0.01, 'any')}{number('maxAspectRatio', 'Maximum aspect ratio', 0.01, 'any')}
      <Field label="Tag presence"><Select value={draft.tagged === undefined ? '' : String(draft.tagged)} onChange={event => set('tagged', event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">Any</option><option value="true">Tagged</option><option value="false">Untagged</option></Select></Field>
      <Field label="Match tags"><Select value={draft.tagMode ?? 'all'} onChange={event => set('tagMode', event.target.value)}><option value="all">All selected tags</option><option value="any">Any selected tag</option></Select></Field>
    </div>
    <Field label="Filter by tag"><Input value={tag} onChange={event => setTag(event.target.value)} placeholder="Find an existing tag" /></Field>
    {tag && <ul className="flex flex-wrap gap-2" aria-label="Matching tags">{suggestions.data?.map(item => <li key={item.id}><QuietButton onClick={() => { setDraft(old => ({ ...old, tagged: undefined, tag: [...new Set([...(old.tag ?? []), item.name])] })); setTag('') }}>{item.name}</QuietButton></li>)}</ul>}
    <div className="flex flex-wrap gap-2">{draft.tag?.map(name => <QuietButton key={name} aria-label={`Remove filter tag ${name}`} onClick={() => setDraft(old => ({ ...old, tag: old.tag?.filter(x => x !== name) }))}>{name} ×</QuietButton>)}</div>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.recursive ?? false} onChange={event => set('recursive', event.target.checked)} />Include subfolders</label>
    <div className="flex gap-3"><Button type="submit">Apply filters</Button><QuietButton onClick={() => onApply({ libraryId: value.libraryId, folderId: value.folderId })}>Clear filters</QuietButton></div>
  </form>
}
