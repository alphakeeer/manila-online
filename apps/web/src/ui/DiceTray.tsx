import { useEffect, useState } from 'react'
import { commodityPresentation, type Commodity } from './commodityPresentation'

const pipLayout: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}

export function DieFace({ value, commodity, rolling = false }: { value: number; commodity: Commodity; rolling?: boolean }) {
  const pips = pipLayout[value] ?? []
  return <span className={`die die--${commodity}${rolling ? ' is-rolling' : ''}`} role="img" aria-label={`${commodityPresentation(commodity).label}骰子 ${value} 点`}>
    {Array.from({ length: 9 }, (_, index) => <i key={index} className={pips.includes(index) ? 'pip' : undefined} />)}
  </span>
}

/** Shows the public dice; `rollKey` changes trigger a short tumble before the server result settles. */
export function DiceTray({ dice, rollKey, variant = 'inline' }: { dice: Partial<Record<Commodity, number>> | null; rollKey: number; variant?: 'inline' | 'stage' }) {
  const [rolling, setRolling] = useState(false)
  const [faces, setFaces] = useState<Partial<Record<Commodity, number>>>({})

  useEffect(() => {
    if (rollKey === 0 || !dice) return
    setRolling(true)
    const shuffle = window.setInterval(() => setFaces(Object.fromEntries(Object.keys(dice).map((commodity) => [commodity, 1 + Math.floor(Math.random() * 6)]))), 90)
    const settle = window.setTimeout(() => { window.clearInterval(shuffle); setRolling(false) }, 950)
    return () => { window.clearInterval(shuffle); window.clearTimeout(settle) }
    // Only a new roll restarts the tumble; the dice object identity changes on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollKey])

  const entries = Object.entries(dice ?? {}).filter(([, value]) => value > 0) as Array<[Commodity, number]>
  if (entries.length === 0) return null
  return <div className={`dice-tray dice-tray--${variant}${rolling ? ' is-rolling' : ''}`} aria-live="polite" aria-label="本轮骰子">
    {entries.map(([commodity, value]) => <span key={commodity} className="dice-tray__die">
      <DieFace value={rolling ? faces[commodity] ?? value : value} commodity={commodity} rolling={rolling} />
      {variant === 'inline' && <small className={commodityPresentation(commodity).className}>{commodityPresentation(commodity).label}</small>}
    </span>)}
  </div>
}
