import { css } from '@emotion/react'
import { useState } from 'preact/hooks'

const style = css`
  flex: none;
  height: 3.6rem;
  padding: 0 1.6rem;
  border: none;
  border-radius: 1.8rem;
  background: #f1f1f1;
  color: #0f0f0f;
  font-size: 1.4rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: #ffffff;
  }

  &.subscribed {
    background: #272727;
    color: #f1f1f1;
  }

  &.subscribed:hover {
    background: #3f3f3f;
  }
`

export const SubscribeButton = () => {
  const [subscribed, setSubscribed] = useState(false)
  return (
    <button
      type='button'
      css={style}
      className={subscribed ? 'subscribed' : undefined}
      onClick={() => setSubscribed(value => !value)}
    >
      {subscribed ? 'Subscribed' : 'Subscribe'}
    </button>
  )
}

export default SubscribeButton
