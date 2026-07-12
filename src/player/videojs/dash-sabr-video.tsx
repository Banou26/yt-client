import { forwardRef } from 'react'
import type { ReactNode, Ref } from 'react'
import { useAttachMedia, useComposedRefs, useMediaInstance } from '@videojs/react'

import { DashSabrMedia, dashSabrMediaDefaultProps } from './dash-sabr-media'

// useSyncProps isn't a public @videojs/react export; inline the same behaviour —
// assign known props to the media instance, pass the rest through to the <video>.
const syncProps = (
  target: Record<string, unknown>,
  props: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> => {
  const rest: Record<string, unknown> = {}
  for (const key in props) {
    if (key in defaults) {
      const value = props[key] === undefined ? defaults[key] : props[key]
      if (target[key] !== value) target[key] = value
    } else {
      rest[key] = props[key]
    }
  }
  return rest
}

type DashSabrVideoProps = {
  src: string
  startTime?: number
  onError?: (error: unknown) => void
  children?: ReactNode
}

// A @videojs/core media-engine provider backed by DashSabrMedia (dash.js + the
// SABR-via-frame bridge). `src` is a YouTube videoId — the engine fetches the
// session and builds the manifest itself.
export const DashSabrVideo = forwardRef(function DashSabrVideo(
  { children, ...props }: DashSabrVideoProps,
  ref: Ref<HTMLVideoElement>,
) {
  const media = useMediaInstance(DashSabrMedia as never)
  return (
    <video
      ref={useComposedRefs(useAttachMedia(media as never), ref)}
      controls
      playsInline
      preload="auto"
      {...syncProps(media as never, props, dashSabrMediaDefaultProps)}
    >
      {children}
    </video>
  )
})
