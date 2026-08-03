import type { ComponentChildren, FunctionComponent, RefObject } from 'preact'

import { css } from '@emotion/react'
import { useEffect } from 'preact/hooks'

export const useDismiss = (
  { open, onClose, rootRef, triggerRef }: {
    open: boolean
    onClose: () => void
    rootRef: RefObject<HTMLElement | null>
    triggerRef?: RefObject<HTMLElement | null>
  },
) => {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
      triggerRef?.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, rootRef, triggerRef])
}

const popupStyle = css`
  position: absolute;
  top: calc(100% + 0.8rem);
  min-width: 20rem;
  max-height: 70vh;
  padding: 0.8rem 0;
  overflow-y: auto;
  border-radius: 1.2rem;
  background: var(--bg-menu);
  box-shadow: var(--shadow-menu);
  z-index: var(--z-popup);

  &.align-end {
    right: 0;
  }

  &.align-start {
    left: 0;
  }
`

export const Popup = (
  { align = 'end', label, children, class: className }:
  { align?: 'start' | 'end', label: string, children: ComponentChildren, class?: string },
) => (
  <div
    css={popupStyle}
    className={[`align-${align}`, className].filter(part => part !== undefined).join(' ')}
    role='menu'
    aria-label={label}
  >
    {children}
  </div>
)

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

  &:hover:not(:disabled),
  &:focus-visible {
    background: var(--bg-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .label {
    flex: 1;
    min-width: 0;
  }

  .detail {
    color: var(--text-secondary);
  }
`

export const MenuItem = (
  { icon: Icon, detail, disabled, selected, onSelect, children }: {
    icon?: FunctionComponent<{ size?: number, strokeWidth?: number }>
    detail?: string
    disabled?: boolean
    selected?: boolean
    onSelect?: () => void
    children: ComponentChildren
  },
) => (
  <button
    type='button'
    css={itemStyle}
    role='menuitem'
    aria-checked={selected}
    disabled={disabled}
    onClick={onSelect}
  >
    {Icon ? <Icon size={20} strokeWidth={1.5} /> : undefined}
    <span className='label'>{children}</span>
    {detail ? <span className='detail'>{detail}</span> : undefined}
  </button>
)

const dividerStyle = css`
  height: 1px;
  margin: 0.8rem 0;
  background: var(--border-subtle);
`

export const MenuDivider = () => <div css={dividerStyle} role='separator' />
