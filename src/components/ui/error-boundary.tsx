import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { useErrorBoundary } from 'preact/hooks'

const style = css`
  max-width: 56rem;
  margin: 4.8rem auto;
  padding: 2.4rem;
  border-radius: 1.2rem;
  background: var(--bg-subtle);
  text-align: center;

  h2 {
    margin: 0 0 0.8rem;
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  p {
    margin: 0 0 1.6rem;
    font-size: 1.4rem;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  button {
    height: 3.6rem;
    padding: 0 1.6rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
  }
`

export const ErrorBoundary = ({ children }: { children: ComponentChildren }) => {
  const [error, reset] = useErrorBoundary()

  if (!error) return <>{children}</>

  return (
    <div css={style} role='alert'>
      <h2>Something went wrong</h2>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <button type='button' onClick={reset}>Try again</button>
    </div>
  )
}

export default ErrorBoundary
