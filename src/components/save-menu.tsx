import { css } from '@emotion/react'
import { ListPlus, Plus } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useMutation, useQuery } from 'urql'
import { useLocation } from 'wouter'

import type { PlaylistPrivacy, SavePlaylistsQuery } from '../generated/graphql'

import { gql } from '../generated'
import { useSession } from '../session'
import { readable } from './format'
import { privacyIcon, WATCH_LATER_ID } from './playlist'
import Dialog from './ui/dialog'
import { Menu, MenuItem, MenuSection, MenuSeparator } from './ui/menu'
import { showToast } from './ui/toast'
import { useInfiniteFeed } from './use-infinite-feed'

// no `privacy`: the library feed carries no visibility, and Playlist is keyed by id in graphcache, so it would overwrite what a /playlist read stored
const SAVE_PLAYLISTS_QUERY = gql(`
  query SavePlaylists($cursor: String) {
    playlists(cursor: $cursor) {
      items {
        id
        title
        videoCountText
      }
      cursor
    }
  }
`)

const ADD_TO_PLAYLIST = gql(`
  mutation AddToPlaylist($playlistId: ID!, $videoIds: [ID!]!) {
    addToPlaylist(playlistId: $playlistId, videoIds: $videoIds) {
      id
    }
  }
`)

const CREATE_PLAYLIST = gql(`
  mutation CreatePlaylist($title: String!, $videoIds: [ID!], $privacy: PlaylistPrivacy) {
    createPlaylist(title: $title, videoIds: $videoIds, privacy: $privacy) {
      id
      title
      videoCountText
      privacy
    }
  }
`)

type PlaylistsPage = SavePlaylistsQuery['playlists']

type SaveRow = { id: string, title: string, videoCountText?: string | null, privacy?: string | null }

const triggerStyle = css`
  display: flex;
  align-items: center;
  gap: 0.8rem;
  height: 3.6rem;
  padding: 0 1.6rem;
  border: none;
  border-radius: 1.8rem;
  background: var(--bg-chip);
  color: var(--text-primary);
  font-size: 1.4rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--bg-chip-hover);
  }
`

const panelStyle = css`
  min-width: 28rem;
`

