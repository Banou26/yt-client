import type { NotificationsQuery } from '../generated/graphql'

import { css } from '@emotion/react'
import { Bell } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { useLocation } from 'wouter'

import { gql } from '../generated'
import { useSession } from '../session'
import { readable } from './format'
import { Menu, MenuItem } from './ui/menu'
import { showToast } from './ui/toast'
import { useInfiniteFeed } from './use-infinite-feed'
import { watchHrefFor } from './video-card'

type NotificationPage = NotificationsQuery['notifications']

const NOTIFICATIONS_QUERY = gql(`
  query Notifications($cursor: String) {
    notifications(cursor: $cursor) {
      items {
        id
        message
        sentText
        avatar
        thumbnail
        videoId
        read
      }
      cursor
    }
  }
`)

const UNSEEN_COUNT_QUERY = gql(`
  query UnseenNotificationCount {
    unseenNotificationCount
  }
`)

const MARK_READ = gql(`
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id)
  }
`)

/* Every poll is a tunneled round trip on EVERY page, so this is deliberately
   slow. The panel itself fetches on open, which is the only moment a precise
   count matters; the badge just has to be roughly right. */
const POLL_MS = 5 * 60_000

const style = css`
  .bell {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4rem;
    height: 4rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .bell:hover {
    background: var(--bg-hover);
  }

  .badge {
    position: absolute;
    top: 0.4rem;
    right: 0.4rem;
    min-width: 1.6rem;
    height: 1.6rem;
    padding: 0 0.4rem;
    border-radius: 0.8rem;
    background: var(--brand-red);
    color: #fff;
    font-size: 1.1rem;
    line-height: 1.6rem;
    text-align: center;
  }
`

const panelStyle = css`
  width: 40rem;
  max-width: 90vw;
  max-height: 70vh;
  overflow-y: auto;

  .row {
    display: flex;
    gap: 1.2rem;
    width: 100%;
    text-align: left;
  }

  .row-avatar {
    flex: none;
    width: 4rem;
    height: 4rem;
    border-radius: 50%;
    object-fit: cover;
    background: var(--bg-chip);
  }

  .row-body {
    flex: 1;
    min-width: 0;
  }

  .row-message {
    font-size: 1.3rem;
    line-height: 1.8rem;
    color: var(--text-primary);
  }

  .row-time {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .row-thumb {
    flex: none;
    width: 8rem;
    aspect-ratio: 16 / 9;
    border-radius: 0.4rem;
    object-fit: cover;
    background: var(--bg-chip);
  }

  /* An unread row is marked by a dot rather than a background wash: the panel
     is a menu, and a filled row would fight the focus highlight. */
  .unread {
    position: relative;
    padding-left: 1rem;
  }

  .unread::before {
    content: '';
    position: absolute;
    left: 0;
    top: 1.6rem;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    background: var(--accent);
  }
`

export const NotificationsMenu = () => {
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState<NotificationPage[]>([])
  const [, markRead] = useMutation(MARK_READ)

  const [{ data: countData }, refetchCount] = useQuery({
    query: UNSEEN_COUNT_QUERY,
    pause: !ready || !signedIn,
  })

  useEffect(() => {
    if (!ready || !signedIn) return
    // Paused while the tab is hidden: a backgrounded tab polling every five
    // minutes forever is a round trip nobody is waiting for.
    const tick = () => {
      if (!document.hidden) refetchCount({ requestPolicy: 'network-only' })
    }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ready, signedIn, refetchCount])

  const [{ data, error, fetching }] = useQuery({
    query: NOTIFICATIONS_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    // The list costs a round trip and is only worth it once the panel is open.
    pause: !open || !ready || !signedIn,
  })
  const page = data?.notifications
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: notification => notification.id,
  })

  if (ready && !signedIn) return null

  const unseen = countData?.unseenNotificationCount ?? 0

  const onSelect = (id: string, videoId?: string | null) => {
    void markRead({ id }).then((result) => {
      if (result.error) showToast(readable(result.error.message))
    })
    if (videoId) navigate(watchHrefFor(videoId))
  }

  return (
    <div css={style}>
      <Menu
        label='Notifications'
        align='end'
        panelClass={panelStyle.name}
        onOpenChange={setOpen}
        trigger={
          <button type='button' className='bell' aria-label='Notifications'>
            <Bell size={24} strokeWidth={1.5} />
            {unseen > 0 ? <span className='badge'>{unseen > 99 ? '99+' : unseen}</span> : undefined}
          </button>
        }
      >
        {fetching && items.length === 0 ? <MenuItem label='Loading…' disabled /> : undefined}
        {error && items.length === 0 ? <MenuItem label={readable(error.message)} disabled /> : undefined}
        {!fetching && !error && items.length === 0
          ? <MenuItem label='No notifications' disabled />
          : undefined}
        {items.map(notification => (
          <MenuItem
            key={notification.id}
            onSelect={() => onSelect(notification.id, notification.videoId)}
            ariaLabel={notification.message}
            label={
              <span className={notification.read ? 'row' : 'row unread'}>
                {notification.avatar
                  ? <img className='row-avatar' src={notification.avatar} alt='' loading='lazy' />
                  : <span className='row-avatar' aria-hidden='true' />}
                <span className='row-body'>
                  <span className='row-message'>{notification.message}</span>
                  {notification.sentText ? <span className='row-time'>{notification.sentText}</span> : undefined}
                </span>
                {notification.thumbnail
                  ? <img className='row-thumb' src={notification.thumbnail} alt='' loading='lazy' />
                  : undefined}
              </span>
            }
          />
        ))}
        {cursor && !fetching
          ? (
            <MenuItem
              label='Show more'
              closeOnSelect={false}
              onSelect={() => setLoaded(loaded[loaded.length - 1] === page ? loaded : [...loaded, page!])}
            />
          )
          : undefined}
      </Menu>
    </div>
  )
}

export default NotificationsMenu
