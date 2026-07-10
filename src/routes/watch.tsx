const WatchPage = ({ params }: { params: { videoId: string } }) => (
  <main>
    <h1>Watch {params.videoId}</h1>
    <p>The playback engine will mount here.</p>
  </main>
)

export default WatchPage
