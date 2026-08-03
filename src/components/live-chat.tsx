import type { TargetedEvent } from 'preact'

import type { LiveChatQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'

import { gql } from '../generated'
import { useSession } from '../session'
import { showToast } from './ui/toast'
import { RichText } from './rich-text'

type ChatPage = LiveChatQuery['liveChat']
type ChatRow = ChatPage['items'][number]
type ChatRun = ChatRow['runs'][number]

const LIVE_CHAT_QUERY = gql(`
  query LiveChat($videoId: ID!, $cursor: String) {
    liveChat(videoId: $videoId, cursor: $cursor) {
      items {
        id
        text
        runs { text url videoId startSeconds browseId emojiUrl emojiLabel }
        timestampText
        isOwner
        isModerator
        isMember
        purchaseAmountText
        headerBackgroundColor
        bodyBackgroundColor
        author { id name avatar handle }
      }
      cursor
      removedIds
      disabled
    }
  }
`)

const SEND_LIVE_CHAT = gql(`
  mutation SendLiveChatMessage($videoId: ID!, $text: String!) {
    sendLiveChatMessage(videoId: $videoId, text: $text)
  }
`)

const TRANSCRIPT_LIMIT = 250

const PINNED_SLACK_PX = 40

const styles = css`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  background: var(--surface);
  overflow: hidden;
  /* Tall enough to be worth reading, short enough to leave the related rail
     visible underneath on a normal window. */
  height: 42rem;

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 1rem 1.2rem;
    border-bottom: 1px solid var(--border);
    font-size: 1.4rem;
    font-weight: 500;
  }

  .log {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.6rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .row {
    display: grid;
    grid-template-columns: 2.4rem 1fr;
    gap: 0.8rem;
    padding: 0.4rem 1.2rem;
    font-size: 1.3rem;
    line-height: 1.4;
  }

  .row img.avatar {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    grid-row: 1 / span 2;
  }

  .who {
    color: var(--text-secondary);
    font-weight: 500;
    margin-right: 0.6rem;
  }

  .who.owner { color: #ffd600; }
  .who.moderator { color: #5e84f1; }
  .who.member { color: #2ba640; }

  /* A paid message is a coloured card rather than a line, which is the whole
     point of paying for it. */
  .row.paid {
    display: block;
    margin: 0.4rem 1.2rem;
    padding: 0;
    border-radius: 0.8rem;
    overflow: hidden;
  }

  .row.paid .paid-head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    font-weight: 600;
  }

  .row.paid .paid-body {
    padding: 0.8rem 1rem;
  }

  .row.paid .paid-body:empty { display: none; }

  .emoji {
    display: inline-block;
    width: 1.8rem;
    height: 1.8rem;
    vertical-align: -0.35rem;
  }

  .compose {
    display: flex;
    gap: 0.8rem;
    align-items: center;
    padding: 0.8rem 1.2rem;
    border-top: 1px solid var(--border);
  }

  .compose input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    color: inherit;
    font: inherit;
    font-size: 1.3rem;
    padding: 0.4rem 0;
  }

  .compose input:focus {
    outline: none;
    border-bottom-color: var(--text);
  }

  .compose button {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: 1.3rem;
    font-weight: 500;
    padding: 0.4rem 0.8rem;
    border-radius: 1.6rem;
  }

  .compose button:disabled { opacity: 0.5; cursor: default; }

  .notice {
    padding: 1.6rem 1.2rem;
    color: var(--text-secondary);
    font-size: 1.3rem;
    text-align: center;
  }

  .resume {
    border: none;
    background: var(--text);
    color: var(--surface);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    padding: 0.5rem 1rem;
    margin: 0 1.2rem 0.8rem;
    border-radius: 1.6rem;
    cursor: pointer;
  }
`

const ChatLine = ({ message }: { message: ChatRow }) => {
  const badge = message.isOwner
    ? 'owner'
    : message.isModerator
      ? 'moderator'
      : message.isMember
        ? 'member'
        : ''
  const body = (
    <RichText
      runs={message.runs}
      renderRun={(run: ChatRun, key: string) => (run.emojiUrl
        ? <img key={key} className='emoji' src={run.emojiUrl} alt={run.emojiLabel ?? ''} loading='lazy' />
        : undefined)}
    />
  )
  if (message.purchaseAmountText) {
    return (
      <div className='row paid'>
        <div
          className='paid-head'
          style={{ background: message.headerBackgroundColor ?? '#1565c0', color: '#fff' }}
        >
          {message.author?.avatar ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' /> : undefined}
          <span>{message.author?.name}</span>
          <span style={{ marginLeft: 'auto' }}>{message.purchaseAmountText}</span>
        </div>
        <div className='paid-body' style={{ background: message.bodyBackgroundColor ?? '#1976d2', color: '#fff' }}>
          {body}
        </div>
      </div>
    )
  }
  return (
    <div className='row'>
      {message.author?.avatar
        ? <img className='avatar' src={message.author.avatar} alt='' loading='lazy' />
        : <span className='avatar' />}
      <div>
        <span className={`who ${badge}`} title={message.timestampText ?? undefined}>{message.author?.name}</span>
        {body}
      </div>
    </div>
  )
}

export const LiveChat = ({ videoId }: { videoId: string }) => {
  const { ready, signedIn } = useSession()
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<ChatRow[]>([])
  const [ended, setEnded] = useState(false)
  const [draft, setDraft] = useState('')
  const [pinned, setPinned] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  const [, send] = useMutation(SEND_LIVE_CHAT)

  /* the server parks each request until something arrives, so the cursor chain IS the poll: no interval belongs here */
  const [{ data, error }, reexecute] = useQuery({
    query: LIVE_CHAT_QUERY,
    variables: { videoId, cursor },
    pause: ended,
  })

  const page = data?.liveChat

  const attemptRef = useRef(0)
  useEffect(() => {
    if (!error || ended) {
      if (!error) attemptRef.current = 0
      return
    }
    const delay = Math.min(8_000, 500 * 2 ** attemptRef.current)
    attemptRef.current += 1
    const timer = setTimeout(() => reexecute({ requestPolicy: 'network-only' }), delay)
    return () => clearTimeout(timer)
  }, [error, ended, reexecute])

  useEffect(() => {
    if (!page) return
    const removed = new Set(page.removedIds ?? [])
    if (page.items.length || removed.size) {
      setMessages((current) => {
        const next = removed.size
          ? current.filter((message) => !removed.has(message.id))
          : current
        // ids repeat when urql replays a cursor on remount
        const seen = new Set(next.map((message) => message.id))
        const added = page.items.filter((message) => !seen.has(message.id) && !removed.has(message.id))
        const grown = added.length ? [...next, ...added] : next
        return grown.length > TRANSCRIPT_LIMIT ? grown.slice(grown.length - TRANSCRIPT_LIMIT) : grown
      })
    }
    if (!page.cursor) setEnded(true)
    else if (page.cursor !== cursor) setCursor(page.cursor)
  }, [page])

  useEffect(() => {
    const log = logRef.current
    if (!log || !pinned) return
    log.scrollTop = log.scrollHeight
  }, [messages, pinned])

  const onScroll = () => {
    const log = logRef.current
    if (!log) return
    setPinned(log.scrollHeight - log.scrollTop - log.clientHeight <= PINNED_SLACK_PX)
  }

  const submit = async (event: TargetedEvent<HTMLFormElement, Event>) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    const result = await send({ videoId, text })
    if (result.error) {
      showToast(result.error.graphQLErrors[0]?.message ?? 'Could not send that message')
      setDraft(text)
    }
  }

  if (page?.disabled) {
    return <div css={styles}><div className='notice'>Live chat is turned off for this stream.</div></div>
  }

  return (
    <div css={styles}>
      <div className='head'>
        <span>Live chat</span>
        {ended ? <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>Ended</span> : undefined}
      </div>
      <div className='log' ref={logRef} onScroll={onScroll}>
        {messages.length === 0
          ? (
            <div className='notice'>
              {error ? 'Reconnecting to live chat…' : 'Waiting for messages…'}
            </div>
          )
          : messages.map((message) => <ChatLine key={message.id} message={message} />)}
      </div>
      {!pinned && messages.length > 0
        ? <button type='button' className='resume' onClick={() => setPinned(true)}>Jump to latest</button>
        : undefined}
      {ready && signedIn && !ended
        ? (
          <form className='compose' onSubmit={submit}>
            <input
              value={draft}
              maxLength={200}
              placeholder='Chat…'
              onInput={(event: TargetedEvent<HTMLInputElement, Event>) => setDraft(event.currentTarget.value)}
            />
            <button type='submit' disabled={!draft.trim()}>Send</button>
          </form>
        )
        : undefined}
    </div>
  )
}

export default LiveChat
