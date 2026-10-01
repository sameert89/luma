import { Field, Select } from '../../components/ui/Controls'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { setReelsSort, useReelsSort, type ReelsSortChoice } from './reelsSort'

const options: { id: ReelsSortChoice; name: string }[] = [
  { id: 'library', name: 'Same as the library' },
  { id: 'modified', name: 'Modified date' },
  { id: 'captured', name: 'Captured date' },
  { id: 'name', name: 'Name' },
  { id: 'type', name: 'Type' },
  { id: 'size', name: 'Size' },
  { id: 'shuffle', name: 'Shuffle' },
]

export function ReelsSortSettings() {
  const value = useReelsSort()
  // Direction means nothing for a shuffle, or when the library's own order is kept.
  const directed = value.sort !== 'library' && value.sort !== 'shuffle'
  return (
    <SettingsSection title="Reels" description="Choose the order Reels opens in on this device.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Default order">
          <Select
            value={value.sort}
            onChange={event => setReelsSort({ ...value, sort: event.target.value as ReelsSortChoice })}
          >
            {options.map(option => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default direction">
          <Select
            value={value.order}
            disabled={!directed}
            onChange={event => setReelsSort({ ...value, order: event.target.value === 'asc' ? 'asc' : 'desc' })}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </Select>
        </Field>
      </div>
      <p className="text-sm leading-relaxed text-muted">
        Applies each time you open Reels. You can still change the order from Filters while you watch, and Watch on
        Reels from a photo or video keeps the order you were browsing in, so it carries on from that item.
      </p>
    </SettingsSection>
  )
}
