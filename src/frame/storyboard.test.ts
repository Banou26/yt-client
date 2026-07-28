import { describe, expect, it } from 'vite-plus/test'

import { bestStoryboard, parseStoryboards, storyboardFrame } from './storyboard'

// Shape of a real player-response storyboard spec: a base URL carrying $L/$N/$M
// placeholders, then one segment per level.
const SPEC = 'https://i.ytimg.com/sb/abc/storyboard3_L$L/$N.jpg?sqp=x'
  + '|48#27#100#10#10#1000#M$M#rs$a'
  + '|80#45#100#5#5#1000#M$M#rs$b'
  + '|160#90#100#5#5#1000#M$M#rs$c'

describe('parseStoryboards', () => {
  it('returns one board per level with the level index substituted', () => {
    const boards = parseStoryboards(SPEC)
    expect(boards).toHaveLength(3)
    expect(boards[0]!.templateUrl).toContain('storyboard3_L0')
    expect(boards[2]!.templateUrl).toContain('storyboard3_L2')
  })

  it('writes each level its own sigh signature', () => {
    const boards = parseStoryboards(SPEC)
    expect(boards[0]!.templateUrl).toContain('sigh=rs%24a')
    expect(boards[2]!.templateUrl).toContain('sigh=rs%24c')
  })

  it('derives the sheet count from the tile grid', () => {
    const boards = parseStoryboards(SPEC)
    // 100 tiles at 10x10 per sheet is one sheet; at 5x5 it is four.
    expect(boards[0]!.sheetCount).toBe(1)
    expect(boards[1]!.sheetCount).toBe(4)
  })

  it('tolerates a missing or malformed spec instead of throwing', () => {
    expect(parseStoryboards(undefined)).toEqual([])
    expect(parseStoryboards('')).toEqual([])
    expect(parseStoryboards('not a url|48#27#100#10#10#1000#M$M#rs')).toEqual([])
    // A level with nonsense numbers is dropped, the rest survive.
    expect(parseStoryboards('https://i.ytimg.com/sb/x.jpg|a#b#c#d#e#f#g#h')).toEqual([])
  })
})

describe('bestStoryboard', () => {
  it('picks the widest level', () => {
    expect(bestStoryboard(parseStoryboards(SPEC))?.thumbnailWidth).toBe(160)
  })

  it('returns undefined when there are no boards', () => {
    expect(bestStoryboard([])).toBeUndefined()
  })
})

describe('storyboardFrame', () => {
  const board = bestStoryboard(parseStoryboards(SPEC))!

  it('maps the start of the video to the first tile of the first sheet', () => {
    expect(storyboardFrame(board, 0)).toMatchObject({ x: 0, y: 0, width: 160, height: 90 })
    expect(storyboardFrame(board, 0)?.url).toContain('M0')
  })

  it('walks across a row then down', () => {
    // 1s interval, 5 columns: second 1 is column 1, second 5 wraps to row 1.
    expect(storyboardFrame(board, 1)).toMatchObject({ x: 160, y: 0 })
    expect(storyboardFrame(board, 5)).toMatchObject({ x: 0, y: 90 })
  })

  it('rolls onto the next sheet past the tiles one sheet holds', () => {
    // 5x5 = 25 tiles per sheet, so second 25 is the first tile of sheet 1.
    const frame = storyboardFrame(board, 25)
    expect(frame?.url).toContain('M1')
    expect(frame).toMatchObject({ x: 0, y: 0 })
  })

  it('clamps past the end rather than pointing at a tile that does not exist', () => {
    const frame = storyboardFrame(board, 10_000)
    // 100 tiles, 25 per sheet, so the last tile is sheet 3 bottom-right.
    expect(frame?.url).toContain('M3')
    expect(frame).toMatchObject({ x: 160 * 4, y: 90 * 4 })
  })

  it('rejects a nonsensical position', () => {
    expect(storyboardFrame(board, -1)).toBeUndefined()
    expect(storyboardFrame(board, Number.NaN)).toBeUndefined()
  })
})
