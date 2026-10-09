import { useEffect, useState } from 'react'
import { commodityPresentation } from './commodityPresentation'
import type { FeedEvent } from './gameEvents'

function EventLine({ event }: { event: FeedEvent }) {
  const tint = event.commodity ? ` ${commodityPresentation(event.commodity).className}` : event.seat ? ` seat-${event.seat}` : ''
  return <li className={`feed-item feed-item--${event.tone}${tint}`}>
    <span className="feed-item__icon" aria-hidden="true">{event.icon}</span>
    <span className="feed-item__text">{event.text}</span>
  </li>
}

/** Persistent log (desktop sidebar, mobile drawer section). Newest first. */
export function EventFeed({ events }: { events: readonly FeedEvent[] }) {
  return <section className="side-card event-feed" aria-label="航海日志">
    <h2 className="side-card__title">航海日志</h2>
    {events.length === 0 ? <p className="side-card__empty">每一次出价、掷骰与靠港都会记在这里。</p>
      : <ol className="feed-list" aria-live="polite">{events.slice(0, 40).map((event) => <EventLine key={event.id} event={event} />)}</ol>}
  </section>
}

/** Transient toasts for phones, where the log sits below the fold. */
export function EventToasts({ events }: { events: readonly FeedEvent[] }) {
  const [visible, setVisible] = useState<FeedEvent[]>([])
  const newest = events[0]?.id
  useEffect(() => {
    if (!newest) return
    const fresh = events.slice(0, 3).filter((event) => event.id.split('-')[0] === newest.split('-')[0])
    setVisible(fresh)
    const timer = window.setTimeout(() => setVisible([]), 3600)
    return () => window.clearTimeout(timer)
    // Only a new batch (keyed by revision) replaces the toasts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest])
  if (visible.length === 0) return null
  return <ol className="event-toasts" aria-hidden="true">{visible.map((event) => <EventLine key={event.id} event={event} />)}</ol>
}
