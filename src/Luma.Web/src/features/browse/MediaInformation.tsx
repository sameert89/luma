import { t } from '../../lib/i18n'
import type { Media } from './api'

export function MediaInformation({ item }: { item: Media }) {
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm">
      <div className="col-span-2">
        <dt className="text-muted">{t('browse:mediaInformation.name')}</dt>
        <dd className="break-words">{item.fileName}</dd>
      </div>
      <div>
        <dt className="text-muted">{t('browse:mediaInformation.modified')}</dt>
        <dd>{new Date(item.modifiedAt).toLocaleString()}</dd>
      </div>
      <div>
        <dt className="text-muted">{t('browse:mediaInformation.fileSize')}</dt>
        <dd>
          {t('browse:mediaInformation.mB', {
            itemSizeBytes10241024ToFixed2: (item.sizeBytes / 1024 / 1024).toFixed(2),
          })}
        </dd>
      </div>
      {item.width && item.height && (
        <div>
          <dt className="text-muted">{t('browse:mediaInformation.dimensions')}</dt>
          <dd>
            {item.width} × {item.height}
          </dd>
        </div>
      )}
      {item.mediaType === 'video' && (
        <div>
          <dt className="text-muted">{t('browse:mediaInformation.video')}</dt>
          <dd>
            {item.durationMs
              ? `${(item.durationMs / 1000).toFixed(1)} seconds`
              : t('browse:mediaInformation.durationUnknown')}
          </dd>
        </div>
      )}
    </dl>
  )
}
