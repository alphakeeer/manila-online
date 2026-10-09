import type { GameRoomSnapshot } from '@manila/protocol'
import type { CSSProperties, ReactNode } from 'react'
import { annotationDocument, findBoardPosition, findCargoSlot, hotspotStyle, type AnnotationItem } from './annotations'
import { commodityPresentation, type Commodity } from './commodityPresentation'
import { deltaText, locationLabel, playerName } from './labels'
import { MarketPriceTrack } from './MarketPriceTrack'
import { samePlacement, type PlacementChoice } from './placement'

/**
 * Keep production imports explicit: Vite must not glob every archival source image.
 * These are WebP derivatives of manila_assets/ (regenerate with scripts/optimize-assets.py).
 */
const assets = {
  board: new URL('../assets/game_board.webp', import.meta.url).href,
  nutmeg: new URL('../assets/nutmeg_shares.webp', import.meta.url).href,
  silk: new URL('../assets/silk_shares.webp', import.meta.url).href,
  jade: new URL('../assets/jade_shares.webp', import.meta.url).href,
  ginseng: new URL('../assets/ginseng_shares.webp', import.meta.url).href,
} as const
export const shareArt = assets

/** Warm the HTTP cache while players wait in the lobby, so the board paints instantly at game start. */
export function preloadGameAssets() {
  for (const url of Object.values(assets)) {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
  }
}
const laneName = ['left', 'center', 'right'] as const
const shareWidth = 221
const lastRouteSpace = 13

type Boat = GameRoomSnapshot['public']['boats'][number]
export interface LaunchPreviewRow { boatId: string; commodity: string; lane: number; startPosition: number }
export interface BoardPreview { launch?: readonly LaunchPreviewRow[]; pilotMoves?: ReadonlyArray<{ boatId: string; delta: number }> }

function boardSlotName(location: { area: string; berth?: 'A' | 'B' | 'C' | undefined }): string | null {
  switch (location.area) {
    case 'port': return `port-${location.berth!.toLowerCase()}-accomplice-slot`
    case 'shipyard': return `shipyard-${location.berth!.toLowerCase()}-accomplice-slot`
    case 'pirateCaptain': return 'pirate-boat-captain-slot'
    case 'pirateCrew': return 'pirate-boat-crew-slot'
    case 'smallPilot': return 'small-pilot-slot'
    case 'largePilot': return 'large-pilot-slot'
    case 'insurance': return 'insurance-office-accomplice-slot'
    default: return null
  }
}

