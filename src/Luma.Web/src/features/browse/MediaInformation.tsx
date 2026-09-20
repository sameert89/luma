import type { Media } from './api'

export function MediaInformation({ item }: { item: Media }) {
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <div className="col-span-2">
        <dt className="text-muted">Name</dt>
        <dd className="break-words">{item.fileName}</dd>
      </div>
      <div>
        <dt className="text-muted">Modified</dt>
        <dd>{new Date(item.modifiedAt).toLocaleString()}</dd>
      </div>
      <div>
        <dt className="text-muted">File size</dt>
        <dd>{(item.sizeBytes / 1024 / 1024).toFixed(2)} MB</dd>
      </div>
      {item.width && item.height && (
        <div>
          <dt className="text-muted">Dimensions</dt>
          <dd>
            {item.width} × {item.height}
          </dd>
        </div>
      )}
      {item.mediaType === 'video' && (
        <div>
          <dt className="text-muted">Video</dt>
          <dd>{item.durationMs ? `${(item.durationMs / 1000).toFixed(1)} seconds` : 'Duration unknown'}</dd>
        </div>
      )}
    </dl>
  )
}
