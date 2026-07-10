import { css } from '@emotion/react'
import { useQuery } from 'urql'

import { gql } from '../generated'
import { VideoGrid } from '../components/video-grid'

const HomeQuery = gql(`
  query Home {
    home {
      items {
        id
        title
        thumbnail
        channel { id name }
      }
    }
  }
`)

const heading = css`
  margin: 0 0 24px;
  font-size: clamp(2rem, 5vw, 4.6rem);
  line-height: 0.95;
  letter-spacing: -0.05em;
`

const HomePage = () => {
  const [{ data, error, fetching }] = useQuery({ query: HomeQuery })
  return (
    <main>
      <h1 css={heading}>Your lightweight YouTube client.</h1>
      {error ? <p>{error.message}</p> : null}
      {fetching && !data ? <p>Loading...</p> : null}
      <VideoGrid videos={data?.home.items ?? []} />
    </main>
  )
}

export default HomePage
