export type Storyboard = {
  // Sheet URL with the sheet index still to be substituted for $M.
  templateUrl: string
  thumbnailWidth: number
  thumbnailHeight: number
  thumbnailCount: number
  intervalMs: number
  columns: number
  rows: number
  sheetCount: number
}

export type StoryboardFrame = {
  url: string
  x: number
  y: number
  width: number
  height: number
}

// The player response ships every storyboard level in one pipe-delimited spec:
// a base URL, then one segment per level. Each segment is
// width#height#count#columns#rows#interval#name#sigh, where `sigh` is a
// per-level signature that has to be written back onto the base URL, and $L/$N
// in the base stand for the level index and its name.
export const parseStoryboards = (spec: string | undefined): Storyboard[] => {
  if (!spec) return []
  const parts = spec.split('|')
  const base = parts.shift()
  if (!base) return []
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return []
  }
  return parts.flatMap((part, level) => {
    const [width, height, count, columns, rows, interval, name, sigh] = part.split('#')
    const thumbnailWidth = Number(width)
    const thumbnailHeight = Number(height)
    const thumbnailCount = Number(count)
    const columnCount = Number(columns)
    const rowCount = Number(rows)
    const intervalMs = Number(interval)
    if ([thumbnailWidth, thumbnailHeight, thumbnailCount, columnCount, rowCount, intervalMs]
      .some((value) => !Number.isFinite(value) || value <= 0)) return []
    if (sigh) url.searchParams.set('sigh', sigh)
    return [{
      templateUrl: url.toString().replace('$L', String(level)).replace('$N', name ?? ''),
      thumbnailWidth,
      thumbnailHeight,
      thumbnailCount,
      intervalMs,
      columns: columnCount,
      rows: rowCount,
      sheetCount: Math.ceil(thumbnailCount / (columnCount * rowCount)),
    }]
  })
}

// Levels run smallest to largest; the hover preview wants the sharpest one.
export const bestStoryboard = (boards: Storyboard[]) =>
  boards.reduce<Storyboard | undefined>(
    (best, board) => (!best || board.thumbnailWidth > best.thumbnailWidth ? board : best),
    undefined,
  )

// Maps a playhead position onto one tile of one sheet. Returns the sprite
// offsets rather than an image, so the caller can render it with a single
// background-position and never decode more than one sheet per hover.
export const storyboardFrame = (board: Storyboard, seconds: number): StoryboardFrame | undefined => {
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  const perSheet = board.columns * board.rows
  const index = Math.min(board.thumbnailCount - 1, Math.floor((seconds * 1_000) / board.intervalMs))
  if (index < 0) return undefined
  const sheet = Math.floor(index / perSheet)
  const position = index % perSheet
  return {
    url: board.templateUrl.replace('$M', String(sheet)),
    x: (position % board.columns) * board.thumbnailWidth,
    y: Math.floor(position / board.columns) * board.thumbnailHeight,
    width: board.thumbnailWidth,
    height: board.thumbnailHeight,
  }
}
