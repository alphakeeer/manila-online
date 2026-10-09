import { useEffect, useRef, useState } from 'react'

export const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Tween a displayed number toward `value`; returns the shown value and the last change for a floating delta. */
export function useAnimatedNumber(value: number, duration = 650) {
  const [shown, setShown] = useState(value)
  const [delta, setDelta] = useState<{ amount: number; key: number } | null>(null)
  const from = useRef(value)
  const shownRef = useRef(value)
  shownRef.current = shown

  useEffect(() => {
    const start = shownRef.current
    if (start === value) return
    from.current = start
    setDelta({ amount: value - start, key: Date.now() })
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') { setShown(value); return }
    const began = performance.now()
    let frame = 0
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / duration)
      const eased = 1 - (1 - progress) ** 3
      setShown(Math.round(from.current + (value - from.current) * eased))
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  useEffect(() => {
    if (!delta) return
    const timer = window.setTimeout(() => setDelta(null), 1600)
    return () => window.clearTimeout(timer)
  }, [delta])

  return { shown, delta }
}
