import { t } from '../../lib/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { QuietButton } from '../../components/ui/Controls'
import { SettingsSection } from '../../components/ui/SettingsSection'
import { errorMessage, request } from './api'
import type { components } from '../../lib/api/generated'

type HiddenFolder = components['schemas']['HiddenFolderSummary']

export const hiddenFolderQueries = [
  ['folders'],
  ['media'],
  ['libraries'],
  ['hidden-folders'],
  ['reels-first'],
  ['reels-neighbors'],
  ['neighbors'],
]

export function HiddenFolders() {
  const client = useQueryClient()
  const hidden = useQuery({
    queryKey: ['hidden-folders'],
    queryFn: ({ signal }) => request<HiddenFolder[]>('/api/folders/hidden', signal),
  })
  const show = useMutation({
    mutationFn: (id: number) => request(`/api/folders/${id}/hidden`, undefined, 'PUT', { hidden: false }),
    onSuccess: () => {
      for (const queryKey of hiddenFolderQueries) void client.invalidateQueries({ queryKey })
    },
  })
  return (
    <SettingsSection
      title={t('browse:hiddenFolders.hiddenFolders')}
      description={t('browse:hiddenFolders.hiddenFoldersAndEverythingInsideThemAreLeftOut')}
    >
      {hidden.isPending && (
        <p role="status" className="text-sm text-muted">
          {t('browse:hiddenFolders.loadingHiddenFolders')}
        </p>
      )}
      {hidden.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(hidden.error)}
        </p>
      )}
      {hidden.data?.length === 0 && (
        <p className="text-sm text-muted">{t('browse:hiddenFolders.noFoldersAreHidden')}</p>
      )}
      {!!hidden.data?.length && (
        <ul className="divide-y divide-line">
          {hidden.data.map(folder => (
            <li key={folder.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={folder.path}>
                  {folder.path}
                </p>
                <p className="truncate text-xs text-muted">{folder.libraryName}</p>
              </div>
              <QuietButton
                aria-label={t('browse:hiddenFolders.show', { value1: folder.path })}
                disabled={show.isPending}
                onClick={() => show.mutate(folder.id)}
              >
                <Eye className="size-4" />
                {t('browse:hiddenFolders.show2')}
              </QuietButton>
            </li>
          ))}
        </ul>
      )}
      {show.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(show.error)}
        </p>
      )}
    </SettingsSection>
  )
}
