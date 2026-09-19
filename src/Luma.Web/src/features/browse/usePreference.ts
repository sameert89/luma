import { useMutation, useQueryClient } from '@tanstack/react-query'
import { request, type Media } from './api'

export type Preference = 'liked' | 'disliked' | 'neutral'

/**
 * Likes and dislikes apply at once: the item's detail is updated optimistically, requests run one
 * at a time in tap order (so the last tap wins), and only a request that still fails after its busy
 * retries restores the previous value and reports an error.
 */
export function usePreference() {
  const client = useQueryClient()
  return useMutation({
    scope: { id: 'media-preference' },
    mutationFn: ({ id, value }: { id: number; value: Preference }) => request(`/api/media/${id}/preference`, undefined, 'PUT', { preference: value }),
    onMutate: async ({ id, value }) => {
      await client.cancelQueries({ queryKey: ['detail', id] })
      const previous = client.getQueryData<Media>(['detail', id])
      if (previous) client.setQueryData<Media>(['detail', id], { ...previous, preference: value })
      return { previous }
    },
    onError: (_error, { id }, context) => { if (context?.previous) client.setQueryData(['detail', id], context.previous) },
    onSettled: (_result, _error, { id }) => Promise.all([client.invalidateQueries({ queryKey: ['detail', id] }),
      client.invalidateQueries({ queryKey: ['media'] }), client.invalidateQueries({ queryKey: ['neighbors'] })]),
  })
}
