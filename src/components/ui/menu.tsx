import type { ComponentChildren, FunctionComponent, RefObject, VNode } from 'preact'

import { css } from '@emotion/react'
import { Square, SquareCheck } from 'lucide-react'
import { cloneElement, createContext } from 'preact'
import { useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'

import { Popup, useDismiss } from './popup'

type IconComponent = FunctionComponent<{ size?: number, strokeWidth?: number }>

// Widened past role=menuitem deliberately: whichever role a row picks it still has to be found by the navigation query.
const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'

const TYPEAHEAD_RESET_MS = 500

type MenuControls = {
  close: () => void
}

const MenuContext = createContext<MenuControls | undefined>(undefined)

export type MenuTriggerProps = {
  ref: RefObject<HTMLButtonElement | null>
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  onClick: () => void
}

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
  const entry = useRef<'first' | 'last'>('first')
  const typeahead = useRef({ buffer: '', at: 0 })
  const notify = useRef(onOpenChange)
  notify.current = onOpenChange

  const change = useCallback((next: boolean) => {
    setOpen(next)
    notify.current?.(next)
  }, [])

  const onClose = useCallback(() => change(false), [change])
  useDismiss({ open, onClose, rootRef, triggerRef })

  const close = useCallback(() => {
    change(false)
    triggerRef.current?.focus()
  }, [change])

  const items = () => [...(rootRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])]

  const focusAt = (index: number) => {
    const list = items()
    if (list.length === 0) return
    list[((index % list.length) + list.length) % list.length]?.focus()
  }

  const step = (delta: number) => {
    const list = items()
    const from = list.indexOf(document.activeElement as HTMLElement)
    focusAt(from === -1 ? (delta > 0 ? 0 : -1) : from + delta)
  }

  useLayoutEffect(() => {
    if (!open) return
    focusAt(entry.current === 'last' ? -1 : 0)
  }, [open])

  const onKeyDown = (event: KeyboardEvent) => {
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
      if (items().length === 0) return
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
      return
    }
    /* Enter and Space are absent on purpose: every row is a real <button>, so handling them here would fire the row twice. */
    if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) return
    const now = Date.now()
    const buffer = now - typeahead.current.at > TYPEAHEAD_RESET_MS
      ? event.key.toLowerCase()
      : typeahead.current.buffer + event.key.toLowerCase()
    typeahead.current = { buffer, at: now }
    const list = items()
    if (list.length === 0) return
    const from = list.indexOf(document.activeElement as HTMLElement)
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
      entry.current = 'first'
      change(!open)
    },
  }

  return (
    /* The wrapper MUST contain the trigger: useDismiss bails on a pointerdown inside this subtree, and a trigger outside it would close the panel and reopen it on the same click. */
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
  const dismisses = closeOnSelect ?? checked === undefined

  return (
    <button
      type='button'
      css={itemStyle}
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      // aria-disabled rather than the disabled attribute: a disabled button cannot take focus, so the row would drop out of arrow-key navigation.
      aria-disabled={disabled ? 'true' : undefined}
      tabIndex={-1}
      aria-label={typeof label === 'string' ? undefined : ariaLabel}
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
