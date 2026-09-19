import type { GameRoomSnapshot } from '@manila/protocol'
import { annotationDocument, findBoardPosition, findCargoSlot, hotspotStyle, positionStyle } from './annotations'
import { commodityPresentation } from './commodityPresentation'
import { MarketPriceTrack } from './MarketPriceTrack'
import { samePlacement, type PlacementChoice } from './placement'

/** Keep production imports explicit: Vite must not glob every archival source image. */
const assets = {
  board: new URL('../../../../manila_assets/game_board.jpg', import.meta.url).href,
  nutmeg: new URL('../../../../manila_assets/nutmeg_shares.png', import.meta.url).href,
  silk: new URL('../../../../manila_assets/silk_shares.png', import.meta.url).href,
  jade: new URL('../../../../manila_assets/jade_shares.png', import.meta.url).href,
  ginseng: new URL('../../../../manila_assets/ginseng_shares.png', import.meta.url).href,
} as const
const laneName = ['left', 'center', 'right'] as const

function boardHotspotName(location: PlacementChoice): string | null {
  switch (location.area) {
    case 'port': return `port-${location.berth!.toLowerCase()}-accomplice-slot`
    case 'shipyard': return `shipyard-${location.berth!.toLowerCase()}-accomplice-slot`
    case 'pirateCaptain': return 'pirate-boat-captain-slot'
    case 'pirateCrew': return 'pirate-boat-crew-slot'
    case 'smallPilot': return 'small-pilot-slot'
    case 'largePilot': return 'large-pilot-slot'
    case 'insurance': return 'insurance-office-accomplice-slot'
    case 'cargo': return null
    default: return null
  }
}

function accompliceBoardName(location: { area: string; berth?: 'A' | 'B' | 'C' | undefined; boatId?: string | undefined; slot?: number | undefined }): string | null {
  switch (location.area) {
    case 'port': return `port-${location.berth!.toLowerCase()}-accomplice-slot`
    case 'shipyard': return `shipyard-${location.berth!.toLowerCase()}-accomplice-slot`
    case 'pirateCaptain': return 'pirate-boat-captain-slot'
    case 'pirateCrew': return 'pirate-boat-crew-slot'
    case 'smallPilot': return 'small-pilot-slot'
    case 'largePilot': return 'large-pilot-slot'
    case 'insurance': return 'insurance-office-accomplice-slot'
    case 'cargo': return null
    default: return null
  }
}

interface GameBoardProps {
  snapshot: GameRoomSnapshot
  placementChoice?: PlacementChoice | null
  onSelectPlacement?: (location: PlacementChoice) => void
}

/** The board only receives the public protocol projection. */
export function GameBoard({ snapshot, placementChoice = null, onSelectPlacement }: GameBoardProps) {
  const boats = snapshot.public.boats.filter((boat) => boat.commodity && boat.lane !== null && boat.position !== null)
  const placementOptions = snapshot.decision?.kind === 'placement' ? snapshot.decision.options : []
  return <section className="board-panel" aria-label="游戏版图">
    <div className="panel-heading"><div><span>航线实况</span><h2>驶向马尼拉</h2></div><p>第 {snapshot.public.voyage} 航程</p></div>
    <figure className="board-stage">
      <img className="board-stage__image" src={assets.board} alt="马尼拉游戏版图" />
      <MarketPriceTrack market={snapshot.public.market} />
      {boats.filter((boat) => boat.status === 'sailing').map((boat) => {
        const commodity = boat.commodity!
        const route = findBoardPosition(annotationDocument, `${laneName[boat.lane!]!}-route-space-${boat.position}`)
        const cargoOptions = placementOptions.filter((option) => option.location.area === 'cargo' && option.location.boatId === boat.id)
        return <article key={boat.id} className="boat-share" style={positionStyle(annotationDocument.board, route)} aria-label={`${commodityPresentation(commodity).label}舢板`}>
          <img src={assets[commodity]} alt="" />
          <strong className={commodityPresentation(commodity).className}>{commodityPresentation(commodity).label}</strong>
          {cargoOptions.map((option) => {
            const slot = option.location.slot ?? 0
            const position = findCargoSlot(annotationDocument, commodity, slot)
            const selected = placementChoice !== null && samePlacement(placementChoice, option.location)
            return <button key={`${boat.id}-slot-${slot}`} type="button" className={`game-hotspot game-hotspot--cargo${selected ? ' is-selected' : ''}`} style={hotspotStyle(position.canvas, position.item)} aria-label={`货物位 ${slot + 1}，费用 ${option.cost}`} onClick={() => onSelectPlacement?.(option.location)}>{slot + 1}</button>
          })}
          {snapshot.public.accomplices.filter((token) => token.location?.area === 'cargo' && token.location.boatId === boat.id).map((token) => {
            const slot = token.location?.slot ?? 0
            const position = findCargoSlot(annotationDocument, commodity, slot)
            return <span key={token.id} className={`accomplice-marker accomplice-marker--seat-${token.seat}`} style={hotspotStyle(position.canvas, position.item)} title={`${token.seat} 号位同伙`} aria-label={`${token.seat} 号位同伙在${commodityPresentation(commodity).label}舢板货物位 ${slot + 1}`}>{token.seat}</span>
          })}
        </article>
      })}
      {boats.filter((boat) => boat.berth).map((boat) => {
        const commodity = boat.commodity!
        const position = findBoardPosition(annotationDocument, `${boat.status === 'port' ? 'port' : 'shipyard'}-${boat.berth!.toLowerCase()}-punt-slot`)
        return <span className={`berthed-share ${commodityPresentation(commodity).className}`} key={boat.id} style={positionStyle(annotationDocument.board, position)}>{commodityPresentation(commodity).label}</span>
      })}
      {snapshot.public.accomplices.filter((token) => token.location !== null && token.location.area === 'cargo').map((token) => {
        const boat = snapshot.public.boats.find((candidate) => candidate.id === token.location?.boatId)
        if (!boat || !boat.berth) return null
        const position = findBoardPosition(annotationDocument, `${boat.status === 'port' ? 'port' : 'shipyard'}-${boat.berth.toLowerCase()}-punt-slot`)
        return <span key={token.id} className={`accomplice-marker accomplice-marker--seat-${token.seat}`} style={hotspotStyle(annotationDocument.board, position)} title={`${token.seat} 号位同伙`} aria-label={`${token.seat} 号位同伙随舢板停靠`}>{token.seat}</span>
      })}
      {snapshot.public.accomplices.filter((token) => token.location !== null && token.location.area !== 'cargo').map((token) => {
        const name = accompliceBoardName(token.location!)
        if (!name) return null
        const item = findBoardPosition(annotationDocument, name)
        return <span key={token.id} className={`accomplice-marker accomplice-marker--seat-${token.seat}`} style={hotspotStyle(annotationDocument.board, item)} title={`${token.seat} 号位同伙`} aria-label={`${token.seat} 号位同伙：${token.location!.area}`}>{token.seat}</span>
      })}
      {placementOptions.map((option) => {
        const name = boardHotspotName(option.location)
        if (!name) return null
        const item = findBoardPosition(annotationDocument, name)
        const selected = placementChoice !== null && samePlacement(placementChoice, option.location)
        return <button key={name} type="button" className={`game-hotspot${selected ? ' is-selected' : ''}`} style={hotspotStyle(annotationDocument.board, item)} aria-label={`放置同伙：${option.location.area}，费用 ${option.cost}`} onClick={() => onSelectPlacement?.(option.location)}>{option.cost}</button>
      })}
    </figure>
  </section>
}
