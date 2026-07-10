import { useQuery } from 'urql'

import { gql } from '../generated'
import { VideoGrid } from '../components/video-grid'

const SearchQuery = gql(`
  query Search($query: String!) {
    search(query: $query) {
      items {
        id
        title
        thumbnail
        channel { id name }
      }
    }
  }
`)

const SearchPage = ({ params }: { params: { query: string } }) => {
  const query = decodeURIComponent(params.query)
  const [{ data, error, fetching }] = useQuery({ query: SearchQuery, variables: { query } })
  return (
    <main>
      <h1>Results for {query}</h1>
      {error ? <p>{error.message}</p> : null}
      {fetching && !data ? <p>Loading...</p> : null}
      <VideoGrid videos={data?.search.items ?? []} />
    </main>
  )
}

export default SearchPage
