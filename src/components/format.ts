const compactNumber = new Intl.NumberFormat('en', { notation: 'compact' })

// wouter already decodeURI-s the pathname, so params can hold a literal '%' that makes decodeURIComponent throw
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

// urql prefixes a GraphQL error message with its kind ('[GraphQL] ')
export const readable = (message: string) => message.replace(/^\[\w+]\s*/, '')

// YouTube's `t` parameter is minted both as a bare count of seconds ('90', '90s') and in the compound form ('1h2m3s')
export const parseStartSeconds = (value: string | null | undefined) => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+s?$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10)
    return Number.isFinite(seconds) ? seconds : undefined
  }
  const compound = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!compound || compound[0] === '') return undefined
  const [, hours, minutes, seconds] = compound
  // all three groups are optional, so a string of pure letters matches with every group empty
  if (hours === undefined && minutes === undefined && seconds === undefined) return undefined
  return Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)
}
