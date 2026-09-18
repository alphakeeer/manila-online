import type { AccompliceLocation, Commodity, Decision, GameAction, GameState } from '../game'
import { annotationDocument, findBoardPosition, findCargoSlotPosition, playerPositionStyle, positionStyle } from './annotations'
import { commodityPresentation } from './commodityPresentation'
import { MarketPriceTrack } from './MarketPriceTrack'

const asset = (file: string) => new URL(`../../manila_assets/${file}`, import.meta.url).href
const laneName = ['left', 'center', 'right'] as const
const shareCanvas = { jade: 'share-1', nutmeg: 'share-2', silk: 'share-3', ginseng: 'share-4' } as const
const playerSprite = ['player_red.png', 'player_yellow.png', 'player_green.png', 'player_purple.png', 'player_blue.png']

function boardLocationName(location: Exclude<AccompliceLocation, { area: 'cargo' }>) {
  if (location.area === 'port' || location.area === 'shipyard') return `${location.area}-${location.berth.toLowerCase()}-accomplice-slot`
  return ({ pirateCaptain: 'pirate-boat-captain-slot', pirateCrew: 'pirate-boat-crew-slot', smallPilot: 'small-pilot-slot', largePilot: 'large-pilot-slot', insurance: 'insurance-office-accomplice-slot' } as const)[location.area]
}

function tokenBoardName(location: AccompliceLocation | null) {
  return location && location.area !== 'cargo' ? boardLocationName(location) : null
}

export function GameBoard({ state, decision, showPlayers, onAction, marketChanges = [] }: { state: GameState; decision: Decision | null; showPlayers: boolean; onAction: (action: GameAction) => void; marketChanges?: readonly Commodity[] }) {
  const placement = decision?.kind === 'placement' ? decision : null
  const boatsToDisplay = decision?.kind === 'launch'
    ? decision.boatIds.map((id, index) => ({ id, commodity: decision.commodities[index]!, lane: decision.lanes[index]!, position: 0 }))
    : state.boats.filter((boat) => boat.commodity !== null && boat.lane !== null && boat.position !== null)
  const submitPlacement = (location: AccompliceLocation) => placement && onAction({ type: 'placeAccomplice', playerId: placement.playerId, location, mortgageShareIds: [] })
  const boardOptions = placement?.options.filter((option) => option.location.area !== 'cargo') ?? []
  const cargoOptions = (boatId: string) => placement?.options.filter((option): option is typeof option & { location: Extract<AccompliceLocation, { area: 'cargo' }> } => option.location.area === 'cargo' && option.location.boatId === boatId) ?? []

  return <section className="board-panel" aria-label="游戏版图">
    <div className="panel-heading"><div><span>航线实况</span><h2>驶向马尼拉</h2></div><p>第 {state.voyage} 航程</p></div>
    <figure className="board-stage">
      <img className="board-stage__image" src={asset('game_board.jpg')} alt="马尼拉游戏版图" />
      <MarketPriceTrack state={state} changedCommodities={marketChanges} />
      {boatsToDisplay.map((boat) => {
        const commodity = boat.commodity!
        const route = findBoardPosition(annotationDocument, `${laneName[boat.lane!]}-route-space-${boat.position}`)
        const canvas = annotationDocument.shares.find((share) => share.id === shareCanvas[commodity])!
        const tokens = state.accomplices.filter((token) => token.location?.area === 'cargo' && token.location.boatId === boat.id)
        return <article key={boat.id} className="boat-share" style={positionStyle(annotationDocument.board, route)} aria-label={`${commodityPresentation(commodity).label}舢板`}>
          <img src={asset(`${commodity}_shares.png`)} alt="" />
          <strong className={commodityPresentation(commodity).className}>{commodityPresentation(commodity).label}</strong>
          {showPlayers && tokens.map((token) => {
            const location = token.location as Extract<AccompliceLocation, { area: 'cargo' }>
            const slot = findCargoSlotPosition(annotationDocument, commodity, location.slot)
            const playerIndex = state.players.findIndex((player) => player.id === token.playerId)
            return <img key={token.id} className="share-player" style={playerPositionStyle(canvas, slot)} src={asset(playerSprite[playerIndex] ?? 'player_red.png')} alt={`${state.players[playerIndex]?.name ?? ''}的同伙`} />
          })}
          {cargoOptions(boat.id).map((option) => {
            const slot = findCargoSlotPosition(annotationDocument, commodity, option.location.slot)
            return <button key={JSON.stringify(option.location)} className="share-slot" style={positionStyle(canvas, slot)} type="button" aria-label={`放置同伙：${commodityPresentation(commodity).label}，${option.cost} 比索`} onClick={() => submitPlacement(option.location)}>+</button>
          })}
        </article>
      })}
      {state.boats.filter((boat) => boat.commodity !== null && boat.berth !== null).map((boat) => {
        const position = findBoardPosition(annotationDocument, `${boat.status === 'port' ? 'port' : 'shipyard'}-${boat.berth!.toLowerCase()}-punt-slot`)
        const commodity = boat.commodity!
        return <span className={`berthed-share ${commodityPresentation(commodity).className}`} key={boat.id} style={positionStyle(annotationDocument.board, position)}>{commodityPresentation(commodity).label}</span>
      })}
      {showPlayers && state.accomplices.map((token) => { const name = tokenBoardName(token.location); if (!name) return null; const position = findBoardPosition(annotationDocument, name); const playerIndex = state.players.findIndex((player) => player.id === token.playerId); return <img key={token.id} className="board-player" style={playerPositionStyle(annotationDocument.board, position)} src={asset(playerSprite[playerIndex] ?? 'player_red.png')} alt={`${state.players[playerIndex]?.name ?? ''}的同伙`} /> })}
      {boardOptions.map((option) => { const location = option.location as Exclude<AccompliceLocation, { area: 'cargo' }>; const position = findBoardPosition(annotationDocument, boardLocationName(location)); return <button className="game-hotspot" key={JSON.stringify(location)} style={positionStyle(annotationDocument.board, position)} type="button" aria-label={`放置同伙：${location.area}，${option.cost} 比索`} onClick={() => submitPlacement(location)}>+</button> })}
    </figure>
  </section>
}