const formStyle = css`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field-label {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .name {
    height: 4rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.4rem;
  }

  .name:focus,
  .privacy:focus {
    outline: none;
    border-color: var(--accent-focus);
  }

  .privacy {
    height: 4rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.4rem;
  }

  .row {
    display: flex;
    justify-content: flex-end;
    gap: 0.8rem;
  }

  .cancel,
  .create {
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .cancel {
    background: transparent;
    color: var(--accent);
  }

  .cancel:hover {
    background: var(--accent-hover);
  }

  /* --accent-inverse is the OPPOSITE theme's accent, meant as a foreground on
     an inverted surface: as a fill here it lands at #3ea6ff in the light theme
     and takes white text to 2.6:1, under the 4.5:1 this size needs. The filled
     pills elsewhere in the app use the inverse PAIR, which stays legible in
     both themes and needs no literal. */
  .create {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .create:not(:disabled):hover {
    background: var(--bg-inverse-hover);
  }

  .create:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

// membership is write-only: nothing upstream reports whether a video is already in a playlist, so a saved row goes inert rather than pretending it can undo
export const SaveMenu = (
  { videoId, align = 'end', class: className }: {
    videoId: string
    align?: 'start' | 'end'
    class?: string
  },
) => {
  const [, navigate] = useLocation()
  const { ready, signedIn } = useSession()
  const [opened, setOpened] = useState(false)
  const [loaded, setLoaded] = useState<PlaylistsPage[]>([])
  const [saved, setSaved] = useState<string[]>([])
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<SaveRow[]>([])
  const [name, setName] = useState('')
  const [privacy, setPrivacy] = useState<PlaylistPrivacy>('PRIVATE')

  const [{ data, error, fetching }] = useQuery({
    query: SAVE_PLAYLISTS_QUERY,
    variables: { cursor: loaded[loaded.length - 1]?.cursor },
    pause: !opened || !ready || !signedIn,
  })
  const [, addToPlaylist] = useMutation(ADD_TO_PLAYLIST)
  const [createState, createPlaylist] = useMutation(CREATE_PLAYLIST)

  const page = data?.playlists
  const { items, cursor } = useInfiniteFeed({
    pages: page ? [...loaded, page] : loaded,
    key: playlist => playlist.id,
  })

  const onMore = () => {
    if (!page?.cursor || fetching || error) return
    setLoaded(loaded[loaded.length - 1] === page ? loaded : [...loaded, page])
  }

  // a created playlist is shown from the mutation result: a refetch would fetch whichever page the cursor is on, not the first one it appears on
  const rows: SaveRow[] = [
    ...created,
    ...items.filter(playlist =>
      playlist.id !== WATCH_LATER_ID && !created.some(row => row.id === playlist.id)),
  ]

  const onSave = (playlistId: string, title: string) => {
    if (pending !== undefined || saved.includes(playlistId)) return
    setPending(playlistId)
    void addToPlaylist({ playlistId, videoIds: [videoId] }).then((result) => {
      setPending(undefined)
      if (result.error) {
        showToast(readable(result.error.message))
        return
      }
      setSaved(ids => [...ids, playlistId])
      showToast(`Saved to ${title}`)
    })
  }

  const onName = (event: Event) => setName((event.currentTarget as HTMLInputElement).value)
  const onPrivacy = (event: Event) =>
    setPrivacy((event.currentTarget as HTMLSelectElement).value as PlaylistPrivacy)

  const onCreate = (event: Event) => {
    event.preventDefault()
    const title = name.trim()
    if (title.length === 0 || createState.fetching) return
    void createPlaylist({ title, videoIds: [videoId], privacy }).then((result) => {
      if (result.error) {
        showToast(readable(result.error.message))
        return
      }
      const playlist = result.data?.createPlaylist
      if (playlist) {
        setCreated(rows => [...rows, playlist])
        setSaved(ids => [...ids, playlist.id])
      }
      setCreating(false)
      setName('')
      showToast(`Saved to ${title}`)
    })
  }

  const triggerBody = () => (
    <>
      <ListPlus size={20} strokeWidth={1.5} />
      Save
    </>
  )

  if (ready && !signedIn) {
    return (
      <button
        type='button'
        css={triggerStyle}
        className={className}
        onClick={() => navigate('/signin')}
      >
        {triggerBody()}
      </button>
    )
  }

  return (
    <>
      <Menu
        label='Save to playlist'
        align={align}
        class={className}
        onOpenChange={(open: boolean) => { if (open) setOpened(true) }}
        trigger={<button type='button' css={triggerStyle}>{triggerBody()}</button>}
      >
        <div css={panelStyle} role='presentation'>
          <MenuSection title='Save video to…'>
            {/* the library aggregation does not reliably list Watch later, and it is filtered back out of the fetched rows below */}
            <MenuItem
              label='Watch later'
              checked={saved.includes(WATCH_LATER_ID)}
              disabled={pending !== undefined || saved.includes(WATCH_LATER_ID)}
              onSelect={() => onSave(WATCH_LATER_ID, 'Watch later')}
            />
            {rows.map(playlist => (
              <MenuItem
                key={playlist.id}
                label={playlist.title}
                detail={playlist.videoCountText ?? undefined}
                trailingIcon={privacyIcon(playlist.privacy)}
                checked={saved.includes(playlist.id)}
                disabled={pending !== undefined || saved.includes(playlist.id)}
                onSelect={() => onSave(playlist.id, playlist.title)}
              />
            ))}
            {/* placeholder rows are menu items rather than bare text so focus has somewhere to land when the panel opens */}
            {fetching && rows.length === 0
              ? <MenuItem label='Loading…' disabled />
              : undefined}
            {error && rows.length === 0
              ? <MenuItem label={readable(error.message)} disabled />
              : undefined}
            {!fetching && !error && rows.length === 0
              ? <MenuItem label='No playlists yet' disabled />
              : undefined}
            {cursor
              ? (
                <MenuItem
                  label={fetching ? 'Loading more…' : 'Show more'}
                  disabled={fetching || Boolean(error)}
                  closeOnSelect={false}
                  onSelect={onMore}
                />
              )
              : undefined}
          </MenuSection>
          <MenuSeparator />
          <MenuItem
            icon={Plus}
            label='Create new playlist'
            disabled={pending !== undefined}
            onSelect={() => setCreating(true)}
          />
        </div>
      </Menu>
      {/* rendered outside the panel so the dialog's own focus trap owns the page alone */}
      {creating
        ? (
          <Dialog title='New playlist' onClose={() => setCreating(false)}>
            <form css={formStyle} onSubmit={onCreate}>
              <label className='field'>
                <span className='field-label'>Name</span>
                <input
                  className='name'
                  type='text'
                  value={name}
                  maxLength={150}
                  placeholder='Enter playlist name'
                  onInput={onName}
                />
              </label>
              {/* creation is the one endpoint that reliably applies privacy, so a wrong choice cannot be corrected from this panel later */}
              <label className='field'>
                <span className='field-label'>Visibility</span>
                <select className='privacy' value={privacy} onChange={onPrivacy}>
                  <option value='PRIVATE'>Private</option>
                  <option value='UNLISTED'>Unlisted</option>
                  <option value='PUBLIC'>Public</option>
                </select>
              </label>
              <div className='row'>
                <button type='button' className='cancel' onClick={() => setCreating(false)}>Cancel</button>
                <button
                  type='submit'
                  className='create'
                  disabled={name.trim().length === 0 || createState.fetching}
                >
                  {createState.fetching ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </Dialog>
        )
        : undefined}
    </>
  )
}

export default SaveMenu