/** Size the share tile against the board width so cargo hotspots inside it keep their own pixel size. */
function boatStyle(item: AnnotationItem): CSSProperties {
  const canvas = annotationDocument.board
  return {
    left: `${(item.x / canvas.width) * 100}%`,
    top: `${(item.y / canvas.height) * 100}%`,
    width: `${(shareWidth / canvas.width) * item.scale * 100}%`,
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg)`,
  }
}

function routeItem(lane: number, position: number) {
  const clamped = Math.max(0, Math.min(lastRouteSpace, position))
  return findBoardPosition(annotationDocument, `${laneName[lane] ?? 'center'}-route-space-${clamped}`)
}

function boatItem(boat: Boat): AnnotationItem | null {
  if ((boat.status === 'port' || boat.status === 'shipyard') && boat.berth) return findBoardPosition(annotationDocument, `${boat.status}-${boat.berth.toLowerCase()}-punt-slot`)
  if (boat.status === 'sailing' && boat.lane !== null && boat.position !== null) return routeItem(boat.lane, boat.position)
  return null
}

const initial = (nickname: string) => Array.from(nickname.trim())[0]?.toUpperCase() ?? '?'

interface GameBoardProps {
  snapshot: GameRoomSnapshot
  placementChoice?: PlacementChoice | null
  onSelectPlacement?: (location: PlacementChoice) => void
  preview?: BoardPreview | undefined
  actionableBoatIds?: readonly string[]
  onBoatAction?: (boatId: string) => void
  overlay?: ReactNode
}

/** The board only receives the public protocol projection. */
export function GameBoard({ snapshot, placementChoice = null, onSelectPlacement, preview, actionableBoatIds = [], onBoatAction, overlay }: GameBoardProps) {
  const view = snapshot.public
  const placementOptions = snapshot.decision?.kind === 'placement' ? snapshot.decision.options : []
  const nameOf = (seat: number) => playerName(view, seat)
  const marker = (token: { id: string; seat: number }, style: CSSProperties, label: string) => <span key={token.id} className={`accomplice-marker seat-${token.seat}${token.seat === snapshot.self.seat ? ' is-self' : ''}`} style={style} title={`${nameOf(token.seat)}`} aria-label={label}>{initial(nameOf(token.seat))}</span>

  const boats = view.boats.filter((boat) => boat.commodity !== null).map((boat) => ({ boat, item: boatItem(boat) })).filter((entry): entry is { boat: Boat; item: AnnotationItem } => entry.item !== null)
  const launchGhosts = preview?.launch ?? []
  const pilotGhosts = (preview?.pilotMoves ?? []).flatMap((move) => {
    const boat = view.boats.find((candidate) => candidate.id === move.boatId)
    if (!boat?.commodity || boat.lane === null || boat.position === null) return []
    const target = boat.position + move.delta
    return [{ boat, delta: move.delta, arrives: target > lastRouteSpace, item: routeItem(boat.lane, target) }]
  })

  return <section className="board-panel" aria-label="游戏版图">
    <figure className="board-stage">
      <img className="board-stage__image" src={assets.board} alt="马尼拉游戏版图" draggable={false} />
      <MarketPriceTrack market={view.market} />
      {launchGhosts.map((row) => {
        const commodity = row.commodity as Commodity
        return <div key={`ghost-${row.boatId}`} className="boat-share is-ghost" style={boatStyle(routeItem(row.lane, row.startPosition))} aria-hidden="true">
          <img src={assets[commodity]} alt="" draggable={false} />
          <span className={`boat-share__tag ${commodityPresentation(commodity).className}`}>{commodityPresentation(commodity).label} · {row.startPosition}</span>
        </div>
      })}
      {boats.map(({ boat, item }) => {
        const commodity = boat.commodity!
        const presentation = commodityPresentation(commodity)
        const cargoOptions = placementOptions.filter((option) => option.location.area === 'cargo' && option.location.boatId === boat.id)
        const actionable = actionableBoatIds.includes(boat.id)
        const docked = boat.status !== 'sailing'
        const classes = ['boat-share', `boat-share--${commodity}`, docked ? `is-${boat.status}` : '', actionable ? 'is-actionable' : '', boat.plundered ? 'is-plundered' : '', boat.position === lastRouteSpace && !docked ? 'is-at-pirates' : ''].filter(Boolean).join(' ')
        return <article key={boat.id} className={classes} style={boatStyle(item)} aria-label={`${presentation.label}舢板${docked ? (boat.status === 'port' ? `，停靠港口 ${boat.berth}` : `，修船厂 ${boat.berth}`) : `，第 ${boat.position} 格`}`}>
          <img src={assets[commodity]} alt="" draggable={false} />
          {!docked && <span className={`boat-share__tag ${presentation.className}`}>{presentation.label} · {boat.position}</span>}
          {boat.plundered && <span className="boat-share__skull" aria-hidden="true">☠</span>}
          {actionable && onBoatAction && <button type="button" className="boat-share__action" aria-label={`推进${presentation.label}舢板`} onClick={() => onBoatAction(boat.id)} />}
          {cargoOptions.map((option) => {
            const slot = option.location.slot ?? 0
            const position = findCargoSlot(annotationDocument, commodity, slot)
            const selected = placementChoice !== null && samePlacement(placementChoice, option.location)
            return <button key={`${boat.id}-slot-${slot}`} type="button" className={`game-hotspot game-hotspot--cargo${selected ? ' is-selected' : ''}`} style={hotspotStyle(position.canvas, position.item)} aria-label={`货物位 ${slot + 1}，费用 ${option.cost}`} onClick={() => onSelectPlacement?.(option.location)}>{option.cost}</button>
          })}
          {view.accomplices.filter((token) => token.location?.area === 'cargo' && token.location.boatId === boat.id).map((token) => {
            const slot = token.location?.slot ?? 0
            const position = findCargoSlot(annotationDocument, commodity, slot)
            return marker(token, hotspotStyle(position.canvas, position.item), `${nameOf(token.seat)} 的同伙在${presentation.label}舢板货物位 ${slot + 1}`)
          })}
        </article>
      })}
      {pilotGhosts.map((ghost) => {
        const commodity = ghost.boat.commodity!
        return <div key={`pilot-${ghost.boat.id}`} className="boat-share is-ghost is-pilot-ghost" style={boatStyle(ghost.item)} aria-hidden="true">
          <img src={assets[commodity]} alt="" draggable={false} />
          <span className="boat-share__tag boat-share__tag--delta">{deltaText(ghost.delta)}{ghost.arrives ? ' 入港' : ''}</span>
        </div>
      })}
      {view.accomplices.filter((token) => token.location !== null && token.location.area !== 'cargo').map((token) => {
        const name = boardSlotName(token.location!)
        if (!name) return null
        return marker(token, hotspotStyle(annotationDocument.board, findBoardPosition(annotationDocument, name)), `${nameOf(token.seat)} 的同伙：${locationLabel(token.location!, view.boats)}`)
      })}
      {placementOptions.map((option) => {
        const name = boardSlotName(option.location)
        if (!name) return null
        const item = findBoardPosition(annotationDocument, name)
        const selected = placementChoice !== null && samePlacement(placementChoice, option.location)
        return <button key={name} type="button" className={`game-hotspot${selected ? ' is-selected' : ''}`} style={hotspotStyle(annotationDocument.board, item)} aria-label={`放置同伙：${locationLabel(option.location, view.boats)}，费用 ${option.cost}`} onClick={() => onSelectPlacement?.(option.location)}>{option.cost}</button>
      })}
      {overlay}
    </figure>
  </section>
}
