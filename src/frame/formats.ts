// Structural subset of a youtubei.js adaptive format: only what the playability
// decision reads.
export type AdaptiveFormat = {
  has_audio?: boolean
  has_video?: boolean
  xtags?: string
  is_drc?: boolean
  is_dubbed?: boolean
  is_auto_dubbed?: boolean
  is_descriptive?: boolean
  is_original?: boolean
}

const isAudioOnly = (format: AdaptiveFormat) => Boolean(format.has_audio) && !format.has_video

// Variants the viewer never asked for: a dubbing, a described track, or a
// dynamic-range-compressed mix.
const isUnwantedAudio = (format: AdaptiveFormat) =>
  Boolean(format.is_drc || format.is_dubbed || format.is_auto_dubbed || format.is_descriptive)

// Which formats the SABR session may advertise.
//
// Video always passes. Audio is narrowed to ONE logical track, because the
// player has no audio-track selector yet, and because the manifest must only
// offer what the server will actually serve.
//
// The narrowing is set-aware rather than per-format, and that matters twice:
//
//   - Keying off the presence of `xtags` alone is wrong. On an auto-dubbed
//     video YouTube tags EVERY audio format, the original included
//     (`acont=original`), so rejecting tagged formats threw away all 80 audio
//     formats of a 17-language video and playback failed with
//     "no supported audio and video formats".
//
//   - Keeping every tagged format is also wrong. An ordinary video ships a
//     plain track PLUS processed siblings that differ only by xtags (`vb=1`,
//     the volume-boosted mix). Those are not independently servable: letting
//     them into the manifest lets the player select one and every segment
//     request for it comes back 403.
//
// So: prefer the untagged tracks when the video has them, which is the common
// case and exactly what shipped before; fall back to the tagged originals only
// when there is no untagged track at all.
export const playableFormats = <Format extends AdaptiveFormat>(formats: Format[]): Format[] => {
  const audio = formats.filter((format) => isAudioOnly(format) && !isUnwantedAudio(format))
  const untagged = audio.filter((format) => !format.xtags)
  const originals = audio.filter((format) => format.is_original)
  const preferred = untagged.length > 0 ? untagged : originals.length > 0 ? originals : audio
  // Identity set rather than a rebuilt array, so the caller's original ordering
  // survives: the SABR session picks its starting track by position.
  const keep = new Set<Format>(preferred)
  return formats.filter((format) => !isAudioOnly(format) || keep.has(format))
}
