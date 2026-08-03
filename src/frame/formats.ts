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

const isUnwantedAudio = (format: AdaptiveFormat) =>
  Boolean(format.is_drc || format.is_dubbed || format.is_auto_dubbed || format.is_descriptive)

// set-aware, not per-format: auto-dubbed videos tag EVERY audio format, and the `vb=1` siblings 403 on every segment
export const playableFormats = <Format extends AdaptiveFormat>(formats: Format[]): Format[] => {
  const audio = formats.filter((format) => isAudioOnly(format) && !isUnwantedAudio(format))
  const untagged = audio.filter((format) => !format.xtags)
  const originals = audio.filter((format) => format.is_original)
  const preferred = untagged.length > 0 ? untagged : originals.length > 0 ? originals : audio
  // identity set, so the caller's ordering survives: the SABR session picks its starting track by position
  const keep = new Set<Format>(preferred)
  return formats.filter((format) => !isAudioOnly(format) || keep.has(format))
}
