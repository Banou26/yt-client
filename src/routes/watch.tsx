import { useQuery } from 'urql'

import { gql } from '../generated'
import VideoPlayer from '../player/video-player'

const VideoQuery = gql(`
  query Video($id: ID!) {
    video(id: $id) {
      id
      title
      description
      channel { id name }
    }
  }
`)

const WatchPage = ({ params }: { params: { videoId: string } }) => {
  const [{ data, error }] = useQuery({ query: VideoQuery, variables: { id: params.videoId } })
  return (
    <main>
      <VideoPlayer videoId={params.videoId} />
      <h1>{data?.video?.title ?? params.videoId}</h1>
      {error ? <p>{error.message}</p> : null}
      {data?.video?.description ? <p>{data.video.description}</p> : null}
    </main>
  )
}

export default WatchPage
