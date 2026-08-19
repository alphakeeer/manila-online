import type { CSSProperties } from 'react'
import type { DemoBoat, DemoPlacement } from './types'

interface BoardStageProps {
  boardImageUrl: string
  boats: DemoBoat[]
  placements: DemoPlacement[]
  selectedPlacementId: string | null
}

export function BoardStage({ boardImageUrl, boats, placements, selectedPlacementId }: BoardStageProps) {
  return (
    <figure className="board-stage">
      <img className="board-stage__image" src={boardImageUrl} alt="马尼拉游戏版图" />
      {boats.map((boat) => (
        <span
          key={boat.id}
          className="demo-boat"
          aria-label={`${boat.cargo}舢板位于航线 ${boat.routePosition}`}
          style={{
            '--boat-color': boat.color,
            '--boat-x': `${boat.x}%`,
            '--boat-y': `${boat.y}%`,
          } as CSSProperties}
        >
          <span>{boat.cargo.slice(0, 1)}</span>
        </span>
      ))}
      {placements.map((placement) => (
        <span
          key={placement.id}
          className={`board-hotspot${selectedPlacementId === placement.id ? ' is-selected' : ''}`}
          aria-hidden="true"
          style={{
            '--spot-x': `${placement.boardX}%`,
            '--spot-y': `${placement.boardY}%`,
          } as CSSProperties}
        />
      ))}
    </figure>
  )
}
