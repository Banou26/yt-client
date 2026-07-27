const compactNumber = new Intl.NumberFormat('en', { notation: 'compact' })

// wouter already decodeURI-s the pathname, so params can hold a literal '%'
// that makes decodeURIComponent throw: fall back to the raw value.
export const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const formatViews = (viewCount?: string | null) => {
  if (!viewCount) return undefined
  if (!/^\d+$/.test(viewCount)) return viewCount
  return `${compactNumber.format(Number(viewCount))} views`
}

export const formatDuration = (seconds?: number | null) => {
  // 0 means "no duration" (live streams), not a zero-length video
  if (seconds === undefined || seconds === null || seconds <= 0) return undefined
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return (
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
      : `${minutes}:${String(rest).padStart(2, '0')}`
  )
}

export const formatMeta = (viewCount?: string | null, publishedText?: string | null) => {
  const parts = [formatViews(viewCount), publishedText ?? undefined].filter(part => part !== undefined)
  return parts.length > 0 ? parts.join(' • ') : undefined
}

// urql prefixes a GraphQL error message with its kind ('[GraphQL] '), and the
// source's own sentence is the only part of that the user can act on. Shared
// rather than redeclared per surface: every route and panel that shows an error
// had grown its own copy of this line.
export const readable = (message: string) => message.replace(/^\[\w+]\s*/, '')
