import type { ComponentChildren, FunctionComponent, RefObject, VNode } from 'preact'

import { css } from '@emotion/react'
import { Square, SquareCheck } from 'lucide-react'
import { cloneElement, createContext } from 'preact'
import { useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'

import { Popup, useDismiss } from './popup'

/* popup.tsx already owns the panel chrome and both dismissals (outside
   pointerdown, Escape with focus restore), so none of that is repeated here.
   What it has no opinion about is the keyboard: its rows are plain buttons left
   in the natural tab order, which a screen reader reads as N separate stops
   instead of one composite widget, and nothing ever moves focus into the panel.

   This layer adds the missing half of the menu pattern on top of it: the
   trigger advertises the panel it owns, focus lands on a row when the panel
   opens, the arrows plus Home/End walk the rows, typing jumps to one, and Tab
   cannot wander out of an open menu. */

type IconComponent = FunctionComponent<{ size?: number, strokeWidth?: number }>

// Widened past role=menuitem deliberately: aria-checked only means something on
// a menuitemcheckbox/menuitemradio, and whichever role a row picks it still has
// to be found by the navigation query.
const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'

// Long enough to type a word at speed, short enough that a pause starts a fresh
// search instead of extending a stale one.
const TYPEAHEAD_RESET_MS = 500

type MenuControls = {
  /**
   * Closes the panel and puts focus back on the trigger. Selecting a row is a
   * keyboard round trip: the row unmounts on the same tick, so without this
   * focus falls to <body> and tab order restarts from the top of the document.
   */
  close: () => void
}

/* The one seam a stacked panel (the YouTube settings-menu pattern: root ->
   Quality -> back) will need. It stays a context rather than props threaded
   through the rows so adding push/pop later changes this type and Menu only,
   never a MenuItem call site. */
const MenuContext = createContext<MenuControls | undefined>(undefined)

/**
 * Everything the trigger must carry. It is injected into the caller's own
 * markup rather than wrapped in a button of our own: the five triggers this has
 * to serve (two card overflow buttons, the comments sort pill, the watch action
 * button, the header settings ellipsis) share no styling at all.
 *
 * `ref` is what anchors the panel and what Escape returns focus to, so it
 * cannot be dropped.
 */
export type MenuTriggerProps = {
  ref: RefObject<HTMLButtonElement | null>
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  onClick: () => void
}

/**
 * Pass the trigger element itself and the props above are cloned onto it:
 *
 *   trigger={<button type='button' className='more' aria-label='More actions'>…</button>}
 *
 * A `css` prop on that element is fine: emotion wraps it in a forwardRef
 * component, and the injected ref reaches the button either way.
 *
 * The render-prop form stays available for a trigger that has to compose the
 * props itself, but it costs an annotation at the call site
 * (`(props: MenuTriggerProps) => …`): this project's JSX factory does not
 * contextually type a function passed as a component prop, so an unannotated
 * parameter trips noImplicitAny. Element form for anything that does not need
 * it. A trigger that wants to look different while the panel is up can style
 * off its own `aria-expanded` attribute or off the wrapper's `data-open`.
 */
type MenuTrigger = VNode | ((props: MenuTriggerProps) => ComponentChildren)

const rootStyle = css`
  position: relative;
  display: flex;
  align-items: center;
  flex: none;
`

export const Menu = (
  { trigger, children, label, align = 'end', class: className, panelClass, onOpenChange }: {
    trigger: MenuTrigger
    children: ComponentChildren
    label: string
    align?: 'start' | 'end'
    class?: string
    panelClass?: string
    onOpenChange?: (open: boolean) => void
  },
) => {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Which end of the list takes focus when the panel appears: ArrowUp opens
  // onto the last row, every other way in onto the first.
  const entry = useRef<'first' | 'last'>('first')
  const typeahead = useRef({ buffer: '', at: 0 })
  // Reassigned every render instead of captured: useDismiss re-arms its
  // document listeners whenever onClose changes identity, so the notifier has
  // to be reachable from a callback whose identity never does.
  const notify = useRef(onOpenChange)
  notify.current = onOpenChange

  const change = useCallback((next: boolean) => {
    setOpen(next)
    notify.current?.(next)
  }, [])

  // No focus restore here on purpose. This is the outside-pointerdown path, and
  // focus belongs wherever the user just clicked; Escape restores the trigger
  // itself, inside useDismiss.
  const onClose = useCallback(() => change(false), [change])
  useDismiss({ open, onClose, rootRef, triggerRef })

  const close = useCallback(() => {
    change(false)
    triggerRef.current?.focus()
  }, [change])

  /* Rows are read off the DOM rather than registered through the context: a row
     can sit inside a MenuSection, behind a fragment, or be appended by a query
     that resolved after the panel opened, and a registration list would have to
     stay ordered through all three. The query is rooted at the wrapper (not the
     panel) because the trigger lives in there too and shares this key handler,
     and the trigger is not a menuitem so it never matches. A future nested
     panel is the one case that breaks it: it will need scoping to the panel
     that is currently on top. */
  const items = () => [...(rootRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])]

  const focusAt = (index: number) => {
    const list = items()
    if (list.length === 0) return
    // Wraps both ways, so -1 is the last row: that is what End wants and what
    // ArrowUp on a closed menu wants.
    list[((index % list.length) + list.length) % list.length]?.focus()
  }

  const step = (delta: number) => {
    const list = items()
    // Focus still on the trigger means nothing in the panel has it yet, so an
    // arrow enters the list at the near end rather than stepping from nowhere.
    const from = list.indexOf(document.activeElement as HTMLElement)
    focusAt(from === -1 ? (delta > 0 ? 0 : -1) : from + delta)
  }

  // Layout effect so the row takes focus before paint: a frame with the panel
  // up and focus still on the trigger is a frame where the arrows do the wrong
  // thing. A panel whose rows arrive later (an async list) simply has nothing
  // to focus yet, and the trigger branch of the arrow handler covers it.
  useLayoutEffect(() => {
    if (!open) return
    focusAt(entry.current === 'last' ? -1 : 0)
  }, [open])

  const onKeyDown = (event: KeyboardEvent) => {
    // A form control inside the panel owns its own keys: the arrows move a
    // caret, Home and End jump within the value, and letters are text rather
    // than a row to jump to. Escape still closes, from useDismiss.
    const tag = (event.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        entry.current = event.key === 'ArrowUp' ? 'last' : 'first'
        change(true)
        return
      }
      step(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (!open) return
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      focusAt(event.key === 'Home' ? 0 : -1)
      return
    }
    if (event.key === 'Tab') {
      // Tabbing out would strand an open panel with focus somewhere else on the
      // page. The panel is one widget, so Tab walks it and Escape is the exit.
      // An empty panel is left alone: trapping there is a focus black hole.
      if (items().length === 0) return
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
      return
    }
    /* Enter and Space are absent on purpose. Every row is a real <button>, so
       the browser already turns both into a click, and handling them here would
       fire the row twice. That is also why Space is kept out of typeahead. */
    if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) return
    const now = Date.now()
    const buffer = now - typeahead.current.at > TYPEAHEAD_RESET_MS
      ? event.key.toLowerCase()
      : typeahead.current.buffer + event.key.toLowerCase()
    typeahead.current = { buffer, at: now }
    const list = items()
    if (list.length === 0) return
    const from = list.indexOf(document.activeElement as HTMLElement)
    // One repeated letter walks the rows that start with it; a longer buffer
    // starts at the current row so the word being typed keeps matching it.
    const start = buffer.length === 1 ? from + 1 : Math.max(from, 0)
    const match = list
      .map((_, offset) => list[(start + offset + list.length) % list.length]!)
      .find(item => (item.dataset.menuLabel ?? item.textContent ?? '').trim().toLowerCase().startsWith(buffer))
    if (!match) return
    event.preventDefault()
    match.focus()
  }

  const controls = useMemo(() => ({ close }), [close])
  const triggerProps: MenuTriggerProps = {
    ref: triggerRef,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: () => {
      // Reset, or an ArrowUp open would leave every later click opening onto
      // the last row.
      entry.current = 'first'
      change(!open)
    },
  }

  return (
    /* The wrapper is the positioning anchor Popup needs (it is absolute and
       owns none), and it MUST contain the trigger: useDismiss bails on a
       pointerdown inside this subtree, and a trigger outside it would close the
       panel and reopen it on the same click. data-open is exposed for the cards,
       whose overflow button is opacity 0 until hover and has to stay visible
       while its own menu is up. */
    <div
      css={rootStyle}
      className={className}
      ref={rootRef}
      data-open={open ? 'true' : undefined}
      onKeyDown={onKeyDown}
    >
      {typeof trigger === 'function' ? trigger(triggerProps) : cloneElement(trigger, triggerProps)}
      {open
        ? (
          <MenuContext.Provider value={controls}>
            <Popup label={label} align={align} class={panelClass}>{children}</Popup>
          </MenuContext.Provider>
        )
        : undefined}
    </div>
  )
}

