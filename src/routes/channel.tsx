import { useQuery } from 'urql'

import { VideoGrid } from '../components/video-grid'
import { gql } from '../generated'

const ChannelQuery = gql(`
  query Channel($id: ID!) {
    channel(id: $id) {
      channel { id name avatar }
      videos {
        items {
          id
          title
          thumbnail
          channel { id name }
        }
      }
    }
  }
`)

const ChannelPage = ({ params }: { params: { channelId: string } }) => {
  const [{ data, error }] = useQuery({ query: ChannelQuery, variables: { id: params.channelId } })
  return (
    <main>
      <h1>{data?.channel.channel.name ?? params.channelId}</h1>
      {error ? <p>{error.message}</p> : null}
      <VideoGrid videos={data?.channel.videos.items ?? []} />
    </main>
  )
}

export default ChannelPage
