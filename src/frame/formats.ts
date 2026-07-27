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

// Which formats the SABR session is willing to serve.
//
// Video always passes. Audio is narrowed to ONE logical track, because the
// player has no audio-track selector yet and the session must not offer a
// dubbing the viewer did not ask for.
//
// The narrowing keys off the semantic flags, NOT off the presence of `xtags`.
// On a video with auto-dubbing, YouTube tags EVERY audio format, including the
// original: the English track carries `acont=original` and the dubbings carry
// `acont=dubbed-auto`. Rejecting anything with xtags therefore threw away all
// 80 audio formats of a 17-language video and left the session with nothing,
// surfacing as "youtube: no supported audio and video formats". Only DRC,
// dubbed, and descriptive variants are actually unwanted.
export const isPlayableFormat = (format: AdaptiveFormat) => {
  if (!format.has_audio || format.has_video) return true
  return !format.is_drc && !format.is_dubbed && !format.is_auto_dubbed && !format.is_descriptive
}
