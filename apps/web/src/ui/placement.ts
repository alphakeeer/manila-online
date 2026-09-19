import type { GameCommandRequest } from '@manila/protocol'

export type PlacementLocation = Extract<GameCommandRequest['action'], { type: 'placeAccomplice' }>['location']

/** Wire decisions expose `area` as a plain string; commands narrow it at the submit boundary. */
export interface PlacementChoice {
  area: string
  boatId?: string | undefined
  slot?: number | undefined
  berth?: 'A' | 'B' | 'C' | undefined
}

export function samePlacement(left: PlacementChoice, right: PlacementChoice) {
  if (left.area !== right.area) return false
  if (left.area === 'cargo' && right.area === 'cargo') return left.boatId === right.boatId && left.slot === right.slot
  if ((left.area === 'port' || left.area === 'shipyard') && (right.area === 'port' || right.area === 'shipyard')) return left.berth === right.berth
  return true
}