const itemStyle = css`
  width: 100%;
  min-height: 4rem;
  display: flex;
  align-items: center;
  gap: 1.6rem;
  padding: 0 1.6rem;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 1.4rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;

  > svg {
    flex: none;
  }

  &:hover:not([aria-disabled='true']),
  &:focus-visible {
    background: var(--bg-hover);
  }

  &[aria-disabled='true'] {
    opacity: 0.5;
    cursor: default;
  }

  .label {
    flex: 1;
    min-width: 0;
  }

  .detail {
    color: var(--text-secondary);
    white-space: nowrap;
  }
`

export const MenuItem = (
  { icon: Icon, label, detail, checked, disabled, trailingIcon: TrailingIcon, closeOnSelect, onSelect, ariaLabel }: {
    icon?: IconComponent
    /* Usually a string, but a row is allowed to be richer: the notifications
       panel renders an avatar, a message and a still. `ariaLabel` is what a
       non-string row is announced as, since the accessible name can no longer
       be derived from the text. */
    label: ComponentChildren
    detail?: string
    checked?: boolean
    disabled?: boolean
    trailingIcon?: IconComponent
    closeOnSelect?: boolean
    onSelect?: () => void
    ariaLabel?: string
  },
) => {
  const menu = useContext(MenuContext)
  // A checkable row keeps the panel up by default, because ticking three
  // playlists in one pass is the whole point of the save panel. A command row
  // closes it, the way a menu is expected to behave.
  const dismisses = closeOnSelect ?? checked === undefined

  return (
    <button
      type='button'
      css={itemStyle}
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      // aria-disabled rather than the disabled attribute: a disabled button
      // cannot take focus, so the row would drop out of arrow-key navigation
      // and a keyboard user would never learn the action exists.
      aria-disabled={disabled ? 'true' : undefined}
      // Focus inside the panel is managed, so no row is a tab stop of its own.
      tabIndex={-1}
      // A row whose label is not a string has no text to derive a name from,
      // so it carries an explicit one.
      aria-label={typeof label === 'string' ? undefined : ariaLabel}
      // Typeahead matches this rather than the rendered text, so a trailing
      // count ("12 videos") can never become part of what the user types. A
      // rich label would stringify to '[object Object]' here, so it falls back
      // to the explicit name.
      data-menu-label={typeof label === 'string' ? label : ariaLabel}
      onClick={() => {
        if (disabled) return
        onSelect?.()
        if (dismisses) menu?.close()
      }}
    >
      {checked === undefined
        ? (Icon ? <Icon size={20} strokeWidth={1.5} /> : undefined)
        : checked
          ? <SquareCheck size={20} strokeWidth={1.5} />
          : <Square size={20} strokeWidth={1.5} />}
      <span className='label'>{label}</span>
      {detail ? <span className='detail'>{detail}</span> : undefined}
      {TrailingIcon ? <TrailingIcon size={16} strokeWidth={1.5} /> : undefined}
    </button>
  )
}

const sectionStyle = css`
  .section-title {
    padding: 0.8rem 1.6rem 0.4rem;
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--text-secondary);
  }
`

export const MenuSection = (
  { title, children }: { title: string, children: ComponentChildren },
) => {
  // Labelled by the heading that is already on screen rather than by an
  // aria-label, so what a screen reader announces and what the user reads
  // cannot drift apart.
  const id = useId()

  return (
    <div css={sectionStyle} role='group' aria-labelledby={id}>
      <div className='section-title' id={id}>{title}</div>
      {children}
    </div>
  )
}

const separatorStyle = css`
  height: 1px;
  margin: 0.8rem 0;
  background: var(--border-subtle);
`

export const MenuSeparator = () => <div css={separatorStyle} role='separator' />

export default Menu
