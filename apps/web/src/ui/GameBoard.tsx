import type { GameRoomSnapshot } from '@manila/protocol'
import { annotationDocument, findBoardPosition, positionStyle } from './annotations'
import { commodityPresentation } from './commodityPresentation'
import { MarketPriceTrack } from './MarketPriceTrack'

const asset = (file: string) => new URL(`../../../../manila_assets/${file}`, import.meta.url).href
const laneName = ['left', 'center', 'right'] as const

/** The board only receives the public protocol projection. */
export function GameBoard({ snapshot }: { snapshot: GameRoomSnapshot }) {
  const boats = snapshot.public.boats.filter((boat) => boat.commodity && boat.lane !== null && boat.position !== null)
  return <section className="board-panel" aria-label="游戏版图">
    <div className="panel-heading"><div><span>航线实况</span><h2>驶向马尼拉</h2></div><p>第 {snapshot.public.voyage} 航程</p></div>
    <figure className="board-stage">
      <img className="board-stage__image" src={asset('game_board.jpg')} alt="马尼拉游戏版图" />
      <MarketPriceTrack market={snapshot.public.market} />
      {boats.filter((boat) => boat.status === 'sailing').map((boat) => {
        const commodity = boat.commodity!
        const route = findBoardPosition(annotationDocument, `${laneName[boat.lane!]!}-route-space-${boat.position}`)
        return <article key={boat.id} className="boat-share" style={positionStyle(annotationDocument.board, route)} aria-label={`${commodityPresentation(commodity).label}舢板`}>
          <img src={asset(`${commodity}_shares.png`)} alt="" />
          <strong className={commodityPresentation(commodity).className}>{commodityPresentation(commodity).label}</strong>
        </article>
      })}
      {boats.filter((boat) => boat.berth).map((boat) => {
        const commodity = boat.commodity!
        const position = findBoardPosition(annotationDocument, `${boat.status === 'port' ? 'port' : 'shipyard'}-${boat.berth!.toLowerCase()}-punt-slot`)
        return <span className={`berthed-share ${commodityPresentation(commodity).className}`} key={boat.id} style={positionStyle(annotationDocument.board, position)}>{commodityPresentation(commodity).label}</span>
      })}
    </figure>
  </section>
}
